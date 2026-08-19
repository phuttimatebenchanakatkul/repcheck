"""Guards keyboard activation for hyrox.js's div[role="button"] rows.

Two live surfaces are built as `div[role="button"]` rather than real
`<button>`s, because each one wraps its own nested interactive control and
buttons cannot nest (invalid HTML: the browser silently closes the outer one
and corrupts everything rendered after it):

- the personal-best board's rows (`renderPbBoard`, history screen)
- the history rows (`renderHistory`), which nest the remove "x" button

A div gets no free Enter/Space activation the way a real button does, so
`handleKeydown()` replays it as a synthetic click. Nothing about that is
visible in a diff review, and it fails silently for keyboard and screen
reader users only.

These three assertions previously lived in
tests/test_hyrox_personal_best_section.py, which existed to guard the setup
screen's "Your personal bests" card. That card was removed (the history
screen's board replaced it), and deleting its test file would have taken
this coverage with it even though `handleKeydown` and both of its callers
are still very much alive. Extracted here instead, scoped to what survives.

Source-level regex assertions against the real file, same tradeoff the rest
of this suite makes for hyrox.js -- see CLAUDE.md's testing note.
"""

import pytest

KEYDOWN_START = "handleKeydown(event) {"
KEYDOWN_END = "// ---------- AI analysis: short/detail toggle ----------"


@pytest.fixture(scope="module")
def hyrox_js():
    with open("static/hyrox.js", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def handle_keydown(hyrox_js):
    start = hyrox_js.index(KEYDOWN_START)
    end = hyrox_js.index(KEYDOWN_END)
    assert end > start, "handleKeydown() extraction markers moved -- update this test"
    return hyrox_js[start:end]


def test_the_listener_is_actually_bound(hyrox_js):
    """The handler is worthless if nothing calls it. Bound on the root, next
    to the delegated click listener, so it survives every re-render."""
    assert 'this.root.addEventListener("keydown", (event) => this.handleKeydown(event));' in hyrox_js


def test_div_role_button_triggers_get_keyboard_activation(handle_keydown):
    """A div[role=button] gets no free Enter/Space handling the way a real
    <button> does -- handleKeydown() must replay it as a synthetic click,
    scoped to [data-action][role="button"] so it only fires on the elements
    that actually need the shim."""
    assert 'event.target.closest(\'[data-action][role="button"]\')' in handle_keydown
    assert "target.click();" in handle_keydown


def test_keydown_ignores_keys_other_than_enter_or_space(handle_keydown):
    """Any other key (Tab, Escape, an arrow key, ...) landing on the trigger
    must fall through untouched -- only Enter/Space replay a synthetic
    click, or arrow-key scrolling and tabbing break inside these rows."""
    assert 'if (event.key !== "Enter" && event.key !== " ") return;' in handle_keydown


def test_keydown_ignores_events_that_originate_on_a_nested_button(handle_keydown):
    """closest() alone isn't enough. A history row is a div[role=button]
    that CONTAINS a real remove-"x" <button>; Enter/Space pressed while
    focus is on that button also matches
    `.closest('[data-action][role="button"]')` by walking up to the row.
    The browser already activates the real button, so replaying a synthetic
    click on the row too would double-fire -- deleting the race AND opening
    its detail modal off one keypress. The guard must require event.target
    to BE the matched trigger, not merely be contained by it."""
    assert "if (!target || event.target !== target) return;" in handle_keydown


def test_default_is_prevented_so_space_does_not_also_scroll(handle_keydown):
    """Space on a focused div scrolls the page by default. Without the
    preventDefault the row would activate AND jump the viewport."""
    assert "event.preventDefault();" in handle_keydown


def test_both_live_row_types_still_use_the_role_button_shim(hyrox_js):
    """If either surface is ever rewritten to a real <button>, this shim's
    remaining justification shrinks -- and if BOTH are, handleKeydown and
    this file should go. Pins the two current callers so that decision is
    made deliberately rather than discovered later."""
    assert 'class="hx-pb-lb-row' in hyrox_js
    assert 'class="hx-history-row' in hyrox_js
    assert hyrox_js.count('role="button"') >= 2
