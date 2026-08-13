"""Guards the exercise-name trust boundary on the analyze page.

Fourth and last screen in this family (see test_nutrition_name_escaping,
test_workouts_name_escaping, test_onboarding_name_escaping). index.html
renders exercise names in two places: the "recent analyses" strip and the
exercise search modal.

The name is author-controlled the same way it is on the workouts page --
POST /api/custom-exercises only does str(...).strip() and name[:60], no
HTML sanitization -- and it reaches the DOM through innerHTML on template
literals, so an unescaped one renders as live markup rather than text.

The recent-analyses strip is the notable one: data-name is not decoration,
it is what the click handler reads back to reopen that exercise
(strip.querySelectorAll("[data-name]")). So this site needs escapeAttr
specifically -- escapeHtml leaves the quote that would end the attribute,
and the value still has to survive the round-trip through dataset for the
card to keep working.
"""

import re

import pytest


@pytest.fixture(scope="module")
def index_html():
    with open("templates/index.html", encoding="utf-8") as f:
        return f.read()


def test_recent_analysis_card_escapes_the_exercise_name(index_html):
    """data-name here is functional, not decorative -- the click target."""
    match = re.search(r'an-recent-card" data-name="(.*?)"', index_html)
    assert match, "could not find the recent-analysis card"
    assert match.group(1) == "${escapeAttr(entry.exercise)}", (
        "data-name is a quoted attribute AND the click handler's lookup key "
        "-- it needs escapeAttr, which the parser reverses on read"
    )


def test_both_recent_analysis_branches_escape_the_name(index_html):
    """renderRecentAnalyses() has TWO branches and they use DIFFERENT fields.

    The server-history branch renders entry.exercise_label; the local-log
    fallback renders entry.exercise. They produce near-identical markup, so
    a fix aimed at one reads as if it covered both. Assert on the count.
    """
    names = re.findall(r'an-recent-name">(.*?)</div>', index_html)
    assert len(names) == 2, f"expected 2 recent-analysis branches, found {len(names)}"
    assert names == [
        "${escapeHtml(entry.exercise_label)}",
        "${escapeHtml(entry.exercise)}",
    ], (
        "both recent-analysis branches must escape their exercise name -- "
        f"got {names}"
    )


def test_analysis_result_header_escapes_the_exercise_label(index_html):
    """The report header renders the label the analysis came back with."""
    match = re.search(r'an-bar-title">(.*?)</h1>', index_html)
    assert match, "could not find the analysis result header"
    assert match.group(1) == "${escapeHtml(data.exercise_label)}", (
        "the analysis result header renders the exercise label unescaped"
    )


def test_exercise_modal_row_escapes_name_in_text_and_attribute(index_html):
    match = re.search(
        r'ex-modal-result-item" data-name="(.*?)">.*?<span>(.*?)</span>', index_html
    )
    assert match, "could not find the exercise modal result row"
    assert match.group(1) == "${escapeAttr(name)}", (
        "data-name is a quoted attribute and needs escapeAttr"
    )
    assert match.group(2) == "${escapeHtml(name)}", (
        "the exercise modal renders the visible name unescaped"
    )


def test_no_user_authored_value_is_interpolated_raw(index_html):
    """Catches a NEW unescaped site, not just the ones fixed here."""
    raw = [
        "${entry.exercise}",
        "${entry.exercise_label}",
        "${data.exercise_label}",
        'data-name="${name}"',
        "<span>${name}</span>",
    ]
    found = [token for token in raw if token in index_html]
    assert not found, (
        f"user-authored values interpolated raw into innerHTML: {found} -- "
        "route each through escapeHtml(), or escapeAttr() if it lands "
        "inside a quoted attribute"
    )


def test_escape_attr_helper_escapes_quotes(index_html):
    match = re.search(
        r"function escapeAttr\(text\)\s*\{(.*?)\n  \}", index_html, re.DOTALL
    )
    assert match, "escapeAttr() helper is missing"
    body = match.group(1)
    assert "&quot;" in body, "escapeAttr must escape double quotes"
    assert "escapeHtml(" in body, (
        "escapeAttr should build on escapeHtml so it also covers < > and &"
    )


def test_escape_html_helper_round_trips_through_text_content(index_html):
    match = re.search(
        r"function escapeHtml\(text\)\s*\{(.*?)\n  \}", index_html, re.DOTALL
    )
    assert match, "escapeHtml() helper is missing"
    assert "textContent" in match.group(1), (
        "escapeHtml must assign the value to textContent -- that is the "
        "step that turns < > & into entities"
    )
