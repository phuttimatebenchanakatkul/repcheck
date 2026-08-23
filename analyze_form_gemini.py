"""Exercise form analysis using Google Gemini video understanding (no
MediaPipe/pose tracking).

Sends the trimmed clip to Gemini natively (VideoMetadata-driven frame
sampling on Gemini's side) rather than extracting and sending discrete
still frames -- judging reps, range of motion, symmetry, and form purely
from what it sees. This mirrors rep_form_analyzer.py's proven approach
(used for Challenges) rather than this file's own former frame-sampling
one: that file's comments document sparse frame sampling actually
undercounting reps in production (an 11-rep set scored as 6 at ~1fps),
which is exactly why this file used to forbid Gemini from ever stating a
rep count at all -- discrete frames just weren't a reliable enough signal
for it. Sending the real video and asking for VideoMetadata(fps=...)
fixes that at the source.

Usage:
    python analyze_form_gemini.py <video_path> <exercise>

    exercise is one of: chest_fly, bicep_curl, tricep_pushdown, pull_up

Example:
    python analyze_form_gemini.py IMG_5297.MOV bicep_curl

Requires:
    pip install google-genai python-dotenv

    Put your key in a .env file next to this script:
        GEMINI_API_KEY=...
"""

import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Judging joint angles and subtle compensation patterns from video is a
# much harder visual-reasoning task than the other Gemini calls in this
# app (rep counting alone, food photos), and 3.1-flash-lite (the cut-down,
# fastest tier) was producing noticeably inaccurate form feedback.
# gemini-3.1-pro-preview would reason better still, but this API key's
# plan has a 0 free-tier quota for the pro tier (confirmed via a live
# 429), so it's not actually usable here — gemini-3.5-flash is the
# strongest model that's both a real reasoning upgrade over 3.1-flash-lite
# and actually accessible on this quota.
# Superseded gemini-3.5-flash, which measured catastrophically slow on this
# workload: two back-to-back calls on an ordinary 45s clip sat for 262s and
# 288s before failing with 503 "model is currently experiencing high
# demand", and successful calls ranged 25-114s for the SAME request. That
# variance is server-side, not payload-driven -- a 20s clip measured slower
# (75s) than a 45s one (25s) -- so it cannot be tuned away by sending less
# video. gemini-3.6-flash measured 4-20s on identical clips while still
# correctly identifying the movement and holding the six-section format.
GEMINI_MODEL = "gemini-3.6-flash"

# See rep_form_analyzer.py's identical constant for the full story: Gemini
# defaults to ~1fps video sampling unless told otherwise, which is nowhere
# near enough to reliably see every rep of a faster exercise.
# VideoMetadata.fps forces a denser sample. Unlike that file's sibling
# video_trimmer.py (which re-encodes at a hard 15fps ceiling), this file's
# trim_video.py stream-copies (-c copy, no re-encode), so the trimmed clip
# keeps the source's original fps (30 on every iPhone clip measured here),
# so a 15fps request is a real ask, not capped by an upstream re-encode.
#
# Raising it does not help, and 30 is not even reachable: the API rejects
# any fps above 24 outright --
#   video_metadata.fps: [FIELD_INVALID] threshold must be less than or equal to 24
# Sweeping the range that IS allowed, on one fixed 10.7s clip, showed no
# accuracy gain from sampling denser: 10fps->4 reps, 15->4, 20->5, 24->3.
# The densest legal setting counted the FEWEST reps, so there's no evidence
# 15 undersamples. Rep counts wobble +/-1 run to run at a fixed fps anyway
# (same clip, temperature=0), which swamps any difference between settings.
GEMINI_VIDEO_SAMPLE_FPS = 15

# How many times to retry a call Gemini's safety classifier blocked (empty
# response + prompt_feedback.block_reason set) before giving up. Observed
# elsewhere in this app to be flaky/non-deterministic on completely
# ordinary workout footage (same clip, same fps: blocked once, passed on
# retry) rather than a real content violation, so retrying the identical
# request is a legitimate fix here, not just papering over a real block.
# Retries are additionally bounded by ANALYSIS_BUDGET_SECONDS below -- an
# attempt that can't finish inside the remaining budget is never started.
MAX_SAFETY_BLOCK_RETRIES = 2

# Hard ceiling on how long a user waits for an analysis, covering the whole
# call including retries -- not per attempt. Without it the retry loop above
# is unbounded: three attempts with no timeout, measured at up to 114s each
# on an identical request, is a ~5.7-minute wait for someone staring at a
# spinner. Gemini's latency for the SAME request was measured between 25s
# and 114s, so the wait can't be made predictable by sending less video
# (clip length barely moved it; see GEMINI_VIDEO_SAMPLE_FPS on why sending
# less is also the wrong trade). Bounding the total is the only thing that
# actually caps what the user experiences.
ANALYSIS_BUDGET_SECONDS = 60

