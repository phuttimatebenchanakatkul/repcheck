"""Guards the workout log's cross-device sync.

repcheck_workout_log_v2 is in database.py's MERGE_LOG_KEYS, so the generic
POST/PUT /api/sync/<key> route (fired fire-and-forget by every
localStorage.setItem() via static/account_sync.js) merges rather than
overwrites it -- see LOG_MERGE_DATE_KEYED_KEYS's own comment. A merge can
only ever GAIN entries back from an older stored copy, never remove or
change one, so a workout deleted or edited on one device would resurrect
or revert to its old value the next time any device synced.

Bug report (2026-08-13): a workout logged and then deleted on mobile kept
reappearing on PC; workouts added on mobile never showed up on PC at all
(PC kept showing stale data); an edited workout's changes weren't
reflected either. Root cause: unlike the nutrition log, weight log, and
HYROX history -- which each already hit this exact bug and got a
dedicated, authoritative write endpoint (append_nutrition_log_entry /
remove_nutrition_log_entry, set_weight_log_entry, append_hyrox_history_entry
/ remove_hyrox_history_entry) -- the workout log had no such endpoint and
relied entirely on the generic merge-only sync.

Fix: set_workout_log_day() (mirrored below) replaces one date's entire
entry list with exactly what's given, so additions, edits, and deletions
are all correctly represented by a single authoritative write, the same
way set_weight_log_entry() already does for weigh-ins. workouts.html calls
POST /api/workout/log-day (debounced) on every mutation.
"""

import pytest

import app as app_module
import database
from database import create_local_user, set_user_data, set_workout_log_day


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _login(client, user_id):
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


def _make_user(email):
    return create_local_user(email, "irrelevant-password", "Test User")


# ---------- database.set_workout_log_day() ----------


def test_set_workout_log_day_removes_a_previously_stored_entry(tmp_path, monkeypatch):
    """The core regression: deleting the only exercise logged for a date
    must actually remove it from storage, not just fail to re-add it.
    Simulates the exact bug -- an entry already present (as if from an
    earlier sync), then the authoritative "this date now has these
    entries" write with that entry gone."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = _make_user("delete-resurrect@example.com")

    entry = {"id": "entry-1", "exercise": "Bench Press", "addedAt": 1, "sets": [{"reps": 8}]}
    set_workout_log_day(user_id, "2026-08-13", [entry])
    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert len(stored["2026-08-13"]) == 1

    # The delete: client sends the day's entries with that one filtered out.
    updated = set_workout_log_day(user_id, "2026-08-13", [])

    assert updated["2026-08-13"] == []
    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-13"] == [], f"deleted entry resurrected: {stored}"


def test_set_workout_log_day_survives_a_stale_generic_merge_landing_first(tmp_path, monkeypatch):
    """Reproduces the actual production race: account_sync.js's generic
    blob-sync (set_user_data, merge-based) can land in parallel with the
    authoritative day-sync, carrying a stale copy of the log that still has
    the now-deleted entry. If the authoritative write runs AFTER that merge
    (the expected order -- the merge fires immediately on
    localStorage.setItem, the authoritative call is debounced 400ms later),
    the deletion must still win."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = _make_user("race-order@example.com")

    entry = {"id": "entry-1", "exercise": "Squat", "addedAt": 1, "sets": [{"reps": 10}]}
    set_workout_log_day(user_id, "2026-08-13", [entry])

    # The generic merge route lands next, still carrying the stale (pre-delete)
    # blob -- this is what account_sync.js's beacon sends before the client's
    # own in-memory `log` has caught up, or from a second device that hasn't
    # pulled the delete yet.
    set_user_data(user_id, database.WORKOUT_LOG_KEY, {"2026-08-13": [entry]})

    # The authoritative delete lands last (the normal, expected ordering).
    set_workout_log_day(user_id, "2026-08-13", [])

    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-13"] == [], f"stale merge resurrected the deleted entry: {stored}"


def test_set_workout_log_day_reflects_an_edit_not_just_the_original_add(tmp_path, monkeypatch):
    """An edit (same id, changed fields) must overwrite the stored entry,
    not be ignored the way append_nutrition_log_entry's id-based dedup
    would (that dedup exists precisely to skip an entry whose id already
    exists -- correct for "add", wrong for "edit"). set_workout_log_day is
    a full replace, so it must not have that skip-on-existing-id behavior."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = _make_user("edit-propagates@example.com")

    original = {"id": "entry-1", "exercise": "Squat", "addedAt": 1, "sets": [{"reps": ""}]}
    set_workout_log_day(user_id, "2026-08-13", [original])

    edited = {"id": "entry-1", "exercise": "Squat", "addedAt": 1, "sets": [{"reps": 12, "weightKg": 100}]}
    set_workout_log_day(user_id, "2026-08-13", [edited])

    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-13"] == [edited], f"edit was not reflected: {stored}"


def test_set_workout_log_day_does_not_touch_other_dates(tmp_path, monkeypatch):
    """A write scoped to one date must leave every other date's entries
    alone -- this is what makes it safe to call on every debounced edit
    instead of resending the whole log."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = _make_user("date-scoping@example.com")

    monday = {"id": "mon-1", "exercise": "Push", "addedAt": 1, "sets": []}
    tuesday = {"id": "tue-1", "exercise": "Pull", "addedAt": 2, "sets": []}
    set_workout_log_day(user_id, "2026-08-10", [monday])
    set_workout_log_day(user_id, "2026-08-11", [tuesday])

    set_workout_log_day(user_id, "2026-08-10", [])  # delete Monday's only exercise

    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-10"] == []
    assert stored["2026-08-11"] == [tuesday], f"an unrelated date was clobbered: {stored}"


# ---------- POST /api/workout/log-day ----------


def test_log_day_route_requires_login(client):
    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": []})
    assert res.status_code == 401
    assert res.get_json()["ok"] is False


def test_log_day_route_stores_and_returns_the_day(client):
    user_id = _make_user("route-happy-path@example.com")
    _login(client, user_id)

    entry = {"id": "entry-1", "exercise": "Deadlift", "addedAt": 1, "sets": [{"reps": 5}]}
    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": [entry]})

    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["workout_log"]["2026-08-13"] == [entry]

    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-13"] == [entry]


def test_log_day_route_rejects_a_malformed_date(client):
    user_id = _make_user("route-bad-date@example.com")
    _login(client, user_id)

    res = client.post("/api/workout/log-day", json={"date": "not-a-date", "entries": []})
    assert res.status_code == 400
    assert res.get_json()["ok"] is False


def test_log_day_route_rejects_entries_that_are_not_a_list(client):
    user_id = _make_user("route-bad-entries@example.com")
    _login(client, user_id)

    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": {"not": "a list"}})
    assert res.status_code == 400
    assert res.get_json()["ok"] is False


def test_log_day_route_scopes_writes_to_the_logged_in_user_only(client):
    """One user's day-sync must never be able to write into another user's
    workout log."""
    owner_id = _make_user("owner@example.com")
    attacker_id = _make_user("attacker@example.com")

    owner_entry = {"id": "owner-entry", "exercise": "Bench Press", "addedAt": 1, "sets": []}
    set_workout_log_day(owner_id, "2026-08-13", [owner_entry])

    _login(client, attacker_id)
    attacker_entry = {"id": "attacker-entry", "exercise": "Curl", "addedAt": 1, "sets": []}
    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": [attacker_entry]})
    assert res.status_code == 200

    owner_stored = database.get_all_user_data(owner_id)[database.WORKOUT_LOG_KEY]
    assert owner_stored["2026-08-13"] == [owner_entry], "attacker's write leaked into another user's log"
