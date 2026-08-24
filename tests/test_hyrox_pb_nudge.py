"""Guards the one call to action on the personal-bests board.

`renderPbBoard()` is otherwise pure scoreboard: tabs, ranked rows, and a
"top 5 of 12" footnote. The nudge is the single line that tells you what to do
about what you are looking at, and it is the kind of copy that gets dropped
silently in a refactor of the render function -- nothing breaks, the board just
quietly loses its ending.

Two things matter and neither is visible in a diff review:

- it renders on a board that HAS times, not on the empty state, which already
  says the same thing in its own sub-line ("Finish a standard race and your
  fastest times show up here") and would otherwise say it twice;
- the copy comes from i18n, so the Thai locale gets it too.

Source-level regex assertions against the real files, same tradeoff
test_hyrox_keyboard_activation.py already makes -- see CLAUDE.md's testing note.
"""

import pytest

BOARD_START = "renderPbBoard() {"
BOARD_END = "// Four separate global leaderboards"
KEY = "hyrox.pb.beatItHint"


@pytest.fixture(scope="module")
def hyrox_js():
    with open("static/hyrox.js", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def hyrox_css():
    with open("static/hyrox.css", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def i18n_js():
    with open("static/i18n.js", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def render_pb_board(hyrox_js):
    start = hyrox_js.index(BOARD_START)
    end = hyrox_js.index(BOARD_END, start)
    assert end > start, "renderPbBoard() extraction markers moved -- update this test"
    return hyrox_js[start:end]


def test_the_board_ends_with_the_nudge(render_pb_board):
    assert f'<div class="pb-nudge">${{t("{KEY}")}}</div>' in render_pb_board, (
        "the personal-bests board lost its call-to-action line"
    )


def test_the_empty_state_does_not_get_it_too(render_pb_board):
    """The empty branch returns before the nudge is appended -- it already has
    its own sub-line saying the same thing."""
    empty_return = render_pb_board.index("if (!boards.length) {")
    nudge = render_pb_board.index("pb-nudge")
    assert nudge > empty_return, (
        "the nudge moved above the empty-state early return -- an empty board "
        "would then say 'start more races' twice, once as its own sub-line"
    )


def test_it_lands_after_the_rows_not_before_them(render_pb_board):
    """A caption above the times is a header, not a nudge."""
    list_append = render_pb_board.index("bodyEl.appendChild(listEl);")
    nudge = render_pb_board.index("pb-nudge")
    assert nudge > list_append


def test_the_copy_is_translated(i18n_js):
    """Two locales ship (en + th); a hard-coded English string here would be a
    silent regression for Thai users."""
    assert i18n_js.count(f'"{KEY}":') == 2, (
        f"{KEY} is missing from a locale -- both en and th must define it"
    )


def test_the_nudge_has_a_style(hyrox_css):
    """Unstyled it renders as left-aligned body text hanging off the card."""
    assert ".pb-nudge {" in hyrox_css
    rule = hyrox_css[hyrox_css.index(".pb-nudge {") :]
    rule = rule[: rule.index("}")]
    assert "text-align: center" in rule, "the nudge should read as a card footer, centered"
