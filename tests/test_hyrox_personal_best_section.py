"""Guards the Hyrox setup screen's "Your personal bests" card.

hyrox.js is a single hand-rolled ES6 class with no build step and no JS
test runtime wired up for it (unlike templates/workouts.html, which has a
vitest+jsdom extraction harness -- see tests-js/support/loadReviewStep.js).
Source-level regex assertions against the real file are the same tradeoff
test_split_review_step.py already makes for template-embedded JS, applied
here to a plain static file instead.

Two things about this card are worth pinning, and both fail silently if
someone "simplifies" the function later:

Gender isolation. A man must never see a woman's-category PB in this card
and vice versa. getAllPersonalBests() (pre-existing) returns every combo
the user has ever raced under ANY gender -- including a different one, if
they ever switched their leaderboard preference mid-history. Losing the
`r.gender === gender` filter would silently leak the other gender's times
back in.

No manufactured empty state. If the user has a Singles PB but has never
run a Doubles race, the Doubles section must not render at all -- not as
an empty section, not as a placeholder row. A regression here would show
a training-history gap as if it were a real (zero-time) result.
"""

import re

import pytest


@pytest.fixture(scope="module")
def hyrox_js():
    with open("static/hyrox.js", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def render_my_bests_card(hyrox_js):
    start = hyrox_js.index("renderMyBestsCard() {")
    end = hyrox_js.index(
        "// Four separate global leaderboards -- open/pro x singles/doubles --"
    )
    assert end > start, "renderMyBestsCard() extraction markers moved -- update this test"
    return hyrox_js[start:end]


def test_card_does_not_render_without_a_resolved_gender(render_my_bests_card):
    """No gender preference/guess available yet -- nothing to scope to, so
    don't render rather than guessing or showing a mixed list."""
    assert re.search(r"const gender = this\.resolveLeaderboardGender\(\);\s*if \(!gender\) return null;", render_my_bests_card)


def test_card_filters_personal_bests_to_the_users_own_gender(render_my_bests_card):
    """The core requirement: a male user only ever sees men's-category
    PBs here, a female user only women's -- never both, never the wrong one."""
    assert re.search(
        r"this\.getAllPersonalBests\(\)\.filter\(\(r\) => r\.gender === gender\)",
        render_my_bests_card,
    ), "must filter getAllPersonalBests() by the resolved gender, not show every combo ever raced"


def test_card_classifies_results_into_singles_and_doubles_sections(render_my_bests_card):
    assert "FORMAT_IDS.forEach((formatId) => {" in render_my_bests_card
    assert "bests.filter((r) => r.format === formatId)" in render_my_bests_card


def test_empty_format_section_is_skipped_not_shown_empty(render_my_bests_card):
    """A user who has only ever run Singles must not see a blank/placeholder
    Doubles section -- the section should simply not exist in the DOM."""
    assert re.search(r"if \(!rows\.length\) return;", render_my_bests_card)


def test_card_returns_null_when_the_user_has_no_bests_for_their_gender(render_my_bests_card):
    assert re.search(r"if \(!bests\.length\) return null;", render_my_bests_card)


def test_rows_within_a_section_are_not_re_sorted(render_my_bests_card):
    """getAllPersonalBests() already returns results sorted fastest-to-
    slowest; filtering by gender and by format must be simple .filter()
    calls (order-preserving), not anything that could shuffle the ranking."""
    assert "rows.forEach((r) => {" in render_my_bests_card
    assert ".sort(" not in render_my_bests_card, (
        "re-sorting here would be redundant at best and a bug at worst -- "
        "getAllPersonalBests() already sorts ascending by totalSeconds"
    )


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