# Don't start another attempt unless enough budget remains for it to
# plausibly succeed -- a 3-second window just burns the retry and returns
# the same timeout error later, so the user waits longer for nothing.
MIN_ATTEMPT_SECONDS = 12

# gemini-3.5-flash reasons before answering, and its default thinking depth
# is the single biggest controllable slice of the wait: measured at ~2,350
# thinking tokens and ~97s on a 45s clip, versus ~600 tokens and ~45s at
# LOW -- same rep count (8), same graded output. MINIMAL was measured too
# and is NOT safe here: it stopped emitting the required STRETCH_SCORE /
# OVERALL_SCORE / REPS lines entirely, which parse_scores() reads as an
# unscorable response and turns into "We couldn't score that video".
GEMINI_THINKING_LEVEL = "LOW"

EXERCISES = {
    "bicep_curl": {
        "label": "Bicep Curl",
        "secondary_notes": (
            "Check elbow drift (elbow should stay pinned near the torso, "
            "not swing forward), wrist alignment (should stay neutral, not "
            "curling/breaking at the wrist), and whether the lifter is "
            "using body momentum/back swing to move the weight."
        ),
        "research_notes": (
            "EMG studies comparing straight bar, EZ-bar, and dumbbell curls "
            "found no single variant clearly wins for biceps activation, "
            "though semi-prone (hammer-style) wrist positions increase "
            "brachioradialis involvement. Anatomical research on elbow "
            "moment arms shows flexor leverage changes substantially through "
            "the range of motion, which is part of why controlled, full-range "
            "reps (rather than partial reps or using momentum) are consistently "
            "recommended over swinging the weight with the back or shoulders."
        ),
    },
    "tricep_pushdown": {
        "label": "Tricep Pushdown",
        "secondary_notes": (
            "Check that the upper arm/elbow stays fixed at the side "
            "throughout (shoulder shouldn't travel forward or the elbow "
            "flare outward), full extension is reached at the bottom "
            "without locking out violently, and the torso stays upright "
            "rather than leaning on the weight."
        ),
        "research_notes": (
            "EMG research on terminal elbow extension shows the medial and "
            "lateral heads of the triceps become significantly more active in "
            "the last 30 degrees of extension than earlier in the movement, "
            "meaning full lockout (without violent overextension) matters for "
            "triceps engagement. Keeping the upper arm fixed at the side "
            "throughout is the technique point most tied to isolating the "
            "triceps rather than recruiting the shoulder and chest."
        ),
    },
    "chest_fly": {
        "label": "Chest Fly",
        "secondary_notes": (
            "Check that elbow bend stays roughly constant through the "
            "range (a slight, fixed bend, not straightening or over-"
            "bending), the movement stays in the shoulder joint rather "
            "than turning into a press, symmetry between left/right arm "
            "paths, and that the stretch at the bottom doesn't look like "
            "it's straining the shoulder capsule (excessive depth/flare)."
        ),
        "research_notes": (
            "EMG comparisons show flyes produce lower pec major activation "
            "than presses at matched effort, but more biceps brachii "
            "involvement due to the stabilization demands of dumbbells. "
            "Because flyes load the shoulder in a more stretched, less "
            "mechanically supported position than pressing movements, keeping "
            "a fixed, slight elbow bend (rather than locking straight or "
            "overbending) is the technique point most consistently flagged as "
            "protective for the shoulder joint in this research."
        ),
    },
    "pull_up": {
        "label": "Pull-Up",
        "secondary_notes": (
            "Check whether the chin clears the bar/top position, full "
            "dead-hang extension is reached at the bottom, and whether "
            "there is excessive kipping/swinging (large torso/hip angle "
            "changes) versus a controlled strict pull."
        ),
    },
    "shoulder_press": {
        "label": "Shoulder Press",
        "secondary_notes": (
            "Check that the weight travels in a controlled, roughly "
            "vertical path without excessive forward lean, elbows don't "
            "flare too far forward, the lower back doesn't overarch "
            "(excessive lumbar extension) to help the weight up, and full "
            "range of motion is reached from shoulder height to a full "
            "overhead lockout."
        ),
        "research_notes": (
            "EMG research comparing shoulder press variants found dumbbells "
            "performed standing (the least stable version) produce the "
            "highest deltoid activation, and that a fuller range of motion "
            "increases activation of both the deltoid and rotator cuff "
            "muscles compared to a partial range. Reviews of rotator cuff EMG "
            "note that when deltoid activity substantially outpaces rotator "
            "cuff activity, the humeral head can migrate upward in the joint, "
            "which is associated with impingement risk -- reinforcing why "
            "controlled, full-range pressing (not just heavier partial reps) "
            "is favored for shoulder health."
        ),
    },
    "flat_bench_press": {
        "label": "Flat Bench Press",
        "secondary_notes": (
            "Check that the bar/dumbbells move in a controlled path down "
            "to the chest without bouncing off it, elbows aren't flaring "
            "straight out to 90 degrees (should be tucked closer to "
            "45-75 degrees), shoulder blades stay pinned back on the "
            "bench rather than rounding forward, and the hips stay down "
            "on the bench rather than being thrown up to assist the lift."
        ),
        "research_notes": (
            "EMG research comparing bench press and dumbbell flyes found the "
            "pec major activates more during the press than the fly, and that "
            "wider grips increase shoulder abduction angle -- theorized to "
            "reduce subacromial space and raise rotator-cuff impingement risk "
            "at high loads, though direct biomechanical proof of that link is "
            "still limited. Grip-width studies show a wide grip produces "
            "meaningfully more sideways (lateral) force through the sticking "
            "point of the lift than a medium or narrow grip, which is one "
            "reason a moderate grip is often recommended for shoulder health."
        ),
    },
    "incline_bench_press": {
        "label": "Incline Bench Press",
        "secondary_notes": (
            "Check that the bar/dumbbells are lowered under control to "
            "the upper chest/collarbone area without bouncing, elbows "
            "aren't flaring straight out to 90 degrees, shoulder blades "
            "stay retracted against the bench, and the hips stay down "
            "rather than being thrown up to assist the lift."
        ),
        "research_notes": (
            "A systematic review/meta-analysis of pec EMG across bench press "
            "variants found incline pressing activates the upper (clavicular) "
            "portion of the chest similarly to flat pressing, but reduces "
            "activation of the lower (sternal) portion. Reported shoulder "
            "injuries linked to pressing movements include rotator cuff strain "
            "and anterior instability, both associated with excessive shoulder "
            "abduction angle (elbows flared too wide) under heavy load."
        ),
    },
    "wide_grip_lat_pulldown": {
        "label": "Wide-Grip Lat Pulldown",
        "secondary_notes": (
            "Check that the bar is pulled down to the upper chest by "
            "driving the elbows down and back (not just curling with the "
            "biceps), the torso isn't leaning back excessively to use "
            "body momentum, a full stretch is reached at the top without "
            "shrugging the shoulders up to the ears, and the negative is "
            "controlled rather than letting the bar snap back up."
        ),
        "research_notes": (
            "A 2025 EMG study comparing seven lat pulldown grip variants found "
            "no significant difference in lat activation between wide, narrow, "
            "pronated, supinated, or neutral grips -- challenging the common "
            "assumption that a wider grip better targets the lats. The one "
            "significant finding was that a wide pronated grip combined with a "
            "30-degree torso lean back increased posterior deltoid activation, "
            "meaning excessive leaning recruits the rear shoulder more than "
            "the back muscles the exercise is meant to target."
        ),
    },
    "sldl": {
        "label": "Stiff-Leg Deadlift (SLDL)",
        "secondary_notes": (
            "Check that the legs stay nearly straight (only a slight, "
            "fixed knee bend) throughout, the movement is a hip hinge "
            "with a flat/neutral spine (no rounding of the lower back), "
            "the bar/weight stays close to the legs the whole way down "
            "and up, and depth doesn't get sacrificed by rounding the "
            "back just to reach lower."
        ),
    },
    "rdl": {
        "label": "Romanian Deadlift (RDL)",
        "secondary_notes": (
            "Check that the hips push straight back into a hip hinge "
            "with a soft, roughly fixed knee bend maintained throughout, "
            "the spine stays neutral (no rounding of the lower back), "
            "the bar/weight stays close to the legs, and the lifter stops "
            "the descent around mid-shin or wherever the hamstrings reach "
            "their stretch limit rather than rounding the back to go "
            "lower."
        ),
    },
    "leg_press": {
        "label": "Leg Press",
        "secondary_notes": (
            "Check that the lower back stays flat against the pad (it "
            "shouldn't round or lift off the seat at the bottom), knees "
            "track in line with the toes rather than caving inward, depth "
            "doesn't go so deep that the lower back rounds off the pad, "
            "and the knees aren't locked out aggressively at the top."
        ),
        "research_notes": (
            "Research on lower-body machine exercises notes that rounding of "
            "the lower back off the seat pad -- typically from going deeper "
            "than hip mobility allows -- shifts stress onto the lumbar spine "
            "instead of the hips and knees, which is the main technique fault "
            "flagged for this exercise. Knee tracking in line with the toes "
            "(not caving inward) mirrors the same valgus-related concerns "
            "documented in squat research."
        ),
    },
    "hack_squat": {
        "label": "Hack Squat",
        "secondary_notes": (
            "Check that the heels stay flat and planted (not rising up "
            "onto the toes), knees track over the toes rather than caving "
            "inward, the back and hips stay in full contact with the pad "
            "throughout (no rounding or hips lifting away), and the "
            "descent is controlled rather than bouncing out of the bottom."
        ),
        # No hack-squat-specific research was available; this generalizes
        # from free-weight squat research on knee valgus and ankle
        # mobility, which applies reasonably well since a hack squat is
        # still a knee-dominant squat pattern (just on a fixed machine path).
        "research_notes": (
            "A meta-analysis on dynamic knee valgus (the knees caving inward) "
            "during squats identifies it as a recognized risk factor tied to "
            "ACL loading and patellofemoral pain, though a separate meta-"
            "analysis of longitudinal studies found knee valgus alone does not "
            "reliably predict future ACL injury in isolation -- risk appears "
            "to be multi-factorial. A systematic review on deep squats and "
            "knee structures found reduced ankle mobility (limited dorsiflexion) "
            "is a common contributor to compensatory knee valgus and trunk "
            "lean, and that excessive relative load is a separate factor that "
            "raises joint stress independent of technique."
        ),
    },
    "leg_extension": {
        "label": "Leg Extension",
        "secondary_notes": (
            "Check that the movement is controlled through the full range "
            "without swinging or using momentum, the back stays against "
            "the pad rather than arching up to help lift the weight, "
            "there's a brief pause/squeeze at the top of the extension, "
            "and the weight is lowered under control rather than dropped."
        ),
        "research_notes": (
            "An NSCA review addressing the 'is it risky' debate around leg "
            "extensions concludes the exercise is not inherently dangerous "
            "when loaded and dosed appropriately, though it does note elevated "
            "patellofemoral joint stress is a known consideration, making "
            "controlled tempo and appropriate load more important than for "
            "compound lifts where load is naturally self-limited by other "
            "muscle groups fatiguing first."
        ),
    },
    "lying_leg_curl": {
        "label": "Lying Leg Curl Machine",
        "secondary_notes": (
            "Check that the hips stay pressed down into the pad rather "
            "than lifting up to assist the curl, the movement is "
            "controlled through the full range without swinging momentum, "
            "there's a squeeze at the top of the curl, and the weight is "
            "lowered under control rather than snapping back down."
        ),
        "research_notes": (
            "The same NSCA review on isolation leg machines notes that hamstring "
            "training benefits from combining hip-dominant movements (like "
            "deadlifts) with knee-dominant isolation movements (like the leg "
            "curl), since they train the hamstrings' two distinct joint "
            "actions. The main technique point is keeping the hips pressed "
            "into the pad rather than lifting them to help curl the weight, "
            "which otherwise shifts load onto the lower back."
        ),
    },
}


