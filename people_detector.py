"""Person detection in video using MediaPipe Object Detector.

Usage:
    python people_detector.py                # webcam
    python people_detector.py video.mp4      # video file
    python people_detector.py output.mp4     # save to file (if output.mp4 provided)

Requires:
    pip install mediapipe opencv-python

Notes:
    - Downloads the object detection model automatically on first run
    - Detects all objects, filters for 'person' class
    - Confidence threshold: 0.5 (adjust as needed)
"""

import sys
import time
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


def get_model_path():
    """Download model if not present, return path."""
    model_url = "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite"
    model_dir = Path.home() / ".mediapipe_models"
    model_dir.mkdir(exist_ok=True)

    model_path = model_dir / "efficientdet_lite0_uint8.tflite"

    if not model_path.exists():
        print(f"Downloading model to {model_path}...")
        import urllib.request
        urllib.request.urlretrieve(model_url, model_path)
        print("Model downloaded successfully!")

    return str(model_path)


def draw_detections(frame, result, confidence_threshold=0.5):
    """Draw bounding boxes and labels for detected people."""
    if not result.detections:
        return frame

    h, w = frame.shape[:2]
    person_count = 0

    for detection in result.detections:
        # Filter for "person" class (class index typically 0)
        if detection.categories[0].category_name.lower() == "person":
            if detection.categories[0].score >= confidence_threshold:
                person_count += 1

                bbox = detection.bounding_box
                x_min = int(bbox.origin_x * w)
                y_min = int(bbox.origin_y * h)
                x_max = int((bbox.origin_x + bbox.width) * w)
                y_max = int((bbox.origin_y + bbox.height) * h)

                # Draw bounding box
                cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), (0, 255, 0), 2)

                # Draw confidence score
                confidence = detection.categories[0].score
                label = f"Person: {confidence:.2f}"
                cv2.putText(
                    frame,
                    label,
                    (x_min, y_min - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 0),
                    2,
                )

    # Display person count
    cv2.putText(
        frame,
        f"People detected: {person_count}",
        (10, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 0, 255),
        2,
    )

    return frame


def main():
    input_source = sys.argv[1] if len(sys.argv) > 1 else 0
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    # Convert input_source to int if it's a digit (webcam), else keep as string (file path)
    try:
        input_source = int(input_source)
    except (ValueError, TypeError):
        pass

    model_path = get_model_path()

    # Create detector options
    options = vision.ObjectDetectorOptions(
        base_options=python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO,
        score_threshold=0.5,
    )

    # Open video source
    cap = cv2.VideoCapture(input_source)
    if not cap.isOpened():
        sys.exit(f"Could not open source: {input_source}")

    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Video writer if output file specified
    out = None
    if output_file:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(output_file, fourcc, fps, (width, height))
        print(f"Saving output to {output_file}")

    frame_count = 0

    with vision.ObjectDetector.create_from_options(options) as detector:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            frame_count += 1

            # Convert frame to MediaPipe Image
            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
            )

            # Detect objects
            timestamp_ms = int(time.monotonic() * 1000)
            result = detector.detect_for_video(mp_image, timestamp_ms)

            # Draw detections
            frame = draw_detections(frame, result)

            # Display frame
            cv2.imshow("People Detector", frame)

            # Save to output file if specified
            if out:
                out.write(frame)

            # Press 'q' to quit
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    print(f"Processed {frame_count} frames")

    cap.release()
    if out:
        out.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
