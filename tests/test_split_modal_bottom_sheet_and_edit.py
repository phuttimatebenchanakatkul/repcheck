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


@pytest.fixture(scope="module")
def inline_exercise_picker_fn(workouts_html):
    start = workouts_html.index("async function renderInlineExercisePicker(container")
    end = workouts_html.index("function renderWholeSplitView()", start)
    return workouts_html[start:end]


@pytest.fixture(scope="module")
def picker_expand_css(workouts_html):
    start = workouts_html.index(".wl-plan-picker-expand {")
    end = workouts_html.index('/* Names the split the AI chose')
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
    """"Pick exercises" expands renderInlineExercisePicker() in place
    (#wl-plan-picker-expand) instead of swapping the whole sheet over to
    renderExercisePickerStep()'s full-step picker -- see
    renderInlineExercisePicker()'s own docstring-comment for why it isn't
    just a call to that function against a different container."""
    assert 'id="split-view-pick-exercises-btn"' in whole_split_body_fn
    assert 'id="wl-plan-picker-expand"' in whole_split_body_fn
    assert re.search(
        r"renderInlineExercisePicker\(pickerInner, \{\s*"
        r"getSelected: \(\) => activeDay\.exercises,\s*"
        r"onDone: \(selected\) => \{\s*"
        r"activeDay\.exercises = selected;\s*"
        r"persistSplitPlan\(plan\);\s*"
        r"renderWholeSplitBody\(plan\);",
        whole_split_body_fn,
    )


def test_week_view_pick_exercises_button_toggles_the_expand_panel(whole_split_body_fn):
    """Tapping the button while the panel is already open must collapse it
    again without saving -- it's a toggle, not a one-way navigation into a
    picker screen."""
    assert re.search(
        r'const opening = !pickerExpand\.classList\.contains\("is-open"\);',
        whole_split_body_fn,
    )
    assert re.search(
        r"if \(!opening\) \{\s*"
        r"closePicker\(myToken\);\s*"
        r"return;\s*\}",
        whole_split_body_fn,
    )
    # Opening is deferred until the picker has rendered (so the growth is
    # measured against real content), so the class goes on in openPicker()
    # rather than at click time -- hence add/remove, not toggle.
    assert 'pickerExpand.classList.add("is-open");' in whole_split_body_fn
    assert 'pickerExpand.classList.remove("is-open");' in whole_split_body_fn


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


# ---------- inline "Pick exercises" expansion (weekly-split view) ----------
#
# renderInlineExercisePicker() mounts the same categorized search+pick UI
# into a container inside the already-open weekly-split view instead of
# swapping #split-modal-body over to a new step, so the sheet visibly grows
# in place (see the .wl-plan-picker-expand grid animation) rather than
# looking like a second screen/sheet popping over the first.


def test_inline_picker_shares_the_list_builder_with_the_wizard_step(workouts_html):
    """Both pickers must render exercises identically -- sharing
    buildExercisePickerListHtml() instead of each maintaining its own copy
    of the category/search filtering logic."""
    assert "function buildExercisePickerListHtml(query, selected) {" in workouts_html
    assert workouts_html.count("listEl.innerHTML = buildExercisePickerListHtml(query, selected);") == 2


def test_inline_picker_mounts_into_the_given_container_not_the_modal_body(inline_exercise_picker_fn):
    """Unlike renderExercisePickerStep() (which always targets the fixed
    #split-modal-body/#split-ex-picker-* ids), this picker must be
    reusable against an arbitrary container -- it's mounted into
    #wl-plan-picker-expand-inner, a small element nested inside the
    weekly-split view's own #split-modal-body render."""
    assert "container.innerHTML = `" in inline_exercise_picker_fn
    assert "splitModalBody" not in inline_exercise_picker_fn
    assert 'container.querySelector(".split-ex-picker-search")' in inline_exercise_picker_fn


def test_inline_picker_takes_an_isStale_callback_instead_of_its_own_generation_counter(inline_exercise_picker_fn):
    """It has no render step of its own to bump splitModalGeneration --
    staleness is the caller's (renderWholeSplitBody's) responsibility,
    since only the caller knows whether the panel got closed/reopened or
    the whole view got re-rendered while loadCustomExercises() was
    in flight."""
    assert re.search(
        r"async function renderInlineExercisePicker\(container, \{ getSelected, onDone \}, isStale\) \{\s*"
        r"const t = RepCheckI18n\.t;\s*"
        r"const selected = new Set\(getSelected\(\)\);\s*"
        r"\s*"
        r"await loadCustomExercises\(\);\s*"
        r"if \(isStale\(\)\) return;",
        inline_exercise_picker_fn,
    )


