"""Guards the onboarding wizard's Log out button against going `position: fixed`.

It was fixed to the viewport's top-right corner on the theory that escaping a
wrong account should be reachable from any step. The cost was invisible in a
diff and only showed up on a real screen: as soon as a step grew tall enough to
scroll (body type + activity, diet + weight target), the pill sat on top of the
card and covered whichever option happened to be underneath it -- the right
edge of an activity row on one screen, an intensity row on the next. A user
could not tap what it covered.

It now lives in the normal flow at the top of `.ob-wrap`, above the logo, and
scrolls with the page like everything else.

Source-level regex assertions against the real template, same tradeoff the rest
of this suite makes for hand-rolled CSS/JS with no module boundary -- see
CLAUDE.md's testing note.
"""

import re

import pytest

TEMPLATE = "templates/onboarding.html"


@pytest.fixture(scope="module")
def onboarding_html():
    with open(TEMPLATE, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def logout_rule(onboarding_html):
    """The `.ob-logout-form` declaration block, braces excluded."""
    match = re.search(r"\.ob-logout-form\s*\{([^}]*)\}", onboarding_html)
    assert match, ".ob-logout-form rule is gone from " + TEMPLATE
    return match.group(1)


def test_the_logout_pill_is_not_fixed_to_the_viewport(logout_rule):
    """The whole point: a fixed pill overlays the card on every scrolling step."""
    assert "position:" not in logout_rule.replace(" ", "").replace("position:relative", ""), (
        "onboarding's Log out form declares a `position` again -- fixed/absolute "
        "puts it back on top of the wizard card and covers the options underneath. "
        f"Rule was: {logout_rule.strip()}"
    )


def test_it_is_not_lifted_above_the_card_by_z_index(logout_rule):
    """z-index only matters for a positioned box; its presence means someone
    re-introduced one."""
    assert "z-index" not in logout_rule, (
        "z-index on .ob-logout-form implies it was positioned out of flow again"
    )


def test_it_sits_inside_the_wizard_wrapper(onboarding_html):
    """In flow means inside `.ob-wrap`, not a sibling floating over it."""
    wrap_start = onboarding_html.index('<div class="ob-wrap">')
    form_start = onboarding_html.index('class="ob-logout-form"')
    assert form_start > wrap_start, (
        "the Log out form is outside .ob-wrap again -- outside the wrapper it "
        "has no column to sit in and only overlaying can position it"
    )


def test_it_comes_before_the_logo_and_the_card(onboarding_html):
    """Top of the column, above the logo: out of the card's way, and the first
    thing a user who landed on the wrong account can reach."""
    form_start = onboarding_html.index('class="ob-logout-form"')
    logo_start = onboarding_html.index('class="ob-logo"')
    card_start = onboarding_html.index('<div class="ob-card">')
    assert form_start < logo_start < card_start


def test_it_is_still_right_aligned(logout_rule):
    """A full-width flow element would push the logo down and read as a banner;
    the pill still hugs the right edge where it always was."""
    collapsed = logout_rule.replace(" ", "")
    assert "justify-content:flex-end" in collapsed, (
        "the Log out pill lost its right alignment: " + logout_rule.strip()
    )


def test_logging_out_still_posts_to_the_logout_route(onboarding_html):
    """Restyling must not cost the wizard its only escape hatch."""
    assert 'method="post"' in onboarding_html
    assert "url_for('auth.logout')" in onboarding_html
    assert 'data-i18n="sidebar.logout"' in onboarding_html