# ----------------------------------------------------------------------
# Sources backing the research_notes above, grouped by body part, so any
# claim can be traced back to the original paper. Pulled from PubMed/PMC,
# JOSPT, and NSCA -- systematic reviews and meta-analyses wherever
# possible, supplemented by targeted EMG/biomechanics papers on
# contested or exercise-specific questions.
# ----------------------------------------------------------------------
RESEARCH_SOURCES = {
    "chest": [
        "Solstad et al. - A Comparison of Muscle Activation between Barbell "
        "Bench Press and Dumbbell Flyes in Resistance-Trained Males",
        "MDPI (2023) - Electromyographic Activity of the Pectoralis Major "
        "Muscle during Traditional Bench Press and Other Variants: A "
        "Systematic Review and Meta-Analysis",
        "PMC7862765 - Biomechanical Analysis of Wide, Medium, and Narrow "
        "Grip Width Effects During 1-RM Bench Pressing",
        "PMC11224528 - Effects of bench press technique variations on "
        "musculoskeletal shoulder loads and potential injury risk",
    ],
    "back": [
        "PMC12452428 / MDPI (2025) - Electromyographic Analysis of Back "
        "Muscle Activation During Lat Pulldown Exercise: Effects of Grip "
        "Variations and Forearm Orientation",
        "Lusk, Hale & Russell (2010) - Grip width and forearm orientation "
        "effects on muscle activity during the lat pull-down, J Strength "
        "Cond Res",
    ],
    "arms": [
        "PMC6047503 - Differences in EMG activity of biceps brachii and "
        "brachioradialis while performing three variants of curl",
        "Effect of shoulder position on biceps brachii EMG in different "
        "dumbbell curls (moment arm / anatomical study)",
        "EMG activity of Triceps Brachii in Terminal Extension of Elbow "
        "(ResearchGate)",
        "PMC10407265 - The Elbow's Achilles Heel: Systematic Review and "
        "Meta-Analysis of Triceps Tendon Rupture and Repair Techniques",
    ],
    "shoulders": [
        "Sweeney (thesis, Univ. of Wisconsin) - Electromyographic analysis "
        "of the deltoid muscle during shoulder press variants",
        "PMC2857390 - Scapular and rotator cuff muscle activity during arm "
        "elevation: A review of normal function and alterations with "
        "shoulder impingement",
        "JOSPT (2004) - Electromyographic Analysis of the Rotator Cuff and "
        "Deltoid Musculature During Common Shoulder External Rotation "
        "Exercises",
        "PMC11224528 - Effects of bench press technique variations on "
        "musculoskeletal shoulder loads and potential injury risk",
    ],
    "legs": [
        "BMC Musculoskeletal Disorders (2024) / PMC11331804 - Muscle "
        "activation in the lower limb muscles in individuals with dynamic "
        "knee valgus during single-leg and overhead squats: a meta-analysis",
        "Frontiers (2024) / PMC11618833 - Impact of the deep squat on "
        "articular knee joint structures, friend or enemy? A scoping review",
        "IJSPT (2025) - The Use of Elastic Resistance Bands to Reduce "
        "Dynamic Knee Valgus in Squat-Based Movements: A Narrative Review",
        "NSCA - Are the Seated Leg Extension, Leg Curl, and Adduction "
        "Machine Exercises Non-Functional or Risky?",
        "PMC12372021 - Optimizing Hip Abductor Strengthening for Lower "
        "Extremity Rehabilitation: A Narrative Review",
    ],
}

