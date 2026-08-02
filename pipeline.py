"""End-to-end pipeline: trim a raw workout video, then analyze the
trimmed clip's form with Gemini, and print the result.

Flow:
    user's raw video -> trim_video.trim_video() -> trimmed clip
                      -> analyze_form_gemini (sample frames + call Gemini)
                      -> form analysis printed to the user

Usage:
    python pipeline.py <input_video> <exercise>

    exercise is one of: chest_fly, bicep_curl, tricep_pushdown, pull_up

Example:
    python pipeline.py IMG_5896.MOV chest_fly

Requires:
    ffmpeg installed and on PATH
    pip install opencv-python google-genai python-dotenv

    Put your key in a .env file next to this script:
        GEMINI_API_KEY=...
"""

import re
import sys
from pathlib import Path

from analyze_form_gemini import (
    EXERCISES,
    GEMINI_MODEL,
    call_gemini,
    parse_scores,
    resolve_exercise,
    strip_score_lines,
    video_mime_type,
)
from trim_video import DURATION_SECONDS, get_video_duration, trim_video


def run_pipeline(input_video, exercise, trimmed_path=None):
    """Trim input_video and analyze it with Gemini.

    exercise can be one of the curated EXERCISES keys/labels, or any other
    exercise name from the larger searchable library — resolve_exercise()
    falls back to generic form-analysis notes for anything not curated.

    trimmed_path lets callers (e.g. the web app) control where the
    intermediate trimmed clip is written, so it can clean it up itself.
    Defaults to "<input>_trimmed<ext>" next to the input file.

    Returns a dict with the markdown feedback plus the metadata needed
    to render/print a result (rep count, duration, model, trimmed path).
    """
    if not exercise or not exercise.strip():
        sys.exit("Please choose an exercise.")

    input_path = Path(input_video)
    if not input_path.exists():
        sys.exit(f"Input video not found: {input_path}")

    if trimmed_path is None:
        trimmed_path = input_path.with_name(f"{input_path.stem}_trimmed{input_path.suffix}")
    trimmed_path = Path(trimmed_path)
    trim_video(input_path, trimmed_path)

    config = resolve_exercise(exercise)
    # A short source upload trims to less than DURATION_SECONDS -- fall back
    # to the target length only if ffprobe genuinely couldn't be found/run,
    # so Gemini is still told a real, plausible clip length either way.
    # Explicit `is None`, NOT `or`: a 0.0-second (frameless) clip is falsy,
    # so `or` quietly reported it to Gemini as a full 75-second lift --
    # asking the model to grade a set it had no footage of.
    measured_duration = get_video_duration(trimmed_path)
    duration_seconds = DURATION_SECONDS if measured_duration is None else measured_duration
    print(f"\nAnalyzing {trimmed_path} ({duration_seconds}s) as {config['label']}...")
    print(f"Sending video to {GEMINI_MODEL}...\n")

    with open(trimmed_path, "rb") as f:
        video_bytes = f.read()
    raw_feedback = call_gemini(
        video_bytes, config, duration_seconds, video_mime_type(trimmed_path)
    )

    # The model reports UNSCORABLE when the clip shows no assessable set
    # (see build_prompt) -- surface that instead of pretending we graded it.
    unscorable = re.search(r"UNSCORABLE:\s*(.*)", raw_feedback)
    if unscorable:
        reason = unscorable.group(1).strip()
        sys.exit(
            "We couldn't analyze that video"
            + (f" — {reason}" if reason else ".")
            + " Please upload a clear clip of your full set and try again."
        )

    stretch_score, squeeze_score, overall_score, favored, reps = parse_scores(raw_feedback)
    # A response with no parsable OVERALL_SCORE means the grading didn't
    # actually happen -- failing loudly beats showing feedback with a
    # missing or misleading number attached to it.
    if overall_score is None:
        sys.exit("We couldn't score that video. Please try uploading it again.")

    feedback = strip_score_lines(raw_feedback)

    return {
        "feedback": feedback,
        "exercise_label": config["label"],
        "stretch_score": stretch_score,
        "squeeze_score": squeeze_score,
        "overall_score": overall_score,
        "favored": favored,
        "reps": reps,
        "model": GEMINI_MODEL,
        "duration_seconds": duration_seconds,
        "trimmed_path": trimmed_path,
    }


def main():
    if len(sys.argv) < 3:
        sys.exit(
            "Usage: python pipeline.py <input_video> "
            f"<exercise: {'|'.join(EXERCISES)}>"
        )

    input_video = sys.argv[1]
    exercise = sys.argv[2]

    result = run_pipeline(input_video, exercise)

    print(f"Overall Form & Technique: {result['overall_score']}/100")
    print(f"Stretch: {result['stretch_score']}/100")
    print(f"Squeeze: {result['squeeze_score']}/100")
    print(f"Favored: {result['favored']}")
    print(f"Reps: {result['reps']}")
    print("\n--- Form Analysis ---\n")
    print(result["feedback"])


if __name__ == "__main__":
    main()
