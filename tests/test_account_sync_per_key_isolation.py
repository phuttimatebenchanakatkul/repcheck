"""Guards that one SYNC_KEYS entry throwing during hydration doesn't starve
every other key's reconciliation for that page load.

static/account_sync.js has no JS test runtime (see
tests/test_hyrox_personal_best_section.py's module docstring for the
established convention) -- these are source-level regex assertions against
the real file, same tradeoff.

Context: the hydration handler (fetch("/api/sync").then(...)) iterates
SYNC_KEYS in a single forEach and calls nativeSetItem() to write merged/
adopted values back to localStorage. Before this fix, the entire per-key
body lived directly inside the forEach callback with no try/catch, and the
whole promise chain ends in a blanket .catch(function () {}) -- so if ANY
key's nativeSetItem() throws (e.g. QuotaExceededError, now reachable for
MERGE_LOG_KEYS entries like Hyrox history since fix/never-evict-race-history
removed their local size cap), the forEach stops at that key: every key
after it in Set-insertion order silently never gets reconciled that page
load, with zero error surfaced anywhere. Not a data-loss bug (nothing gets
deleted), but a silent sync-availability regression directly adjacent to
the history-retention fix that made it newly reachable.
"""

import re


def account_sync_js():
    with open("static/account_sync.js", encoding="utf-8") as f:
        return f.read()


def reconcile_fn_body():
    src = account_sync_js()
    start = src.index("function reconcileOneSyncKey(key) {")
    end = src.index("// Forcing a reload while the user has an open modal")
    assert end > start, "reconcileOneSyncKey() extraction markers moved -- update this test"
    return src[start:end]


def forEach_wrapper_body():
    src = account_sync_js()
    start = src.index("SYNC_KEYS.forEach(function (key) {", src.index("var now = Date.now();"))
    end = src.index("function reconcileOneSyncKey(key) {")
    assert end > start, "SYNC_KEYS.forEach wrapper extraction markers moved -- update this test"
    return src[start:end]


def test_per_key_reconciliation_is_isolated_in_a_try_catch():
    """The forEach callback that drives hydration must call the per-key
    logic through a try/catch, not run it inline -- otherwise one key's
    thrown error aborts iteration of every key after it."""
    wrapper = forEach_wrapper_body()
    assert re.search(r"try\s*\{\s*reconcileOneSyncKey\(key\);\s*\}\s*catch", wrapper), (
        "SYNC_KEYS.forEach must call reconcileOneSyncKey(key) inside a try/catch"
    )


def test_reconcile_one_sync_key_is_a_real_function_not_inlined():
    """Pins the extraction itself: the per-key body must be its own named
    function (reconcileOneSyncKey), not re-inlined into the forEach
    callback where a future edit could silently drop the try/catch around
    it."""
    src = account_sync_js()
    assert "function reconcileOneSyncKey(key) {" in src
    body = reconcile_fn_body()
    # Sanity: the extracted function still contains the real reconciliation
    # logic (not an empty stub left behind by a bad refactor).
    assert "nativeSetItem(key" in body
    assert "pushToServer(key" in body


def test_hyrox_history_still_flows_through_the_isolated_path():
    """The exact key this fix was motivated by (repcheck_hyrox_history_v1,
    one of MERGE_LOG_KEYS) must still be handled by reconcileOneSyncKey --
    this isn't testing a parallel/duplicate code path that could drift
    from the real one."""
    body = reconcile_fn_body()
    assert "MERGE_LOG_KEYS.has(key)" in body
    assert "mergeLog(key, localLog, serverLog)" in body
