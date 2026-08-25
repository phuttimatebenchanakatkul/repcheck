"""Guards the marketing palette's small coloured text against WCAG AA failure.

The accent hexes (`--green`, `--amber`, `--blue`) are chosen for fills -- they
sit under white text on a button or an icon chip. Used *as* text they miss the
4.5:1 bar that everything on this page needs, because every coloured-text spot
(eyebrow 12.5px, pill 11.5px, kicker 12px, form-note 12.5px) is well under the
18.66px-bold threshold that would earn the 3:1 large-text exemption.

The `-ink` tokens are the text-only variants. Which direction each moves is a
per-token, per-theme fact, not a rule:

    green / amber   fail on light, pass on dark   -> darkened, dark reverts
    blue            fails on dark, marginal light -> darker light AND lighter dark

That asymmetry is exactly why this file computes real contrast ratios from the
real tokens instead of asserting on hex strings. It survives a repalette and
only fails on an actual regression -- and it catches the "simplify these back
to the accent" cleanup, which looks harmless in a diff and silently drops the
page below AA with no visual cue in the CSS.

The marketing site is a separate Render Static Site with no build step (see
CLAUDE.md), so nothing else checks this.
"""

import re

import pytest

CSS = "marketing/styles.css"

# WCAG 2.1 AA for text below 18.66px bold / 24px regular.
AA_SMALL_TEXT = 4.5

# Each ink, and every surface token it can legitimately land on. Surfaces are
# named by token so the check follows a repalette instead of pinning hexes.
# A `-bg` tint is listed even where no chip uses that colour yet, so one added
# later is covered before it ships rather than after someone squints at it.
INK_SURFACES = {
    "--green-ink": ["--bg", "--card-bg", "--green-bg"],
    "--amber-ink": ["--bg", "--card-bg", "--amber-bg"],
    "--blue-ink": ["--bg", "--card-bg", "--blue-bg"],
}

THEMES = ["light", "dark"]


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


def _block_body(css, selector_pattern):
    """Body of the first rule whose selector matches. These blocks hold only
    custom-property declarations, so a simple scan to the closing brace is
    enough -- no nesting to balance."""
    m = re.search(selector_pattern + r"\s*\{", css)
    assert m, f"no block matching {selector_pattern!r} in {CSS}"
    end = css.index("}", m.end())
    return css[m.end() : end]


def _declarations(body):
    return dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body))


def _resolve(value, table):
    """One level of `var(--x)` indirection -- all the dark blocks use."""
    m = re.fullmatch(r"var\(\s*(--[\w-]+)\s*\)", value.strip())
    return table[m.group(1)] if m else value.strip()


@pytest.fixture(scope="module")
def css():
    with open(CSS, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def palettes(css):
    """{theme: {token: '#rrggbb'}} with the dark block layered over light."""
    light = _declarations(_block_body(css, r"(?<!\w):root(?!\[|:)"))
    dark_over = _declarations(_block_body(css, r":root\[data-theme=\"dark\"\]"))
    dark = dict(light)
    dark.update(dark_over)
    dark = {k: _resolve(v, dark) for k, v in dark.items()}
    light = {k: _resolve(v, light) for k, v in light.items()}
    keep = lambda d: {k: v for k, v in d.items() if re.fullmatch(r"#[0-9a-fA-F]{6}", v)}
    return {"light": keep(light), "dark": keep(dark)}


def test_contrast_helper_matches_known_wcag_values():
    """Black on white is 21:1, white on white is 1:1. If these drift, every
    other assertion in this file is measuring nothing."""
    assert round(_contrast("#000000", "#ffffff"), 2) == 21.0
    assert round(_contrast("#ffffff", "#ffffff"), 2) == 1.0


def test_both_dark_blocks_define_the_same_inks(css):
    """The theme is set twice -- once under `prefers-color-scheme` for the OS
    default and once on `[data-theme="dark"]` for the manual toggle. They are
    hand-duplicated, so an ink added to one and forgotten in the other would
    leave the toggle and the OS default disagreeing. Only the OS-default path
    would be wrong, which is the one nobody clicks to check."""
    media = _declarations(_block_body(css, r":root:not\(\[data-theme=\"light\"\]\)"))
    attr = _declarations(_block_body(css, r":root\[data-theme=\"dark\"\]"))
    ink = lambda d: {k: v.strip() for k, v in d.items() if k.endswith("-ink")}
    assert ink(media) == ink(attr), (
        "the two dark blocks disagree on the -ink tokens; both must define "
        "every ink identically"
    )


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("ink", sorted(INK_SURFACES))
def test_ink_clears_aa_on_every_surface_it_can_land_on(palettes, theme, ink):
    table = palettes[theme]
    assert ink in table, f"{ink} is not defined for the {theme} theme"
    fg = table[ink]
    for surface in INK_SURFACES[ink]:
        assert surface in table, f"{surface} is not defined for the {theme} theme"
        bg = table[surface]
        ratio = _contrast(fg, bg)
        assert ratio >= AA_SMALL_TEXT, (
            f"[{theme}] {ink} ({fg}) on {surface} ({bg}) is {ratio:.2f}:1, "
            f"below the {AA_SMALL_TEXT}:1 AA bar for text this size"
        )


def test_coloured_text_uses_the_ink_variants_not_the_accents(css):
    """The accents are for fills. A `color:`/`--kicker:` declaration reaching
    for one is the exact regression this file exists to catch."""
    # The lookbehind keeps `border-color` / `outline-color` out of this -- those
    # are borders and rings, which are fills and correctly stay on the accent.
    offenders = re.findall(
        r"(?:(?<![-\w])color|--kicker)\s*:\s*var\(\s*--(green|amber|blue)\s*\)", css
    )
    assert not offenders, (
        f"coloured text still on the fill accent(s): {sorted(set(offenders))} "
        "-- use the matching --*-ink token for text"
    )


def test_every_accent_used_as_text_has_an_ink_token(css, palettes):
    """Catches the reverse gap: a new `--purple-ink` used in CSS but never
    defined would fall back to nothing, and an accent coloured as text without
    an ink token is the bug this file was written for."""
    used = set(re.findall(r"var\(\s*(--[\w-]+-ink)\s*\)", css))
    for token in used:
        for theme in THEMES:
            assert token in palettes[theme], (
                f"{token} is used in {CSS} but not defined for the {theme} theme"
            )
        assert token in INK_SURFACES, (
            f"{token} is used in {CSS} but has no surface list in this test -- "
            "add it to INK_SURFACES so its contrast is actually checked"
        )
