"""Analyzes a trimmed challenge video with Gemini and counts valid reps.

This is deliberately a separate file from video_trimmer.py: that file's
only job is producing a 25-second clip with ffmpeg; this file's only job
is sending that clip to Gemini and judging it. It explicitly judges each
rep's range of motion and throws out reps that don't reach full depth —
e.g. a push-up where the chest never gets close to the floor, or a
sit-up that doesn't bring the torso up to vertical, doesn't count, even
if the up/down motion pattern is there.

Flow (see app.py's /api/challenges/<id>/submit route for the real caller):
    raw video -> video_trimmer.trim_first_25_seconds() (ffmpeg)
              -> this file's Gemini call, judging form per rep
              -> {"reps": int, "rejected": int, "notes": str}

Usage:
    python rep_form_analyzer.py <video> <exercise: pushups|situps|pullups>

Requires:
    ffmpeg installed and on PATH
    pip install google-genai python-dotenv
    GEMINI_API_KEY=... in .env next to this script
"""

import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

from video_trimmer import CHALLENGE_SECONDS, RepCountError, trim_first_25_seconds

# "pro" tiers aren't usable on this API key's plan (confirmed via a live
# 429 -- 0 free-tier quota), and "flash-lite" was measurably too weak for
# this: it repeatedly counted partial reps and hand-assisted reps (e.g.
# pushing off the thighs during a sit-up) as valid despite explicit rules
# against it. gemini-3.5-flash is the strongest model actually usable on
# this quota -- see analyze_form_gemini.py, which hit the identical issue.
GEMINI_MODEL = "gemini-3.5-flash"

CHALLENGE_EXERCISES = {
    "pushups": {
        "label": "Push-ups",
        "rep_definition": (
            "one full push-up: starting from a straight-arm plank, chest lowers to near "
            "the floor with elbows bending, then pushes back up to full arm extension"
        ),
    },
    "situps": {
        "label": "Sit-ups",
        "rep_definition": (
            "one full sit-up: starting lying on the back, torso rises until roughly "
            "vertical/near the knees, then returns back down to the floor"
        ),
    },
    "pullups": {
        "label": "Pull-ups",
        "rep_definition": (
            "one full pull-up: starting from a dead hang with arms extended, chin rises "
            "above the bar, then the body lowers back to a full hang"
        ),
    },
}

# What "full range of motion" means per exercise — this is what actually
# separates a counted rep from a rejected one, distinct from just the
# up/down movement pattern used to spot a rep candidate in the first place.
# Each exercise's standard is a numbered checklist, not prose — every rep
# gets scored against these EXACT numbered checks (see CHECKLIST_INSTRUCTIONS
# below), which forces an explicit per-rep judgment instead of a vague
# overall impression. Prose-only standards were tried first and repeatedly
# let bad reps through (partial range, hands pushing off the thighs on
# sit-ups) despite explicitly forbidding them — an unstructured "judge this
# against these rules" pass lets the model pattern-match "looks like a
# rep" instead of actually checking each rule.
FORM_STANDARDS = {
    "pushups": [
        (
            "Full bottom depth, clearly visible: the chest lowers to within a few "
            "inches of the floor (elbows bending to roughly 90 degrees or less) "
            "before pressing back to full arm extension. A shallow dip that doesn't "
            "approach the floor fails this even though it looks like a push-up "
            "motion. If the bottom position isn't clearly visible for this "
            "rep — out of frame, blocked from view, too blurry/dark to tell — this "
            "check fails; never assume it was deep enough just because you "
            "couldn't see it."
        ),
        (
            "Straight body line: the hips don't sag down or pike up sharply during "
            "the rep — the body stays a roughly straight line from shoulders to "
            "ankles."
        ),
    ],
    "situps": [
        (
            "Hands stay on the head, the WHOLE rep: fingers laced behind the head "
            "or hands against the temples/ears, from the bottom through the top and "
            "back to the bottom, with no gap. This check FAILS if at any point the "
            "hands leave the head — reaching to the floor or legs, resting on or "
            "pushing off the thighs/knees to help rise, grabbing the shins, using a "
            "partner or object for assistance, or crossing the arms over the chest "
            "instead. This is the single most commonly missed check — people "
            "frequently push off their thighs right at the bottom-to-rise "
            "transition, which is easy to skim past. Look specifically at that "
            "transition moment for every rep, not just the rise and the top."
        ),
        (
            "Full top range: the torso rises until the chest is roughly over or "
            "past the knees (near-vertical). A small crunch that only lifts the "
            "head/shoulders a few inches off the ground fails this."
        ),
        (
            "Full bottom range, clearly visible, EVERY rep: the torso returns all "
            "the way down until the upper back/shoulder blades are flat against the "
            "floor again before the next rise begins. Stopping partway down and "
            "rising again without fully touching the floor fails this — check the "
            "bottom of every single rep, not just the first, since fatigue often "
            "shrinks the range partway through a set. If the bottom of a rep isn't "
            "clearly visible for this rep, this check fails; never assume the back "
            "reached the floor just because you didn't clearly see it."
        ),
    ],
    "pullups": [
        (
            "Full top position: the chin clearly rises above the bar."
        ),
        (
            "Full bottom dead hang, clearly visible, EVERY rep: the arms fully "
            "straighten before the next rep starts. If the bottom position isn't "
            "clearly visible for this rep — out of frame, blocked from view, too "
            "blurry to tell if the arms fully straightened — this check fails; "
            "never assume it was a full hang just because you couldn't see it."
        ),
    ],
}


