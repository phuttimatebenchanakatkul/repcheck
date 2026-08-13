"""Guards the same trust boundary as test_nutrition_name_escaping.py, one
screen over: the onboarding wizard's split review.

static/onboarding.js carries its own copy of the split-review screen,
separate from the one in templates/workouts.html. Every screen in it is
built by handing a template literal to el(), which assigns the string to
innerHTML -- so an interpolated value is markup, not text.

Three of the values reaching those literals are author-controlled by
whoever is using the app:
  - split day labels, which are free text on the custom-split path
  - exercise names, which a user can create via POST /api/custom-exercises
  - the lifting goal, a free-text field the split API echoes back inside
    the rationale it returns

That is the same sink that made food names a stored-XSS vector on the
nutrition page. Verified here with '"><img src=x onerror=alert(1)>' as
both a custom day label and a custom exercise name: before the fix it
injected live <img> elements and fired the handler; after, it renders as
visible literal text.

Two helpers exist and they are not interchangeable:
  escapeHtml() round-trips through textContent, escaping < > and & but
  NOT quotes. Correct for a text node.
  escapeAttr() adds the quote escaping, and is required wherever the
  value lands inside a quoted attribute -- one " there ends the
  attribute and the rest parses as markup.

These tests pin each interpolation site, since the failure is silent:
the wizard looks fine until a label happens to contain a bracket.
"""

import re

import pytest


@pytest.fixture(scope="module")
def onboarding_js():
    with open("static/onboarding.js", encoding="utf-8") as f:
        return f.read()


def test_split_review_day_title_escapes_the_label(onboarding_js):
    """Day labels are free text on the custom-split path."""
    match = re.search(r'ob-review-day-title">(.*?)</div>', onboarding_js)
    assert match, "could not find the split-review day title element"
    assert "escapeHtml(day.label)" in match.group(1), (
        "the split-review day title renders the label unescaped -- a "
        "custom day named '\"><img src=x onerror=...>' becomes a live "
        "element here"
    )


def test_exercise_chip_escapes_the_exercise_name(onboarding_js):
    """Exercise names are not all library-controlled.

    A user can create their own via POST /api/custom-exercises and have
    it picked into a generated split, so the name arrives here as
    attacker-authored text.
    """
    match = re.search(
        r'ob-review-exercise-chip-icon">.*?</span>(.*?)</span>', onboarding_js
    )
    assert match, "could not find the exercise chip name"
    assert "escapeHtml(ex)" in match.group(1), (
        "the exercise chip renders a custom exercise name unescaped"
    )


def test_weekday_option_value_uses_attribute_escaping(onboarding_js):
    """An attribute needs escapeAttr, not escapeHtml.

    escapeHtml leaves " untouched, which is fine in a text node and
    useless here -- the quote would close the value attribute and let
    the rest of the label inject new attributes onto the <option>.
    """
    match = re.search(r'<option value="(\$\{[^"]*?)"', onboarding_js[onboarding_js.index("uniqueLabels.map"):])
    assert match, "could not find the weekday option value attribute"
    assert match.group(1) == "${escapeAttr(label)}", (
        "the weekday option value must use escapeAttr -- escapeHtml does "
        "not escape the quote that would break out of the attribute"
    )


def test_weekday_option_text_escapes_the_label(onboarding_js):
    """The same label is also interpolated as the option's visible text."""
    match = re.search(r">(\$\{escapeHtml\(label\)\})</option>", onboarding_js)
    assert match, (
        "the weekday option renders the label unescaped as text -- the "
        "value attribute and the text content both need escaping"
    )


def test_custom_day_chip_escapes_the_typed_name(onboarding_js):
    """The field that feeds day.label, escaped at the point of entry.

    Escaping only the review screen would leave this one live, and it
    renders the same text the user just typed.
    """
    match = re.search(r'ob-custom-day-row">\s*<span>(.*?)</span>', onboarding_js)
    assert match, "could not find the custom day chip"
    assert match.group(1) == "${escapeHtml(name)}", (
        "the custom day chip renders the typed name unescaped"
    )


def test_lifting_goal_textarea_escapes_the_goal(onboarding_js):
    """A literal </textarea> in the goal would break out of the element."""
    match = re.search(r"ob-goal-textarea.*?>(\$\{.*?\})</textarea>", onboarding_js)
    assert match, "could not find the lifting goal textarea"
    assert match.group(1) == "${escapeHtml(w.liftingGoal)}", (
        "the goal textarea renders the free-text goal unescaped -- a goal "
        "containing '</textarea><img src=x onerror=...>' escapes the element"
    )


def test_rationale_escapes_the_model_text(onboarding_js):
    """The rationale is model-authored and quotes the user's own goal.

    /api/generate-split injects the free-text goal into the rationale it
    returns, so this string is user-influenced even though a model wrote
    the sentence around it.
    """
    match = re.search(r'ob-rationale-text">(.*?)</div>', onboarding_js)
    assert match, "could not find the rationale element"
    assert match.group(1) == "${escapeHtml(w.rationale)}", (
        "the rationale renders unescaped"
    )


def test_no_user_authored_value_is_interpolated_raw(onboarding_js):
    """Catches a NEW unescaped site, not just the ones fixed here.

    The site-by-site tests above only pin the interpolations that exist
    today. This one fails if any of these values is ever interpolated
    raw again anywhere in the file, which is how the bug came back once
    already (workouts.html and onboarding.js each had their own copy).
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


def test_escape_attr_helper_escapes_quotes(onboarding_js):
    """The helper itself must actually handle quotes.

    Pins the property the attribute site depends on, so escapeAttr can't
    later be simplified into an escapeHtml alias without failing here.
    """
    match = re.search(
        r"function escapeAttr\(text\)\s*\{(.*?)\n  \}", onboarding_js, re.DOTALL
    )
    assert match, "escapeAttr() helper is missing"
    body = match.group(1)
    assert "&quot;" in body, "escapeAttr must escape double quotes"
    assert "escapeHtml(" in body, (
        "escapeAttr should build on escapeHtml so it also covers < > and &"
    )


def test_escape_html_helper_round_trips_through_text_content(onboarding_js):
    """textContent is what does the escaping; assigning innerHTML would not."""
    match = re.search(
        r"function escapeHtml\(text\)\s*\{(.*?)\n  \}", onboarding_js, re.DOTALL
    )
    assert match, "escapeHtml() helper is missing"
    body = match.group(1)
    assert "textContent" in body, (
        "escapeHtml must assign the value to textContent -- that is the "
        "step that turns < > & into entities"
    )
