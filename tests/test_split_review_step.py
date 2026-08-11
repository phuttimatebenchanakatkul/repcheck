"""Guards the split wizard's "Assign your week" review step.

This is the last step of the split wizard: a colour-coded week grid plus a
drawer showing the selected day's exercises. Two things about it are worth
pinning, and both fail silently.

The trust boundary. Exercise names and day labels are not all
library-controlled. A user creates a custom exercise (POST
/api/custom-exercises) and picks it into a split, and on the custom path
they type the day labels themselves. The AI writes the rationale text
freeform. All of it reaches the DOM through innerHTML on template
literals, so an unescaped one renders as live markup rather than text --
the same failure already confirmed exploitable for food names in
nutrition.html (see test_nutrition_name_escaping.py).

The saved-plan contract. Everything downstream matches on the literal
string "Rest" and on raw day labels: getTodaysSplitInfo() in index.html
and renderWholeSplitBody() in this template both compare against "Rest"
directly. If the review step ever saved the *translated* rest label
("พัก" in Thai), every Thai user's plan would silently read as a training
day with no matching entry in plan.days.

These are source-level assertions against the rendered template, matching
the pattern used by test_nutrition_name_escaping.py and
test_nutrition_relog_confirm.py -- the JS is inline in the Jinja template
and this repo has no JS test runtime.
"""

import re

import pytest

from app import app as flask_app


@pytest.fixture(scope="module")
def workouts_html():
    with flask_app.test_request_context():
        from flask import render_template

        try:
            from app import (
                EXERCISE_CATEGORIES,
                EXERCISE_DETAILS,
                EXERCISE_ICONS,
                BODYWEIGHT_EXERCISES,
                UNILATERAL_EXERCISES,
                WORKOUT_EXERCISES,
            )

            return render_template(
                "workouts.html",
                active_nav="workouts",
                exercise_library=WORKOUT_EXERCISES,
                exercise_details=EXERCISE_DETAILS,
                exercise_categories=EXERCISE_CATEGORIES,
                exercise_icons=EXERCISE_ICONS,
                unilateral_exercises=sorted(UNILATERAL_EXERCISES),
                bodyweight_exercises=sorted(BODYWEIGHT_EXERCISES),
                i18n_page="workouts",
            )
        except Exception:
            with open("templates/workouts.html", encoding="utf-8") as f:
                return f.read()


@pytest.fixture(scope="module")
def review_step(workouts_html):
    """Just renderSplitStepReview(), so assertions can't match elsewhere.

    The template also renders the saved split (renderWholeSplitBody) and
    the Today's plan card, which use similar markup. Slicing to the one
    function keeps a passing assertion from being satisfied by a
    different, unrelated block.
    """
    start = workouts_html.index("function renderSplitStepReview()")
    end = workouts_html.index("const SPLIT_VIEW_MONDAY_FIRST")
    return workouts_html[start:end]


# ---------- the trust boundary ----------


def test_exercise_name_is_escaped_in_the_drawer(review_step):
    """A custom exercise name is user-authored text."""
    match = re.search(r'split-ex-name">(.*?)</span>', review_step)
    assert match, "could not find the exercise name element"
    assert match.group(1) == "${escapeHtml(name)}", (
        "the drawer renders a custom exercise name unescaped -- a name like "
        "'<img src=x onerror=...>' becomes a live element here"
    )


def test_demo_link_attribute_uses_attribute_escaping(review_step):
    """data-exercise-detail carries the name into a quoted attribute.

    escapeHtml leaves " untouched, which is correct for a text node and
    useless here: one quote closes the attribute and the rest of the name
    parses as new attributes on the button.
    """
    match = re.search(r'data-exercise-detail="(.*?)"', review_step)
    assert match, "could not find the demo-link attribute"
    assert match.group(1) == "${escapeAttr(name)}", (
        "data-exercise-detail must use escapeAttr -- escapeHtml does not "
        "escape the quote that would break out of the attribute"
    )


def test_day_label_is_escaped_everywhere_it_is_rendered(review_step):
    """Day labels are free text on the custom-split path.

    The label reaches three places: the grid swatch (abbreviated), the
    legend, and the drawer's pill. Missing any one of them reopens the
    hole.
    """
    swatch = re.search(r'split-week-cell-swatch\$\{.*?\}">(.*?)</span>', review_step)
    assert swatch, "could not find the grid swatch element"
    assert "escapeHtml(" in swatch.group(1), "the grid swatch renders a day label unescaped"

    legend = re.search(r'<span style="\$\{accentStyle\(label\)\}"><i></i>(.*?)</span>', review_step)
    assert legend, "could not find the legend entry"
    assert legend.group(1) == "${escapeHtml(label)}", "the legend renders a day label unescaped"

    pill = re.search(r'split-day-drawer-pill">(.*?)</span>', review_step)
    assert pill, "could not find the drawer pill"
    assert "escapeHtml(" in pill.group(1), "the drawer pill renders a day label unescaped"


def test_ai_rationale_is_escaped(review_step):
    """The rationale is freeform model output going into innerHTML."""
    match = re.search(r'class="split-rationale">.*?</strong>\s*(\$\{[^}]*\})', review_step)
    assert match, "could not find the rationale block"
    assert "escapeHtml(" in match.group(1), (
        "the AI-written rationale is interpolated into innerHTML and must be escaped"
    )


