"""The "+" quick-actions sheet: four buttons, and no glow.

Three constraints keep getting re-broken by hand, so they are pinned here as
source-level assertions (same approach as test_barcode_entry_points.py --
base.html's markup and static/style.css have no other harness):

  1. Exactly FOUR action tiles. The sheet used to carry six tiles AND a
     labelled list of the "More" pages stacked underneath, which pushed it
     past its 88%-height cap and made it scroll on short phones. Challenges
     was the fifth, dropped when the feature was hidden from the app.
  2. The More pages are present but NOT on the actions pane -- they live on
     a second pane that is `hidden` until asked for.
  3. No glow. A tinted or dark box-shadow under the tiles reads as a halo on
     the dark theme; it has been added and removed from this app repeatedly
     (branches fix/remove-cta-glow-effect, fix/remove-af-icon-glow).

The behavioural half of the pane swap is covered by
tests-js/quickActionsPanes.test.js, which runs the real inline block.
"""

import re

import pytest


@pytest.fixture(scope="module")
def base_html():
    with open("templates/base.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def style_css():
    with open("static/style.css", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def i18n_js():
    with open("static/i18n.js", encoding="utf-8") as f:
        return f.read()


def _actions_pane(base_html):
    """The markup between the actions pane and the More pane."""
    start = base_html.index('id="qa-pane-actions"')
    end = base_html.index('id="qa-pane-more"')
    assert end > start
    return base_html[start:end]


def _more_pane(base_html):
    start = base_html.index('id="qa-pane-more"')
    end = base_html.index('id="mt-fab-cancel"')
    assert end > start
    return base_html[start:end]


def test_actions_pane_has_exactly_four_tiles(base_html):
    tiles = re.findall(r'class="qa-tile[ "]', _actions_pane(base_html))
    assert len(tiles) == 4, (
        f"expected 4 action tiles in the quick-actions sheet, found {len(tiles)}. "
        "If a fifth action is genuinely needed, something has to move into the "
        "More pane."
    )


def test_log_a_workout_is_not_a_quick_action(base_html):
    # It was dropped because the bottom bar already has a Workouts tab, so it
    # was the one action with a shorter path elsewhere.
    assert "mobile.logWorkout" not in _actions_pane(base_html)


def test_the_four_tiles_are_the_expected_actions(base_html):
    pane = _actions_pane(base_html)
    for key in (
        "mobile.scanMeal",
        "mobile.analyzeLift",
        "mobile.logWeight",
        "mobile.scanBarcode",
    ):
        assert key in pane, f"{key} is missing from the quick-actions tiles"


def test_challenges_is_not_a_quick_action(base_html):
    # Hidden from the app: no tile here.
    assert "mobile.challenges" not in _actions_pane(base_html)


def test_more_pages_are_not_on_the_actions_pane(base_html):
    pane = _actions_pane(base_html)
    assert "mt-sheet-action" not in pane, (
        "the More pages (Coach/Friends/Settings/...) must not render alongside "
        "the action tiles -- that stacking is what made the sheet scroll"
    )
    # The old always-visible section label must be gone with them.
    assert "qa-section-label" not in base_html


def test_more_pane_is_hidden_until_opened(base_html):
    opening_tag = base_html[
        base_html.index('<section class="qa-pane" id="qa-pane-more"') :
    ].split(">", 1)[0]
    assert "hidden" in opening_tag, "the More pane must start hidden"


def test_more_pane_still_carries_every_page(base_html):
    pane = _more_pane(base_html)
    for route in ("coach", "friends", "settings", "admin_users"):
        assert f"url_for('{route}')" in pane, f"{route} fell out of the More pane"
    assert "auth.logout" in pane
    assert "auth.login_page" in pane


def test_more_pane_is_reachable_from_the_actions_pane(base_html):
    pane = _actions_pane(base_html)
    assert 'id="qa-more-open"' in pane
    assert 'aria-controls="qa-pane-more"' in pane
    # And back again.
    assert 'id="qa-more-back"' in _more_pane(base_html)


def test_more_is_a_quiet_row_not_a_sixth_tile(base_html):
    # If it ever becomes a .qa-tile it starts competing with the four actions,
    # and the tile count assertion above would also start lying.
    more_link = re.search(r'<button[^>]*id="qa-more-open"[^>]*>', base_html).group(0)
    assert "qa-more-link" in more_link
    assert "qa-tile" not in more_link


def test_the_sheet_subtitle_is_gone(base_html, i18n_js):
    assert "qa-head-sub" not in base_html
    assert "mobile.quickActionsSub" not in base_html
    # And the dead key was retired rather than left dangling in i18n.
    assert "mobile.quickActionsSub" not in i18n_js


def test_more_options_label_is_translated(i18n_js):
    # One entry per locale block: English and Thai.
    assert i18n_js.count('"mobile.moreOptions"') == 2


def test_quick_action_tiles_have_no_glow(style_css):
    block = style_css[style_css.index(".qa-tile {") : style_css.index(".qa-tile-title")]
    assert "box-shadow" not in block, (
        "no box-shadow on the quick-action tiles or their icon badges -- a drop "
        "shadow reads as a halo on the dark theme and keeps getting reverted"
    )


def test_tiles_have_no_per_action_color_classes(base_html, style_css):
    # The colour-per-action badges (qa-green/blue/amber/red/purple) were
    # retired when the sheet moved from a tile grid to a flat row list --
    # every row (actions AND the More pages) now shares one plain icon
    # treatment, so no tile should still carry a colour modifier class.
    for color in ("qa-green", "qa-blue", "qa-amber", "qa-red", "qa-purple"):
        assert color not in base_html, f"{color} modifier class should be gone from the redesigned sheet"
    block = style_css[style_css.index(".qa-tile {") : style_css.index(".qa-cancel {")]
    assert "gradient" not in block
