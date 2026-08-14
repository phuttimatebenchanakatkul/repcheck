"""Guards that a Hyrox race, once recorded, is never silently dropped from
this device's local history no matter how long ago it happened or how many
races have been recorded since.

hyrox.js has no JS test runtime (see tests/test_hyrox_personal_best_section.py's
module docstring for the established convention) -- these are source-level
regex assertions against the real file, same tradeoff.

Context: saveHistory() used to do `this.history.slice(-MAX_HISTORY)` (200)
before writing to localStorage, on every save -- finishing a race, deleting
a race, or caching an AI analysis result. account_sync.js's cross-device
merge is purely additive (a race present on either side is always kept) and
the server itself never caps or ages out hyrox_results rows, so the data was
never lost server-side -- but any device that had accumulated more than 200
local races (or received a fuller history via a cross-device sync merge,
since that hydration write bypassed MAX_HISTORY entirely) would have its
oldest races permanently chopped out of localStorage the very next time it
saved anything, hiding them from renderHistory(), renderPersonalBests(),
getAllPersonalBests()/getPersonalBest(), and findRace() (the race-detail
modal) on that device.
"""

import re

import pytest


@pytest.fixture(scope="module")
def hyrox_js():
    with open("static/hyrox.js", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def save_history_body(hyrox_js):
    start = hyrox_js.index("saveHistory() {")
    end = hyrox_js.index("// ---------- Derived state ----------")
    assert end > start, "saveHistory() extraction markers moved -- update this test"
    return hyrox_js[start:end]


@pytest.fixture(scope="module")
def find_race_body(hyrox_js):
    start = hyrox_js.index("findRace(raceId) {")
    end = hyrox_js.index("hydrateAnalysisFromRecord(race) {")
    assert end > start, "findRace() extraction markers moved -- update this test"
    return hyrox_js[start:end]


@pytest.fixture(scope="module")
def render_history_body(hyrox_js):
    start = hyrox_js.index("renderHistory() {")
    end = hyrox_js.index('document.addEventListener("DOMContentLoaded"')
    assert end > start, "renderHistory() extraction markers moved -- update this test"
    return hyrox_js[start:end]


def test_max_history_cap_does_not_exist(hyrox_js):
    """The count-based eviction constant itself must be gone, not just
    unused -- its continued presence would invite a future re-introduction
    of the trim it used to gate."""
    assert "MAX_HISTORY" not in hyrox_js


def test_save_history_writes_the_full_array_untrimmed(save_history_body):
    """No slice/splice/pop/shift on this.history before it's written to
    localStorage -- the array saved must be the array in memory, unmodified."""
    assert "localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));" in save_history_body
    assert not re.search(r"this\.history\.(slice|splice|pop|shift)\(", save_history_body), (
        "saveHistory() must not trim this.history by any means before persisting it"
    )


def test_history_reading_surfaces_are_not_pre_filtered_by_count(hyrox_js):
    """renderHistory(), getAllPersonalBests(), getPersonalBest(), and
    findRace() all read this.history directly (by design -- see this
    file's docstring on renderMyBestsCard() vs renderPersonalBests()) --
    pin that none of them additionally slice it down before use, which
    would reintroduce a hidden cap even with saveHistory() fixed."""
    for fn_start in (
        "getPersonalBest(category, format, gender, scale) {",
        "getAllPersonalBests() {",
    ):
        start = hyrox_js.index(fn_start)
        end = hyrox_js.index("\n    }\n", start)
        body = hyrox_js[start:end]
        assert not re.search(r"this\.history\.(slice|splice)\(", body), (
            f"{fn_start} must scan the full this.history, not a truncated copy"
        )


def test_find_race_scans_the_full_array(find_race_body):
    """findRace() backs the race-detail modal opened from both the history
    list and the personal-bests card -- it must .find() across the whole
    this.history, not a truncated copy, or an older race's row would open
    to a blank/missing detail view instead of its real splits."""
    assert "this.history.find(" in find_race_body
    assert not re.search(r"this\.history\.(slice|splice|pop|shift)\(", find_race_body), (
        "findRace() must not scan a truncated copy of this.history"
    )


def test_render_history_reads_full_array_and_does_not_truncate(render_history_body):
    """renderHistory() (the saved-times list on the history screen) clones
    this.history via a bare .slice() purely to sort by date without
    mutating the original array in place -- that clone must stay a full,
    unbounded copy. A bounded slice (e.g. slice(-50)) or a splice/pop/shift
    here would silently hide older races from the list even with
    saveHistory() itself fixed."""
    assert "this.history.slice()" in render_history_body
    assert not re.search(r"this\.history\.(splice|pop|shift)\(", render_history_body), (
        "renderHistory() must not trim this.history via splice/pop/shift"
    )
    assert not re.search(r"this\.history\.slice\([^)]+\)", render_history_body), (
        "renderHistory() must not bound its this.history clone with slice arguments "
        "(a bare slice() for sorting is fine; slice(-N) or slice(0, N) is a truncation)"
    )


def test_save_history_catches_quota_errors_instead_of_throwing(save_history_body):
    """Removing the count cap means a long-lived device can eventually hit
    the browser's localStorage quota, which makes setItem throw
    QuotaExceededError synchronously. Every caller of saveHistory()
    (finishRace/removeHistory/the analysis-cache write) does more work
    right after it -- render(), persistHistoryEntry(),
    persistRemoveHistoryEntry() -- so an uncaught throw here would abort
    those too, silently losing a race even harder than the eviction bug
    this file exists to prevent. Must be caught and surfaced, not left to
    propagate."""
    assert re.search(r"try\s*\{\s*localStorage\.setItem\(HISTORY_KEY", save_history_body), (
        "the localStorage write in saveHistory() must be wrapped in try/catch"
    )
    assert 'showHistorySaveError(t("hyrox.history.storageFullError"));' in save_history_body


def test_storage_full_error_i18n_key_exists_in_both_locales():
    with open("static/i18n.js", encoding="utf-8") as f:
        i18n_js = f.read()
    assert i18n_js.count('"hyrox.history.storageFullError":') == 2, (
        "hyrox.history.storageFullError must have both an English and a Thai entry"
    )


def test_pb_time_button_html_scans_the_full_array(hyrox_js):
    """pbTimeButtonHtml() (the Personal Bests card's tap-time-to-open-report
    wiring, and the exact code path the 'set on another device' toast this
    file's TODO entry is about depends on) resolves a server-reported PB to
    a local race record via this.history.filter(...). It must scan the
    full array, not a truncated copy -- a future slice() here would
    reproduce the original eviction bug on this specific surface without
    any of the other tests in this file catching it."""
    start = hyrox_js.index("pbTimeButtonHtml(r, cls) {")
    end = hyrox_js.index("\n    }\n", start)
    body = hyrox_js[start:end]
    assert "this.history.filter(" in body
    assert not re.search(r"this\.history\.(slice|splice|pop|shift)\(", body), (
        "pbTimeButtonHtml() must scan the full this.history, not a truncated copy"
    )
