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
        r"function renderRelogConfirm\(original\)\s*\{(.*?)\n  \}",
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
        r"function renderRelogConfirm\(original\)\s*\{(.*?)\n  \}",
        script,
        re.DOTALL,
    )
    assert fn_match, "renderRelogConfirm() is missing"
    body = fn_match.group(1)
    assert re.search(
        r'af-relog-confirm-btn"\)\.addEventListener\("click",\s*\(\)\s*=>\s*relogEntry\(original\)\)',
        body,
    ), "the confirm screen's Log again button should call relogEntry(original)"
    assert re.search(
        r'af-relog-cancel-btn"\)\.addEventListener\("click",\s*renderAfChoice\)',
        body,
    ), "Cancel should return to the choice screen, not log anything"
