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
"""

import re
from pathlib import Path

CHALLENGES_PATH = Path("templates/challenges.html")

WILL_SWAP_EVENT = "repcheck:page-will-swap"


def _source():
    return CHALLENGES_PATH.read_text(encoding="utf-8")


def test_challenges_page_releases_the_camera_when_pagenav_swaps_it_away():
    """The teardown hook exists and runs the recorder's own close path."""
    source = _source()
    handlers = re.findall(
        rf'document\.addEventListener\(\s*["\']{re.escape(WILL_SWAP_EVENT)}["\']\s*,\s*'
        r'(?:function\s+([A-Za-z0-9_$]+)|([A-Za-z0-9_$]+))',
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
    assert "closeRecordModal()" in body.group(1), (
        "the page-will-swap handler must call closeRecordModal() -- that is what "
        "stops the MediaRecorder, clears the countdown and the stop timer, and "
        "calls stopRecordingStream()."
    )


def test_close_record_modal_really_releases_the_stream():
    """closeRecordModal() must stop the tracks, not just hide the modal."""
    source = _source()
    body = re.search(r"function closeRecordModal\(\)\s*\{(.*?)\n    \}", source, re.S)
    assert body, "closeRecordModal() not found in templates/challenges.html"
    inner = body.group(1)
    assert "stopRecordingStream()" in inner, (
        "closeRecordModal() must call stopRecordingStream() -- that is the call "
        "that stops the video tracks and frees the camera."
    )
    assert "clearInterval(countdownTimer)" in inner, (
        "closeRecordModal() must clear the countdown interval, or a swapped-away "
        "page keeps counting down and fires a submission from a dead screen."
    )


def test_stop_recording_stream_stops_every_track():
    source = _source()
    body = re.search(r"function stopRecordingStream\(\)\s*\{(.*?)\n    \}", source, re.S)
    assert body, "stopRecordingStream() not found in templates/challenges.html"
    assert re.search(r"getTracks\(\)\.forEach\(\s*\(?t\)?\s*=>\s*t\.stop\(\)\s*\)", body.group(1)), (
        "stopRecordingStream() must stop every track on the stream; anything less "
        "leaves the camera held open."
    )
