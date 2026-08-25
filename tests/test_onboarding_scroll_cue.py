"""Guards the onboarding wizard's bottom-of-card affordances.

Two things that only show up on a real phone screen:

1. The sticky Next/Back bar is painted over the card's bottom edge with
   negative margins, so it has to repeat the card's own corner radius. Without
   that the card reads as rounded on top and square on the bottom.

2. Those same sticky buttons make a tall step look finished at the fold -- the
   user answers the visible question and taps Next, never seeing the ones
   below. A fade plus a tappable "more below" pill, both keyed off
   `body.ob-has-more`, say there is more.

Source-level regex assertions against the real template/script, same tradeoff
the rest of this suite makes for hand-rolled CSS/JS with no module boundary --
see CLAUDE.md's testing note.
"""

import re

import pytest

TEMPLATE = "templates/onboarding.html"
SCRIPT = "static/onboarding.js"


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def onboarding_html():
    return _read(TEMPLATE)


@pytest.fixture(scope="module")
def onboarding_js():
    return _read(SCRIPT)


def _actions_rule(css):
    """The body of the `.ob-wizard-actions { ... }` rule."""
    match = re.search(r"\.ob-wizard-actions\s*\{(.*?)\}", css, re.S)
    assert match, ".ob-wizard-actions rule not found"
    return match.group(1)


def test_card_radius_is_repeated_on_the_sticky_actions_bar(onboarding_html):
    card = re.search(r"\.ob-card\s*\{(.*?)\}", onboarding_html, re.S)
    assert card, ".ob-card rule not found"
    radius = re.search(r"border-radius:\s*([\d.]+px)", card.group(1))
    assert radius, ".ob-card has no border-radius"

    actions = _actions_rule(onboarding_html)
    for corner in ("border-bottom-left-radius", "border-bottom-right-radius"):
        found = re.search(corner + r":\s*([\d.]+px)", actions)
        assert found, f"{corner} missing from .ob-wizard-actions"
        assert found.group(1) == radius.group(1), (
            f"{corner} is {found.group(1)} but the card is {radius.group(1)}"
        )


def test_actions_bar_still_bleeds_to_the_card_edges(onboarding_html):
    """The radius only matters because the bar covers the card's bottom edge."""
    actions = _actions_rule(onboarding_html)
    assert "position: sticky" in actions
    assert "margin-bottom: -32px" in actions


def test_more_below_cue_is_gated_on_the_has_more_class(onboarding_html):
    assert ".ob-scroll-cue" in onboarding_html
    # Hidden by default, revealed only by the class the script sets.
    assert re.search(
        r"\.ob-scroll-cue\s*\{[^}]*opacity:\s*0", onboarding_html, re.S
    ), "the cue must start hidden"
    assert re.search(
        r"body\.ob-has-more\s+\.ob-scroll-cue\s*\{[^}]*opacity:\s*1", onboarding_html, re.S
    ), "body.ob-has-more must reveal the cue"
    assert re.search(
        r"body\.ob-has-more\s+\.ob-wizard-actions::before\s*\{[^}]*opacity:\s*1",
        onboarding_html,
        re.S,
    ), "body.ob-has-more must reveal the fade above the button bar"


def test_hidden_cue_is_out_of_the_tab_order_and_the_a11y_tree(onboarding_html):
    """opacity: 0 hides the pill from eyes only.

    An opacity-0 button is still focusable and still announced, so on a screen
    where nothing is below the fold a keyboard or screen-reader user could land
    on an invisible "More questions below" pointing at questions that are all
    already on screen. visibility: hidden is what removes it from both.

    The trailing `;` in each pattern matters: the rule carries a comment that
    says "visibility: hidden" in prose, and without the terminator these would
    pass on the comment alone after the real declaration was deleted.
    """
    cue = re.search(r"\.ob-scroll-cue\s*\{(.*?)\}", onboarding_html, re.S)
    assert cue, ".ob-scroll-cue rule not found"
    assert re.search(
        r"visibility:\s*hidden\s*;", cue.group(1)
    ), "the hidden cue must leave the tab order, not just go transparent"

    shown = re.search(
        r"body\.ob-has-more\s+\.ob-scroll-cue\s*\{(.*?)\}", onboarding_html, re.S
    )
    assert shown, "body.ob-has-more .ob-scroll-cue rule not found"
    assert re.search(
        r"visibility:\s*visible\s*;", shown.group(1)
    ), "revealing the cue must put it back in the tab order"

    # visibility flips discretely, so without it in the transition the pill
    # would disappear instantly instead of fading out.
    assert re.search(
        r"transition:[^;]*visibility", cue.group(1)
    ), "hiding must stay animated -- keep visibility in the transition"


def test_script_toggles_has_more_from_remaining_scroll(onboarding_js):
    assert re.search(
        r'classList\.toggle\(\s*"ob-has-more"', onboarding_js
    ), "nothing sets the class the CSS waits on"
    assert re.search(
        r"scrollHeight\s*-\s*window\.innerHeight\s*-\s*window\.scrollY", onboarding_js
    ), "the cue must be driven by how much scrolling is left"
    # A re-render changes the page height, and so does scrolling it.
    assert "requestAnimationFrame(updateScrollCue)" in onboarding_js
    assert 'window.addEventListener("scroll", updateScrollCue' in onboarding_js


def test_cue_is_rendered_on_question_screens_and_scrolls_down(onboarding_js):
    actions = re.search(
        r"function renderWizardActions\(.*?\n  \}", onboarding_js, re.S
    )
    assert actions, "renderWizardActions not found"
    assert "ob-scroll-cue" in actions.group(0), "question screens render no cue"
    assert 'data-action="scroll-more"' in actions.group(0)
    # ...but only on the two multi-question screens -- 5 (body fat +
    # activity) and 6 (protein + diet). On a one-question screen the
    # copy would be a lie, so the markup is not emitted at all.
    assert "showCue ?" in actions.group(0), "the cue must be conditional"
    cue_steps = re.search(r"const CUE_STEPS = \[(.*?)\]", onboarding_js, re.S)
    assert cue_steps, "CUE_STEPS not found"
    assert sorted(re.findall(r'"(\w+)"', cue_steps.group(1))) == [
        "body_activity",
        "preferences",
    ], "only the two multi-question screens may show the cue"
    assert re.search(
        r'action === "scroll-more"[^}]*window\.scrollBy', onboarding_js, re.S
    ), "tapping the cue must scroll the page down"
