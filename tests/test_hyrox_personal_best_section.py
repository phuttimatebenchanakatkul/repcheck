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


# ---------- expand-to-full-report ----------
#
# Each format section shows only its fastest tier by default (rows[0] --
# loadMyBests() already sorts ascending, so this is always the hero). A
# second tier raced adds a tap-to-expand chevron; tapping any time opens
# the exact same race-detail modal (breakdown + AI analysis) the History
# screen already uses, IF that result also matches this device's local
# history -- the server leaderboard `me` field this card is built from has
# no race id, so there is nothing to open otherwise, and taps must say so
# instead of silently doing nothing or opening a fake report.


@pytest.fixture(scope="module")
def handle_click_body(hyrox_js):
    start = hyrox_js.index("handleClick(event) {")
    end = hyrox_js.index("handleKeydown(event) {")
    assert end > start, "handleClick()/handleKeydown() extraction markers moved -- update this test"
    return hyrox_js[start:end]


def test_hero_row_uses_the_fastest_tier(render_my_bests_card):
    """rows[0] is always the fastest because loadMyBests() sorts ascending
    and the per-format .filter() preserves order (see
    test_render_does_not_re_sort_the_already_sorted_entries) -- the hero
    button must be built from that first row, not last or unsorted."""
    assert 'this.pbTimeButtonHtml(rows[0], "pb-time-btn pb-hero-time")' in render_my_bests_card


def test_format_with_only_one_tier_gets_no_expand_affordance(render_my_bests_card):
    """A user who has only raced Singles Open (no Pro yet) must not see a
    chevron that expands into nothing -- that's a dead tap target."""
    assert "const hasMultiple = rows.length > 1;" in render_my_bests_card
    assert re.search(r"hasMultiple\s*\n?\s*\?\s*`data-action=\"toggle-pb-format\"", render_my_bests_card), (
        "the trigger's data-action/role/tabindex must be conditional on hasMultiple, "
        "not always present"
    )
    assert re.search(r"\$\{hasMultiple \? `<span class=\"pb-chevron\">", render_my_bests_card)


def test_section_trigger_is_a_div_not_a_real_button(render_my_bests_card):
    """Regression: the trigger wraps its own nested <button> (the hero
    time). Real <button> elements can't nest inside each other -- it's
    invalid HTML, and the browser silently auto-closes the outer one,
    corrupting every sibling section rendered after it (the Doubles
    section ended up rendered as a sibling of the whole card instead of
    inside it the first time this was tried). The trigger must stay a div
    with role="button", never a real <button>."""
    assert '<div class="pb-section-trigger" ${triggerAttrs}>' in render_my_bests_card
    assert '<button type="button" class="pb-section-trigger"' not in render_my_bests_card


def test_time_click_opens_the_real_race_detail_modal_when_local_match_exists(render_my_bests_card):
    """Reuses showRaceDetail()/renderRaceDetailModal() verbatim -- the same
    modal History already opens -- rather than building a second one."""
    assert 'data-action="show-race-detail" data-id="${localMatch.id}"' in render_my_bests_card


def test_time_click_shows_a_toast_when_no_local_match_exists(render_my_bests_card, handle_click_body):
    """The server's `me` field never has a race id, so a PB set on another
    device (or before local history existed) has nothing to open. The
    button must still exist and respond -- not silently no-op, not fake a
    report -- so it dispatches to a toast instead."""
    assert 'data-action="pb-no-detail"' in render_my_bests_card
    assert 'if (action === "pb-no-detail") return showHistorySaveError(t("hyrox.pb.noDetailAvailable"));' in handle_click_body


def test_no_detail_toast_i18n_key_exists_in_both_locales():
    with open("static/i18n.js", encoding="utf-8") as f:
        i18n_js = f.read()
    assert i18n_js.count('"hyrox.pb.noDetailAvailable":') == 2, (
        "hyrox.pb.noDetailAvailable must have both an English and a Thai entry"
    )