# Used for any exercise the user picks that isn't one of the curated
# EXERCISES entries above (i.e. it has no hand-written, exercise-specific
# coaching/research notes). Still gives Gemini something concrete to
# check rather than analyzing with no guidance at all.
GENERIC_SECONDARY_NOTES = (
    "No exercise-specific technique notes are available for this movement, "
    "so judge it against general strength-training form principles: "
    "controlled tempo through the full range of motion (no jerking or "
    "using momentum to move the weight), joints tracking in safe alignment "
    "(e.g. knees tracking over the toes, elbows not flaring uncontrolled), "
    "reaching a genuine stretch and a genuine squeeze/contraction at the "
    "two ends of the movement, and the torso/core staying stable rather "
    "than swinging or arching to help lift the weight."
)

_LABEL_TO_KEY = {cfg["label"].strip().lower(): key for key, cfg in EXERCISES.items()}


def resolve_exercise(name):
    """Look up a curated EXERCISES entry by key or label. Falls back to a
    generic config (just the given name + GENERIC_SECONDARY_NOTES) for any
    exercise outside the curated list, so the analyzer can run on anything
    in the larger searchable exercise library, not just the 14 curated
    movements."""
    if name in EXERCISES:
        return EXERCISES[name]
    key = _LABEL_TO_KEY.get(name.strip().lower())
    if key:
        return EXERCISES[key]
    return {"label": name.strip(), "secondary_notes": GENERIC_SECONDARY_NOTES}