def test_inline_picker_wiring_passes_a_combined_staleness_check(whole_split_body_fn):
    """Staleness here has two independent causes: the panel itself got
    toggled closed/reopened (pickerToken), or the whole week view got
    re-rendered out from under it -- another weekday tab, a remove-button
    edit, "Edit split" (splitModalGeneration). Either one alone would miss
    the other case."""
    assert re.search(
        r"const isStale = \(\) => myToken !== pickerToken \|\| splitModalGeneration !== renderGeneration;",
        whole_split_body_fn,
    )
    assert "}, isStale).then(() => {" in whole_split_body_fn


def test_picker_expand_animates_via_max_height_not_display_none(picker_expand_css):
    """A display:none/block toggle would cut straight to the final state --
    the max-height 0 -> a generous cap transition is what makes the panel
    visibly grow instead of snapping open, matching the "carefully expand
    vertically" requirement this exists to satisfy. (An earlier version of
    this used the grid-template-rows 0fr->1fr trick instead, but hit an
    overflow circularity that stuck the track at ~padding height instead
    of the content's intrinsic size.)"""
    assert "max-height: 0;" in picker_expand_css
    assert "transition: max-height" in picker_expand_css
    assert "display: none" not in picker_expand_css
    # The open height is no longer a CSS cap: it's the panel's own measured
    # scrollHeight, written inline by openPicker(). See
    # test_picker_opens_to_its_measured_height_then_releases_the_cap.
    assert not re.search(r"\.wl-plan-picker-expand\.is-open\s*\{\s*max-height:", picker_expand_css)


def test_picker_renders_before_it_opens_so_the_growth_is_never_an_empty_box(whole_split_body_fn):
    """renderInlineExercisePicker() awaits loadCustomExercises(), so opening
    the panel first would animate an empty box for the whole transition and
    then pop the picker in at the end. The open call has to be chained off
    the render instead -- and re-checked for staleness, since the panel can
    be closed again (or the whole week view re-rendered) during that await."""
    assert re.search(
        r"\}, isStale\)\.then\(\(\) => \{\s*"
        r"if \(isStale\(\)\) return;\s*"
        r"openPicker\(\);\s*"
        r"\}\);",
        whole_split_body_fn,
    )


def test_picker_opens_to_its_measured_height_then_releases_the_cap(whole_split_body_fn):
    """max-height can't transition to `none`, so the growth has to target a
    concrete measured pixel height. Holding that measurement afterwards
    would clip the list (which re-renders shorter on every keystroke), so
    the cap is dropped once the panel has settled."""
    assert 'pickerExpand.style.maxHeight = pickerExpand.scrollHeight + "px";' in whole_split_body_fn
    assert 'pickerExpand.style.maxHeight = "none";' in whole_split_body_fn


def test_open_and_close_force_a_reflow_between_the_start_and_end_heights(whole_split_body_fn):
    """Writing the start and end max-height in the same task lets the
    browser collapse both into one style recalc -- there'd be no start value
    to animate from and the panel would snap. pinHeight() reads offsetHeight
    in between to flush the first write."""
    assert re.search(
        r"function pinHeight\(px\) \{\s*"
        r'pickerExpand\.style\.maxHeight = px \+ "px";\s*'
        r"void pickerExpand\.offsetHeight;\s*"
        r"\}",
        whole_split_body_fn,
    )
    assert "pinHeight(0);" in whole_split_body_fn
    assert "pinHeight(pickerExpand.scrollHeight);" in whole_split_body_fn


def test_settle_handler_ignores_transitions_bubbling_up_from_the_staged_children(whole_split_body_fn):
    """The staged children animate opacity/transform inside the panel and
    those transitionend events bubble to it. Without the target/propertyName
    guard, the first child to finish fading would fire the panel's settle
    step early -- dropping the height cap (or emptying the panel) mid-growth."""
    assert re.search(
        r'if \(ev\.target !== pickerExpand \|\| ev\.propertyName !== "max-height"\) return;',
        whole_split_body_fn,
    )