# Gemini's video understanding samples at a default of roughly 1 frame per
# second unless told otherwise — nowhere near enough to reliably see every
# rep of a fast bodyweight exercise (a push-up cadence of one rep every
# 1-2.5 seconds means a 1fps sample can easily land entirely on the "up"
# position of several reps in a row and never see a single "down"). This
# was the actual root cause of significant undercounting (e.g. a person
# doing 11 push-ups being scored as 6) — the video content and the prompt
# were both fine, Gemini just wasn't being shown enough of the video.
# VideoMetadata.fps forces a much denser sample.
#
# NOTE: video_trimmer.py's ffmpeg step re-encodes the source clip at only
# 15fps, so requesting a sample rate above 15 here doesn't get Gemini any
# additional real frames -- there's nothing beyond the source's own rate
# to sample. Values above 8 (up to and including 15) were also observed
# to measurably increase how often Gemini's safety classifier flagged
# completely ordinary sit-up footage as PROHIBITED_CONTENT and returned
# nothing, and the effect wasn't even monotonic with fps (8 and 12 passed
# the same clip that got blocked at 10) -- meaning it's flaky classifier
# noise, not something a "better" fps value reliably avoids. See
# _call_gemini_with_form_check's retry-on-block logic for the mitigation.
GEMINI_VIDEO_SAMPLE_FPS = 15

# How many times to retry a call that Gemini's safety classifier blocked
# (empty response + prompt_feedback.block_reason set) before giving up.
# Observed to be flaky/non-deterministic on completely ordinary workout
# footage (same clip, same fps: blocked once, passed on retry) rather
# than a real content violation, so retrying the identical request is a
# legitimate fix here, not just papering over a real block.
MAX_SAFETY_BLOCK_RETRIES = 2