def build_prompt(config, duration_seconds):
    return f"""You are a certified strength coach and physical therapist reviewing a
client's exercise video for {config['label']}.

You are given the full video clip of the lift, {duration_seconds} seconds
long, in real time. No pose-tracking data is provided — judge everything
visually from the video itself, including how many reps were performed,
range of motion, tempo, and left/right symmetry.

Before judging anything, orient yourself: note the camera angle (front,
side, or three-quarter — some faults, like knee valgus or elbow flare,
are only reliably visible from certain angles), and which parts of the
clip are sharp and clear versus blurry, motion-blurred, or where the
lifter is partly out of frame. Only state a specific technical claim (an
exact joint angle, a specific fault, a left/right asymmetry) if it's
clearly and repeatedly visible across multiple reps — a single ambiguous
or blurry moment is not enough evidence on its own. If the camera angle
hides a joint or detail you'd need to judge something specific, say that
plainly instead of guessing at it.

Count reps precisely — watch the entire clip chronologically at normal
speed, not a quick skim. Count ONE complete cycle (e.g. down AND back up)
as a single rep — never count the two halves of the same movement as two
reps. Include partial or clearly bad-form attempts in the count too; this
is a raw rep count, not a validity judgment (that's what the sections
below are for).

Exercise-specific things to look for:
{config['secondary_notes']}
{"" if not config.get("research_notes") else f'''
Relevant research to ground your analysis in (from EMG studies and
systematic reviews/meta-analyses -- use this to inform which faults you
flag and why they matter, but don't quote it verbatim or cite papers to
the user):
{config["research_notes"]}
'''}
BEFORE scoring anything, check that the clip actually shows a person
performing this exercise. If the video is empty/black, shows no person, is
too short or too corrupted to make out any reps, or shows something that
is clearly not a set of {config['label']} being performed, then do NOT
invent a score. Instead output exactly this single line and nothing else:
UNSCORABLE: <one short sentence saying what you actually saw>

Never guess a score to fill in the format. A plausible-looking number
attached to footage you couldn't actually assess is far worse than
admitting the clip can't be graded. Only continue to the scores below if
you can genuinely see the set.

Otherwise, on their own lines before anything else, output exactly these
five lines with no extra text, no bold, no markdown around them:
STRETCH_SCORE: <integer 0-100>
SQUEEZE_SCORE: <integer 0-100>
OVERALL_SCORE: <integer 0-100>
FAVORED: <stretch|squeeze|balanced>
REPS: <integer — total reps counted, per the counting rules above>

STRETCH_SCORE rates how well the lifter reaches a full, controlled stretch
at that end of the movement for this exercise. SQUEEZE_SCORE rates how
well the lifter reaches a full, controlled squeeze/contraction at the
other end. OVERALL_SCORE rates the overall form and technique quality of
the set as a whole, out of 100 — be a strict but fair grader, reserving
90-100 for genuinely excellent form. FAVORED tells the lifter which half
of the movement their execution leans on more: output "stretch" if
STRETCH_SCORE is clearly higher than SQUEEZE_SCORE, "squeeze" if the
reverse, or "balanced" if they're close.

Work out OVERALL_SCORE using ALL of the following criteria together:

1. Stretch vs. squeeze quality. If one is clearly noticeably worse than
   the other (e.g. great stretch at the bottom but a rushed, partial
   squeeze at the top, or vice versa), weight the overall score toward
   that weaker half rather than averaging it away — a bad squeeze should
   visibly hurt the score even if the stretch was great. If both halves
   look similarly good (or similarly flawed), combine/average them
   normally instead of penalizing one side.

2. Joint angle / range of motion at each key position. For the position(s)
   central to this movement (e.g. full lockout/extension, top-of-rep
   flexion, bottom stretch depth), judge how close the visible angle is to
   the ideal target range for that position in this specific exercise
   (for example, an elbow lockout might have an ideal range of roughly
   175-185 degrees). Score highest when the angle sits near the middle of
   that ideal range, and taper the score down the further it drifts
   toward the edges or outside the range. Negligible deviations (barely
   short of full lockout, a hair past neutral, etc.) should NOT be
   penalized — only meaningfully out-of-range angles should reduce the
   score. Apply this same logic to every exercise-relevant joint angle,
   not just one.

3. Movement integrity / compensation patterns. Check whether the lifter is
   letting momentum, swinging, or the wrong muscle group take over the
   rep instead of the target muscle (e.g. on a wide-grip lat pulldown,
   swinging the torso/weight or letting the forearms and biceps dominate
   the pull instead of the lats driving the elbows down and back). Any
   clear compensation pattern like this should reduce the score
   proportional to how much it's doing the work instead of proper form.

Calibrate ALL THREE scores to these bands. Be honest, not polite — most
real-world gym sets land in the 40-75 range, and anything above 85 should
be rare and earned:
- 90-100: textbook. Full controlled range of motion on essentially every
  rep, no meaningful faults.
- 75-89: good with minor flaws — full range of motion on most reps, small
  technical slips that don't change what muscle is doing the work.
- 55-74: mediocre — noticeable faults on many reps (cut-short range of
  motion, some momentum, inconsistent tempo), though the target muscle
  still does most of the work.
- 30-54: poor — major faults dominate the set: half/partial reps on most
  attempts, momentum or other muscle groups doing much of the work, or
  joints repeatedly loaded in risky positions.
- 0-29: dangerous, or barely recognizable as this exercise performed
  correctly.

HARD RULES that override everything above — apply them after computing
your initial numbers:
- These scores grade the lifter's execution of {config['label']}
  specifically — the exercise they told the app they were doing. If the
  clip actually shows a different movement (or something so far from
  {config['label']} that it's effectively a different exercise), say so
  plainly in the Movement Summary and score all three numbers 25 or
  lower. Do NOT quietly grade whatever movement they performed instead.
- If most reps are partial/half reps, the score for whichever end is
  being cut (STRETCH_SCORE for a cut stretch, SQUEEZE_SCORE for a cut
  squeeze) MUST be 45 or lower. A half rep is a failing range-of-motion
  grade at that end — it is never an 80.
- Grade what you OBSERVED, not what you end up writing. Before composing
  any section, count the distinct faults you actually saw in the frames
  and the distinct things genuinely done well. If the faults outweigh the
  strengths — more problems than strengths observed, or any real injury
  risk from how the reps are executed — OVERALL_SCORE MUST be below 50.
  This comparison is over what you SAW, not over how many bullets survive
  the length limits further down: those limits control presentation only
  and MUST NOT raise the score. A set with six faults where you only had
  room to print two is still a set with six faults. Never write a
  warning-heavy report and attach a 75+ score to it.
- Do not soften the numbers to be encouraging. Encouragement belongs in
  the words; the lifter uses the numbers to track progress, and an
  inflated score on bad form teaches them to keep lifting in a way that
  can injure them.

Before writing anything, silently re-check every specific claim you're
about to make (a scored angle, a named fault, a stated asymmetry)
against the frames one more time: is it clearly and repeatedly visible,
or is it a guess extrapolated from limited/ambiguous evidence? Drop or
soften anything that doesn't hold up — an honest "hard to tell from this
angle" is far better than a specific claim that turns out to be wrong.
This matters most for the Negatives and Injury Prevention sections below,
where a fabricated fault actively misleads the lifter.

Then analyze the lifter's form and respond using EXACTLY the six "##"
section headings below, in this order, and no others — do not merge them,
do not add an extra heading (like a "Note" section) before or around
them, and do not put the section names as bold bullet labels inside a
single block. Each "##" heading must start its own section with its own
bullet points underneath it.

Write every section in bullet points, in plain, everyday language a total
gym beginner would understand -- talk like an encouraging human coach
standing next to them, NOT like a physical therapist writing a report.
Avoid clinical or technical jargon (no "scapular retraction", "glenohumeral",
"eccentric phase", "range of motion" without explaining it, etc.); if a
real cue needs a body part, name it simply ("shoulder blades", "elbows",
"lower back"). Keep it warm and constructive, never harsh. Keep the whole
response short — assume the user does not want to read a long answer, but
make sure it's still clear. This is read on a phone screen in a gym, in a
few seconds between sets — not a report read at a desk, so every sentence
has to earn its place.

Within EVERY section, order the bullets by importance: the first bullet
must be the single most important takeaway for that section, standing
completely on its own. Keep it especially short — one punchy, plain-English
sentence, no more than about 8 words, written like a headline someone
could read at a glance. Put all supporting detail, secondary observations,
and nuance in the bullets that follow it — that's where the fuller
explanation belongs. The UI shows only this first-bullet headline by
default and lets the user expand to read the rest, so keep the headline
tight and save the detail for what follows.

Limit every section to at most 3 bullets total (the headline plus no more
than 2 supporting bullets) — cut to the single most useful supporting
point or two rather than listing everything you noticed. Keep the
supporting bullets short and precise too: one clear sentence each, under
about 12 words, no run-on sentences stacking multiple observations with
commas and "and". If a supporting bullet doesn't add something the
headline didn't already say, cut it rather than padding the section out.

Cut words, not meaning. Every bullet must name the specific thing you saw
or the specific thing to do — no filler openers ("Overall", "It looks
like", "Great job"), no restating the section's own name, no hedging
padding, no adjective stacking. Prefer a concrete number, body part, or
rep ("elbows flared on the last 3 reps") over a general impression
("form degraded somewhat"). If a word can go without losing information,
it goes.

This 3-bullet cap is a PRESENTATION limit and has no effect on grading.
Work out the three scores from everything you observed BEFORE trimming
anything, then trim only the writing. If a section had more faults than
fit, keep the most severe ones and let the score continue to reflect all
of them. Trimming the report must never soften the number.

## Movement Summary
(A plain, factual description of how the movement was actually performed —
NOT judgment, just what happened. The headline states the rep count and
how full the reps looked. Supporting bullets cover tempo and the overall
pattern, only where there is something worth saying. If you can't tell
something precisely from the video, say so in a few words rather than
guessing.)

## Positives
(What the lifter is doing well. Be specific and reference what you see.)

## Negatives
(Form faults you observe, specific to this exercise. Be specific and
reference what you see in the video.)

## Improvements
(Concrete, actionable coaching cues to fix each negative above.)

## Injury Prevention
(The single fault above that carries the most injury risk: name the risk
and the one thing to do differently. Skip this if nothing here is
genuinely risky — say so in a few words instead of inventing a risk.)

## How to Progress
(One call for next session, based on the rep count and whether form held
across the set: add reps, add load, or hold the weight and clean up form.
State the call first, the reason second, in plain language — no jargon,
no lecture on progressive overload.)

Be honest and direct, but constructive. If you cannot clearly assess
something from the video (e.g. subtle joint angles), say so rather than
guessing."""


