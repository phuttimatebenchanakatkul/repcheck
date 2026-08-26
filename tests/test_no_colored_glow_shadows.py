"""No colored glow (halo) shadows anywhere in the app's CSS.

A "glow" here is a *blurred* drop shadow painted in a chromatic color -- the
green halo that used to sit under the Home week-day circles, the amber one
under the check-in banner, the blue one under every primary CTA. On the dark
theme those bleed a colored halo onto whatever is behind them, and James has
asked for them to be removed enough times that the comments in style.css and
hyrox.css already say so in prose. This test is the mechanical version of
those comments.

What stays legal, deliberately:
  * neutral depth shadows -- rgba(0,0,0,...) and the near-black tints. Those
    read as elevation, not as a halo, and are invisible on the dark theme.
  * zero-blur rings -- `0 0 0 3px var(--blue-bg)` focus rings and the
    `0 0 0 2px var(--blue)` "today" ring. A hard ring is an indicator.
  * `inset` shadows -- they paint inside the box, so there is no halo.

This is a source-level regex assertion, same tradeoff as
test_hyrox_flagged_copy_matches_behavior.py: the CSS lives in hand-rolled
sheets and inline <style> blocks with no module boundary to test through.
Mutation-checked -- re-adding any removed glow makes it fail.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Sheets and templates that render the app. `marketing/` is a separate
# deployment with its own design and is intentionally not covered here.
SOURCES = sorted(ROOT.glob("static/*.css")) + sorted(ROOT.glob("templates/*.html"))

# `box-shadow: <value>;` -- values never contain a semicolon, and multi-layer
# shadows sit on one logical declaration, so this is enough. DOTALL lets a
# declaration wrap across lines (the device-frame bezel in style.css does).
DECL_RE = re.compile(r"box-shadow\s*:\s*([^;{}]+);", re.IGNORECASE | re.DOTALL)

RGB_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", re.IGNORECASE)
HEX_RE = re.compile(r"#([0-9a-f]{3}|[0-9a-f]{6})\b", re.IGNORECASE)
VAR_RE = re.compile(r"var\(\s*(--[a-z0-9-]+)", re.IGNORECASE)
# hsl(120 80% 50%) and hsl(120, 80%, 50%) -- saturation is the second slot.
HSL_RE = re.compile(r"hsla?\(\s*[\d.]+(?:deg|rad|turn)?\s*,?\s*([\d.]+)%", re.IGNORECASE)
WORD_RE = re.compile(r"[a-z]+", re.IGNORECASE)
# A length: 0, 0px, 3px, -6px, 0.5rem. Enough to read the blur slot.
LEN_RE = re.compile(r"^-?\d*\.?\d+(px|rem|em|%)?$")

# Custom properties that are themselves neutral greys/blacks.
NEUTRAL_VARS = {"--shadow", "--border", "--bg", "--paper-line"}

# CSS color keywords. Only the achromatic ones are allowed as a blurred
# shadow color; anything else named is a glow by definition. Kept as an
# allowlist rather than a list of every chromatic keyword, so a keyword
# nobody thought of (`rebeccapurple`) fails closed instead of slipping by.
NEUTRAL_KEYWORDS = {"black", "white", "gray", "grey", "transparent", "currentcolor",
                    "dimgray", "dimgrey", "darkgray", "darkgrey", "lightgray",
                    "lightgrey", "silver", "gainsboro", "whitesmoke", "none"}
# Words that appear in a shadow value without being a color at all.
NON_COLOR_WORDS = {"inset", "in", "srgb", "oklch", "oklab", "hsl", "hsla", "rgb",
                   "rgba", "var", "calc", "color", "mix", "shorter", "longer",
                   "hue", "px", "rem", "em", "deg"}

# Saturation at or below this reads as grey, so an hsl() shadow under it is
# elevation rather than a halo.
NEUTRAL_SATURATION = 10.0

# How far apart the R/G/B channels may drift before we call a color chromatic.
# rgba(16,17,20) is a near-black tint (spread 4); rgba(31,169,113) is the
# green glow (spread 138).
NEUTRAL_SPREAD = 24


def _split_layers(value):
    """Split a box-shadow value on the commas that separate layers.

    Commas inside rgba()/color-mix() parentheses do not separate layers.
    """
    layers, depth, current = [], 0, []
    for ch in value:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            layers.append("".join(current))
            current = []
        else:
            current.append(ch)
    layers.append("".join(current))
    return [layer.strip() for layer in layers if layer.strip()]


def _blur_radius(layer):
    """The blur slot of a shadow layer, as a float, or 0.0 if there is none.

    Offsets/blur/spread are the leading run of bare lengths: `x y [blur
    [spread]]`. Anything that is not a bare length (a color, `inset`) ends
    the run.
    """
    stripped = re.sub(r"\b(inset)\b", " ", layer, flags=re.IGNORECASE)
    # Drop color functions so their numeric args are never read as lengths.
    stripped = re.sub(r"\b[a-z-]+\([^()]*(\([^()]*\)[^()]*)*\)", " ", stripped,
                      flags=re.IGNORECASE)
    lengths = []
    for token in stripped.split():
        if LEN_RE.match(token):
            lengths.append(float(re.sub(r"[a-z%]+$", "", token, flags=re.IGNORECASE)))
        else:
            break
    return lengths[2] if len(lengths) >= 3 else 0.0


def _is_chromatic(layer):
    """True when the layer paints in a saturated color rather than a grey."""
    for match in RGB_RE.finditer(layer):
        channels = [int(c) for c in match.groups()]
        if max(channels) - min(channels) > NEUTRAL_SPREAD:
            return True
    for match in HEX_RE.finditer(layer):
        digits = match.group(1)
        if len(digits) == 3:
            digits = "".join(c * 2 for c in digits)
        channels = [int(digits[i:i + 2], 16) for i in (0, 2, 4)]
        if max(channels) - min(channels) > NEUTRAL_SPREAD:
            return True
    for match in VAR_RE.finditer(layer):
        if match.group(1) not in NEUTRAL_VARS:
            return True
    for match in HSL_RE.finditer(layer):
        if float(match.group(1)) > NEUTRAL_SATURATION:
            return True
    # Bare color keywords: `0 0 10px lime`. Strip custom-property names and
    # hex literals first, so `--tour-accent` is not read as the words "tour"
    # and "accent" and `#1a1a1a` is not read as three "a"s. Hex and the
    # numeric functions were already judged on their channels above.
    bare = re.sub(r"--[a-z0-9-]+|#[0-9a-f]+|\d", " ", layer, flags=re.IGNORECASE)
    for word in WORD_RE.findall(bare):
        lowered = word.lower()
        if lowered in NON_COLOR_WORDS or lowered in NEUTRAL_KEYWORDS:
            continue
        return True
    return False


def _glow_layers(value):
    """Every layer of one declaration that is a blurred chromatic shadow."""
    found = []
    for layer in _split_layers(value):
        if re.search(r"\binset\b", layer, re.IGNORECASE):
            continue
        if _blur_radius(layer) <= 0:
            continue
        if _is_chromatic(layer):
            found.append(layer)
    return found


def find_glows(paths=None):
    """(path, line, layer) for every colored glow in the app's CSS."""
    offenders = []
    for path in paths if paths is not None else SOURCES:
        text = path.read_text(encoding="utf-8")
        for match in DECL_RE.finditer(text):
            for layer in _glow_layers(match.group(1)):
                line = text.count("\n", 0, match.start()) + 1
                offenders.append((path.relative_to(ROOT).as_posix(), line, layer))
    return offenders


