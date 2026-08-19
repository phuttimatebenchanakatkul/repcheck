"""Guards the split modal's bottom-sheet conversion and the split-editing
entry-point flow.

Two behaviors regressed easily and silently if this ever gets refactored:

The modal must render as a real bottom sheet (slide up from the bottom,
page recedes behind it) rather than the old centered pop-in dialog -- see
.log-sheet-overlay in static/style.css for the canonical pattern this
mirrors.

Both "edit an existing split" entry points -- the main "Today's plan" card
button and tapping the "Today's plan" title -- now land on the same
read-only week view first (renderWholeSplitView/renderWholeSplitBody),
which lets the user add or remove exercises within a day inline. That
view's own "Edit split" button rebuilds the whole split via the normal
AI-vs-customize wizard (openSplitModal), starting completely blank rather
than pre-filled with the plan being replaced -- there is deliberately no
more "edit in place, skip mode selection" path (see the prior version of
this file, and TODOS.md/git history, for the design this replaced).

Source-level assertions against the rendered template, matching the
pattern used by test_split_review_step.py -- the JS is inline in the Jinja
template and this repo has no JS test runtime for full DOM behavior.
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
def modal_css(workouts_html):
    start = workouts_html.index(".split-modal-overlay {")
    end = workouts_html.index(".split-modal-header {")
    return workouts_html[start:end]


@pytest.fixture(scope="module")
def whole_split_body_fn(workouts_html):
    start = workouts_html.index("function renderWholeSplitBody(plan)")
    end = workouts_html.index("planBtnEl.addEventListener", start)
    return workouts_html[start:end]


@pytest.fixture(scope="module")
def exercise_picker_fn(workouts_html):
    start = workouts_html.index("async function renderExercisePickerStep(dayName")
    end = workouts_html.index("function renderSplitStepDays()", start)
    return workouts_html[start:end]


# ---------- bottom sheet ----------


def test_overlay_anchors_content_to_the_bottom(modal_css):
    """align-items: flex-end is what makes this a bottom sheet, not a
    centered dialog -- losing it silently reverts the whole visual change."""
    assert "align-items: flex-end;" in modal_css


def test_overlay_has_no_own_backdrop_scrim(modal_css):
    """Every other sheet in the app dims the page via html.pc-sheet-active
    on .app, not a background color on the overlay itself. A reintroduced
    `background: rgba(...)` here means two dimming layers stacking."""
    assert "background: rgba" not in modal_css, (
        "the overlay should not paint its own backdrop -- .app dims itself "
        "via pc-sheet-active, applied by openBottomSheet()"
    )


def test_sheet_starts_offscreen_and_slides_in(modal_css):
    """The defining bottom-sheet transform: translateY(100%) at rest,
    translateY(0) once .is-open/.is-in is applied."""
    assert "transform: translateY(100%);" in modal_css
    assert re.search(r"\.split-modal-overlay\.is-open \.split-modal,\s*\.split-modal-overlay\.is-in \.split-modal \{\s*transform: translateY\(0\);", modal_css)


def test_sheet_has_top_rounded_corners_and_no_full_dialog_radius(modal_css):
    """A centered dialog rounds all four corners; a bottom sheet only the
    top two -- the bottom edge is meant to look flush with the viewport."""
    assert "border-radius: 22px 22px 0 0;" in modal_css


def test_overlay_tracks_the_real_visual_viewport_not_100vh(modal_css):
    """100vh (or `inset: 0`) doesn't account for a resized visual viewport
    when a mobile keyboard opens, which can push the sheet's top edge
    off-screen. --pc-vvt/--pc-vvh are the app's own tracked values for this
    (see base.html)."""
    assert "top: var(--pc-vvt, 0px);" in modal_css
    assert "height: var(--pc-vvh, 100vh);" in modal_css


def test_modal_has_a_grabber_handle(workouts_html):
    """The handle is the visual affordance that this is a draggable sheet,
    matching every other sheet in the app."""
    assert 'class="split-modal-handle"' in workouts_html


# ---------- entry points land on the week view ----------


def test_openEditSplitModal_no_longer_exists(workouts_html):
    """The old edit-in-place-and-skip-mode-selection function was removed
    entirely, not just made unreachable -- a stray call site anywhere would
    be a ReferenceError at runtime."""
    assert "function openEditSplitModal(" not in workouts_html
    assert "openEditSplitModal(" not in workouts_html


def test_isEditingExistingPlan_no_longer_referenced(workouts_html):
    """Nothing sets this flag to true anymore (its one setter lived inside
    the now-deleted openEditSplitModal), so both button-label ternaries
    that used to branch on it were simplified to their always-taken
    branch. A reintroduced reference here would mean dead code crept
    back in, or -- worse -- a new caller silently relying on a flag
    nothing ever flips true."""
    assert "isEditingExistingPlan" not in workouts_html


def test_split_step_type_button_always_says_generate_plan(workouts_html):
    """renderSplitStepType()'s own primary button ("split-next-btn") had
    the same isEditingExistingPlan ? saveChanges : generatePlan branch as
    the review step's save button (see reviewStep.test.js's equivalent
    "always labels the primary button 'Save plan'" coverage) -- this is
    the source-level counterpart for the type step, asserting the exact
    simplified ternary rather than only the flag's absence."""
    assert (
        '${(splitWizard.type === "custom" || selfBuild) ? t("workouts.wizard.generatePlan") : t("common.next")}'
        in workouts_html
    )


