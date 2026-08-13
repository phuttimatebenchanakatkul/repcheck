"""Guards the exercise-name and split-label trust boundary in workouts.html.

Same bug class as test_nutrition_name_escaping.py and
test_onboarding_name_escaping.py, third screen. This page has the widest
blast radius of the three because the same values render in six separate
places: the workout log, the exercise search modal, the plan list (twice
-- the library view and the split day view), the split exercise picker,
and the split review.

The attacker-authored values here are:
  - custom exercise names. POST /api/custom-exercises only does
    str(...).strip() and name[:60] -- no HTML sanitization -- and the
    name flows into customExercises, which feeds the exercise modal and
    the split picker.
  - the custom exercise emoji, capped at 8 chars server-side and
    returned straight into innerHTML by exerciseEmoji(). Eight chars is
    too short for a working handler but long enough to open a tag.
  - split day labels, free text on the custom-split path.
  - the free-text goal and the rationale the split API builds around it.

Scope note: custom exercises and splits are stored per user_id, so a
payload renders in its author's own session rather than someone else's.
That makes this self-XSS, not cross-user stored XSS -- lower severity
than the nutrition case, same fix, and still worth closing since the
page also renders values the server never sanitizes.

Two helpers exist and they are not interchangeable:
  escapeHtml() round-trips through textContent, escaping < > and & but
  NOT quotes. Correct for a text node.
  escapeAttr() adds the quote escaping, and is required wherever the
  value lands inside a quoted attribute -- one " there ends the
  attribute and the rest parses as markup. This page leans on it hard:
  exercise names ride in data-exercise-detail, data-quick-add,
  data-fav-toggle, data-name and data-exercise, all read back via
  dataset (the parser turns &quot; back into " on the way out, so the
  escaping is invisible to those readers).
"""

import re

import pytest


@pytest.fixture(scope="module")
def workouts_html():
    with open("templates/workouts.html", encoding="utf-8") as f:
        return f.read()


def test_workout_log_entry_escapes_the_exercise_name(workouts_html):
    """A logged entry can name a custom exercise."""
    match = re.search(r'wl-entry-name">(.*?)</div>', workouts_html)
    assert match, "could not find the workout log entry name"
    assert match.group(1) == "${escapeHtml(entry.exercise)}", (
        "the workout log renders the exercise name unescaped"
    )


def test_exercise_modal_row_escapes_name_in_text_and_attributes(workouts_html):
    """One row, three sinks: two attributes and the visible name."""
    match = re.search(
        r'<div class="ex-modal-result-item" data-name="(.*?)">(.*?)</div>',
        workouts_html,
        re.DOTALL,
    )
    assert match, "could not find the exercise modal result row"
    assert match.group(1) == "${escapeAttr(name)}", (
        "data-name is a quoted attribute and needs escapeAttr"
    )
    row = match.group(2)
    assert "${escapeHtml(name)}" in row, (
        "the exercise modal renders the visible name unescaped"
    )
    assert "data-fav-toggle=\"${escapeAttr(name)}\"" in row, (
        "data-fav-toggle is a quoted attribute and needs escapeAttr"
    )


def test_custom_exercise_picker_row_escapes_the_name(workouts_html):
    """The custom-exercise list is the most direct sink on the page.

    These rows render exactly the names POST /api/custom-exercises
    accepted without sanitizing.
    """
    match = re.search(
        r'<input type="checkbox" data-exercise="\$\{escapeAttr\(ex\.name\)\}"',
        workouts_html,
    )
    assert match, (
        "the custom exercise picker checkbox renders ex.name unescaped in "
        "its data-exercise attribute"
    )
    assert "<span>${escapeHtml(ex.name)}</span>" in workouts_html, (
        "the custom exercise picker renders ex.name unescaped as text"
    )


def test_builtin_exercise_picker_row_escapes_the_name(workouts_html):
    """Built-in names are library-controlled, but the row is shared shape.

    Escaping both branches keeps the two picker paths from drifting, which
    is how one of them would silently become the unescaped one again.
    """
    assert 'data-exercise="${escapeAttr(name)}"' in workouts_html, (
        "the built-in exercise picker checkbox attribute is unescaped"
    )


def test_plan_exercise_rows_escape_name_in_both_copies(workouts_html):
    """There are TWO plan-row templates and both must escape.

    The library plan view and the split day view carry near-identical
    markup; fixing only the one that happens to be grepped first leaves
    the other live. This asserts on the count, not just presence.
    """
    rows = re.findall(
        r'wl-plan-exercise-row" data-exercise-detail="(.*?)"', workouts_html
    )
    assert len(rows) == 2, f"expected 2 plan-row templates, found {len(rows)}"
    for value in rows:
        assert value == "${escapeAttr(name)}", (
            "data-exercise-detail is a quoted attribute and needs escapeAttr"
        )
    names = re.findall(r'wl-plan-exercise-name">(.*?)</span>', workouts_html)
    assert len(names) == 2, f"expected 2 plan-name spans, found {len(names)}"
    for value in names:
        assert value == "${escapeHtml(name)}", (
            "the plan row renders the exercise name unescaped"
        )


def test_quick_add_button_escapes_name_in_both_attributes(workouts_html):
    """The aria-label interpolates the name mid-attribute, not just alone."""
    match = re.search(r'data-quick-add="(.*?)" aria-label="Log (.*?) now"', workouts_html)
    assert match, "could not find the quick-add button"
    assert match.group(1) == "${escapeAttr(name)}", (
        "data-quick-add is a quoted attribute and needs escapeAttr"
    )
    assert match.group(2) == "${escapeAttr(name)}", (
        "the aria-label embeds the name inside a quoted attribute -- a raw "
        'quote there ends aria-label and the rest parses as attributes'
    )