def test_expand_state_is_tracked_per_format_not_globally(hyrox_js):
    """Expanding Singles must not also expand Doubles -- pbExpandedFormats
    is a Set keyed by format id, same pattern as analysisExpanded."""
    assert "this.pbExpandedFormats = new Set();" in hyrox_js
    assert re.search(
        r"togglePbFormat\(formatId\) \{\s*if \(this\.pbExpandedFormats\.has\(formatId\)\) this\.pbExpandedFormats\.delete\(formatId\);\s*else this\.pbExpandedFormats\.add\(formatId\);",
        hyrox_js,
    )


def test_toggle_pb_format_action_is_wired_in_the_click_dispatcher(handle_click_body):
    assert 'if (action === "toggle-pb-format") return this.togglePbFormat(target.dataset.format);' in handle_click_body


def test_div_role_button_triggers_get_keyboard_activation(hyrox_js):
    """A div[role=button] gets no free Enter/Space handling the way a real
    <button> does -- handleKeydown() must replay it as a synthetic click,
    scoped to [data-action][role="button"] so it doesn't double-fire on
    elements (like the nested time button) that are real buttons already."""
    assert 'this.root.addEventListener("keydown", (event) => this.handleKeydown(event));' in hyrox_js
    start = hyrox_js.index("handleKeydown(event) {")
    end = hyrox_js.index("// ---------- AI analysis: short/detail toggle ----------")
    assert end > start, "handleKeydown() extraction markers moved -- update this test"
    body = hyrox_js[start:end]
    assert 'event.target.closest(\'[data-action][role="button"]\')' in body
    assert "target.click();" in body


def test_keydown_ignores_keys_other_than_enter_or_space(hyrox_js):
    """Any other key (Tab, Escape, an arrow key, ...) landing on the
    trigger must fall through untouched -- only Enter/Space replay a
    synthetic click."""
    start = hyrox_js.index("handleKeydown(event) {")
    end = hyrox_js.index("// ---------- AI analysis: short/detail toggle ----------")
    body = hyrox_js[start:end]
    assert 'if (event.key !== "Enter" && event.key !== " ") return;' in body


def test_keydown_ignores_events_that_originate_on_the_nested_button(hyrox_js):
    """closest() alone isn't enough: Enter/Space fired while focus is on the
    nested pb-time-btn (a real <button>, inside the trigger div) would also
    match `.closest('[data-action][role="button"]')` by walking up to the
    outer div. That real button already gets free keyboard activation from
    the browser, so replaying a synthetic click on the outer trigger too
    would double-fire. The guard must require event.target to BE the
    matched trigger, not just be contained in it."""
    start = hyrox_js.index("handleKeydown(event) {")
    end = hyrox_js.index("// ---------- AI analysis: short/detail toggle ----------")
    body = hyrox_js[start:end]
    assert "if (!target || event.target !== target) return;" in body


def test_open_state_drives_both_the_open_class_and_aria_expanded(render_my_bests_card):
    """togglePbFormat() only flips a Set entry and re-renders -- the visual
    open/closed state (and the state AT assistive tech sees) both have to
    be recomputed from that Set on every render, not cached or left stale."""
    assert 'const isOpen = this.pbExpandedFormats.has(formatId);' in render_my_bests_card
    assert '<div class="pb-section ${isOpen ? "is-open" : ""}">' in render_my_bests_card
    assert 'aria-expanded="${isOpen}"' in render_my_bests_card


def test_detail_rows_render_every_tier_with_the_shared_time_button_and_date_fallback(render_my_bests_card):
    """The expanded detail list must reuse pbTimeButtonHtml() for every
    tier (not hand-roll a second row template that could drift from the
    hero row's local-match/no-match wiring), and fall back to an em dash
    -- not a blank string, not a fabricated date -- when that tier has no
    local-history match."""
    assert 'const btn = this.pbTimeButtonHtml(r, "pb-time-btn pb-detail-time");' in render_my_bests_card
    assert re.search(r'const dateHtml = localMatch\s*\n?\s*\?\s*t\("hyrox\.pb\.setPrefix"', render_my_bests_card)
    assert ': "&mdash;";' in render_my_bests_card
