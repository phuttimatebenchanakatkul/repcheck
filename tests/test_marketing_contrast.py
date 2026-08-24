"""Guards the marketing palette's small coloured text against WCAG AA failure.

The accent hexes (`--green` #1fa971, `--amber` #b9832a) are chosen for fills --
buttons, gradients, icon chips -- where they sit under white text. As TEXT on a
light surface they only reach ~2.7-3.1:1, and every place the page uses them
that way is 11.5-12.5px, which needs 4.5:1. `--green-ink` / `--amber-ink` are
the darkened text-only variants.

This is easy to undo by accident: the two pairs look nearly identical in a
diff, and "simplify these back to --green" is a natural-looking cleanup that
silently drops the page below AA with no visual cue in the CSS. So compute the
real contrast ratios from the real tokens rather than asserting on hexes.

The marketing site is a separate Render Static Site with no build step (see
CLAUDE.md), so nothing else checks this.
"""

import re

import pytest

CSS = "marketing/styles.css"

# WCAG 2.1 AA for text under 18.66px bold / 24px regular. Every coloured-text
# use on this page (eyebrow 12.5px, pill 11.5px, kicker 12px, form-note 12.5px)
# is well under that, so none of them get the 3:1 large-text exemption.
AA_SMALL_TEXT = 4.5


def _relative_luminance(hex_colour):
    """WCAG 2.1 relative luminance."""
    h = hex_colour.lstrip("#")
    channels = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255
        channels.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    r, g, b = channels
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(fg, bg):
    a, b = _relative_luminance(fg), _relative_luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


@pytest.fixture(scope="module")
def css():
    with open(CSS, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def light_tokens(css):
    """First definition of each token wins -- that's the light `:root` block.

    The dark blocks redefine some of these further down the file.
    """
    tokens = {}
    for name, value in re.findall(r"(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;", css):
        tokens.setdefault(name, value.lower())
    return tokens


def test_contrast_helper_matches_known_wcag_values():
    """Black on white is 21:1 and white on white is 1:1 -- if these drift the
    rest of this file is measuring nothing."""
    assert round(_contrast("#000000", "#ffffff"), 2) == 21.0
    assert round(_contrast("#ffffff", "#ffffff"), 2) == 1.0


@pytest.mark.parametrize(
    "ink, surfaces",
    [
        # --green-ink is used on: plain sections (--bg), alt sections and the
        # CTA (--card-bg), and the eyebrow/pill chips (--green-bg).
        ("--green-ink", ["--bg", "--card-bg", "--green-bg"]),
        # --amber-ink is used on plain sections today; --amber-bg is included so
        # an amber chip added later is covered before it ships.
        ("--amber-ink", ["--bg", "--card-bg", "--amber-bg"]),
    ],
)
def test_ink_tokens_clear_aa_on_every_light_surface(light_tokens, ink, surfaces):
    assert ink in light_tokens, f"{ink} is not defined in {CSS}"
    fg = light_tokens[ink]
    for surface in surfaces:
        assert surface in light_tokens, f"{surface} is not defined in {CSS}"
        bg = light_tokens[surface]
        ratio = _contrast(fg, bg)
        assert ratio >= AA_SMALL_TEXT, (
            f"{ink} ({fg}) on {surface} ({bg}) is {ratio:.2f}:1, below the "
            f"{AA_SMALL_TEXT}:1 AA bar for text this size"
        )


def test_coloured_text_uses_the_ink_variants_not_the_accents(css):
    """The accents are for fills. A `color:`/`--kicker:` declaration reaching
    for one is the exact regression this file exists to catch."""
    # The lookbehind keeps `border-color` / `outline-color` out of this -- those
    # are borders and rings, which are fills and correctly stay on the accent.
    offenders = re.findall(
        r"(?:(?<![-\w])color|--kicker)\s*:\s*var\(\s*--(green|amber)\s*\)", css
    )
    assert not offenders, (
        f"coloured text still on the fill accent(s): {sorted(set(offenders))} "
        "-- use --green-ink / --amber-ink for text"
    )
