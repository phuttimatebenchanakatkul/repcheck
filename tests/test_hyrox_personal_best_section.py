"""Guards the Hyrox setup screen's "Your personal bests" card.

hyrox.js is a single hand-rolled ES6 class with no build step and no JS
test runtime wired up for it (unlike templates/workouts.html, which has a
vitest+jsdom extraction harness -- see tests-js/support/loadReviewStep.js).
Source-level regex assertions against the real file are the same tradeoff
test_split_review_step.py already makes for template-embedded JS, applied
here to a plain static file instead.

Three things about this card are worth pinning, and all three fail silently
if someone "simplifies" the function later:

Server-sourced, not local-only. The card originally read straight from
`history` (this browser's local race log via getAllPersonalBests()) --
shipped, then immediately reported broken in production: a real user with
a real #1 leaderboard rank saw no card at all, because their browser's
local history didn't have that race (recorded elsewhere, or before this
feature existed). The fix sources from loadMyBests(), which hits the same
/api/hyrox/leaderboard endpoint the leaderboard card itself already uses --
its `me` field is server-authoritative, so the two cards can never
disagree about what "your best" is. Regression test below pins that the
card no longer reads getAllPersonalBests()/history for its DATA (a
best-effort local history lookup for the cosmetic date line is fine and
expected -- see test_date_lookup_is_best_effort_only_not_authoritative).

Gender isolation. A man must never see a woman's-category PB in this card
and vice versa. loadMyBests() only ever requests the resolved gender's 4
combos from the server -- there's no cross-gender data to leak because it
was never fetched.

No manufactured empty state. If the user has a Singles PB but has never
run a Doubles race, the Doubles section must not render at all -- not as
an empty section, not as a placeholder row.
"""

import re

import pytest