def test_panel_is_emptied_only_after_the_collapse_has_played(whole_split_body_fn):
    """Clearing innerHTML at click time drops the panel's height to zero
    instantly, leaving nothing to animate. It's deferred to the settle
    handler -- and token-guarded, so a quick reopen isn't wiped by the
    previous close's pending callback."""
    assert re.search(
        r"cancelPanelSettled = onPanelSettled\(\(\) => \{\s*"
        r"cancelPanelSettled = null;\s*"
        r"if \(myToken !== pickerToken\) return;\s*"
        r'pickerInner\.innerHTML = "";',
        whole_split_body_fn,
    )


def test_reduced_motion_runs_the_settle_steps_inline(whole_split_body_fn):
    """Under prefers-reduced-motion the CSS sets transition: none, so
    transitionend never fires. Without an inline path the cap would stay
    pinned at the opening measurement (clipping the list) and a closed panel
    would keep its stale content forever."""
    assert 'window.matchMedia("(prefers-reduced-motion: reduce)").matches' in whole_split_body_fn
    # The open branch's full shape (including the reveal scroll) is pinned by
    # test_reveal_runs_only_after_the_growth_has_settled; here it's only the
    # cap release that matters.
    assert re.search(
        r"if \(reducedMotion\(\)\) \{\s*"
        r'pickerExpand\.classList\.add\("is-open"\);\s*'
        r'pickerExpand\.style\.maxHeight = "none";',
        whole_split_body_fn,
    )
    assert re.search(
        r"if \(reducedMotion\(\)\) \{\s*"
        r'pickerExpand\.classList\.remove\("is-open"\);\s*'
        r'pickerExpand\.style\.maxHeight = "0px";\s*'
        r'pickerInner\.innerHTML = "";\s*'
        r"return;\s*\}",
        whole_split_body_fn,
    )


def test_picker_contents_reveal_top_to_bottom_starting_at_the_search_field(inline_exercise_picker_fn):
    """The requested reveal order: the search field leads, the categorised
    list follows, then everything after it -- rather than the whole picker
    appearing at once the moment the panel starts growing."""
    stages = re.findall(r'class="([^"]*wl-plan-picker-stage[^"]*)" style="--stage:(\d)', inline_exercise_picker_fn)
    assert [n for _, n in stages] == ["0", "1", "2", "3"], stages
    assert "split-ex-picker-search" in stages[0][0]
    assert "split-ex-picker-list" in stages[2][0]


def test_stage_delays_apply_only_while_opening(picker_expand_css):
    """Staggering the collapse too would make dismissing the panel feel
    sluggish -- the delay is scoped to the .is-open rule so closing fades
    everything together."""
    assert re.search(
        r"\.wl-plan-picker-expand\.is-open \.wl-plan-picker-stage \{[^}]*"
        r"transition-delay: calc\(var\(--stage, 0\) \* \d+ms\);",
        picker_expand_css,
    )
    base = picker_expand_css[picker_expand_css.index(".wl-plan-picker-stage {"):]
    base = base[: base.index("}")]
    assert "transition-delay" not in base


def test_staged_reveal_is_disabled_under_reduced_motion(picker_expand_css):
    """The stagger is pure motion -- under reduced motion the content must
    just be there, with no offset to slide in from and no delay."""
    block = picker_expand_css[picker_expand_css.index("@media (prefers-reduced-motion: reduce)"):]
    assert ".wl-plan-picker-expand { transition: none; }" in block
    assert "transition-delay: 0s;" in block


def _duration_ms(value):
    value = value.strip()
    return float(value[:-2]) if value.endswith("ms") else float(value[:-1]) * 1000


def test_opening_is_slower_than_collapsing(picker_expand_css):
    """The growth is the part the eye follows, so it has to be unhurried
    enough to read as expanding rather than as a jump -- while dismissing
    stays quick. A single shared duration can't do both, so the two
    directions carry their own timing (openPicker adds .is-open before
    writing the target height, closePicker removes it before writing 0)."""
    close = re.search(r"\.wl-plan-picker-expand \{[^}]*transition: max-height ([\d.]+m?s)", picker_expand_css)
    open_ = re.search(r"\.wl-plan-picker-expand\.is-open \{\s*transition-duration: ([\d.]+m?s);", picker_expand_css)
    assert close and open_, picker_expand_css[:400]
    assert _duration_ms(open_.group(1)) > _duration_ms(close.group(1))
    # Slow enough to actually read as motion rather than a snap.
    assert _duration_ms(open_.group(1)) >= 500