def test_plan_button_routes_to_the_week_view_when_a_plan_exists(workouts_html):
    """The main "Today's plan" card button, once a plan exists, now opens
    the same read-only week view as tapping the "Today's plan" title --
    not a wizard step directly. Building a split from scratch still goes
    to openSplitModal()."""
    handler = re.search(
        r"planBtnEl\.addEventListener\(\"click\", \(\) => \{\s*"
        r"if \(loadSplitPlan\(\)\) renderWholeSplitView\(\);\s*"
        r"else openSplitModal\(\);\s*"
        r"\}\);",
        workouts_html,
    )
    assert handler, (
        "the main plan button must open the week view when a plan already "
        "exists, and the blank wizard only when one doesn't"
    )


def test_week_view_edit_split_button_opens_the_blank_wizard(workouts_html):
    """The week view's own "Edit split" button now rebuilds the whole
    split from openSplitModal() -- the normal AI-vs-customize entry point,
    starting completely blank -- instead of jumping straight into a
    pre-filled editor."""
    assert (
        'getElementById("split-edit-from-view-btn").addEventListener("click", openSplitModal)'
        in workouts_html
    )


# ---------- week view: inline exercise add/remove ----------


def test_week_view_resets_the_modal_title_on_every_render(whole_split_body_fn):
    """renderWholeSplitBody() must set splitModalTitle itself, not rely on
    only being reached via renderWholeSplitView(). The pick-exercises
    button's onDone callback returns here directly after
    renderExercisePickerStep() has overwritten the title to
    "Pick exercises — {day}" -- without resetting it here too, the modal's
    title bar stays stuck on that text after the user is done picking."""
    assert re.search(
        r'function renderWholeSplitBody\(plan\) \{\s*'
        r'splitModalGeneration\+\+;\s*'
        r'const t = RepCheckI18n\.t;\s*'
        r'(?://[^\n]*\n\s*)*'
        r'splitModalTitle\.textContent = t\("workouts\.plan\.wholeSplitTitle"\);',
        whole_split_body_fn,
    )


def test_week_view_renders_a_remove_button_per_exercise(whole_split_body_fn):
    assert 'data-remove-day-exercise="${i}"' in whole_split_body_fn


def test_week_view_remove_button_does_not_also_open_the_how_to_perform_modal(whole_split_body_fn):
    """The remove button is nested inside a [data-exercise-detail] row;
    without stopPropagation its click would also bubble to
    document.body's delegated [data-exercise-detail] listener and pop the
    how-to-perform modal over the top of removing the exercise."""
    assert re.search(
        r'querySelectorAll\("\[data-remove-day-exercise\]"\)\.forEach\(\(btn\) => \{\s*'
        r'btn\.addEventListener\("click", \(event\) => \{[^}]*?'
        r"event\.stopPropagation\(\);",
        whole_split_body_fn,
        re.DOTALL,
    )


def test_week_view_remove_button_persists_immediately(whole_split_body_fn):
    """Unlike the wizard (which only saves on its own explicit Save
    button), the week view is a lightly-editable page -- each remove
    writes straight back to the saved plan so there's nothing to lose by
    navigating away. persistSplitPlan() (not a bare localStorage.setItem)
    is required here specifically because it also refreshes the "Today's
    Plan" card sitting behind this modal -- a bare setItem would leave
    that card showing the pre-edit exercise list until the next full page
    load."""
    assert re.search(
        r"activeDay\.exercises\.splice\(i, 1\);\s*"
        r"persistSplitPlan\(plan\);\s*"
        r"renderWholeSplitBody\(plan\);",
        whole_split_body_fn,
    )


