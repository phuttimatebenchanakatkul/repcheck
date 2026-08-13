"""Guards the split modal's bottom-sheet conversion and edit-in-place flow.

Two behaviors regressed easily and silently if this ever gets refactored:

The modal must render as a real bottom sheet (slide up from the bottom,
page recedes behind it) rather than the old centered pop-in dialog -- see
.log-sheet-overlay in static/style.css for the canonical pattern this
mirrors.

"Edit split" -- both the nested button inside the read-only saved-split
view and the main "Today's plan" card button, whose label already promised
this before the fix -- must open directly into the CURRENT plan's days and
exercises, not reset to the blank mode-selection wizard. A regression here
silently discards a user's already-built split has no visible symptom
except a button whose label lies about what it does.

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
def edit_split_modal_fn(workouts_html):
    start = workouts_html.index("function openEditSplitModal()")
    end = workouts_html.index("function closeSplitModal()")
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


# ---------- edit-in-place ----------


def test_edit_modal_bails_out_with_no_saved_plan(edit_split_modal_fn):
    assert re.search(r"const plan = loadSplitPlan\(\);\s*if \(!plan\) return;", edit_split_modal_fn), (
        "openEditSplitModal must no-op rather than open a wizard with "
        "nothing to edit if there is somehow no saved plan"
    )


def test_edit_modal_marks_itself_as_editing_an_existing_plan(edit_split_modal_fn):
    """This flag is what flips the primary button's label to 'Save changes'
    (see renderSplitStepType()) -- losing it silently reverts the button
    text to 'Generate my plan' while still overwriting the old plan."""
    assert "isEditingExistingPlan: true," in edit_split_modal_fn


def test_edit_modal_prepopulates_days_and_exercises_from_the_saved_plan(edit_split_modal_fn):
    assert "customDays: plan.days.map((d) => d.label)," in edit_split_modal_fn
    assert re.search(
        r"customDayExercises: Object\.fromEntries\(plan\.days\.map\(\(d\) => \[d\.label, \[\.\.\.d\.exercises\]\]\)\),",
        edit_split_modal_fn,
    ), "openEditSplitModal must copy each day's existing exercises into customDayExercises, not start empty"


def test_edit_modal_skips_mode_selection_and_goes_straight_to_the_editor(edit_split_modal_fn):
    """The whole point of the fix: land on renderSplitStepType() (the
    self-build day/exercise editor), not renderSplitStepMode() (the blank
    AI-vs-self-build choice) -- there's nothing to choose when editing."""
    assert "renderSplitStepType();" in edit_split_modal_fn
    assert "renderSplitStepMode()" not in edit_split_modal_fn


def test_edit_modal_defaults_unrecognized_saved_split_type_to_custom(edit_split_modal_fn):
    """A saved plan's splitType might not match any current template id
    (template list changed, or it was hand-typed) -- falling back to
    'custom' keeps the day list editable instead of crashing or
    mis-highlighting a template card."""
    assert re.search(
        r'type: validTypeIds\.includes\(plan\.splitType\) \? plan\.splitType : "custom",',
        edit_split_modal_fn,
    )


def test_both_edit_entry_points_route_to_the_prepopulated_editor(workouts_html):
    """Two buttons promise "edit the current split": the nested button
    inside the read-only saved-split view, and the main Today's-plan card
    button once a plan exists. Both must route to openEditSplitModal, not
    the blank-slate openSplitModal -- the card button's label already made
    this promise before the fix landed, silently broken until its handler
    was updated to match."""
    assert 'getElementById("split-edit-from-view-btn").addEventListener("click", openEditSplitModal)' in workouts_html

    handler = re.search(
        r"planBtnEl\.addEventListener\(\"click\", \(\) => \{\s*"
        r"if \(loadSplitPlan\(\)\) openEditSplitModal\(\);\s*"
        r"else openSplitModal\(\);\s*"
        r"\}\);",
        workouts_html,
    )
    assert handler, (
        "the main plan button must open the edit-in-place flow when a plan "
        "already exists, and the blank wizard only when one doesn't"
    )


def test_save_changes_label_used_only_when_editing_an_existing_plan(workouts_html):
    """Self-build's primary button reads 'Save changes' while editing an
    existing plan and 'Generate my plan' when building a fresh one from
    the day/exercise editor -- both self-build paths through the same
    screen, distinguished only by isEditingExistingPlan."""
    assert (
        'splitWizard.isEditingExistingPlan ? t("workouts.wizard.saveChanges") : t("workouts.wizard.generatePlan")'
        in workouts_html
    )
