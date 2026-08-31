"""Guards the nutrition page's two live cameras against outliving the page.

templates/nutrition.html holds two getUserMedia streams: `afPhotoStream`, the
in-app food-photo viewfinder, and `barcodeLiveStream`, the barcode scanner.
Both are stopped only by an explicit UI action -- closing the camera screen,
or one of the barcode close paths.

Tapping another tab is not one. static/pagenav.js swaps the contents of <main>
in place, so neither pagehide nor visibilitychange fires, and the swap then
calls `RepCheckNavScope.release()`, which unbinds any handler the page had
registered for them anyway (static/nav_scope.js records every document/window
listener a page adds and removes it on the way out). So opening the food camera
or the scanner and then tapping another tab left the MediaStream running: the
camera indicator light stayed on, and a later getUserMedia collided with the
stream still held open -- iOS refuses a second camera in that state.

Same defect and same fix as the analyze viewfinder, see
tests/test_analyze_camera_released_on_page_swap.py: a `repcheck:page-will-swap`
listener, dispatched by pagenav.js immediately BEFORE release(), which is the
one moment a departing page can still run its own teardown.

Pinned at the source level rather than behaviourally for the same reason as
that test: the teardown lives in an inline <script> with no vitest harness, and
the contract at risk is the pairing of an event name in one file with a
dispatch in another. Same tradeoff as test_hyrox_flagged_copy_matches_behavior.py.
"""

import re
from pathlib import Path

NUTRITION_PATH = Path("templates/nutrition.html")

WILL_SWAP_EVENT = "repcheck:page-will-swap"


def _nutrition_source():
    return NUTRITION_PATH.read_text(encoding="utf-8")


def _will_swap_handler_body(source):
    """The body of the page's page-will-swap listener, or None."""
    match = re.search(
        rf'document\.addEventListener\(\s*["\']{re.escape(WILL_SWAP_EVENT)}["\']\s*,'
        r"\s*(?:function[^(]*\([^)]*\)|\([^)]*\)\s*=>)\s*\{(.*?)\n  \}\)",
        source,
        re.S,
    )
    return match.group(1) if match else None


def test_nutrition_page_listens_for_the_swap_that_takes_it_away():
    source = _nutrition_source()
    assert _will_swap_handler_body(source) is not None, (
        f"templates/nutrition.html must listen for {WILL_SWAP_EVENT!r} -- without "
        "it a tab-bar swap leaves the food-photo camera or the barcode scanner "
        "live, and the next getUserMedia collides with the stream still held."
    )


def test_the_swap_teardown_stops_both_live_streams():
    """Stopping only one of the two cameras still leaves the indicator lit."""
    body = _will_swap_handler_body(_nutrition_source())
    assert body is not None, f"no {WILL_SWAP_EVENT!r} listener in templates/nutrition.html"
    assert "stopAfPhotoCamera()" in body, (
        f"the {WILL_SWAP_EVENT!r} handler must call stopAfPhotoCamera() -- that is "
        "what stops afPhotoStream's tracks and frees the in-app food camera."
    )
    assert "stopLiveBarcodeScan()" in body, (
        f"the {WILL_SWAP_EVENT!r} handler must call stopLiveBarcodeScan() -- that "
        "is what stops barcodeLiveStream's tracks and the scan loop's timers."
    )


def test_the_stop_functions_really_release_their_cameras():
    """The handler is only worth anything if these two stop the tracks."""
    source = _nutrition_source()
    photo = re.search(r"function stopAfPhotoCamera\(\)\s*\{(.*?)\n  \}", source, re.S)
    assert photo, "stopAfPhotoCamera() not found in templates/nutrition.html"
    assert "afPhotoStream.getTracks()" in photo.group(1), (
        "stopAfPhotoCamera() must stop afPhotoStream's tracks -- that is the call "
        "that actually frees the camera for the next visit."
    )

    barcode = re.search(r"function stopLiveBarcodeScan\(\)\s*\{(.*?)\n  \}", source, re.S)
    assert barcode, "stopLiveBarcodeScan() not found in templates/nutrition.html"
    assert "barcodeLiveStream.getTracks()" in barcode.group(1), (
        "stopLiveBarcodeScan() must stop barcodeLiveStream's tracks -- that is the "
        "call that actually frees the camera for the next visit."
    )
