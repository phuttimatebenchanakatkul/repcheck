"""Guards the display-name trust boundary on the leaderboards and friend list.

Same bug class as test_nutrition_name_escaping.py and its siblings, but a
different severity. Every other screen in this family renders a value the
CURRENT user authored (a custom exercise, a split label, a lifting goal) --
it only ever executes in that same user's own session, so it's self-XSS.

These three sites are different: they render OTHER users' display names.

  templates/challenges.html -- the reps leaderboard (${row.name},
    ${myRank.name}) shows every entrant, not just you.
  templates/friends.html -- your friend list (${f.name}) shows names your
    friends picked, not names you picked.
  static/hyrox.js -- the Hyrox leaderboard (${name} in the row template)
    is the same shape as challenges.html's.

A user who sets a hostile display name (POST /api/set-name and similar --
see app.py:986, app.py:1051 for the equivalent unsanitized-name pattern on
custom foods/exercises) gets it stored once and then executed in every
OTHER user's browser who views a leaderboard or friends list they're on.
That makes this genuine cross-user stored XSS, not self-XSS -- the
attacker and the victim are different people, and the victim did nothing
except open a page everyone opens.

These tests pin each interpolation site, since the failure is silent: the
leaderboard looks fine until an entrant's name happens to contain a
bracket.
"""

import re

import pytest


@pytest.fixture(scope="module")
def challenges_html():
    with open("templates/challenges.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def friends_html():
    with open("templates/friends.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def hyrox_js():
    with open("static/hyrox.js", encoding="utf-8") as f:
        return f.read()


def test_leaderboard_row_escapes_other_users_names(challenges_html):
    """Every entrant's name, not just the viewer's own, and the board is
    global -- an unescaped name here runs in every viewer's browser.

    The board was rebuilt around a single row component (lbRow), so the
    separate entry-row and pinned-own-row guards this file used to carry
    now collapse into one: your row is that same markup with `is-me`, and
    both feed it through `label`."""
    match = re.search(r'ch-lb-label">(.*?)</div>', challenges_html)
    assert match, "could not find the leaderboard row label element"
    assert match.group(1) == "${escapeHtml(label)}", (
        "the leaderboard row renders a display name unescaped"
    )
    # Pin that it really is the only row template -- a second, unescaped
    # one reintroduces the bug without touching the line above.
    assert challenges_html.count('class="ch-lb-label"') == 1, (
        "more than one leaderboard row template -- each needs its own guard"
    )
    assert re.search(r'label:\s*row\.name', challenges_html), (
        "the list must feed other users' names through lbRow's escaped label"
    )


def test_friend_row_escapes_the_friend_name(friends_html):
    """f.name is the friend's own name, chosen by them, not the viewer."""
    match = re.search(r"fr-friend-avatar\">(.*?)</div>\s*<div>(.*?)</div>", friends_html)
    assert match, "could not find the friend row"
    assert "escapeHtml(f.name" in match.group(1), (
        "the friend avatar initial renders the friend's name unescaped"
    )
    assert match.group(2) == "${escapeHtml(f.name)}", (
        "the friend row renders the friend's display name unescaped"
    )


def test_hyrox_leaderboard_row_escapes_other_users_names(hyrox_js):
    """Same shape as the reps leaderboard: every entrant's row, not just yours."""
    match = re.search(r'hx-lb-name">(.*?)</span>', hyrox_js)
    assert match, "could not find the Hyrox leaderboard name element"
    assert "escapeHtml(name)" in match.group(1), (
        "the Hyrox leaderboard row renders another user's display name "
        "unescaped -- this executes in every viewer's browser"
    )


def test_no_user_name_is_interpolated_raw(challenges_html, friends_html, hyrox_js):
    """Catches a NEW unescaped site in any of the three files."""
    for name, html, raw in [
        ("challenges.html", challenges_html, ["${row.name}", "${myRank.name}"]),
        ("friends.html", friends_html, ["${f.name}", "${f.name[0]"]),
        ("hyrox.js", hyrox_js, ["hx-lb-name\">${name}"]),
    ]:
        found = [token for token in raw if token in html]
        assert not found, (
            f"{name}: user display names interpolated raw into innerHTML: "
            f"{found} -- route each through escapeHtml()"
        )


def test_escape_html_helper_exists_in_each_file(challenges_html, friends_html, hyrox_js):
    """Pins the helper itself so it can't be simplified into a no-op."""
    for name, html in [
        ("challenges.html", challenges_html),
        ("friends.html", friends_html),
        ("hyrox.js", hyrox_js),
    ]:
        match = re.search(
            r"function escapeHtml\(text\)\s*\{(.*?)\n\s*\}", html, re.DOTALL
        )
        assert match, f"{name}: escapeHtml() helper is missing"
        assert "textContent" in match.group(1), (
            f"{name}: escapeHtml must assign the value to textContent -- "
            "that is the step that turns < > & into entities"
        )
