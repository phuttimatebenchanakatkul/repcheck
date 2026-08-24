"""Today's Plan quick-add must read as a green checkmark, not a green dot.

This has regressed twice. Both earlier fixes kept the 26px filled green
disc and only adjusted what sat inside it (a Unicode glyph, then a white
SVG tick). At 13px inside a 26px disc the tick doesn't read at all on a
phone -- the disc is the only thing the eye resolves, so a logged plan
row looked like an unexplained green dot.

The current shape drops the disc: transparent background, the tick
itself stroked in --green, sized up to 20px. Two things have to hold for
that to survive:

  - .wl-plan-quick-add.is-added must not paint a green background, and
    must set its color to var(--green) so the currentColor stroke picks
    it up.
  - .wl-plan-quick-add must zero its padding. The UA's default button
    padding (1px 6px) eats 12px of the 26px box, and because the button
    is a flex container the SVG shrinks to fit the content box -- a
    declared 20px icon rendered at 14px before padding:0 was added.

Source-level assertions rather than behavioural ones: this is CSS in an
inline <style> block with no module boundary, the same tradeoff the
other regex suites in this directory make.
"""

import re

import pytest


@pytest.fixture(scope="module")
def workouts_html():
    with open("templates/workouts.html", encoding="utf-8") as f:
        return f.read()


def _rule(html, selector):
    match = re.search(re.escape(selector) + r"\s*\{(.*?)\}", html, re.DOTALL)
    assert match, f"could not find the {selector} rule"
    return match.group(1)


def test_added_state_has_no_filled_disc(workouts_html):
    body = _rule(workouts_html, ".wl-plan-quick-add.is-added")
    background = re.search(r"background:\s*([^;]+);", body)
    assert background, "the added state must declare its background"
    assert background.group(1).strip() == "transparent", (
        "a filled green disc swallows the checkmark -- the tick itself is "
        "the icon, so the added state must not paint a background"
    )


def test_added_state_strokes_the_tick_in_green(workouts_html):
    body = _rule(workouts_html, ".wl-plan-quick-add.is-added")
    color = re.search(r"color:\s*([^;]+);", body)
    assert color, "the added state must declare its color"
    assert color.group(1).strip() == "var(--green)", (
        "the SVG strokes with currentColor, so the button's color is what "
        "makes the checkmark green"
    )


def test_quick_add_button_zeroes_its_padding(workouts_html):
    body = _rule(workouts_html, ".wl-plan-quick-add")
    assert re.search(r"padding:\s*0\s*;", body), (
        "the UA's default button padding shrinks the 26px flex box's "
        "content area, and the icon shrinks with it"
    )
