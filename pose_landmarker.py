"""Pose detection using MediaPipe Pose Landmarker (heavy model).

Usage:
    python pose_landmarker.py                # webcam
    python pose_landmarker.py video.mp4      # video file

Requires:
    pip install mediapipe opencv-python
"""

import sys
import time

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

MODEL_PATH = r"C:\Users\James\Downloads\pose_landmarker_heavy.task"

# Landmark connections for drawing the skeleton
POSE_CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),  # arms
    (11, 23), (12, 24), (23, 24),                      # torso
    (23, 25), (25, 27), (24, 26), (26, 28),            # legs
    (27, 29), (29, 31), (28, 30), (30, 32),            # feet
]


def draw_landmarks(frame, result):
    if not result.pose_landmarks:
        return frame
    h, w = frame.shape[:2]
    for landmarks in result.pose_landmarks:
        pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]
        for a, b in POSE_CONNECTIONS:
            cv2.line(frame, pts[a], pts[b], (0, 255, 0), 2)
        for p in pts:
            cv2.circle(frame, p, 4, (0, 0, 255), -1)
    return frame


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else 0

    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        sys.exit(f"Could not open source: {source}")

    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
            )
            timestamp_ms = int(time.monotonic() * 1000)
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            frame = draw_landmarks(frame, result)
            cv2.imshow("Pose Landmarker", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