def test_persistSplitPlan_refreshes_the_todays_plan_card_even_if_the_write_fails(workouts_html):
    """persistSplitPlan() must do both the localStorage write AND refresh
    renderTodaysPlanCard() -- the card sitting behind the split modal.
    Without the second call, removing/adding an exercise inline updates
    the saved plan correctly but leaves that card showing the pre-edit
    exercise list until the next full page load. And the setItem() call
    must be wrapped in its own try/catch, OUTSIDE of which
    renderTodaysPlanCard() sits unconditionally: a quota-exceeded or
    private-browsing write failure shouldn't stop the UI from reflecting
    the in-memory plan every caller already mutated before calling this.

    The RepCheckStreak.mark() in between is subject to the same rule --
    building or editing a split counts toward the streak whether or not
    the plan itself made it to localStorage."""
    assert re.search(
        r"function persistSplitPlan\(plan\) \{\s*"
        r"(?://[^\n]*\n\s*)*"
        r"try \{\s*"
        r"localStorage\.setItem\(SPLIT_PLAN_KEY, JSON\.stringify\(plan\)\);\s*"
        r"\} catch \(err\) \{\}\s*"
        r"(?://[^\n]*\n\s*)*"
        r"if \(window\.RepCheckStreak\) RepCheckStreak\.mark\(\"split_plan\"\);\s*"
        r"renderTodaysPlanCard\(\);\s*\}",
        workouts_html,
    )


def test_wizard_save_handler_uses_persistSplitPlan_too(workouts_html):
    """All three plan-saving call sites -- the two inline week-view edits
    and the wizard's own final Save button -- must go through the same
    persistSplitPlan() helper rather than duplicating its
    setItem+renderTodaysPlanCard pairing inline. A bare localStorage.setItem
    here would still save correctly but silently drop the "Today's Plan"
    card refresh this helper exists to guarantee."""
    assert re.search(
        r"persistSplitPlan\(plan\);\s*"
        r"closeSplitModal\(\);\s*\}\);",
        workouts_html,
    )
    assert "localStorage.setItem(SPLIT_PLAN_KEY, JSON.stringify(plan));\n      closeSplitModal();" not in workouts_html


def test_week_view_has_a_pick_exercises_button_that_persists_immediately(whole_split_body_fn):
    assert 'id="split-view-pick-exercises-btn"' in whole_split_body_fn
    assert re.search(
        r"renderExercisePickerStep\(activeLabel, \{\s*"
        r"getSelected: \(\) => activeDay\.exercises,\s*"
        r"onDone: \(selected\) => \{\s*"
        r"activeDay\.exercises = selected;\s*"
        r"persistSplitPlan\(plan\);\s*"
        r"renderWholeSplitBody\(plan\);",
        whole_split_body_fn,
    )


def test_week_view_shows_empty_state_when_a_day_has_no_exercises_left(whole_split_body_fn):
    """Removing every exercise from a day is allowed (no minimum-count
    guard) -- without this, the day would render a silently-empty list
    that reads as broken rather than intentionally cleared."""
    assert re.search(
        r'\$\{!activeDay\.exercises\.length \? `<div class="wl-plan-rest">\$\{t\("workouts\.plan\.noExercisesText"\)\}</div>` : ""\}',
        whole_split_body_fn,
    )


def test_add_remove_controls_are_skipped_entirely_when_theres_no_active_day(whole_split_body_fn):
    """There's no activeDay object on a rest day (plan.schedule maps it to
    "Rest", not a day label) NOR when the schedule names a label that
    doesn't match any entry in plan.days (a data inconsistency) -- either
    way the remove/pick-exercises wiring must be gated behind the same
    showExerciseList flag the exercise-list-vs-rest-text branch uses, since
    calling activeDay.exercises on null/undefined would throw."""
    assert "const showExerciseList = !isRest && !!activeDay;" in whole_split_body_fn
    assert "if (showExerciseList) {" in whole_split_body_fn
    assert "if (!isRest) {" not in whole_split_body_fn


