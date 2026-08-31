"""Keeps the analyze page's "Recent analyses" strip from being squeezed again.

Two things conspired to crush this strip, and both are invisible from the rule
you would naturally go edit.

1. The section lives inside `.an-capture-card`, which is `padding: 0` so the
   camera viewfinder above it can go full-bleed. That zero is right for the
   video and wrong for everything under it: with no padding of its own,
   `.an-recent` ran flush into both card edges -- 8px from the screen edge on
   a phone -- which is most of what read as "squeezed up altogether".

2. `.an-recent-card` was width `calc((100% - Npx) / 3)`, a hard three-up lock.
   That makes every attempt to add breathing room backfire: v0.5.0.6 widened
   the strip gap 10px -> 16px and the card padding 8px -> 10px, and because
   the three-up divide absorbs the gap, each card got NARROWER (119px -> 115px
   on a 393px screen) and the usable label width dropped 103px -> 95px. The
   exercise name then wrapped to two lines, so the "room to breathe" change
   made the crowding worse. Sizing to the card instead of to a card count is
   what actually widens them.

Source-level rather than behavioural, the same tradeoff as
tests/test_analyze_camera_released_on_page_swap.py: this is CSS in an inline
<style> block with no vitest harness, and what is at risk is a value in one
rule being silently coupled to `padding: 0` in another.

Measured with the real stylesheets at three widths when this landed:
320px -> 132px cards, 390px (the desktop device frame) -> 135px,
393px -> 147px. Every exercise name fits on one line at all three.
"""

import re
from pathlib import Path

INDEX_PATH = Path("templates/index.html")


def _index_source():
    return INDEX_PATH.read_text(encoding="utf-8")


def _rule_body(source, selector):
    """The declarations inside a single CSS rule, one-line or block form."""
    match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", source)
    return match.group(1) if match else None


def test_capture_card_is_still_the_zero_padding_container_this_guards_against():
    """The premise of the other two tests. If this changes, revisit them."""
    body = _rule_body(_index_source(), ".an-capture-card")
    assert body is not None, ".an-capture-card rule not found in templates/index.html"
    assert re.search(r"padding:\s*0\b", body), (
        ".an-capture-card no longer sets padding: 0. That zero is why .an-recent "
        "has to supply its own horizontal padding -- recheck the test below, the "
        "section may now be double-padded instead of flush."
    )


def test_recent_section_insets_itself_from_the_flush_card_edge():
    body = _rule_body(_index_source(), ".an-recent")
    assert body is not None, ".an-recent rule not found in templates/index.html"
    match = re.search(r"padding:\s*([^;]+);", body)
    assert match, (
        ".an-recent must set its own padding -- it sits inside .an-capture-card, "
        "which is padding: 0 so the viewfinder can go full-bleed. Without this the "
        "title and the card strip run flush into both card edges."
    )
    parts = match.group(1).split()
    # padding shorthand: 1 value = all sides, 2 = block/inline, 3+ = inline is [1].
    horizontal = parts[0] if len(parts) == 1 else parts[1]
    pixels = re.match(r"(\d+(?:\.\d+)?)px$", horizontal)
    assert pixels and float(pixels.group(1)) > 0, (
        f".an-recent's horizontal padding is {horizontal!r}; it must be a positive "
        "px value, or the section is flush against the card edge again."
    )


def test_recent_cards_are_sized_to_the_card_not_locked_to_three_across():
    body = _rule_body(_index_source(), ".an-recent-card")
    assert body is not None, ".an-recent-card rule not found in templates/index.html"
    match = re.search(r"\bwidth:\s*([^;]+);", body)
    assert match, ".an-recent-card must set an explicit width"
    width = match.group(1).strip()
    assert not re.search(r"/\s*3\s*\)", width), (
        f".an-recent-card width is {width!r} -- a hard three-up divide. That is the "
        "shape that squeezed the strip: it forces ~115px cards on a 393px screen, "
        "and every added gap or padding then makes each card narrower rather than "
        "roomier. Size to the card (a percentage with a floor), not to a count."
    )
    assert "clamp(" in width or "%" in width, (
        f".an-recent-card width is {width!r}; it should scale with the strip so the "
        "cards stay proportionate across a 320px SE and a 430px Pro Max."
    )
