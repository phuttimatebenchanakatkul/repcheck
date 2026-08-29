"""Guards the rounded top corners on the app's bottom sheets.

Three things regress silently here:

1. A sheet must round only its TOP two corners. A four-corner radius turns
   it back into a centered dialog; a zero radius makes it a bare rectangle
   glued to the bottom of the screen.
2. The full-screen phone rules used to reset .af-modal's radius to 0, so
   phones -- where the "Scan a barcode" sheet is actually used, camera in
   hand -- got square corners while desktop got rounded ones.
3. The radius is a design-system value, not a per-screen choice. Every
   sheet reads the same number, and DESIGN.md is the source of truth for
   what that number is, so a sheet added later can't quietly drift.

Source-level assertions against the templates and stylesheets, matching
the pattern used by tests/test_split_modal_bottom_sheet_and_edit.py --
the CSS lives inline in Jinja templates and there is no CSS runtime here.
"""

import re

import pytest

# Every bottom sheet in the app: (file, selector). A sheet added without a
# line here is invisible to this guard, so add one when you add a sheet.
SHEETS = [
    ("templates/nutrition.html", ".af-modal"),
    ("templates/workouts.html", ".split-modal"),
    ("templates/workouts.html", ".exd-modal"),
    ("static/coaching.css", ".pc-ck-sheet"),
    ("static/style.css", ".log-sheet"),
    ("static/style.css", ".lw-modal"),
]


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def system_radius():
    """The bottom-sheet radius DESIGN.md declares -- the source of truth."""
    design = _read("DESIGN.md")
    match = re.search(
        r"Bottom sheets: `border-radius: ([^`]+)`", design
    )
    assert match, "DESIGN.md no longer states the bottom-sheet border-radius"
    return match.group(1).strip()


def _radius_of(path, selector):
    """The border-radius of the first rule for `selector` in `path`."""
    css = _read(path)
    start = css.index(selector + " {")
    end = css.index("}", start)
    match = re.search(r"border-radius:\s*([^;]+);", css[start:end])
    assert match, f"{selector} in {path} declares no border-radius"
    return match.group(1).strip()


@pytest.mark.parametrize("path,selector", SHEETS)
def test_every_sheet_rounds_only_its_top_corners(path, selector):
    radius = _radius_of(path, selector)
    assert re.fullmatch(r"\d+px \d+px 0 0", radius), (
        f"{selector} in {path} has border-radius {radius!r} -- a bottom "
        "sheet rounds the top two corners only, the bottom edge sits flush "
        "with the viewport"
    )


@pytest.mark.parametrize("path,selector", SHEETS)
def test_every_sheet_uses_the_design_system_radius(path, selector, system_radius):
    radius = _radius_of(path, selector)
    assert radius == system_radius, (
        f"{selector} in {path} rounds by {radius!r} but DESIGN.md declares "
        f"{system_radius!r} for bottom sheets -- same component family, so "
        "the corner should not vary by screen"
    )


@pytest.fixture(scope="module")
def mobile_af_modal_css():
    """The .af-modal override inside @media (max-width: 480px)."""
    css = _read("templates/nutrition.html")
    media = css.index("@media (max-width: 480px)")
    start = css.index("\n    .af-modal {", media)
    end = css.index("\n    }", start)
    return css[start:end]


def test_phone_sheet_is_not_a_bare_rectangle(mobile_af_modal_css, system_radius):
    """The <=480px sheet is edge-to-edge and full height; it still keeps the
    rounded top corners rather than resetting to border-radius: 0."""
    match = re.search(r"border-radius:\s*([^;]+);", mobile_af_modal_css)
    assert match, "the phone .af-modal rule declares no border-radius"
    radius = match.group(1).strip()
    assert radius != "0", (
        "the phone sheet reset border-radius to 0 -- square top corners on "
        "the one viewport where this sheet is actually used"
    )
    assert radius == system_radius, (
        f"phone .af-modal rounds by {radius!r}, desktop by {system_radius!r} "
        "-- the sheet should not change shape with viewport"
    )