def test_split_custom_day_chip_escapes_the_typed_name(workouts_html):
    match = re.search(r'split-custom-day-name">(.*?)</span>', workouts_html)
    assert match, "could not find the custom day chip"
    assert match.group(1) == "${escapeHtml(name)}", (
        "the custom day chip renders the typed day name unescaped"
    )


def test_split_goal_textarea_uses_the_shared_helper(workouts_html):
    """This site had a hand-rolled escape chain; it must use the helper.

    The inline .replace(/&/).replace(/</).replace(/>/) was correct for a
    textarea but is a second implementation that can drift from the real
    one. Pinning it to escapeHtml keeps exactly one definition on the page.
    """
    match = re.search(r"split-goal-textarea.*?>(\$\{.*?\})</textarea>", workouts_html)
    assert match, "could not find the split goal textarea"
    assert match.group(1) == "${escapeHtml(splitWizard.goal)}", (
        "the goal textarea should use escapeHtml rather than a hand-rolled "
        "replace chain"
    )


def test_split_review_day_title_escapes_the_label(workouts_html):
    match = re.search(r'split-review-day-title">(.*?)</div>', workouts_html)
    assert match, "could not find the split review day title"
    assert "escapeHtml(day.label)" in match.group(1), (
        "the split review day title renders the label unescaped"
    )


def test_split_review_chip_escapes_name_in_text_and_attribute(workouts_html):
    match = re.search(
        r'split-review-exercise-chip" data-exercise-detail="(.*?)">', workouts_html
    )
    assert match, "could not find the split review exercise chip"
    assert match.group(1) == "${escapeAttr(e)}", (
        "data-exercise-detail is a quoted attribute and needs escapeAttr"
    )
    assert "</span>${escapeHtml(e)}" in workouts_html, (
        "the split review chip renders the exercise name unescaped as text"
    )


def test_split_review_weekday_option_escapes_value_and_text(workouts_html):
    match = re.search(
        r'<option value="(\$\{[^"]*?)" \$\{defaultSchedule', workouts_html
    )
    assert match, "could not find the weekday option"
    assert match.group(1) == "${escapeAttr(label)}", (
        "the weekday option value must use escapeAttr -- escapeHtml does "
        "not escape the quote that would break out of the attribute"
    )
    assert ">${escapeHtml(label)}</option>" in workouts_html, (
        "the weekday option renders the label unescaped as text"
    )


def test_rationale_escapes_the_model_text(workouts_html):
    """The rationale is model-authored and quotes the user's own goal."""
    assert "${escapeHtml(splitWizard.rationale)}" in workouts_html, (
        "the split rationale renders unescaped"
    )


def test_custom_exercise_emoji_is_escaped(workouts_html):
    """The 8-char server cap is a length limit, not a sanitizer.

    exerciseEmoji()'s return value goes straight into innerHTML through
    exerciseIconHtml(), so an emoji field containing '<iframe ' opens a
    tag that swallows the markup after it.
    """
    match = re.search(
        r"function exerciseEmoji\(name\)\s*\{(.*?)\n  \}", workouts_html, re.DOTALL
    )
    assert match, "exerciseEmoji() helper is missing"
    assert "escapeHtml(meta.emoji)" in match.group(1), (
        "the user-picked custom emoji is returned into innerHTML unescaped"
    )


def test_no_user_authored_value_is_interpolated_raw(workouts_html):
    """Catches a NEW unescaped site, not just the ones fixed here.

    This page grew two near-duplicate plan rows and two near-duplicate
    picker rows; a copy-paste is exactly how one of them ends up raw.
    """
    raw = [
        "${entry.exercise}",
        "${ex.name}",
        "${day.label}",
        "${splitWizard.rationale}",
        "${splitWizard.goal}",
        'data-exercise="${name}"',
        'data-exercise-detail="${name}"',
        'data-exercise-detail="${e}"',
        'data-quick-add="${name}"',
        'data-name="${name}"',
        'data-fav-toggle="${name}"',
        'wl-plan-exercise-name">${name}<',
        '<option value="${label}"',
        ">${label}</option>",
    ]
    found = [token for token in raw if token in workouts_html]
    assert not found, (
        f"user-authored values interpolated raw into innerHTML: {found} -- "
        "route each through escapeHtml(), or escapeAttr() if it lands "
        "inside a quoted attribute"
    )


def test_escape_attr_helper_escapes_quotes(workouts_html):
    """The helper itself must actually handle quotes.

    This page depends on escapeAttr more than the other two -- six of its
    sinks are attributes -- so an escapeAttr that aliased escapeHtml would
    silently reopen all of them.
    """
    match = re.search(
        r"function escapeAttr\(text\)\s*\{(.*?)\n  \}", workouts_html, re.DOTALL
    )
    assert match, "escapeAttr() helper is missing"
    body = match.group(1)
    assert "&quot;" in body, "escapeAttr must escape double quotes"
    assert "escapeHtml(" in body, (
        "escapeAttr should build on escapeHtml so it also covers < > and &"
    )


def test_escape_html_helper_round_trips_through_text_content(workouts_html):
    match = re.search(
        r"function escapeHtml\(text\)\s*\{(.*?)\n  \}", workouts_html, re.DOTALL
    )
    assert match, "escapeHtml() helper is missing"
    assert "textContent" in match.group(1), (
        "escapeHtml must assign the value to textContent -- that is the "
        "step that turns < > & into entities"
    )
