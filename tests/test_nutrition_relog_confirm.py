"""Guards the "+ Log again" confirmation screen in the nutrition page.

Tapping "+ Log again" on a previously-scanned food in the "Recent scans"
list used to call relogEntry() straight from the click handler -- no
confirmation, no macros shown, just an instant silent log. A user could
easily fat-finger the wrong "Recent scans" row and have a meal logged
against their daily totals with zero chance to notice or back out.

The fix inserts a confirm screen (renderRelogConfirm) between the click
and the actual log write: it shows the entry's own stored calories/
protein/fat/carbs (via the same donut-chart display used for a fresh
photo-scan result) and only calls relogEntry() if the user explicitly
taps "Log again" on that screen.

templates/nutrition.html has no JS test harness in this repo (no build
step, no jsdom), so -- following the pattern in test_analyze_nav.py's
_analyze_hrefs() -- these tests inspect the rendered template source
directly rather than executing the script. That's enough to catch the
regression this bug represents: someone re-wiring the click handler
straight back to relogEntry(), bypassing the confirm screen entirely.
"""

import re

import pytest

from app import app as flask_app


@pytest.fixture(scope="module")
def nutrition_html():
    with flask_app.test_request_context():
        # Render through the real Jinja pipeline (not a raw file read) so a
        # future template-syntax change that breaks parsing fails this test
        # too, not just a runtime request.
        from flask import render_template

        try:
            return render_template(
                "nutrition.html",
                food_library=[],
                nutrition_goals={},
                weight_unit="lbs",
            )
        except Exception:
            # Some deployments require more context vars than this test
            # wants to stub out one-by-one; fall back to the raw source,
            # which still lets the structural assertions below run.
            with open("templates/nutrition.html", encoding="utf-8") as f:
                return f.read()


def _script_block(html):
    match = re.search(r"<script>(.*)</script>\s*</body>", html, re.DOTALL)
    return match.group(1) if match else html


def test_relog_click_handler_does_not_log_directly(nutrition_html):
    """The [data-relog] click handler must route through the confirm
    screen, not call relogEntry() itself."""
    script = _script_block(nutrition_html)
    handler_match = re.search(
        r'closest\("\[data-relog\]"\).*?\n(.*?)\n\s*\}\);',
        script,
        re.DOTALL,
    )
    assert handler_match, "could not find the [data-relog] click handler"
    handler_body = handler_match.group(1)
    assert "relogEntry(" not in handler_body, (
        "the recent-scans click handler calls relogEntry() directly again -- "
        "this silently re-logs the food with no confirmation, no macros shown"
    )
    assert "renderRelogConfirm(" in handler_body, (
        "the recent-scans click handler no longer opens the confirmation screen"
    )


def test_relog_confirm_screen_shows_macros_before_logging(nutrition_html):
    """renderRelogConfirm must display the entry's real macros (via the
    same helpers as a fresh scan result) rather than logging blind."""
    script = _script_block(nutrition_html)
    fn_match = re.search(
        r"function renderRelogConfirm\(original[^)]*\)\s*\{(.*?)\n  \}",
        script,
        re.DOTALL,
    )
    assert fn_match, "renderRelogConfirm() is missing"
    body = fn_match.group(1)
    assert "scaledMacros(original)" in body, (
        "renderRelogConfirm should compute the entry's real macros, not guess"
    )
    assert "donutChartHtml(" in body, (
        "renderRelogConfirm should visually show calories/macros before logging"
    )


def test_relog_confirm_button_is_the_only_thing_that_logs(nutrition_html):
    """Only the confirm screen's own "Log again" button may call
    relogEntry() -- cancelling must not log anything."""
    script = _script_block(nutrition_html)
    fn_match = re.search(
        r"function renderRelogConfirm\(original[^)]*\)\s*\{(.*?)\n  \}",
        script,
        re.DOTALL,
    )
    assert fn_match, "renderRelogConfirm() is missing"
    body = fn_match.group(1)
    # The confirm button's handler is a block (it also one-shots itself against
    # double-taps), so this checks the CALL rather than a one-liner arrow: only
    # this handler may reach relogEntry, and relogEntry is called with the
    # entry -- plus optionally the hour the sheet was pinned to.
    assert re.search(
        r'af-relog-confirm-btn"\);?\n?', body
    ), "the confirm screen should wire up its own Log again button"
    assert re.search(r"relogEntry\(original(,\s*\w+)?\)", body), (
        "the confirm screen's Log again button should call relogEntry(original)"
    )
    # Cancel goes back to wherever the screen was opened from: renderAfChoice
    # for the recent-scans list, or a caller-supplied handler for the
    # food-search sheet, whose "back" is not the scan screen. Either way it
    # must not log.
    cancel_match = re.search(
        r'af-relog-cancel-btn"\)\.addEventListener\("click",\s*([^)]+)\)', body
    )
    assert cancel_match, "Cancel should be wired to a handler"
    assert "relogEntry" not in cancel_match.group(1), (
        "Cancel must not log anything"
    )
    assert "renderAfChoice" in cancel_match.group(1), (
        "Cancel should still fall back to the choice screen when no caller "
        "supplies its own way out"
    )


def test_relog_confirm_shows_the_serving_amount(nutrition_html):
    """A calorie count with no amount attached is unreadable -- "804 kcal"
    could be a snack or a platter. The confirm screen must state the grams
    the entry actually represents."""
    script = _script_block(nutrition_html)
    fn_match = re.search(
        r"function renderRelogConfirm\(original[^)]*\)\s*\{(.*?)\n  \}",
        script,
        re.DOTALL,
    )
    assert fn_match, "renderRelogConfirm() is missing"
    body = fn_match.group(1)
    assert "entryTotals(original)" in body, (
        "renderRelogConfirm should read the entry's real total grams from "
        "entryTotals() -- scaledMacros() alone discards the amount"
    )
    assert re.search(r"totals\.grams", body), (
        "the confirm screen should display the entry's total grams"
    )


def test_relog_confirm_lists_per_ingredient_amounts(nutrition_html):
    """For a multi-ingredient dish the breakdown IS the serving: 400g total
    is only meaningful as 150g pork + 200g rice + 50g egg."""
    script = _script_block(nutrition_html)
    fn_match = re.search(
        r"function renderRelogConfirm\(original[^)]*\)\s*\{(.*?)\n  \}",
        script,
        re.DOTALL,
    )
    assert fn_match, "renderRelogConfirm() is missing"
    body = fn_match.group(1)
    assert "ing.grams" in body, (
        "each ingredient's own gram amount should be shown"
    )
    assert "escapeHtml(ing.name)" in body, (
        "ingredient names are Gemini-authored and must be escaped before "
        "reaching innerHTML"
    )


def test_recent_scans_row_shows_grams(nutrition_html):
    """The Recent scans list should show the amount too, so the user can
    tell two differently-sized logs of the same dish apart before tapping."""
    script = _script_block(nutrition_html)
    row_match = re.search(r'af-recent-meta">(.*?)</div>', script)
    assert row_match, "could not find the recent-scans meta row"
    assert "totals.grams" in row_match.group(1), (
        "the recent-scans row should show the entry's grams alongside kcal"
    )