def test_exercise_list_template_branch_also_falls_back_on_a_missing_active_day(whole_split_body_fn):
    """The rest-text-vs-exercise-list ternary in the template itself must
    branch on showExerciseList too, not just the event-wiring below it --
    otherwise a missing activeDay would skip the click handlers safely but
    still crash on activeDay.exercises.map() while building the innerHTML
    string in the first place."""
    assert re.search(
        r"\$\{!showExerciseList\s*"
        r"\? `<div class=\"wl-plan-rest\">\$\{t\(\"workouts\.plan\.restText\"\)\}</div>`\s*"
        r": `<div class=\"wl-plan-exercise-list\">",
        whole_split_body_fn,
    )
    assert "${isRest\n" not in whole_split_body_fn


# ---------- exercise picker: generalized for both callers ----------


def test_exercise_picker_takes_a_getSelected_and_onDone_callback(workouts_html):
    """Refactored from being hardcoded to splitWizard.customDayExercises
    so both the wizard's day editor and the week view's inline editor can
    share the same categorized picker UI instead of duplicating it."""
    assert "async function renderExercisePickerStep(dayName, { getSelected, onDone }) {" in workouts_html
    assert "const selected = new Set(getSelected());" in workouts_html
    assert re.search(
        r'getElementById\("split-ex-picker-done-btn"\)\.addEventListener\("click", \(\) => \{\s*'
        r"onDone\(Array\.from\(selected\)\);\s*\}\);",
        workouts_html,
    )


def test_wizard_pick_exercises_still_writes_back_to_splitWizard(workouts_html):
    """The wizard's own call site must still behave exactly as before the
    refactor: writing the picked set into splitWizard.customDayExercises
    (deleting the key entirely when nothing's picked) and returning to
    renderSplitStepType(), not the week view."""
    assert re.search(
        r"renderExercisePickerStep\(dayName, \{\s*"
        r"getSelected: \(\) => splitWizard\.customDayExercises\[dayName\] \|\| \[\],\s*"
        r"onDone: \(selected\) => \{\s*"
        r"if \(selected\.length\) splitWizard\.customDayExercises\[dayName\] = selected;\s*"
        r"else delete splitWizard\.customDayExercises\[dayName\];\s*"
        r"renderSplitStepType\(\);",
        workouts_html,
    )


# ---------- async render-generation guard (adversarial-review fix) ----------
#
# renderExercisePickerStep() is the one step in this whole wizard/view
# system that's async -- it awaits loadCustomExercises() before rendering
# anything. If the user navigates elsewhere in that window (another
# weekday tab, "Edit split", a fresh wizard save) and something else
# replaces #split-modal-body, the picker's resumed continuation would
# previously overwrite it with stale UI wired to a stale plan/activeDay
# closure -- silently writing an old plan back over one the user saved in
# the meantime. Every function that replaces #split-modal-body bumps a
# shared splitModalGeneration counter; the picker captures its own value
# before awaiting and bails if the counter moved on.

RENDER_GENERATION_ENTRY_POINTS = [
    "renderSplitStepMode",
    "renderSplitStepType",
    "renderSplitStepLocation",
    "renderSplitStepGoal",
    "renderSplitStepDays",
    "renderSplitStepReview",
    "renderWholeSplitBody",
]


@pytest.mark.parametrize("fn_name", RENDER_GENERATION_ENTRY_POINTS)
def test_every_modal_body_render_function_bumps_the_generation_counter(workouts_html, fn_name):
    assert re.search(
        r"function " + fn_name + r"\([^)]*\) \{\s*splitModalGeneration\+\+;",
        workouts_html,
    ), f"{fn_name}() must bump splitModalGeneration as its first statement"


def test_exercise_picker_captures_its_generation_before_awaiting(exercise_picker_fn):
    assert re.search(
        r"async function renderExercisePickerStep\(dayName, \{ getSelected, onDone \}\) \{\s*"
        r"const myGeneration = \+\+splitModalGeneration;",
        exercise_picker_fn,
    )


def test_exercise_picker_bails_if_stale_after_the_await(exercise_picker_fn):
    """The bail-out check must happen AFTER the await and BEFORE the
    splitModalBody.innerHTML assignment -- checking before the await would
    be pointless (nothing could have changed yet), and rendering first
    then checking would still leak the stale UI onto the screen."""
    assert re.search(
        r"await loadCustomExercises\(\);\s*"
        r"(?://[^\n]*\n\s*)*"
        r"if \(myGeneration !== splitModalGeneration\) return;\s*"
        r"splitModalBody\.innerHTML = `",
        exercise_picker_fn,
    )