def test_escape_helpers_exist_in_this_template(workouts_html):
    """escapeAttr must really escape quotes, not alias escapeHtml.

    Pins the property every attribute site above depends on.
    """
    assert "function escapeHtml(text)" in workouts_html, "escapeHtml() helper is missing"
    match = re.search(r"function escapeAttr\(text\)\s*\{(.*?)\n  \}", workouts_html, re.DOTALL)
    assert match, "escapeAttr() helper is missing"
    body = match.group(1)
    assert "&quot;" in body, "escapeAttr must escape double quotes"
    assert "escapeHtml(" in body, (
        "escapeAttr should build on escapeHtml so it also covers < > and &"
    )


# ---------- the saved-plan contract ----------


def test_saved_schedule_uses_the_untranslated_rest_literal(review_step):
    """Downstream code compares against "Rest", never the translation.

    The cycle list is what gets written into the saved schedule, so the
    literal has to appear there rather than restLabel.
    """
    match = re.search(r"const options = \[(.*?)\];", review_step)
    assert match, "could not find the day-cycle option list"
    assert '"Rest"' in match.group(1), (
        'the cycle list must append the literal "Rest" -- saving the translated '
        "label would make every Thai user's rest day read as a training day"
    )
    assert "restLabel" not in match.group(1), (
        "the cycle list must not use the translated rest label; it is written "
        "straight into the saved plan"
    )


def test_rest_detection_matches_the_literal(review_step):
    match = re.search(r"function isRestLabel\(label\)\s*\{(.*?)\}", review_step, re.DOTALL)
    assert match, "could not find isRestLabel()"
    assert '"Rest"' in match.group(1), (
        "rest detection must compare against the stored literal, not a translation"
    )


def test_save_handler_reads_the_wizard_state_not_dropdowns(review_step):
    """The seven <select> elements are gone; the grid is the source now.

    A stale `querySelectorAll("[data-weekday]")` would silently save an
    empty schedule, since nothing renders that attribute any more.
    """
    save_index = review_step.index('id="split-save-btn"')
    handler = review_step[save_index:]
    assert "data-weekday]" not in handler, (
        "the save handler still queries the removed weekday <select> elements"
    )
    assert "...reviewSchedule" in handler, (
        "the save handler must copy the grid's schedule into the saved plan"
    )


def test_schedule_is_copied_not_aliased(review_step):
    """Backing out of the step must not leave the generated plan mutated."""
    match = re.search(r"reviewSchedule = (.*?);", review_step)
    assert match, "could not find the reviewSchedule initialisation"
    assert match.group(1).strip() == "{ ...splitWizard.generatedSchedule }", (
        "reviewSchedule must be a copy -- aliasing it means tapping a day "
        "rewrites the generated schedule even if the user backs out"
    )


def test_weekday_index_maps_monday_first_onto_sunday_indexed_names(workouts_html, review_step):
    """WEEKDAY_NAMES mirrors Date#getDay, so Sunday is index 0.

    The grid renders Monday-first. Getting this mapping wrong shifts every
    label by one day -- the exact off-by-one that makes a plan look right
    in code review and wrong on screen.
    """
    match = re.search(r"REVIEW_WEEKDAY_NAME_INDEX = \[(.*?)\]", workouts_html)
    assert match, "REVIEW_WEEKDAY_NAME_INDEX is missing"
    mapping = [int(n) for n in re.findall(r"\d", match.group(1))]
    assert mapping == [1, 2, 3, 4, 5, 6, 0], (
        f"expected Monday-first -> Sunday-indexed mapping, got {mapping}"
    )
    assert "REVIEW_WEEKDAY_NAME_INDEX[" in review_step, (
        "the review step must index WEEKDAY_NAMES through the shared mapping "
        "rather than hand-rolling the offset"
    )


def test_exercise_icon_html_escapes_the_custom_exercise_emoji(workouts_html):
    """Regression: exerciseIconHtml() is called from the review drawer

    (and 7 other pre-existing sites in this file) with a name that can be
    a custom exercise -- POST /api/custom-exercises caps emoji at 8
    characters server-side (app.py) but never sanitizes it, and "<script>"
    is exactly 8 characters. An adversarial review caught this: the
    surrounding code escapes exercise NAME and day LABEL into this same
    innerHTML sink, but the emoji value flowing through exerciseIconHtml()
    was missed. The <img> branch stays deliberately unescaped -- path only
    ever comes from the server-controlled EXERCISE_ICONS dict, never from
    attacker text.
    """
    match = re.search(
        r"function exerciseIconHtml\(name\)\s*\{(.*?)\n  \}", workouts_html, re.DOTALL
    )
    assert match, "exerciseIconHtml() is missing"
    body = match.group(1)
    assert "escapeHtml(exerciseEmoji(name))" in body, (
        "exerciseIconHtml's emoji fallback must escape exerciseEmoji(name) -- "
        "it is user-authored (the custom-exercise emoji field) and reaches "
        "innerHTML at every one of exerciseIconHtml's 8 call sites"
    )
