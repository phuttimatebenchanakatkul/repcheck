"""Every piece of a user's data lives in SQLite, not only in their browser.

RepCheck's app data is written by the client into localStorage and mirrored
into the `user_data` table by static/account_sync.js + /api/sync (see
database.py's module docstring). That mirroring is ALLOWLIST-driven, which
means the failure mode is silent: a new localStorage key that nobody
remembers to add to both allowlists still works perfectly on the device that
wrote it, and is simply missing on every other device -- and gone for good
when that browser's storage is cleared. Four keys had already drifted that
way (exercise favorites, the HYROX leaderboard gender and facility lane, and
the per-analysis chat threads).

So these tests assert the property directly rather than the four fixes:
  * the two allowlists agree with each other, and
  * every repcheck_* key the client code touches is either synced or on the
    short, explicitly-justified list of things that are NOT account data.

Adding a genuinely per-device key later is fine -- it just has to be named
in NOT_ACCOUNT_DATA below, which is the point: the decision becomes explicit
instead of accidental.
"""

import re
from pathlib import Path

import pytest

import app as app_module
import database

REPO = Path(__file__).resolve().parent.parent
ACCOUNT_SYNC_JS = (REPO / "static" / "account_sync.js").read_text(encoding="utf-8")


def _js_sync_keys():
    """The SYNC_KEYS set literal out of static/account_sync.js."""
    block = re.search(r"var SYNC_KEYS = new Set\(\[(.*?)\]\);", ACCOUNT_SYNC_JS, re.S)
    assert block, "SYNC_KEYS literal not found in static/account_sync.js"
    return set(re.findall(r'"([^"]+)"', block.group(1)))


# Keys that are deliberately NOT account data, with the reason each one is
# exempt. Anything not listed here must be synced.
NOT_ACCOUNT_DATA = {
    # In-progress state for the one-device onboarding walkthrough, cleared
    # when it finishes. Syncing it would resume a half-finished tour on a
    # second device mid-step.
    "repcheck_pending_tour": "transient onboarding tour progress",
    "repcheck_tour_step": "transient onboarding tour progress",
    # sessionStorage guard that stops account_sync's own hydration reload
    # from looping. Not user data at all.
    "repcheck_hydrated_reload": "sync bookkeeping",
}


def test_server_and_client_allowlists_match():
    """app.py and account_sync.js each carry their own copy of the list; a
    key in only one is either rejected on write (client-only) or never
    pushed (server-only), both of which lose data silently."""
    assert _js_sync_keys() == app_module.SYNCED_DATA_KEYS


def test_every_client_storage_key_is_synced_or_justified():
    key_pattern = re.compile(r'["\'](repcheck_[a-zA-Z0-9_]+)["\']')
    found = {}
    for path in list((REPO / "static").rglob("*.js")) + list((REPO / "templates").rglob("*.html")):
        for key in key_pattern.findall(path.read_text(encoding="utf-8")):
            found.setdefault(key, set()).add(path.relative_to(REPO).as_posix())

    stranded = {
        key: sorted(where)
        for key, where in found.items()
        if key not in app_module.SYNCED_DATA_KEYS
        and key not in NOT_ACCOUNT_DATA
        # The chat threads are one key per analysis, so they're matched by
        # pattern; the literal in the source is the bare prefix.
        and not database.is_analyze_chat_key(key + "1")
    }
    assert not stranded, (
        "localStorage key(s) with no server-side copy -- add them to "
        "SYNCED_DATA_KEYS (app.py) and SYNC_KEYS (account_sync.js), or to "
        f"NOT_ACCOUNT_DATA in this test with a reason: {stranded}"
    )


@pytest.mark.parametrize("key", [
    "repcheck_exercise_favorites_v1",
    "repcheck_hyrox_leaderboard_gender_v1",
    "repcheck_hyrox_facility_lane_v1",
    "repcheck_analyze_chat_v1_42",
])
def test_sync_route_accepts_the_previously_stranded_keys(key):
    assert app_module.is_synced_data_key(key)


@pytest.mark.parametrize("key", [
    "repcheck_not_a_real_key",
    # The chat-key pattern is digits-only on purpose: a wildcard suffix
    # would turn /api/sync into an arbitrary per-user scratch store.
    "repcheck_analyze_chat_v1_../../etc",
    "repcheck_analyze_chat_v1_abc",
    "repcheck_analyze_chat_v1_",
])
def test_sync_route_still_rejects_unknown_keys(key):
    assert not app_module.is_synced_data_key(key)


def test_analyze_chat_thread_is_stored_and_never_truncated(tmp_path, monkeypatch):
    """A chat thread round-trips through SQLite, and a device pushing an
    older copy of the same thread can't shorten it -- the history array is
    append-only client-side, so the longer transcript is always a superset."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = database.create_local_user("chat-sync@example.com", "irrelevant-password", "Chat Sync Tester")

    key = "repcheck_analyze_chat_v1_7"
    full = {
        "createdAtMs": 1_700_000_000_000,
        "history": [
            {"role": "user", "text": "Why is my squat depth flagged?"},
            {"role": "assistant", "text": "Your hips stop above parallel."},
        ],
    }
    database.set_user_data(user_id, key, full)
    assert database.get_all_user_data(user_id)[key] == full

    # A tab that still holds the one-turn version of this thread re-pushes it.
    stale = {"createdAtMs": 1_700_000_000_000, "history": full["history"][:1]}
    database.set_user_data(user_id, key, stale)
    assert database.get_all_user_data(user_id)[key]["history"] == full["history"]

    # A genuinely newer turn still lands.
    extended = {
        "createdAtMs": 1_700_000_000_000,
        "history": full["history"] + [{"role": "user", "text": "How do I fix it?"}],
    }
    database.set_user_data(user_id, key, extended)
    assert database.get_all_user_data(user_id)[key]["history"] == extended["history"]


def test_deleting_a_chat_thread_clears_it_from_sqlite(tmp_path, monkeypatch):
    """analyze_chat_widget.js prunes threads past their retention window via
    localStorage.removeItem, which account_sync wraps into a DELETE -- the
    server copy has to go too, or pruning just re-hydrates from the server."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = database.create_local_user("chat-prune@example.com", "irrelevant-password", "Chat Prune Tester")

    key = "repcheck_analyze_chat_v1_9"
    database.set_user_data(user_id, key, {"createdAtMs": 1, "history": [{"role": "user", "text": "hi"}]})
    database.delete_user_data(user_id, key)
    assert key not in database.get_all_user_data(user_id)
