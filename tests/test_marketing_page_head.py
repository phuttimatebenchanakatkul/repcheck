"""Guards the marketing page's <head> against the two ways a pre-launch page
quietly fails at its only job: being shared, and not flashing.

Neither shows up in local browsing. A `summary_large_image` card with no
`og:image` renders as a blank card in every client that honours it, and the
theme-restore snippet only works if it runs BEFORE the stylesheet paints --
move it below `</head>` or after the body and the page flashes the wrong theme
on every load for anyone who picked one.

The marketing site is a separate Render Static Site with no build step (see
CLAUDE.md), so nothing else checks this. Source-level regex assertions against
the real file, same tradeoff the rest of this suite makes.
"""

import re

import pytest

PAGE = "marketing/index.html"


@pytest.fixture(scope="module")
def html():
    with open(PAGE, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def head(html):
    return html[: html.index("</head>")]


def test_a_large_image_card_is_only_claimed_when_there_is_an_image(head):
    card = re.search(r'<meta name="twitter:card" content="([^"]+)"', head)
    assert card, "the twitter:card meta is gone"
    if card.group(1) == "summary_large_image":
        assert 'property="og:image"' in head or 'name="twitter:image"' in head, (
            "twitter:card is summary_large_image but no og:image/twitter:image is "
            "declared -- shared links render a blank card. Add the image or drop "
            "back to content=\"summary\"."
        )


def test_the_theme_is_restored_before_the_first_paint(head):
    """Written by app.js's toggle, read back here. If this snippet moves below
    the stylesheet or out of <head>, the choice still persists but every load
    flashes the other theme first."""
    assert "localStorage.getItem('rc-theme')" in head, (
        "the pre-paint theme restore left <head> -- the toggle's persisted "
        "choice would flash the wrong theme on every load"
    )
    assert head.index('href="styles.css"') < head.index("rc-theme"), (
        "the theme restore must run after the stylesheet link so the attribute "
        "is set before first paint"
    )
    assert 'setAttribute(\'data-theme\'' in head


def test_the_restore_cannot_take_the_page_down_with_it(head):
    """localStorage throws outright in Safari private mode; an unguarded read
    here would kill every script that follows."""
    snippet_start = head.index("rc-theme")
    snippet = head[snippet_start - 200 : snippet_start + 300]
    assert "try {" in snippet and "catch" in snippet


def test_the_page_still_declares_what_it_is(head):
    """Description and canonical are what a pre-launch page is FOR."""
    assert '<meta name="description"' in head
    assert '<link rel="canonical"' in head
    assert '<meta property="og:title"' in head
    assert '<meta property="og:description"' in head
