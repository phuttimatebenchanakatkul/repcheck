"""Guards the challenge recorder against outliving the page that opened it.

Regression: ISSUE-003 -- found by /qa on 2026-09-04.
Report: .gstack/qa-reports/qa-report-repcheck-q0m4-onrender-com-2026-09-04.md

templates/challenges.html opens a live getUserMedia feed to record a challenge
attempt, and hangs a MediaRecorder, a countdown setInterval, a setTimeout, a
requestAnimationFrame pose loop and two object URLs off it. All of them are
released only by an explicit UI action: closeRecordModal() or
closeResultPopup().

Leaving the page is neither of those, and it is not a navigation either.
static/pagenav.js swaps the contents of <main> in place, so neither pagehide
nor visibilitychange fires, and RepCheckNavScope.release() then unbinds any
handler this page registered for them anyway (static/nav_scope.js tracks
setInterval but not setTimeout, and nothing tracks a MediaStream).

So starting a recording and tapping another tab left the camera running for the
rest of the session: the indicator light stayed on, and every later
getUserMedia in the app -- the analyze viewfinder, the food camera, the barcode
scanner -- collided with the stream still held open, which iOS refuses.

templates/index.html and templates/nutrition.html already had the
`repcheck:page-will-swap` teardown (see
tests/test_analyze_camera_released_on_page_swap.py); challenges.html was the
last camera page without it.

Pinned at the source level for the same reason as the analyze test: the
teardown lives in an inline script with no vitest harness, and the contract at
risk is the pairing of an event name in one file with a dispatch in another.

Each function this walks is asserted on its own rather than trusting the
handler's two calls to imply the rest: the first version of this file asserted
only closeRecordModal(), which meant closeResultPopup() could be deleted from
the handler with the suite still green.
"""

import re
from pathlib import Path

CHALLENGES_PATH = Path("templates/challenges.html")

WILL_SWAP_EVENT = "repcheck:page-will-swap"

# Matches `function name() { ... }` at the inline script's indentation, up to
# the closing brace on its own line at that same indentation.
FUNCTION_BODY = r"function {name}\(\)\s*\{{(.*?)\n    \}}"


def _source():
    return CHALLENGES_PATH.read_text(encoding="utf-8")


def _body_of(name):
    """The body of a top-level function in challenges.html's inline script."""
    match = re.search(FUNCTION_BODY.format(name=name), _source(), re.S)
    assert match, f"{name}() not found in templates/challenges.html"
    return match.group(1)


def test_challenges_page_releases_the_camera_when_pagenav_swaps_it_away():
    """The teardown hook exists and runs both of the recorder's close paths."""
    source = _source()
    handlers = re.findall(
        rf'document\.addEventListener\(\s*["\']{re.escape(WILL_SWAP_EVENT)}["\']\s*,\s*'
        r"(?:function\s+([A-Za-z0-9_$]+)|([A-Za-z0-9_$]+))",
        source,
    )
    names = [a or b for a, b in handlers]
    assert names, (
        f"templates/challenges.html must listen for {WILL_SWAP_EVENT!r} -- without it a "
        "tab swap leaves the challenge camera live, and every later getUserMedia "
        "in the app collides with the stream still held open."
    )
    body = re.search(
        rf'document\.addEventListener\(\s*["\']{re.escape(WILL_SWAP_EVENT)}["\']\s*,'
        r"\s*function\s+[A-Za-z0-9_$]+\s*\(\)\s*\{(.*?)\n    \}\);",
        source,
        re.S,
    )
    assert body, "the page-will-swap handler in challenges.html is not in the expected shape"
    inner = body.group(1)
    assert "closeRecordModal()" in inner, (
        "the page-will-swap handler must call closeRecordModal() -- that is what "
        "stops the MediaRecorder, clears the countdown and the stop timer, and "
        "calls stopRecordingStream()."
    )
    assert "closeResultPopup()" in inner, (
        "the page-will-swap handler must also call closeResultPopup() -- that is "
        "the half that revokes resultBlobUrl and detaches the <video>. Without "
        "this assertion that call could be deleted with the suite still green."
    )


def test_close_record_modal_really_releases_the_stream():
    """closeRecordModal() must stop the tracks, not just hide the modal."""
    inner = _body_of("closeRecordModal")
    assert "stopRecordingStream()" in inner, (
        "closeRecordModal() must call stopRecordingStream() -- that is the call "
        "that stops the video tracks and frees the camera."
    )
    assert "clearInterval(countdownTimer)" in inner, (
        "closeRecordModal() must clear the countdown interval, or a swapped-away "
        "page keeps counting down and fires a submission from a dead screen."
    )
    assert "clearTimeout(recordStopTimer)" in inner, (
        "closeRecordModal() must clear recordStopTimer -- static/nav_scope.js "
        "tracks setInterval but NOT setTimeout, so nothing else will."
    )
    assert "hideAnalyzeStage()" in inner, (
        "closeRecordModal() must call hideAnalyzeStage(), which is what stops the "
        "pose RAF loop and revokes analyzeVideoUrl."
    )


def test_stop_recording_stream_stops_every_track():
    inner = _body_of("stopRecordingStream")
    assert re.search(r"getTracks\(\)\.forEach\(\s*\(?t\)?\s*=>\s*t\.stop\(\)\s*\)", inner), (
        "stopRecordingStream() must stop every track on the stream; anything less "
        "leaves the camera held open."
    )


def test_hide_analyze_stage_stops_the_pose_loop_and_revokes_its_blob():
    inner = _body_of("hideAnalyzeStage")
    assert "stopPoseOverlay()" in inner, (
        "hideAnalyzeStage() must call stopPoseOverlay() -- that is the "
        "cancelAnimationFrame that stops the pose loop running on a dead page."
    )
    assert "revokeObjectURL(analyzeVideoUrl)" in inner, (
        "hideAnalyzeStage() must revoke analyzeVideoUrl, or the recorded clip "
        "stays in memory after the page it belonged to is gone."
    )


def test_close_result_popup_revokes_the_result_blob():
    inner = _body_of("closeResultPopup")
    assert "revokeObjectURL(resultBlobUrl)" in inner, (
        "closeResultPopup() must revoke resultBlobUrl -- it is the only path that "
        "frees the submitted clip's object URL."
    )
