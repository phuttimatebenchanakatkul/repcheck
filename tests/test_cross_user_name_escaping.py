"""Guards the escaping of display names that came from OTHER accounts.

Account display names are stored exactly as the user typed them --
update_account() strips whitespace and does nothing else, and there is no
HTML sanitization anywhere on the server. The leaderboard and friends
endpoints hand those names to every viewer, and all three screens build
their rows as template-literal strings assigned through innerHTML.

That combination means an unescaped name is not self-inflicted: it runs in
the browser of everyone who opens the global leaderboard, which is the
difference between an annoyance and an account-takeover vector. The escape
calls pinned below are the only thing standing between the two, and they
are one careless "simplify this template" away from vanishing.

Source-level regex assertions against the real files, matching the
tradeoff test_hyrox_personal_best_section.py already makes: hyrox.js and
these templates hold hand-rolled JS with no build step, and the property
worth pinning here is textual (does this interpolation go through the
escaper) rather than behavioural.

Deliberately NOT covered: the self-XSS sinks (your own custom exercise and
food names). Those are real but far lower severity, and closing them
properly means making RepCheckI18n.t() escape its vars by default rather
than sprinkling more call-site escapes. Tracked separately.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_hyrox_leaderboard_escapes_competitor_names():
    src = read("static/hyrox.js")
    assert "${escapeHtml(name)}" in src, (
        "hyrox.js leaderboard rows must escape the competitor name -- it comes "
        "from /api/hyrox/leaderboard, i.e. another account"
    )
    assert not re.search(r'hx-lb-name">\$\{name\}', src), (
        "found a raw ${name} in the hx-lb-name span"
    )


def test_challenges_leaderboard_escapes_competitor_names():
    src = read("templates/challenges.html")
    # All rows (yours included) render through the single lbRow() component,
    # which escapes its `label` before interpolating -- so the guarantee is
    # that row.name only ever reaches the DOM as that escaped label, and
    # never through a second, unescaped interpolation.
    assert "${escapeHtml(label)}" in src, "lbRow() must escape label before interpolating"
    assert "label: row.name" in src, "leaderboard rows must route row.name through lbRow's label"
    assert "${row.name}" not in src, "found a raw ${row.name}"
    # myRank.name isn't displayed at all -- your own pinned row shows a
    # fixed "You" label instead, so there's no raw-name sink to guard here.
    assert "${myRank.name}" not in src, "found a raw ${myRank.name}"


def test_friends_list_escapes_friend_names():
    src = read("templates/friends.html")
    assert "${escapeHtml(f.name)}" in src, "friend rows must escape f.name"
    # The avatar initial is also interpolated into innerHTML, so a name
    # beginning with "<" would inject through that too.
    assert "${escapeHtml(f.name[0].toUpperCase())}" in src, (
        "the avatar initial must be escaped as well"
    )
    assert "<div>${f.name}</div>" not in src, "found a raw ${f.name}"


def test_each_screen_defines_the_escaper_it_uses():
    # Each of these files is a separate script scope with no shared import,
    # so the helper has to exist locally or the call is a ReferenceError
    # that only fires once someone actually opens the screen.
    for rel in ("static/hyrox.js", "templates/challenges.html", "templates/friends.html"):
        assert "function escapeHtml(" in read(rel), f"{rel} calls escapeHtml but never defines it"


def test_escaper_round_trips_through_textcontent():
    # textContent -> innerHTML is the codebase's established escape idiom
    # (workouts.html, nutrition.html). It covers < > &, which is what
    # matters for a text node; these names are never placed in a bare
    # attribute, where quotes would also need handling.
    for rel in ("static/hyrox.js", "templates/challenges.html", "templates/friends.html"):
        src = read(rel)
        block = src[src.index("function escapeHtml("):]
        assert "textContent" in block[:400], f"{rel}'s escapeHtml must round-trip via textContent"
