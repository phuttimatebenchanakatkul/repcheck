"""Guards the home page's empty-day suggestions.

The rule the feature promises: when today has no food logged and/or no
workout logged, the home page offers suggestions -- and every suggestion is
something the user has ACTUALLY logged before (or an exercise from their own
split plan). Nothing is invented for a user with no history; they get a
"log your first one" link instead.

The list-building rules themselves are behaviourally tested in
tests-js/suggestions.test.js against the real static/suggestions.js. What
can only be checked at the source level is the wiring around them, all of
which is silently droppable in a refactor:

- the card renders only when something is actually missing (a card that
  always renders would nag users who already logged);
- names go through escapeHtml(), because they can be user-created custom
  foods/exercises interpolated into an innerHTML template literal (see
  CLAUDE.md's escaping note);
- the deep links the rows point at are actually handled on the other end.

Source-level regex assertions against the real files, the same tradeoff
test_hyrox_pb_nudge.py makes -- see CLAUDE.md's testing note.
"""

import re

import pytest


@pytest.fixture(scope="module")
def home_html():
    with open("templates/home.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def nutrition_html():
    with open("templates/nutrition.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def workouts_html():
    with open("templates/workouts.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def base_html():
    with open("templates/base.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def i18n_js():
    with open("static/i18n.js", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def render_suggestions(home_html):
    start = home_html.index("function renderSuggestions() {")
    end = home_html.index("function renderAll() {")
    return home_html[start:end]


def test_suggestions_module_is_loaded_app_wide(base_html):
    assert "suggestions.js" in base_html


def test_card_is_gated_on_today_having_nothing_logged(render_suggestions):
    assert "RepCheckSuggestions.hasFoodOn(todayIso)" in render_suggestions
    assert "RepCheckSuggestions.hasWorkoutOn(todayIso)" in render_suggestions
    # Both logged -> nothing rendered at all, not an empty card.
    assert "if (!needsFood && !needsWorkout)" in render_suggestions


def test_each_half_renders_only_when_that_half_is_missing(render_suggestions):
    assert "${needsFood ? foodGroupHtml() : \"\"}" in render_suggestions
    assert "${needsWorkout ? workoutGroupHtml() : \"\"}" in render_suggestions


def test_suggestions_come_from_the_users_own_data(home_html):
    # Foods: this hour's habits + recent, straight from their log.
    assert "RepCheckSuggestions.foodsForHour(new Date().getHours()" in home_html
    # Exercises: their own split plan first, then their own log.
    assert "splitInfo ? splitInfo.exercises.slice(0, SUGGEST_LIMIT) : []" in home_html
    assert "RepCheckSuggestions.recentExercises(SUGGEST_LIMIT)" in home_html


def test_no_history_falls_back_to_a_first_log_link_not_an_invented_pick(home_html):
    food_group = home_html[home_html.index("function foodGroupHtml() {"):home_html.index("function workoutGroupHtml() {")]
    workout_group = home_html[home_html.index("function workoutGroupHtml() {"):home_html.index("function renderSuggestions() {")]
    assert "if (!names.length)" in food_group
    assert "home.suggest.firstFood" in food_group
    assert "if (!names.length)" in workout_group
    assert "home.suggest.buildPlan" in workout_group
    # No hard-coded food or exercise names anywhere in the two builders.
    for group in (food_group, workout_group):
        assert "FOOD_LIBRARY" not in group
        assert "EXERCISE_CATEGORIES" not in group


def test_names_are_escaped_and_url_encoded(home_html):
    row = home_html[home_html.index("function suggestRowHtml("):home_html.index("function suggestGroupHtml(")]
    assert "escapeHtml(label)" in row
    assert re.search(r"function escapeHtml\(", home_html)
    assert home_html.count("encodeURIComponent(name)") == 2


def test_row_deep_links_are_handled_on_the_other_end(home_html, nutrition_html, workouts_html):
    assert "?quick=add&food=${encodeURIComponent(name)}" in home_html
    assert "?quick=log&exercise=${encodeURIComponent(name)}" in home_html

    quick_add = nutrition_html[nutrition_html.index('if (quick === "add") {'):]
    assert 'new URLSearchParams(search).get("food")' in quick_add
    assert "openAddFoodModal(new Date().getHours())" in quick_add
    assert "renderModalResults(food)" in quick_add

    quick_log = workouts_html[workouts_html.index('if (quick !== "log") return;'):]
    assert 'params.get("exercise")' in quick_log
    assert "renderExerciseModalSearch(exercise)" in quick_log


@pytest.mark.parametrize(
    "key",
    [
        "home.suggest.title",
        "home.suggest.sub",
        "home.suggest.noFood",
        "home.suggest.noWorkout",
        "home.suggest.fromPlan",
        "home.suggest.fromHistory",
        "home.suggest.firstFood",
        "home.suggest.firstWorkout",
        "home.suggest.buildPlan",
    ],
)
def test_copy_comes_from_i18n_in_both_locales(i18n_js, key):
    # Two dictionaries in the file (en, th) -- the key must be in both, so
    # the Thai locale gets the suggestions too.
    assert i18n_js.count(f'"{key}":') == 2
