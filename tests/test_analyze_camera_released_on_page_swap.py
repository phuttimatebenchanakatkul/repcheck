"""Guards the analyze viewfinder against outliving the page that opened it.

The analyze page opens the camera on load (`openCamera()` runs at the bottom of
its inline script) and releases it from two handlers: `visibilitychange` and
`pagehide`. Both assume leaving this page is a navigation.

Tapping another tab is not. static/pagenav.js swaps the contents of <main> in
place, so neither event fires -- and then `RepCheckNavScope.release()` unbinds
those two handlers outright (static/nav_scope.js records every document/window
listener a page registers and removes it on the way out). The camera was
therefore never released: the indicator light stayed on, and the next visit to
the analyze page called getUserMedia while the first stream was still held.
iOS refuses a second camera in that state -- the same constraint the recorder's
own flip() works around by stopping tracks before re-opening -- so the promise
rejected, showCameraFallback() ran, and the viewfinder was replaced by the
upload dropzone for the rest of the session. The camera worked once per full
page load and never again.

The fix is a `repcheck:page-will-swap` listener. pagenav.js dispatches that
event immediately BEFORE calling release(), which is the one moment a departing
page can still run its own teardown.

This is pinned at the source level rather than behaviourally: the teardown lives
in index.html's inline script, which has no vitest harness (tests-js/support/
has a loader for static/video_recorder.js, but not for this page's wiring), and
the contract at risk is the pairing of an event name in one file with a dispatch
in another. Same tradeoff as test_hyrox_flagged_copy_matches_behavior.py.
"""

import re
from pathlib import Path

INDEX_PATH = Path("templates/index.html")
PAGENAV_PATH = Path("static/pagenav.js")

WILL_SWAP_EVENT = "repcheck:page-will-swap"


def _index_source():
    return INDEX_PATH.read_text(encoding="utf-8")


def test_analyze_page_releases_the_camera_when_pagenav_swaps_it_away():
    """The teardown hook exists and calls the function that stops the tracks."""
    source = _index_source()
    match = re.search(
        rf'document\.addEventListener\(\s*["\']{re.escape(WILL_SWAP_EVENT)}["\']\s*,\s*([A-Za-z0-9_$]+)',
        source,
    )
    assert match, (
        f"templates/index.html must listen for {WILL_SWAP_EVENT!r} -- without it a "
        "tab-bar swap leaves the camera live and the next visit's getUserMedia "
        "collides with the stream still held open."
    )
    handler = match.group(1)
    assert handler == "closeCamera", (
        f"the {WILL_SWAP_EVENT!r} handler is {handler!r}; it must be closeCamera, "
        "which is what actually stops the MediaStream tracks and clears the timers."
    )


def test_close_camera_cancels_the_session_that_holds_the_tracks():
    """closeCamera() must really release the camera, not just reset the UI."""
    source = _index_source()
    body = re.search(r"function closeCamera\(\)\s*\{(.*?)\n  \}", source, re.S)
    assert body, "closeCamera() not found in templates/index.html"
    assert "camSession.cancel()" in body.group(1), (
        "closeCamera() must call camSession.cancel() -- that is the call that "
        "stops the video tracks and frees the camera for the next visit."
    )


def test_pagenav_still_dispatches_will_swap_before_releasing_listeners():
    """The hook above only works because of this ordering in pagenav.js."""
    source = PAGENAV_PATH.read_text(encoding="utf-8")
    dispatch = source.find(f'CustomEvent(WILL_SWAP')
    release = source.find("scope.release(pageRecords)")
    assert dispatch != -1, "pagenav.js no longer dispatches WILL_SWAP"
    assert release != -1, "pagenav.js no longer calls scope.release(pageRecords)"
    assert dispatch < release, (
        "pagenav.js must dispatch page-will-swap BEFORE scope.release() unbinds "
        "the departing page's listeners, or the analyze page can never release "
        "its camera."
    )
    assert f'"{WILL_SWAP_EVENT}"' in source, (
        f"pagenav.js must still name the event {WILL_SWAP_EVENT!r}; the analyze "
        "page listens for that exact string."
    )
