"""Exercise form analysis using MediaPipe pose tracking + OpenAI vision.

Tracks joint angles through a lift video, detects reps, samples the key
frames of each rep (top/bottom of the movement), and sends those frames
plus the angle data to an OpenAI vision model for a form critique.

Usage:
    python analyze_form.py <video_path> <exercise>

    exercise is one of: chest_fly, bicep_curl, tricep_pushdown, pull_up

Example:
    python analyze_form.py IMG_5297.MOV bicep_curl

Requires:
    pip install mediapipe opencv-python openai python-dotenv

    Put your key in a .env file next to this script:
        OPENAI_API_KEY=sk-...
"""

import base64
import json
import math
import os
import sys

import cv2
import mediapipe as mp
from dotenv import load_dotenv
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from pose_landmarker import MODEL_PATH, POSE_CONNECTIONS, draw_landmarks

load_dotenv()

OPENAI_MODEL = "gpt-5.4-mini"

# MediaPipe pose landmark indices
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
NOSE = 0

# Each exercise defines:
#   angle_joints: (shoulder, elbow, wrist) landmark indices per side, used
#       as the primary rep-counting angle (elbow flexion)
#   rep_direction: "flex_to_extend" (starts extended, angle drops then
#       rises = one rep) or "extend_to_flex" (starts flexed)
#   secondary: extra angle(s) worth tracking for form faults, described
#       for the prompt sent to the model
EXERCISES = {
    "bicep_curl": {
        "label": "Bicep Curl",
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
        "secondary_notes": (
            "Check whether the chin clears the bar/top position, full "
            "dead-hang extension is reached at the bottom, and whether "
            "there is excessive kipping/swinging (large torso/hip angle "
            "changes) versus a controlled strict pull."
        ),
    },
    "shoulder_press": {
        "label": "Shoulder Press",
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
        # No hack-squat-specific research was available; this generalizes
        # from free-weight squat research on knee valgus and ankle
        # mobility, which applies reasonably well since a hack squat is
        # still a knee-dominant squat pattern (just on a fixed machine path).
        "secondary_notes": (
            "Check that the heels stay flat and planted (not rising up "
            "onto the toes), knees track over the toes rather than caving "
            "inward, the back and hips stay in full contact with the pad "
            "throughout (no rounding or hips lifting away), and the "
            "descent is controlled rather than bouncing out of the bottom."
        ),
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
        "sides": ["left", "right"],
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
        "sides": ["left", "right"],
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


def angle(a, b, c):
    """Angle at point b (in degrees) formed by points a-b-c, in 2D."""
    ax, ay = a
    bx, by = b
    cx, cy = c
    v1 = (ax - bx, ay - by)
    v2 = (cx - bx, cy - by)
    dot = v1[0] * v2[0] + v1[1] * v2[1]
    mag1 = math.hypot(*v1)
    mag2 = math.hypot(*v2)
    if mag1 == 0 or mag2 == 0:
        return 0.0
    cos_a = max(-1.0, min(1.0, dot / (mag1 * mag2)))
    return math.degrees(math.acos(cos_a))


def extract_landmarks(result, w, h):
    if not result.pose_landmarks:
        return None
    lm = result.pose_landmarks[0]
    return [(p.x * w, p.y * h) for p in lm]


def elbow_angle(pts, side):
    if side == "left":
        return angle(pts[L_SHOULDER], pts[L_ELBOW], pts[L_WRIST])
    return angle(pts[R_SHOULDER], pts[R_ELBOW], pts[R_WRIST])


def find_rep_peaks(angles, min_prominence=25, refractory=5):
    """Simple local-min/max detector on an angle time series.

    Returns a list of (frame_index, kind) where kind is 'min' or 'max',
    alternating, representing the bottom/top of each rep.
    """
    peaks = []
    n = len(angles)
    i = 1
    last_idx = -refractory
    while i < n - 1:
        if angles[i] >= angles[i - 1] and angles[i] >= angles[i + 1]:
            kind = "max"
        elif angles[i] <= angles[i - 1] and angles[i] <= angles[i + 1]:
            kind = "min"
        else:
            i += 1
            continue
        if i - last_idx >= refractory:
            if not peaks or peaks[-1][1] != kind:
                candidate_ok = True
                if peaks:
                    prev_angle = angles[peaks[-1][0]]
                    if abs(angles[i] - prev_angle) < min_prominence:
                        candidate_ok = False
                if candidate_ok:
                    peaks.append((i, kind))
                    last_idx = i
        i += 1
    return peaks


def encode_frame_jpg(frame):
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return None
    return base64.b64encode(buf).decode("utf-8")


def analyze_video(video_path, exercise):
    config = EXERCISES[exercise]

    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        sys.exit(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30

    frames = []
    left_angles = []
    right_angles = []

    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        frame_idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]

            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
            )
            timestamp_ms = int(frame_idx * (1000 / fps))
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            pts = extract_landmarks(result, w, h)
            annotated = draw_landmarks(frame.copy(), result)
            frames.append(annotated)

            if pts:
                left_angles.append(elbow_angle(pts, "left"))
                right_angles.append(elbow_angle(pts, "right"))
            else:
                left_angles.append(left_angles[-1] if left_angles else 180.0)
                right_angles.append(right_angles[-1] if right_angles else 180.0)

            frame_idx += 1

    cap.release()

    if not frames:
        sys.exit("No frames could be read from the video.")

    left_peaks = find_rep_peaks(left_angles)
    right_peaks = find_rep_peaks(right_angles)
    peaks = left_peaks if len(left_peaks) >= len(right_peaks) else right_peaks

    key_indices = sorted({idx for idx, _ in peaks})
    if not key_indices:
        # fall back to evenly spaced samples if rep detection found nothing
        step = max(1, len(frames) // 6)
        key_indices = list(range(0, len(frames), step))[:8]

    key_indices = key_indices[:10]  # cap frame count sent to the API

    reps = max(len(left_peaks), len(right_peaks)) // 2

    summary = {
        "exercise": config["label"],
        "duration_seconds": round(len(frames) / fps, 1),
        "estimated_reps": reps,
        "left_elbow_angle_deg": {
            "min": round(min(left_angles), 1),
            "max": round(max(left_angles), 1),
            "range_of_motion": round(max(left_angles) - min(left_angles), 1),
        },
        "right_elbow_angle_deg": {
            "min": round(min(right_angles), 1),
            "max": round(max(right_angles), 1),
            "range_of_motion": round(max(right_angles) - min(right_angles), 1),
        },
        "left_right_rom_symmetry_delta": round(
            abs(
                (max(left_angles) - min(left_angles))
                - (max(right_angles) - min(right_angles))
            ),
            1,
        ),
    }

    sample_frames = [frames[i] for i in key_indices]
    return summary, sample_frames, config


def build_prompt(summary, config):
    return f"""You are a certified strength coach and physical therapist reviewing a
client's exercise video for {config['label']}.

You are given:
1. Several key frames sampled from the video (at the top/bottom of each
   rep), with the detected skeleton overlaid (green lines/red dots).
2. Joint angle data measured from pose tracking across the full set:


## Note. Give the Positives, Negatives, Improvements, Injury Prevention in bullet points and don't use much jargon so that the user can clearly understand. Don't be too professional, you're talking to a user with little to no experience in the gym. 
# Also don't give the answer too long since users could pottentialy be lazy to read. Keep it fairly short but still make sure that the user understands clearly.


{json.dumps(summary, indent=2)}

Exercise-specific things to look for:
{config['secondary_notes']}
{"" if not config.get("research_notes") else f'''
Relevant research to ground your analysis in (from EMG studies and
systematic reviews/meta-analyses -- use this to inform which faults you
flag and why they matter, but don't quote it verbatim or cite papers to
the user):
{config["research_notes"]}
'''}
Analyze the lifter's form and respond in this exact markdown structure:

## Positives
(What the lifter is doing well. Be specific and reference what you see.)

## Negatives
(Form faults you observe, specific to this exercise. Be specific and
reference what you see in the frames and the angle data.)

## Improvements
(Concrete, actionable coaching cues to fix each negative above.)

## Injury Prevention
(Which faults above carry injury risk, what that risk is specifically,
and what the lifter should do differently to reduce it going forward.)

Be honest and direct, but constructive. If you cannot clearly assess
something from the frames, say so rather than guessing."""


def call_openai(summary, sample_frames, config):
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("openai package not installed. Run: pip install openai")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit(
            "OPENAI_API_KEY environment variable is not set. "
            "Set it before running this script."
        )

    client = OpenAI(api_key=api_key)

    content = [{"type": "text", "text": build_prompt(summary, config)}]
    for frame in sample_frames:
        b64 = encode_frame_jpg(frame)
        if b64:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                }
            )

    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": content}],
    )
    return response.choices[0].message.content


def main():
    if len(sys.argv) < 3:
        sys.exit(
            "Usage: python analyze_form.py <video_path> "
            f"<exercise: {'|'.join(EXERCISES)}>"
        )

    video_path = sys.argv[1]
    exercise = sys.argv[2]

    if exercise not in EXERCISES:
        sys.exit(f"Unknown exercise '{exercise}'. Choose from: {', '.join(EXERCISES)}")

    print(f"Analyzing {video_path} as {EXERCISES[exercise]['label']}...")
    summary, sample_frames, config = analyze_video(video_path, exercise)

    print("\n--- Pose tracking summary ---")
    print(json.dumps(summary, indent=2))
    print(f"\nSending {len(sample_frames)} key frames to {OPENAI_MODEL}...\n")

    feedback = call_openai(summary, sample_frames, config)

    print("--- Form Analysis ---\n")
    print(feedback)


if __name__ == "__main__":
    main()