def parse_scores(feedback_text):
    """Pull the STRETCH_SCORE / SQUEEZE_SCORE / OVERALL_SCORE / FAVORED /
    REPS lines out of the raw Gemini response.

    Returns (stretch_score, squeeze_score, overall_score, favored, reps),
    where each score is an int 0-100 (or None if missing), favored is one
    of "stretch", "squeeze", "balanced", or None if missing/unrecognized,
    and reps is an int (uncapped -- a rep count can exceed 100) or None.
    """
    def find_score(label):
        match = re.search(rf"{label}:\s*(\d+)", feedback_text)
        return max(0, min(100, int(match.group(1)))) if match else None

    stretch = find_score("STRETCH_SCORE")
    squeeze = find_score("SQUEEZE_SCORE")
    overall = find_score("OVERALL_SCORE")

    favored_match = re.search(r"FAVORED:\s*(stretch|squeeze|balanced)", feedback_text, re.IGNORECASE)
    favored = favored_match.group(1).lower() if favored_match else None

    reps_match = re.search(r"REPS:\s*(\d+)", feedback_text)
    reps = int(reps_match.group(1)) if reps_match else None

    return stretch, squeeze, overall, favored, reps


def strip_score_lines(feedback_text):
    return re.sub(
        r"^(STRETCH_SCORE|SQUEEZE_SCORE|OVERALL_SCORE|REPS):\s*\d+\s*$\n?|^FAVORED:\s*\w+\s*$\n?",
        "",
        feedback_text,
        flags=re.MULTILINE,
    )