def test_staged_fade_is_also_longer_on_the_way_in(picker_expand_css):
    """A quick fade under a slow growth reads as the content popping in
    before the panel has finished opening -- the stagger has to be paced to
    the growth, and likewise shortened again on the way out."""
    base = picker_expand_css[picker_expand_css.index(".wl-plan-picker-stage {"):]
    base = base[: base.index("}")]
    close = re.search(r"transition: opacity ([\d.]+m?s)", base)
    open_ = re.search(
        r"\.wl-plan-picker-expand\.is-open \.wl-plan-picker-stage \{[^}]*transition-duration: ([\d.]+m?s);",
        picker_expand_css,
    )
    assert close and open_
    assert _duration_ms(open_.group(1)) > _duration_ms(close.group(1))


def test_panel_grows_with_the_sheets_own_easing_curve(workouts_html, picker_expand_css):
    """Reusing .split-modal's presentation curve keeps the panel from
    reading as a second, unrelated motion layered on the sheet."""
    sheet = re.search(r"\.split-modal \{[^}]*transition: transform [\d.]+m?s (cubic-bezier\([^)]*\))", workouts_html)
    assert sheet, "couldn't find .split-modal's transition"
    assert sheet.group(1) in picker_expand_css


def test_grown_picker_is_scrolled_into_view(whole_split_body_fn):
    """The grown panel is routinely taller than what's left of the sheet
    (the list caps at 50vh, .split-modal at 86vh, and the day's tabs and
    exercise rows are already above it), so the Done button finishes the
    growth below the fold with nothing on screen to suggest it's there.
    Measured on a 844px-tall phone: a 597px panel in a 655px scrollport."""
    assert "function revealPicker(smooth) {" in whole_split_body_fn
    assert "splitModalBody.scrollTo({ top, behavior: smooth ? \"smooth\" : \"auto\" });" in whole_split_body_fn


def test_reveal_scrolls_the_sheet_body_not_the_page(whole_split_body_fn):
    """scrollIntoView() would walk every scrollable ancestor including the
    document, dragging the page behind the sheet. The scrollport is
    .split-modal-body (the one element with overflow-y: auto) and it's the
    only thing that should move."""
    assert "scrollIntoView" not in whole_split_body_fn
    assert re.search(
        r"const top = splitModalBody\.scrollTop\s*"
        r"\+ \(pickBtn\.getBoundingClientRect\(\)\.top - bodyRect\.top\)",
        whole_split_body_fn,
    )


def test_reveal_is_a_no_op_when_the_panel_already_fits(whole_split_body_fn):
    """A short list on a tall screen needs no scroll, and scrolling anyway
    would shove the day's exercise list out of view for nothing. Verified
    against a 215px panel: scrollTop stays at 0."""
    assert re.search(
        r"if \(pickerExpand\.getBoundingClientRect\(\)\.bottom <= bodyRect\.bottom\) return;",
        whole_split_body_fn,
    )


def test_reveal_runs_only_after_the_growth_has_settled(whole_split_body_fn):
    """While the panel is still expanding, splitModalBody hasn't reached its
    final scrollHeight, so scrollTo() would clamp short and land in the
    wrong place. It has to follow the cap release in the settle handler --
    and run inline (unanimated) on the reduced-motion path, which never
    gets a transitionend."""
    assert re.search(
        r"cancelPanelSettled = onPanelSettled\(\(\) => \{\s*"
        r"cancelPanelSettled = null;\s*"
        r'pickerExpand\.style\.maxHeight = "none";\s*'
        r"revealPicker\(true\);",
        whole_split_body_fn,
    )
    assert re.search(
        r"if \(reducedMotion\(\)\) \{\s*"
        r'pickerExpand\.classList\.add\("is-open"\);\s*'
        r'pickerExpand\.style\.maxHeight = "none";\s*'
        r"revealPicker\(false\);\s*"
        r"return;\s*\}",
        whole_split_body_fn,
    )
