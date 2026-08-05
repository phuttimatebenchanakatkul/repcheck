"""Guards against duplicate nutrition log entries from the relog (and other
"add to log") flows.

Every "add to log" call site in templates/nutrition.html (relogEntry() and
two more) does two things after pushing the new entry into the in-page log:
  1. saveLog() -> localStorage.setItem(), which static/account_sync.js wraps
     to fire-and-forget sync the *whole* log blob to the server. The server
     merges rather than overwrites for this key (see database.py's
     MERGE_LOG_KEYS / _merge_by_id), so this can land the new entry too.
  2. await persistLogEntry() -> POST /api/nutrition/log-entry, which calls
     append_nutrition_log_entry() to append that same entry server-side.

Both paths can carry the identical entry (same id, same addedAt) to the
server. Before this fix, append_nutrition_log_entry() did a blind append,
so if the blob-sync merge from (1) had already landed the entry by the time
(2)'s read-modify-write ran, the entry ended up duplicated in the stored
log -- confirmed live against the DB: the same entry id/addedAt appearing
twice in a single date's array (rules out a double-click, which would
produce two different ids).

Regression: relog (and every other add-to-log call site) duplicated the
logged entry server-side.
Found by QA testing the "+ Log again" relog confirmation flow on 2026-08-05.
"""

import database


def test_append_nutrition_log_entry_is_idempotent_by_id(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()

    user_id = database.create_local_user("relog-dedup-tester@example.com", "irrelevant-password", "Relog Dedup Tester")

    entry = {"id": "c0eb7d73-9c2a-409f-93fd-0b89992b8b8d", "food": "Pad Kra Pao Moo Krob", "addedAt": "2026-08-05T12:00:00.000Z"}

    # Simulate the race directly: the generic blob-sync merge (set_user_data,
    # which the wrapped localStorage.setItem() in saveLog() triggers) lands
    # the entry first, exactly as it would if it beat the explicit
    # POST /api/nutrition/log-entry request to the server.
    database.set_user_data(user_id, database.NUTRITION_LOG_KEY, {"2026-08-05": [entry]})

    # The explicit append (persistLogEntry -> append_nutrition_log_entry)
    # for the *same* entry then runs, as it always does regardless of the
    # blob-sync race's outcome.
    day_entries = database.append_nutrition_log_entry(user_id, "2026-08-05", entry)

    assert len(day_entries) == 1, f"entry was duplicated: {day_entries}"

    stored = database.get_all_user_data(user_id)[database.NUTRITION_LOG_KEY]
    assert len(stored["2026-08-05"]) == 1, f"duplicate persisted to storage: {stored}"


def test_append_nutrition_log_entry_still_appends_distinct_entries(tmp_path, monkeypatch):
    """The dedup-by-id fix must not swallow genuinely different entries."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()

    user_id = database.create_local_user("relog-dedup-tester-2@example.com", "irrelevant-password", "Relog Dedup Tester 2")

    first = {"id": "entry-one", "food": "Chicken Salad", "addedAt": "2026-08-05T12:00:00.000Z"}
    second = {"id": "entry-two", "food": "Chicken Salad", "addedAt": "2026-08-05T18:00:00.000Z"}

    database.append_nutrition_log_entry(user_id, "2026-08-05", first)
    day_entries = database.append_nutrition_log_entry(user_id, "2026-08-05", second)

    assert [e["id"] for e in day_entries] == ["entry-one", "entry-two"]
