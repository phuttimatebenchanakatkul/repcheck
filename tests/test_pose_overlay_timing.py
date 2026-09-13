"""The skeleton on the "Analyzing" screen has to move with the clip.

Two reports about that overlay -- it did not line up with the video, and it
was not smooth -- with one cause between them: detection rate and render rate
were the same rate, and it was the slow one.

A detection costs 40-110ms end to end (grab the frame, transfer it to the
worker, run the model, post landmarks back), and on top of that the loop sat
out a 120ms floor before even starting the next one. So the overlay was
repainted perhaps eight times a second, against a clip playing at thirty, and
each repaint showed the body as it had been a tenth of a second earlier. Held
still in between, it stepped; drawn late, it trailed.

The fix splits the two rates apart. Detection runs as fast as the device
manages; rendering happens every animation frame, positioning the skeleton at
`previewVideo.currentTime` from the last two results. The arithmetic that does
the positioning is unit-tested in tests-js/poseInterp.test.js -- what is left
here is the wiring, which cannot be exercised in jsdom because it needs a
playing <video>, a WASM model and a live worker.

Source-level for that reason, and pinned tightly: each assertion below is one
of the connections that, quietly removed, would put the old behaviour back
with every other test still green.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ANALYZE = ROOT / "templates" / "index.html"
WORKER = ROOT / "static" / "pose_worker.js"


@pytest.fixture(scope="module")
def source():
    return ANALYZE.read_text(encoding="utf-8")


def _pose_loop(source):
    """The body of the rAF loop inside startPoseLoop()."""
    body = re.search(
        r"function startPoseLoop\(\) \{(.*?)\n  \}\n", source, re.S
    )
    assert body, "startPoseLoop() was renamed or restructured"
    return body.group(1)


# ---------- Rendering is decoupled from detection ----------

def test_the_skeleton_is_redrawn_every_animation_frame(source):
    """The heart of it.

    Previously the only call to the draw function was from the result
    handler, so the canvas changed only when a detection came back. Now the
    loop draws on its own schedule and the results only update where it
    draws FROM.
    """
    loop = _pose_loop(source)

    assert "drawPoseAt(previewVideo.currentTime)" in loop, (
        "the pose loop no longer redraws each frame at the clip's current "
        "position -- the skeleton is back to updating only when a detection "
        "lands, which is the stepping that was reported"
    )


def test_results_are_filed_as_samples_rather_than_drawn_on_arrival(source):
    """Both backends. If either one painted directly, its path would keep the
    old lag while the other was fixed -- and the worker path is the one that
    runs on almost every device, so a regression on the main-thread fallback
    would be invisible until someone denied the worker."""
    assert "drawPose(" not in source.replace("drawPoseAt(", ""), (
        "something still draws a detection result straight to the canvas"
    )

    handler = re.search(r"function onPoseWorkerMessage\(event\) \{(.*?)\n  \}", source, re.S)
    assert handler, "onPoseWorkerMessage() was renamed"
    assert "recordPoseSample(msg.landmarks, poseFrameVideoTime)" in handler.group(1), (
        "the worker's results are not being filed against the video time of "
        "the frame they came from"
    )

    loop = _pose_loop(source)
    assert "recordPoseSample(result.landmarks, at)" in loop, (
        "the main-thread fallback's results are not being filed as samples"
    )


# ---------- The sample is timestamped by the frame, not by its result ----------

def test_the_video_time_is_read_before_the_frame_is_grabbed(source):
    """This ordering is the whole measurement.

    createImageBitmap(video) snapshots the frame showing when it is called,
    so currentTime read just before it is that frame's own position in the
    clip. Read later -- when the result arrives, say -- it would record where
    the clip had got to by then, which is exactly the latency the renderer
    exists to measure out. The skeleton would be timestamped as current, and
    so drawn with the same lag as before, silently.
    """
    body = re.search(r"function sendPoseFrame\(worker, ts\) \{(.*?)\n  \}", source, re.S)
    assert body, "sendPoseFrame() was renamed or restructured"
    stripped = re.sub(r"//.*$", "", body.group(1), flags=re.MULTILINE)

    assert "poseFrameVideoTime = previewVideo.currentTime" in stripped, (
        "sendPoseFrame() no longer records the video time of the frame it grabs"
    )
    assert stripped.index("poseFrameVideoTime = previewVideo.currentTime") < stripped.index(
        "createImageBitmap"
    ), "the video time is read after the frame is grabbed, so it times the wrong moment"


def test_the_main_thread_path_times_its_frame_the_same_way(source):
    loop = _pose_loop(source)
    stripped = re.sub(r"//.*$", "", loop, flags=re.MULTILINE)

    assert stripped.index("const at = previewVideo.currentTime") < stripped.index(
        "detectForVideo"
    ), "the fallback reads the video time after detecting, which times the wrong moment"


# ---------- Detection is no longer throttled below the device's own rate ----------

def test_the_worker_floor_is_well_under_the_models_own_cost(source):
    """The old 120ms floor was pure idle: the worker finished in 25-80ms and
    then waited longer than it had worked. The floor is kept only so a fast
    desktop does not run detection at the full display rate, so it has to sit
    below what the model costs on a phone or it is throttling again."""
    match = re.search(r"const POSE_DETECT_INTERVAL_MS = (\d+);", source)
    assert match, "POSE_DETECT_INTERVAL_MS is gone"

    assert int(match.group(1)) <= 33, (
        "the worker detection floor is " + match.group(1) + "ms, which is more "
        "than a 30Hz frame -- it throttles detection below what the device "
        "could manage, which is half of why the skeleton trailed the body"
    )


def test_that_floor_is_not_applied_to_the_main_thread_fallback(source):
    """There the model runs on the render thread, so every detection is time
    the <video> spends not being decoded. Detecting more often would buy a
    tighter skeleton by making the clip stutter -- the exact trade the worker
    exists to avoid taking."""
    match = re.search(r"const POSE_MAIN_THREAD_INTERVAL_MS = (\d+);", source)
    assert match, (
        "POSE_MAIN_THREAD_INTERVAL_MS is gone -- if the fallback now shares "
        "the worker's floor, it is detecting on the render thread every 33ms"
    )
    assert int(match.group(1)) >= 100

    loop = _pose_loop(source)
    assert "poseLandmarker && now - lastDetectTs >= POSE_MAIN_THREAD_INTERVAL_MS" in loop, (
        "the main-thread branch is not gated by its own wider interval"
    )


def test_the_worker_is_still_paced_by_one_frame_at_a_time(source):
    """Removing the floor only works because this gate stays: the next frame
    goes out when the previous result is back. Without it a slow device would
    queue frames it cannot keep up with, and the timestamps reaching
    detectForVideo() would stop being monotonic -- which wedges the landmarker
    permanently, not just for that frame."""
    loop = _pose_loop(source)

    assert "if (!poseFrameInFlight)" in loop, (
        "the worker path no longer waits for the previous result before "
        "sending the next frame"
    )


# ---------- A pair of samples has to describe one continuous movement ----------

def test_an_analysis_does_not_inherit_the_previous_clips_pose(source):
    """stopPoseLoop() runs between analyses. A leftover sample would be paired
    with the first result of the next clip and the renderer would draw a line
    straight across the two."""
    body = re.search(r"function stopPoseLoop\(\) \{(.*?)\n  \}", source, re.S)
    assert body, "stopPoseLoop() was renamed"

    assert "clearPoseSamples()" in body.group(1), (
        "stopPoseLoop() no longer drops the stored samples"
    )


def test_both_landmarkers_still_return_a_single_pose(source):
    """The renderer keeps landmarks[0] and nothing else, which is every pose
    the model returns while numPoses is 1. Poses carry no identity between
    frames, so a second one could not be paired across time anyway -- raising
    numPoses would need the renderer reworked, not just the option changed.
    """
    worker = WORKER.read_text(encoding="utf-8")

    # Read out of each createLandmarker() rather than counted across the file:
    # the prose above explains the constraint and would otherwise match.
    for name, text in (("templates/index.html", source), ("static/pose_worker.js", worker)):
        options = re.search(
            r"createFromOptions\(vision, \{(.*?)\n\s*\}\);", text, re.S
        )
        assert options, "createLandmarker() was restructured in " + name
        assert "numPoses: 1," in options.group(1), (
            name + " no longer builds its landmarker with numPoses: 1"
        )
