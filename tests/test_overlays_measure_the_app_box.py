"""Inside the app, `vw` is the screen -- and the screen is not the app.

Above 721px <body> is a fixed-size box carrying a `transform` (see "Device
frame" in static/style.css and tests/test_ipad_layout.py): a 720px column on a
tablet, a 390px phone on a desk. That transform makes <body> the containing
block for every `position: fixed` descendant, so a percentage resolves against
the app box -- while `vw` still resolves against the whole screen.

So a `max-width: 90vw` cap written for a phone quietly stops capping. Measured
on an 1180px iPad in landscape, the save-error toasts capped at 1062px against
a 720px column, and the tour's mini bar at 1156px: the inset each one exists to
keep was simply gone, and long copy could run the full width of the column.

Below 721px the containing block IS the viewport, so `%` and `vw` agree and
nothing about the phone changes. That is why the fix is `%` everywhere rather
than another breakpoint.

The one legitimate `vw` is the app box's own width, which has to measure the
screen -- that is the whole point of it.

Source-level for the reason CLAUDE.md gives for CSS: no module boundary to
test through. Mutation-checked: put `90vw` back on any toast and this fails.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# The app's own styles. marketing/ is a separate static site with no app box,
# so vw there means exactly what it says.
APP_STYLES = sorted(
    [p for p in (ROOT / "static").glob("*.css")]
    + [p for p in (ROOT / "templates").glob("*.html")]
)

# `width: min(100vw, 720px)` on <body> IS the app box: it measures the screen
# on purpose, to decide how wide the column may be.
ALLOWED = (
    "min(100vw, 720px)",
)

VW = re.compile(r"(?<![\w-])\d*\.?\d+vw(?![\w-])")


def _style_text(path):
    text = path.read_text(encoding="utf-8", errors="ignore")
    if path.suffix == ".html":
        return "\n".join(m.group(1) for m in re.finditer(r"<style>(.*?)</style>", text, re.S))
    return text


@pytest.mark.parametrize("path", APP_STYLES, ids=lambda p: p.name)
def test_app_styles_do_not_size_against_the_screen(path):
    css = _style_text(path)
    if not css.strip():
        pytest.skip(f"{path.name} has no stylesheet")
    # Comments in these files discuss vw at length; strip them first.
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for allowed in ALLOWED:
        css = css.replace(allowed, "")

    offenders = []
    for line in css.splitlines():
        if VW.search(line):
            offenders.append(line.strip())

    assert not offenders, (
        f"{path.relative_to(ROOT)} sizes something against the screen: "
        f"{offenders[:4]}. Above 721px <body> is the app box and carries a "
        "transform, so a fixed-position element's containing block is that box "
        "while vw is still the whole screen -- on a 1180px iPad a 90vw cap is "
        "1062px against a 720px column. Use % (it equals vw below 721px), or "
        "add the rule to ALLOWED if it genuinely has to measure the screen."
    )
