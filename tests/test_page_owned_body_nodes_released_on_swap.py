"""Guards the nodes a page puts in <body> against outliving that page.

A phone screenshot started this: open the food-analysis sheet on Nutrition,
close it, tap another tab, open a recent analysis, scroll down -- and the whole
food sheet is sitting at the bottom of that screen. "Log food", the close
button, the food's name, the macro donut, 1081 calories. Fully readable,
because it is completely unstyled.

Both halves of that come from the same place. `window.openBottomSheet`
(templates/base.html) re-parents a sheet to <body> so it escapes the
transformed stacking context inside .app -- which also takes it out of <main>,
the only part of the document static/pagenav.js replaces on a tab swap. And a
page template's CSS is inline INSIDE that <main>: `.af-modal-overlay` is
declared nowhere else, so the swap took its `position: fixed; opacity: 0` away
and left the markup behind as ordinary block content.

static/nav_scope.js already removes body-level nodes a page put there, but only
ones added while the page's own scripts were running -- a sheet is moved when a
thumb opens it, long after that. `RepCheckNavScope.adopt()` is the way a page
hands over a node it placed later.

The sheet itself is covered behaviourally, through the real pagenav +
nav_scope + openBottomSheet, in tests-js/sheetOutlivesItsPage.test.js. This
file covers the one other page-owned node placed in <body> at click time whose
rules are inline in <main> -- the nutrition save-error toast -- which has no
vitest harness of its own. Same tradeoff as
tests/test_nutrition_cameras_released_on_page_swap.py.
"""

import re
from pathlib import Path

NUTRITION_PATH = Path("templates/nutrition.html")
NAV_SCOPE_PATH = Path("static/nav_scope.js")
BASE_PATH = Path("templates/base.html")


def test_nav_scope_offers_a_way_to_hand_over_a_late_body_node():
    source = NAV_SCOPE_PATH.read_text(encoding="utf-8")
    assert re.search(r"\n    adopt: function \(node\) \{", source), (
        "static/nav_scope.js must expose adopt() -- it is how a page hands over "
        "a node it put in <body> after its scripts finished, and both "
        "openBottomSheet and the nutrition toast call it by that name."
    )
    assert "adopted = []" in source and "concat(adopted)" in source, (
        "release() must drain what adopt() collected, or handing a node over "
        "does nothing at all."
    )


def test_open_bottom_sheet_hands_over_the_sheets_it_moves_out_of_main():
    source = BASE_PATH.read_text(encoding="utf-8")
    match = re.search(
        r"window\.openBottomSheet = function\(.*?\n        \};", source, re.S
    )
    assert match, "window.openBottomSheet moved -- update this test."
    body = match.group(0)
    assert 'closest("main.main")' in body, (
        "openBottomSheet must ask whether the sheet came from inside <main> "
        "before adopting it: the shell's own sheets (the tab-bar '+' menu, "
        "log-weight, goal-adjust) live outside <main> and outlive every page."
    )
    assert "RepCheckNavScope.adopt" in body, (
        "openBottomSheet must hand a page's sheet to nav_scope, or a tab swap "
        "leaves it in the body of every screen after it."
    )


def test_the_save_error_toast_goes_with_the_page_that_raised_it():
    source = NUTRITION_PATH.read_text(encoding="utf-8")
    match = re.search(r"function showLogSaveError\(\) \{(.*?)\n  \}", source, re.S)
    assert match, "showLogSaveError() moved -- update this test."
    body = match.group(1)
    assert "document.body.appendChild(toast)" in body, (
        "showLogSaveError() no longer puts the toast in <body>; if it now "
        "renders inside <main> this test is obsolete, not failing."
    )
    assert "RepCheckNavScope.adopt" in body, (
        "The toast lands in <body> while .nl-save-error-toast's rules are "
        "inline in <main>, so a tab swap inside its six seconds leaves the "
        "error text unstyled on the next screen. Hand it to nav_scope."
    )
