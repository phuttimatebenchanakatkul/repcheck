"""Guards the analyze screen's exercise picker/chip visibility pairing.

templates/index.html's inline module has no vitest extraction harness (the
loaders in tests-js/support/ cover workouts.html, nutrition.html, hyrox.js
and friends, not this one), and the script carries Jinja expressions that
a JS parser chokes on. Source-level regex assertions against the real file
are the same tradeoff test_hyrox_personal_best_section.py already makes.

Two states, one invariant: #ex-picker-btn and #selected-exercise-chip are
mutually exclusive. Before the fix, selectExercise() only showed the chip
and never hid the button, so a user who picked an exercise saw "Choose an
exercise" still sitting above the thing they had just chosen -- reported
from a real device with the button circled in red.

preselectLastExercise() is pinned here too because it is what makes the
pairing load-bearing: the screen now starts in the chip state whenever the
local analyze log has an entry, so a regression is visible on first paint
rather than only after an interaction.
"""

import re

import pytest

TEMPLATE = "templates/index.html"


@pytest.fixture(scope="module")
def source():
    with open(TEMPLATE, encoding="utf-8") as handle:
        return handle.read()


def _function_body(source, name):
    match = re.search(
        r"function %s\(\)\s*\{(.*?)\n  \}" % re.escape(name), source, re.S
    )
    assert match, "%s() not found in %s" % (name, TEMPLATE)
    return match.group(1)


def test_select_exercise_hides_the_picker_button(source):
    match = re.search(r"function selectExercise\(name\)\s*\{(.*?)\n  \}", source, re.S)
    assert match, "selectExercise() not found"
    body = match.group(1)
    assert 'selectedExerciseChip.style.display = "flex"' in body
    assert 'exPickerBtn.style.display = "none"' in body


def test_clear_selected_exercise_restores_the_picker_button(source):
    body = _function_body(source, "clearSelectedExercise")
    assert 'selectedExerciseChip.style.display = "none"' in body
    # "flex", not "block" -- .ex-picker-btn lays its plus badge and label
    # out with flex, so restoring it as a block breaks the alignment.
    assert 'exPickerBtn.style.display = "flex"' in body


def test_picker_and_chip_are_never_shown_together(source):
    """Both visibility toggles must move in opposite directions."""
    select = re.search(r"function selectExercise\(name\)\s*\{(.*?)\n  \}", source, re.S).group(1)
    clear = _function_body(source, "clearSelectedExercise")
    shown_in_select = 'selectedExerciseChip.style.display = "flex"' in select
    hidden_in_select = 'exPickerBtn.style.display = "none"' in select
    shown_in_clear = 'exPickerBtn.style.display = "flex"' in clear
    hidden_in_clear = 'selectedExerciseChip.style.display = "none"' in clear
    assert shown_in_select and hidden_in_select
    assert shown_in_clear and hidden_in_clear


def test_last_exercise_is_preselected_on_load(source):
    body = _function_body(source, "preselectLastExercise")
    assert "getRecentAnalyzed(1)" in body
    assert "selectExercise(last)" in body
    # Called on first paint and again after an analysis resets the form.
    assert source.count("preselectLastExercise();") >= 2


def test_change_button_reopens_the_picker(source):
    assert 'id="change-exercise-btn"' in source
    assert 'data-i18n="analyze.changeExercise"' in source
    assert 'changeExerciseBtn.addEventListener("click", openExerciseModal);' in source