@pytest.fixture(scope="module")
def hyrox_js():
    with open("static/hyrox.js", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def load_my_bests(hyrox_js):
    start = hyrox_js.index("async loadMyBests() {")
    end = hyrox_js.index("// ---------- Race flow ----------")
    assert end > start, "loadMyBests() extraction markers moved -- update this test"
    return hyrox_js[start:end]


@pytest.fixture(scope="module")
def render_my_bests_card(hyrox_js):
    start = hyrox_js.index("renderMyBestsCard() {")
    end = hyrox_js.index(
        "// Four separate global leaderboards -- open/pro x singles/doubles --"
    )
    assert end > start, "renderMyBestsCard() extraction markers moved -- update this test"
    return hyrox_js[start:end]


# ---------- server-sourced, not local-only (the regression) ----------


def test_loader_fetches_from_the_leaderboard_endpoint_not_local_history(load_my_bests):
    """This is the actual bug: hitting the server (same endpoint the
    leaderboard already uses) instead of only ever reading this browser's
    local race log, so a PB recorded elsewhere still shows up here."""
    assert "fetch(`/api/hyrox/leaderboard?gender=" in load_my_bests
    assert "data.me" in load_my_bests, "must read the server's per-combo `me` field (this user's best in that exact combo)"


def test_loader_queries_all_four_category_format_combos(load_my_bests):
    """Singles/Doubles x Open/Pro -- the card can't show a Pro Singles PB
    if the loader never asked the server about Pro Singles."""
    for category, fmt in [("open", "singles"), ("pro", "singles"), ("open", "doubles"), ("pro", "doubles")]:
        assert re.search(
            r'category:\s*"%s",\s*format:\s*"%s"' % (category, fmt), load_my_bests
        ), f"missing the {category}/{fmt} combo"


def test_loader_skips_combos_the_user_has_never_raced(load_my_bests):
    assert re.search(r"if \(!data\.ok \|\| !data\.me\) return null;", load_my_bests)


def test_card_does_not_read_get_all_personal_bests_for_its_data(render_my_bests_card):
    """getAllPersonalBests() is local-history-only -- using it here is
    exactly the bug that shipped and got reported. A best-effort local
    lookup for the cosmetic date (see below) is fine; treating it as the
    source of the PB list/times themselves is not."""
    assert "this.getAllPersonalBests()" not in render_my_bests_card


def test_date_lookup_is_best_effort_only_not_authoritative(render_my_bests_card):
    """The server's `me` field has no date. A matching local-history entry
    (same device, common case) may supply one for display; the PB's
    existence and time must never depend on finding that match."""
    assert "this.history.find(" in render_my_bests_card
    assert re.search(r"const dateHtml = localMatch\s*\?", render_my_bests_card), (
        "the date line must be optional (empty string when no local match), "
        "not required for the row to render"
    )


# ---------- gender isolation ----------


def test_card_does_not_render_without_a_resolved_gender(render_my_bests_card):
    """No gender preference/guess available yet -- nothing to scope to, so
    don't render rather than guessing or showing a mixed list."""
    assert re.search(r"const gender = this\.resolveLeaderboardGender\(\);\s*if \(!gender\) return null;", render_my_bests_card)


def test_loader_scopes_every_request_to_the_resolved_gender(load_my_bests):
    """Isolation happens by construction here: the fetch URL is built from
    the resolved gender, so there is no cross-gender data to accidentally
    leak -- unlike a client-side filter, which can silently be deleted."""
    assert re.search(r"const gender = this\.resolveLeaderboardGender\(\);\s*if \(!gender\) return;", load_my_bests)
    assert "fetch(`/api/hyrox/leaderboard?gender=${gender}&category=${category}&format=${format}`)" in load_my_bests


def test_cache_is_invalidated_on_gender_mismatch(render_my_bests_card):
    """Switching Men<->Women must trigger a fresh fetch for the new
    gender, not reuse a stale cache scoped to the old one."""
    assert re.search(r"if \(!this\.myBestsCache \|\| this\.myBestsCache\.gender !== gender\) \{", render_my_bests_card)


# ---------- classification and ordering ----------


def test_card_classifies_results_into_singles_and_doubles_sections(render_my_bests_card):
    assert "FORMAT_IDS.forEach((formatId) => {" in render_my_bests_card
    assert "bests.filter((r) => r.format === formatId)" in render_my_bests_card


def test_empty_format_section_is_skipped_not_shown_empty(render_my_bests_card):
    """A user who has only ever run Singles must not see a blank/placeholder
    Doubles section -- the section should simply not exist in the DOM."""
    assert re.search(r"if \(!rows\.length\) return;", render_my_bests_card)


def test_card_returns_null_when_the_user_has_no_bests_for_their_gender(render_my_bests_card):
    assert re.search(r"if \(!bests\.length\) return null;", render_my_bests_card)


def test_loader_sorts_fastest_to_slowest(load_my_bests):
    assert ".sort((a, b) => a.totalSeconds - b.totalSeconds)" in load_my_bests


def test_render_does_not_re_sort_the_already_sorted_entries(render_my_bests_card):
    """loadMyBests() already returns entries sorted ascending; the render
    function's own .filter() calls by format must be order-preserving, not
    followed by a second, potentially conflicting sort."""
    assert ".sort(" not in render_my_bests_card


# ---------- wiring ----------


def test_setup_screen_renders_the_card_after_the_leaderboard(hyrox_js):
    start = hyrox_js.index("renderSetup() {")
    end = hyrox_js.index("// ---------- Race setup page ----------", start)
    setup_body = hyrox_js[start:end]
    leaderboard_pos = setup_body.index("this.renderLeaderboardCard(false)")
    my_bests_pos = setup_body.index("this.renderMyBestsCard()")
    assert my_bests_pos > leaderboard_pos, "the personal-bests card should sit under the leaderboard, not above it"
    assert re.search(r"const myBestsCard = this\.renderMyBestsCard\(\);\s*if \(myBestsCard\) wrap\.appendChild\(myBestsCard\);", setup_body)


def test_card_title_i18n_key_exists_in_both_locales():
    with open("static/i18n.js", encoding="utf-8") as f:
        i18n_js = f.read()
    assert i18n_js.count('"hyrox.pb.myBestsTitle":') == 2, (
        "hyrox.pb.myBestsTitle must have both an English and a Thai entry"
    )