def test_sources_were_actually_scanned():
    """Guards the glob: an empty source list would make the suite vacuous."""
    assert len(SOURCES) > 10, SOURCES


def test_no_colored_glow_shadows():
    offenders = find_glows()
    assert not offenders, "Colored glow shadows found (use a neutral shadow, a " \
        "zero-blur ring, or no shadow):\n" + "\n".join(
            "  %s:%d  %s" % row for row in offenders)


def test_detector_flags_a_known_glow():
    """Mutation check: the removed green day-circle halo must still trip it."""
    assert _glow_layers("0 4px 10px rgba(31, 169, 113, 0.4)")
    assert _glow_layers("0 8px 18px -6px var(--tour-accent)")
    assert _glow_layers("0 0 14px 3px rgba(124, 255, 178, 0.85)")


def test_detector_flags_glows_this_codebase_has_not_used_yet():
    """The guard has to catch the next glow, not just the ones we deleted."""
    assert _glow_layers("0 0 10px lime")
    assert _glow_layers("0 4px 12px #2f66e8")
    assert _glow_layers("0 4px 12px hsl(220 80% 55%)")
    assert _glow_layers("0 4px 12px hsla(220, 80%, 55%, 0.4)")
    assert _glow_layers("0 4px 12px rebeccapurple")
    # ...while still allowing the achromatic equivalents.
    assert _glow_layers("0 4px 12px hsl(220 4% 55%)") == []
    assert _glow_layers("0 4px 12px black") == []
    assert _glow_layers("0 4px 12px #1a1a1a") == []


def test_known_blind_spot_animated_zero_blur_rings():
    """Documents what this test cannot see, so nobody trusts it too far.

    The chat dock's `ag-bar-breathe` pulse was a glow, but it was painted as a
    *zero-blur* colored ring that grew and faded via @keyframes -- structurally
    identical to a focus ring, which we keep. Blur radius alone can't separate
    them; only the animation does. If a pulsing ring comes back, this test
    stays green. Review the keyframes by eye.
    """
    pulse = ("0 2px 8px rgba(0,0,0,0.08), 0 0 0 5px "
             "color-mix(in srgb, var(--purple) 14%, transparent)")
    assert _glow_layers(pulse) == []


def test_detector_allows_what_we_kept():
    """The neutral depth shadows and hard rings must not be flagged."""
    assert _glow_layers("0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 30px rgba(0, 0, 0, 0.45)") == []
    assert _glow_layers("0 8px 18px rgba(20, 20, 20, 0.12)") == []
    assert _glow_layers("0 0 0 3px var(--blue-bg)") == []
    assert _glow_layers("0 0 0 2px var(--blue)") == []
    assert _glow_layers("inset 0 0 0 2px var(--blue)") == []
    assert _glow_layers("0 0 0 9999px rgba(8, 10, 18, 0.45)") == []