def _call_gemini_with_form_check(video_bytes, exercise):
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise RepCountError("google-genai package not installed. Run: pip install google-genai")

    load_dotenv()
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RepCountError("GEMINI_API_KEY not set in .env")

    config = CHALLENGE_EXERCISES[exercise]
    checks = FORM_STANDARDS[exercise]
    checklist_text = "\n".join(f"{i + 1}. {check}" for i, check in enumerate(checks))
    check_labels = ", ".join(f"Check {i + 1}: YES/NO" for i in range(len(checks)))

    prompt = f"""You are judging a {CHALLENGE_SECONDS}-second {config['label']} challenge. You must count EVERY rep accurately — neither undercounting nor overcounting is acceptable, so be precise, not generous.

A rep is defined as: {config['rep_definition']}. This is ONE complete cycle (e.g. down AND back up) — never count the downward half and the upward half of the same movement as two separate reps. If you find yourself listing two consecutive entries with no real pause or reset between them, they are almost certainly the same physical rep split in two — that is a common mistake and you must avoid it.

A rep is VALID only if it passes EVERY check below — a single failed check rejects the whole rep, no matter how good the rest of it looks:
{checklist_text}

Step 1 — Go through the clip rep-by-rep with an explicit checklist.
Watch the ENTIRE clip carefully from start to finish at normal speed (not a quick skim), chronologically. For EVERY attempt at the movement you observe — including ones that look partial, rushed, or clearly bad form; list those too, do not skip them — write one line in EXACTLY this format:
"Rep <n> (<mm:ss>): {check_labels}. Verdict: VALID/REJECTED."
Answer each numbered check independently, based only on what you actually see for THAT specific rep — do not let a YES on one check bias your answer on another, and do not default to YES just because the overall rep looks fine at a glance. A rep still in progress and not completed by the end of the clip doesn't count as an attempt.

Step 2 — Check your own list for duplicate entries.
A real rep takes at least half a second. If any two consecutive entries are implausibly close together in timestamp, you likely split one physical rep into two entries — merge them into one and renumber before continuing.

Step 3 — Report the totals.
After your rep-by-rep list, finish your response with EXACTLY these three lines and nothing after them:
REPS: <integer — count of entries marked VALID after Step 2's merge>
REJECTED: <integer — count of entries marked REJECTED>
NOTES: <one short sentence — if reps were rejected, name which numbered check failed most often, quoting its short description>

If the video does not show the exercise at all, skip straight to:
REPS: 0
REJECTED: 0
NOTES: <why>"""

    client = genai.Client(api_key=api_key)
    video_part = types.Part(
        inline_data=types.Blob(data=video_bytes, mime_type="video/mp4"),
        video_metadata=types.VideoMetadata(fps=GEMINI_VIDEO_SAMPLE_FPS),
    )

    for attempt in range(MAX_SAFETY_BLOCK_RETRIES + 1):
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[video_part, prompt],
            # This is a judgment task that should give the same answer every
            # time given the same footage, not a creative one -- the default
            # temperature was observed to produce noticeably different rep
            # counts (attempt count and pass/fail verdicts both varied) across
            # repeated calls on the exact same video. temperature=0 makes the
            # model consistently pick its most likely/confident answer instead
            # of sampling across plausible ones.
            config=types.GenerateContentConfig(temperature=0),
        )
        if response.text:
            return response.text
        # Empty text + a set block_reason means the safety classifier
        # flagged the video, not that Gemini genuinely had nothing to say.
        # This was observed to be flaky on completely ordinary sit-up
        # footage (retrying the identical request succeeded), so retry a
        # couple of times before giving up rather than failing the user's
        # submission outright on what's very likely a false positive.
    return ""


def _parse_response(text):
    # REPS/REJECTED/NOTES are asked for as the LAST three lines of the
    # response (after the rep-by-rep list), so search from the end —
    # a rep-by-rep breakdown line could otherwise coincidentally contain
    # matching text and get picked up by a naive first-match search.
    reps_matches = re.findall(r"REPS:\s*(\d+)", text)
    if not reps_matches:
        raise RepCountError("Couldn't count reps from the video. Please try a clearer recording.")
    rejected_matches = re.findall(r"REJECTED:\s*(\d+)", text)
    notes_matches = re.findall(r"NOTES:\s*(.+)", text)
    return {
        "reps": int(reps_matches[-1]),
        "rejected": int(rejected_matches[-1]) if rejected_matches else 0,
        "notes": notes_matches[-1].strip() if notes_matches else "",
    }


def analyze_reps(video_path, exercise, trimmed_path=None):
    """Trim the first 25s of video_path (via video_trimmer.py) and count
    only FULL-RANGE-OF-MOTION reps of `exercise`.

    Returns {"reps": int, "rejected": int, "notes": str}. Raises
    RepCountError on failure. trimmed_path lets the caller control (and
    clean up) the intermediate clip; defaults to
    "<input>_challenge.mp4" next to the input.
    """
    if exercise not in CHALLENGE_EXERCISES:
        raise RepCountError(f"Unknown challenge exercise: {exercise}")

    input_path = Path(video_path)
    if not input_path.exists():
        raise RepCountError(f"Video not found: {input_path}")

    if trimmed_path is None:
        trimmed_path = input_path.with_name(f"{input_path.stem}_challenge.mp4")
    trimmed_path = Path(trimmed_path)

    trim_first_25_seconds(input_path, trimmed_path)
    video_bytes = trimmed_path.read_bytes()
    raw = _call_gemini_with_form_check(video_bytes, exercise)
    return _parse_response(raw)


def main():
    if len(sys.argv) < 3:
        sys.exit(f"Usage: python rep_form_analyzer.py <video> <exercise: {'|'.join(CHALLENGE_EXERCISES)}>")
    result = analyze_reps(sys.argv[1], sys.argv[2])
    print(f"Valid reps: {result['reps']}")
    if result["rejected"]:
        print(f"Rejected (bad form): {result['rejected']}")
    if result["notes"]:
        print(f"Notes: {result['notes']}")


if __name__ == "__main__":
    main()