# The trimmed clip keeps the source upload's extension, and ffmpeg's
# `-c copy` keeps its original container -- so a .mov/.avi/.mkv upload is
# genuinely NOT an mp4. Labeling everything "video/mp4" handed Gemini a
# mislabeled byte stream it may decode poorly or not at all, which is
# another way footage can go ungraded-but-scored.
_VIDEO_MIME_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
}


def video_mime_type(path):
    return _VIDEO_MIME_TYPES.get(Path(path).suffix.lower(), "video/mp4")


def _is_timeout(exc):
    """True if exc is the SDK/transport giving up on a slow request, as
    opposed to a real API rejection. The SDK wraps httpx, so the concrete
    class varies by transport -- match on name/text rather than importing
    httpx just for an isinstance check."""
    if exc is None:
        return False
    return "timeout" in f"{type(exc).__name__} {exc}".lower()


def call_gemini(video_bytes, config, duration_seconds, mime_type="video/mp4",
                budget_seconds=ANALYSIS_BUDGET_SECONDS):
    """Returns (feedback_text, api_seconds, attempts_made).

    api_seconds is the total wall-clock time spent calling Gemini, from the
    first attempt to the one that succeeded -- i.e. what the retry loop
    actually cost, separate from video upload/trim time which happens
    outside this function. attempts_made counts how many generate_content
    calls were made (>1 means a safety-block or transient-error retry fired).
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        sys.exit("google-genai package not installed. Run: pip install google-genai")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit(
            "GEMINI_API_KEY environment variable is not set. "
            "Add it to your .env file."
        )

    client = genai.Client(api_key=api_key)

    prompt = build_prompt(config, duration_seconds)
    video_part = types.Part(
        inline_data=types.Blob(data=video_bytes, mime_type=mime_type),
        video_metadata=types.VideoMetadata(fps=GEMINI_VIDEO_SAMPLE_FPS),
    )

    # Budget is wall-clock across every attempt, so a slow first attempt
    # eats into what the retries are allowed to take rather than each one
    # getting a fresh unbounded window.
    started = time.monotonic()

    def seconds_left():
        return budget_seconds - (time.monotonic() - started)

    last_error = None
    timed_out = False
    attempts_made = 0
    for attempt in range(MAX_SAFETY_BLOCK_RETRIES + 1):
        remaining = seconds_left()
        if remaining < MIN_ATTEMPT_SECONDS:
            timed_out = True
            break
        attempts_made += 1
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[video_part, prompt],
                # Judging form/reps should give the same answer every time given
                # the same footage, not vary across calls -- see
                # rep_form_analyzer.py's identical reasoning for temperature=0.
                config=types.GenerateContentConfig(
                    temperature=0,
                    thinking_config=types.ThinkingConfig(
                        thinking_level=GEMINI_THINKING_LEVEL
                    ),
                    # Caps this attempt at whatever budget is left, so a
                    # hung/queued request can't blow past the ceiling.
                    http_options=types.HttpOptions(timeout=int(remaining * 1000)),
                ),
            )
        except Exception as exc:
            # Transient API errors (e.g. a 503 "model is currently
            # experiencing high demand") are real and observed in practice,
            # not just theoretical -- worth a short pause before the next
            # attempt, unlike the empty-response case below which isn't
            # time-dependent. Only pause if the budget can absorb it.
            last_error = exc
            if attempt < MAX_SAFETY_BLOCK_RETRIES and seconds_left() > MIN_ATTEMPT_SECONDS + 2:
                time.sleep(2)
            continue
        if response.text:
            return response.text, time.monotonic() - started, attempts_made
        # Empty text + a safety block is flaky on completely ordinary
        # footage elsewhere in this app -- retry before giving up.
        last_error = None

    # Ran out of budget rather than hitting a real failure: say so plainly
    # instead of surfacing a raw timeout/transport error, which reads to the
    # user like their video was the problem.
    if timed_out or _is_timeout(last_error):
        sys.exit(
            "That analysis took longer than "
            f"{budget_seconds:g} seconds, so we stopped waiting. "
            "This is usually a busy moment on our end, not a problem with "
            "your video -- please try again."
        )
    if last_error is not None:
        sys.exit(f"Gemini request failed after retries: {last_error}")
    sys.exit("Gemini didn't return a usable response for this video. Please try again.")


def main():
    if len(sys.argv) < 3:
        sys.exit(
            "Usage: python analyze_form_gemini.py <video_path> "
            f"<exercise: {'|'.join(EXERCISES)}>"
        )

    video_path = sys.argv[1]
    exercise = sys.argv[2]

    if exercise not in EXERCISES:
        sys.exit(f"Unknown exercise '{exercise}'. Choose from: {', '.join(EXERCISES)}")

    config = EXERCISES[exercise]

    from trim_video import get_video_duration

    duration_seconds = get_video_duration(video_path) or 0
    print(f"Analyzing {video_path} ({duration_seconds}s) as {config['label']}...")
    print(f"Sending video to {GEMINI_MODEL}...\n")

    with open(video_path, "rb") as f:
        video_bytes = f.read()
    feedback, api_seconds, attempts = call_gemini(video_bytes, config, duration_seconds)

    print(f"--- Form Analysis ({api_seconds:.1f}s, {attempts} attempt(s)) ---\n")
    print(feedback)


if __name__ == "__main__":
    main()
