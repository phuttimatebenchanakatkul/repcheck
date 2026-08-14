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
