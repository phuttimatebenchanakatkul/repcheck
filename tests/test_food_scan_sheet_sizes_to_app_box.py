"""The food-scan sheet must size to the app box, not to the browser window.

Every skin above 721px makes <body> a fixed-size box carrying a `transform`
(see "Device frame" in static/style.css and tests/test_ipad_layout.py). That
transform makes <body> the containing block for every `position: fixed`
descendant, so .af-modal-overlay is contained by the app box -- while `vh`
still means the browser window. In the tablet column the two happen to agree
(--app-h is 100dvh there). In the desk skin they do not: --app-h is
`min(844px, 100vh - 96px)`, a 390x844 phone drawn on a desk.

Measured on the real stylesheet at 1440x1080, before this was fixed: the
camera sheet (`.af-modal.is-camera`, then `height: 92vh`) came out 994px
inside an 844px box with `overflow: hidden`, so the drag handle and the whole
header -- title and close button -- were clipped off the top of the phone.
`.af-scanner-screen`'s `min-height: 62vh` had the same fault.

--app-h is the token that exists for exactly this (static/style.css, :root).
It is declared twice there, `100vh` then `100dvh`, so deriving from it also
keeps the dynamic-viewport behaviour on a phone that the old `92dvh` had.

Pinned at the source level rather than behaviourally: this is CSS inside
templates/nutrition.html's <style> block, which no vitest harness loads --
tests-js/support/ extracts the page's <script> blocks, not its stylesheet.
Same tradeoff CLAUDE.md describes, and the same one tests/test_ipad_layout.py
takes. Mutation-checked: put `92vh` back on any of the three rules and the
matching case fails.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
NUTRITION = ROOT / "templates" / "nutrition.html"
STYLE_CSS = ROOT / "static" / "style.css"

# Below this the app is just the app: <body> scrolls, fixed means fixed, and
# vh IS the app viewport. Rules inside the phone block may use it freely.
PHONE_BLOCK = "@media (max-width: 480px) {"

# The rules that size the scan sheet as a fraction of the app screen.
SIZED_TO_APP_BOX = (
    ".af-modal",             # max-height cap on the sheet
    ".af-modal.is-camera",   # definite height, so the live viewfinder can fill it
    ".af-scanner-screen",    # min-height floor for the preview
)


def _style_block():
    match = re.search(r"<style>(.*?)</style>", NUTRITION.read_text(encoding="utf-8"), re.S)
    assert match, f"no <style> block found in {NUTRITION}"
    return match.group(1)


def _base_css():
    """Everything before the phone media query -- the rules a tablet or desk gets."""
    css = _style_block()
    index = css.find(PHONE_BLOCK)
    assert index != -1, (
        f"{PHONE_BLOCK!r} not found in {NUTRITION} -- the phone breakpoint moved. "
        "Update PHONE_BLOCK, then re-check that the rules below it still only "
        "apply where vh and the app box are the same thing."
    )
    return css[:index]


def _rule_body(css, selector):
    """Declarations of the rule whose ENTIRE selector list is `selector`.

    Anchored to the start of a line so a descendant rule that merely ends in
    the same class (`.af-modal-overlay.is-in .af-modal { transform: ... }`) is
    not mistaken for the rule being checked. Comments are stripped: these rules
    explain the vh problem at length, and the explanation must not read as the
    problem.
    """
    pattern = re.compile(r"^[ \t]*" + re.escape(selector) + r"\s*\{([^}]*)\}", re.M)
    matches = pattern.findall(css)
    assert matches, f"{selector} {{ ... }} not found outside the phone block in {NUTRITION}"
    assert len(matches) == 1, f"expected one base `{selector}` rule, found {len(matches)}"
    return re.sub(r"/\*.*?\*/", "", matches[0], flags=re.S)


@pytest.mark.parametrize("selector", SIZED_TO_APP_BOX)
def test_the_scan_sheet_is_sized_to_the_app_box(selector):
    body = _rule_body(_base_css(), selector)
    heights = [
        part.strip()
        for part in body.split(";")
        if re.search(r"\b(?:max-|min-)?height\s*:", part)
    ]
    assert heights, f"{selector} no longer declares a height in {NUTRITION}"

    for declaration in heights:
        # `height: 100%` is fine: it resolves against the parent, which is
        # already sized from --app-h further up the chain.
        assert not re.search(r"\b\d+(?:\.\d+)?d?vh\b", declaration), (
            f"{selector} sizes to the browser window ({declaration!r}). Above 721px "
            "<body> is a fixed-size box carrying a transform, so this fixed-position "
            "sheet is contained by that box and not by the window -- derive the "
            "height from var(--app-h) instead."
        )


def test_the_app_h_token_still_carries_the_dynamic_viewport():
    """The rules above dropped their own `dvh` fallback in favour of --app-h.

    That is only safe while :root declares --app-h twice, vh then dvh. If the
    dvh line goes, the scan sheet silently stops tracking collapsing browser
    chrome on a phone -- which is what the `92dvh` it used to carry was for.
    """
    src = STYLE_CSS.read_text(encoding="utf-8")
    root = re.search(r":root\s*\{(.*?)\n\}", src, re.S)
    assert root, "no :root block in static/style.css"
    declarations = re.findall(r"--app-h\s*:\s*([^;]+);", root.group(1))
    assert "100vh" in [d.strip() for d in declarations], (
        "--app-h lost its plain-vh declaration; browsers without dvh get nothing"
    )
    assert "100dvh" in [d.strip() for d in declarations], (
        "--app-h lost its dvh declaration, so everything derived from it -- the "
        "food-scan sheet included -- stops tracking the visible viewport on a phone"
    )
