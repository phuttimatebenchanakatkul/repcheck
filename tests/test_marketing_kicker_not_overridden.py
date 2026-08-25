"""Guards the split sections' coloured kickers against the cascade bug that
already ate them once.

`.kicker` (0,1,0) sets the label's colour and 12px size. Any later rule that
selects a bare `p` inside `.split-copy` scores 0,1,1 and silently wins, so the
green "Form analysis", blue "Nutrition" and amber "Workout logging" labels all
render as grey 16.5px body copy -- no error, no visual hint in the CSS, only in
the browser.

The marketing site is a separate Render Static Site with no build step (see
CLAUDE.md), so nothing else checks this. Source-level regex assertions against
the real file, same tradeoff the rest of this suite makes.
"""

import re

import pytest

CSS = "marketing/styles.css"
HTML = "marketing/index.html"

# A selector that reaches a *bare* `p` (no class of its own) under .split-copy,
# either as a child (`>`) or a descendant. `.split-copy h2` and
# `.split-copy .check-list li` don't match; `.split-copy > p` does.
BARE_P_UNDER_SPLIT_COPY = re.compile(
    r"\.split-copy\s*>?\s*p(?![\w-])(?P<rest>[^{,]*)"
)


@pytest.fixture(scope="module")
def css():
    with open(CSS, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def html():
    with open(HTML, encoding="utf-8") as f:
        return f.read()


def test_kickers_live_inside_split_copy(html):
    """If this fails the rest of the file is guarding nothing."""
    assert re.search(
        r'<div class="split-copy">\s*<p class="kicker kicker--\w+"', html
    ), "no coloured kicker found directly inside a .split-copy -- retarget this test"


def test_split_copy_paragraph_rules_exclude_the_kicker(css):
    hits = list(BARE_P_UNDER_SPLIT_COPY.finditer(css))
    assert hits, f"no `.split-copy ... p` rule in {CSS} -- retarget this test"
    for hit in hits:
        assert ":not(.kicker)" in hit.group("rest"), (
            f"`{hit.group(0).strip()}` out-specifies `.kicker` (0,1,1 vs 0,1,0) "
            "and greys out the section labels -- add :not(.kicker)"
        )


def test_kicker_modifiers_used_in_the_page_are_defined(css, html):
    used = set(re.findall(r"kicker--([\w-]+)", html))
    defined = set(re.findall(r"\.kicker--([\w-]+)\s*\{", css))
    assert used, "no kicker modifiers in the page -- retarget this test"
    assert used <= defined, f"kicker modifiers used but never defined: {sorted(used - defined)}"
