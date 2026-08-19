"""Every "scan a barcode" button must reach the live scanner.

The barcode UI has three entry points, and they live in two templates:

  1. "Barcode" in the Analyze-a-food-photo modal   (nutrition.html)
  2. "Open camera" on the ?quick=barcode landing    (nutrition.html)
  3. "Scan barcode" in the global FAB sheet         (base.html)

All three used to reach the hidden af-barcode-input directly, which takes a
single still photo with no retry -- if that one frame's focus, angle or
glare was off, the scan just failed. Replacing that with a live camera feed
only helps the callers that actually go through it, and each of these was
fixed in a separate pass *because the earlier passes missed one*: the FAB
handler in particular sat in base.html and silently kept the old behaviour
while the nutrition.html buttons worked, so scanning appeared completely
unfixed to anyone using that button.

These are source-level assertions (same approach as test_analyze_nav.py and
test_nutrition_relog_confirm.py -- there is no JS harness covering
base.html) and they exist to catch the specific regression this shape of bug
keeps taking: a new caller reaching past the scanner into the raw file
input, which fails silently and only on devices without BarcodeDetector.
"""

import re

import pytest

from app import app as flask_app


@pytest.fixture(scope="module")
def templates():
    out = {}
    for name in ("nutrition.html", "base.html"):
        with open(f"templates/{name}", encoding="utf-8") as f:
            out[name] = f.read()
    return out


def _fab_handler(base_html):
    """The mt-fab-scan-barcode click handler body."""
    match = re.search(
        r'getElementById\("mt-fab-scan-barcode"\).*?\n\s*\}\)\(\);',
        base_html,
        re.DOTALL,
    )
    assert match, "could not find the FAB scan-barcode handler in base.html"
    return match.group(0)


def test_fab_scan_barcode_opens_the_live_scanner(templates):
    """The global FAB is on every page, so when it fires on the nutrition
    page it must hand off to the scanner rather than reach past it."""
    handler = _fab_handler(templates["base.html"])
    assert "repcheckOpenBarcodeScanner" in handler, (
        "the FAB should open the live scanner via its exposed entry point"
    )


def test_fab_scan_barcode_does_not_click_the_still_photo_input(templates):
    """The regression itself: clicking af-barcode-input here bypasses the
    live scanner entirely and restores the one-shot photo behaviour."""
    handler = _fab_handler(templates["base.html"])
    assert "af-barcode-input" not in handler, (
        "the FAB must not open the one-shot photo input directly -- that is "
        "the exact bypass that kept barcode scanning broken on iPhone"
    )


def test_the_scanner_entry_point_is_actually_exposed(templates):
    """base.html can only call what nutrition.html publishes -- if this
    global is renamed or dropped, the FAB silently falls back to a full page
    navigation instead of opening the camera."""
    assert "window.repcheckOpenBarcodeScanner" in templates["nutrition.html"], (
        "nutrition.html must expose repcheckOpenBarcodeScanner for base.html"
    )


def test_quick_action_landing_opens_the_live_scanner(templates):
    """The ?quick=barcode landing screen's single button, reached when a
    navigation was unavoidable, goes to the scanner too."""
    match = re.search(
        r"function renderAfBarcodeQuickPrompt\(\)\s*\{(.*?)\n  \}",
        templates["nutrition.html"],
        re.DOTALL,
    )
    assert match, "renderAfBarcodeQuickPrompt() is missing"
    body = match.group(1)
    assert "startLiveBarcodeScan" in body
    assert "afBarcodeInput.click()" not in body


def test_in_modal_barcode_button_opens_the_live_scanner(templates):
    """The Barcode tile in the Analyze-a-food-photo modal."""
    match = re.search(
        r'getElementById\("af-scan-barcode-btn"\)\.addEventListener\("click",(.*?)\}\);',
        templates["nutrition.html"],
        re.DOTALL,
    )
    assert match, "the af-scan-barcode-btn handler is missing"
    assert "startLiveBarcodeScan" in match.group(1)


def test_safari_gets_an_on_device_decoder(templates):
    """Safari has no BarcodeDetector at any version, so without the bundled
    WebAssembly build every frame would have to round-trip to the server --
    slow enough on mobile data that the scanner reads a couple of frames a
    second instead of a dozen."""
    nutrition = templates["nutrition.html"]
    assert "vendor/zbar-wasm.js" in nutrition
    assert "runWasmBarcodeLoop" in nutrition
    # ...and it must stay lazy, so browsers with a native detector never
    # download ~330KB they will not use.
    assert "loadWasmBarcodeDecoder" in nutrition
