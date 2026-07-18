"""Exercise form analysis using OpenAI vision only (no MediaPipe/pose tracking).

Samples frames evenly across the video and sends them straight to an
OpenAI vision model, which is responsible for judging reps, range of
motion, symmetry, and form purely from the images.

Usage:
    python analyze_form_gpt.py <video_path> <exercise>

    exercise is one of: chest_fly, bicep_curl, tricep_pushdown, pull_up

Example:
    python analyze_form_gpt.py IMG_5297.MOV bicep_curl

Requires:
    pip install opencv-python openai python-dotenv

    Put your key in a .env file next to this script:
        OPENAI_API_KEY=sk-...
"""

import base64
import os
import sys

import cv2
from dotenv import load_dotenv

load_dotenv()

OPENAI_MODEL = "gpt-5.4-mini"
NUM_SAMPLE_FRAMES = 30

EXERCISES = {
    "bicep_curl": {
        "label": "Bicep Curl",
        "secondary_notes": (
            "Check elbow drift (elbow should stay pinned near the torso, "
            "not swing forward), wrist alignment (should stay neutral, not "
            "curling/breaking at the wrist), and whether the lifter is "
            "using body momentum/back swing to move the weight."
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
    },
}


def encode_frame_jpg(frame):
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return None
    return base64.b64encode(buf).decode("utf-8")


def sample_frames(video_path, num_frames=NUM_SAMPLE_FRAMES):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        sys.exit(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        # fall back to reading sequentially and counting if metadata is bad
        frames = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        cap.release()
        if not frames:
            sys.exit("No frames could be read from the video.")
        total_frames = len(frames)
        indices = _evenly_spaced_indices(total_frames, num_frames)
        duration_seconds = round(total_frames / fps, 1)
        return [frames[i] for i in indices], duration_seconds

    indices = set(_evenly_spaced_indices(total_frames, num_frames))
    frames = []
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx in indices:
            frames.append(frame)
        idx += 1
    cap.release()

    if not frames:
        sys.exit("No frames could be read from the video.")

    duration_seconds = round(total_frames / fps, 1)
    return frames, duration_seconds


def _evenly_spaced_indices(total_frames, num_frames):
    if total_frames <= num_frames:
        return list(range(total_frames))
    step = total_frames / num_frames
    return [int(i * step) for i in range(num_frames)]


def build_prompt(config, duration_seconds, num_frames):
    return f"""You are a certified strength coach and physical therapist reviewing a
client's exercise video for {config['label']}.

You are given {num_frames} frames sampled evenly across a {duration_seconds}
second clip of the lift, in chronological order. No pose-tracking data is
provided — judge everything visually from the frames themselves,
including how many reps were performed, range of motion, tempo, and
left/right symmetry.

Exercise-specific things to look for:
{config['secondary_notes']}

## Note. Give the Positives, Negatives, Improvements, Injury Prevention in bullet points and don't use much jargon so that the user can clearly understand. Don't be too professional, you're talking to a user with little to no experience in the gym. 
# Also don't give the answer too long since users could pottentialy be lazy to read. Keep it fairly short but still make sure that the user understands clearly.


Analyze the lifter's form and respond in this exact markdown structure:

## Positives
(What the lifter is doing well. Be specific and reference what you see.)

## Negatives
(Form faults you observe, specific to this exercise. Be specific and
reference what you see in the frames.)

## Improvements
(Concrete, actionable coaching cues to fix each negative above.)

## Injury Prevention
(Which faults above carry injury risk, what that risk is specifically,
and what the lifter should do differently to reduce it going forward.)

Be honest and direct, but constructive. If you cannot clearly assess
something from the frames (e.g. exact rep count, subtle joint angles),
say so rather than guessing."""


def call_openai(frames, config, duration_seconds):
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("openai package not installed. Run: pip install openai")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit(
            "OPENAI_API_KEY environment variable is not set. "
            "Add it to your .env file."
        )

    client = OpenAI(api_key=api_key)

    content = [
        {
            "type": "text",
            "text": build_prompt(config, duration_seconds, len(frames)),
        }
    ]
    for frame in frames:
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
            "Usage: python analyze_form_gpt.py <video_path> "
            f"<exercise: {'|'.join(EXERCISES)}>"
        )

    video_path = sys.argv[1]
    exercise = sys.argv[2]

    if exercise not in EXERCISES:
        sys.exit(f"Unknown exercise '{exercise}'. Choose from: {', '.join(EXERCISES)}")

    config = EXERCISES[exercise]

    print(f"Analyzing {video_path} as {config['label']}...")
    frames, duration_seconds = sample_frames(video_path)

    print(f"Sampled {len(frames)} frames from a {duration_seconds}s clip.")
    print(f"Sending frames to {OPENAI_MODEL}...\n")

    feedback = call_openai(frames, config, duration_seconds)

    print("--- Form Analysis ---\n")
    print(feedback)


if __name__ == "__main__":
    main()
