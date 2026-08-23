"""Guards the markup sinks in static/onboarding.js.

Every screen in the wizard is built by handing a template literal to el(),
which assigns the string to innerHTML -- so an interpolated value is
markup, not text.

This file originally pinned three author-controlled values: free-text
split day labels, custom exercise names, and the free-text lifting goal.
#178 ("ask only the nutrition questions at first run") deleted the split
wizard from onboarding entirely, so all three sinks -- and the site-by-site
tests that pinned them -- are gone with it. They were removed here rather
than repointed: the code they guarded does not exist, and a test that
asserts nothing about a live sink is coverage in name only. The equivalent
sinks still live in templates/workouts.html and are pinned by
test_workouts_name_escaping.py.

What remains is the sink that survived (the error string the coaching API
returns, which is not i18n text and still reaches innerHTML), plus the
forward-looking guard below -- which is what caught that one.
"""

import re

import pytest


@pytest.fixture(scope="module")
def onboarding_js():
    with open("static/onboarding.js", encoding="utf-8") as f:
        return f.read()


def test_api_error_is_escaped_before_reaching_inner_html(onboarding_js):
    """w.error is whatever the API put in `error` (or a thrown message),
    interpolated into an el() template literal. Not another user's text
    since #178, but still a non-i18n string reaching a markup sink."""
    match = re.search(r'ob-error">(.*?)</div>', onboarding_js)
    assert match, "could not find the onboarding error element"
    assert match.group(1) == "${escapeHtml(w.error)}", (
        "the onboarding error message reaches innerHTML unescaped"
    )


def test_escape_html_helper_round_trips_through_text_content(onboarding_js):
    """Pins the implementation, not just the call: a hand-rolled replace
    chain that forgets & (or orders the replacements wrong) is the classic
    way this helper gets quietly broken."""
    match = re.search(
        r"function escapeHtml\(text\) \{(.*?)\n  \}", onboarding_js, re.S
    )
    assert match, "escapeHtml() helper is missing from onboarding.js"
    body = match.group(1)
    assert "document.createElement" in body and "textContent" in body, (
        "escapeHtml must round-trip through textContent, not hand-roll a "
        "replace chain"
    )
    assert "innerHTML" in body


def test_no_user_authored_value_is_interpolated_raw(onboarding_js):
    """Catches a NEW unescaped site, not just the one fixed here.

    This is the test that earns its keep: after #178 deleted the split
    steps, it was the only one in this file still pointing at live code,
    and it caught ${w.error} surviving unescaped. It fails if any of these
    values is ever interpolated raw again, which is how the bug came back
    once already (workouts.html and onboarding.js each had their own copy).
    """
    raw = [
        "${day.label}",
        "${ex}",
        "${w.rationale}",
        "${w.liftingGoal}",
        "${w.error}",
        "${name}",
        '<option value="${label}"',
        ">${label}</option>",
    ]
    found = [token for token in raw if token in onboarding_js]
    assert not found, (
        f"user-authored values interpolated raw into innerHTML: {found} -- "
        "route each through escapeHtml(), or escapeAttr() if it lands "
        "inside a quoted attribute"
    )
