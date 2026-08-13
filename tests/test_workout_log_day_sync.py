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

import threading

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


def test_set_workout_log_day_serializes_genuinely_concurrent_writes_to_different_dates(tmp_path, monkeypatch):
    """Flagged by the performance specialist during /ship's pre-landing
    review: the whole-log blob is read-modify-written per call, so two
    devices/tabs writing DIFFERENT dates at nearly the same instant (a
    realistic scenario now that this function fires on a 400ms debounce
    from every keystroke, not just discrete add/delete taps) could each
    SELECT the same pre-write blob before either commits, and whichever
    commits last silently discards the other's just-written date -- the
    exact resurrection/lost-update bug class this function exists to
    prevent, just moved from client-merge to a server-side race. Fixed
    with BEGIN IMMEDIATE (acquires the write lock before the SELECT, so
    the second writer blocks and re-reads the up-to-date blob instead of
    racing against a stale one).

    Runs the race many times in one test (real OS threads, synchronized to
    start together via a Barrier) rather than once, since a single attempt
    can get lucky and not hit the narrow window even without the fix."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = _make_user("concurrent-dates@example.com")

    ATTEMPTS = 20
    for i in range(ATTEMPTS):
        date_a, date_b = f"2026-01-{(i % 28) + 1:02d}", f"2026-02-{(i % 28) + 1:02d}"
        entry_a = {"id": f"a-{i}", "exercise": "Push", "addedAt": i, "sets": []}
        entry_b = {"id": f"b-{i}", "exercise": "Pull", "addedAt": i, "sets": []}
        barrier = threading.Barrier(2)
        errors = []

        def write(date_iso, entry):
            try:
                barrier.wait(timeout=5)  # both threads call set_workout_log_day at the same instant
                database.set_workout_log_day(user_id, date_iso, [entry])
            except Exception as exc:  # noqa: BLE001 -- surfaced via the assertion below
                errors.append(exc)

        threads = [
            threading.Thread(target=write, args=(date_a, entry_a)),
            threading.Thread(target=write, args=(date_b, entry_b)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert not errors, f"attempt {i}: concurrent writes raised: {errors}"
        stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
        assert stored.get(date_a) == [entry_a], f"attempt {i}: date A's write was lost to a concurrent write on date B: {stored}"
        assert stored.get(date_b) == [entry_b], f"attempt {i}: date B's write was lost to a concurrent write on date A: {stored}"


def test_set_user_data_merge_branch_serializes_concurrent_writes_to_the_same_key(tmp_path, monkeypatch):
    """Flagged by the adversarial review during /ship's pre-landing review:
    set_workout_log_day() and the generic /api/sync/<key> route's
    set_user_data() (see static/account_sync.js -- it fires this route
    synchronously on every localStorage write, in parallel with the
    debounced authoritative endpoint) both read-modify-write the SAME
    stored blob for a MERGE_LOG_KEYS key, so their SELECTs could race each
    other the exact same way two set_workout_log_day() calls could. This
    doesn't close the "a sufficiently stale merge push can still resurrect
    a deletion" gap (that requires the merge to land well AFTER the
    authoritative write, not just concurrently with it -- a union merge
    fundamentally can't distinguish "never existed" from "was removed"),
    but it does close the same-instant race between the two write paths."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = _make_user("cross-path-concurrency@example.com")

    entry = {"id": "e1", "exercise": "Bench Press", "addedAt": 1, "sets": [{"reps": 8}]}
    set_workout_log_day(user_id, "2026-08-13", [entry])

    ATTEMPTS = 20
    for i in range(ATTEMPTS):
        edited = {"id": "e1", "exercise": "Bench Press", "addedAt": 1, "sets": [{"reps": 8 + i}]}
        barrier = threading.Barrier(2)
        errors = []

        def via_authoritative_endpoint():
            try:
                barrier.wait(timeout=5)
                set_workout_log_day(user_id, "2026-08-13", [edited])
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        def via_generic_merge_route():
            try:
                barrier.wait(timeout=5)
                # Mirrors what account_sync.js's wrapped setItem sends: the
                # whole current localStorage value for the key, which in
                # this race is still the PRE-edit blob (the device hasn't
                # seen `edited` yet -- it's what the OTHER thread is about
                # to write).
                database.set_user_data(user_id, database.WORKOUT_LOG_KEY, {"2026-08-13": [entry]})
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [
            threading.Thread(target=via_authoritative_endpoint),
            threading.Thread(target=via_generic_merge_route),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert not errors, f"attempt {i}: concurrent writes raised: {errors}"
        # BEGIN IMMEDIATE serializes the two writers, but doesn't dictate
        # which one commits second -- either final value is a legitimate,
        # non-corrupted outcome (unlike the un-fixed race, which could
        # produce a torn/lost write). What must NEVER happen is an
        # exception, or a row that isn't one of these two exact values.
        stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
        assert stored.get("2026-08-13") in ([edited], [entry]), f"attempt {i}: unexpected/corrupted result: {stored}"


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


def test_log_day_route_rejects_a_non_dict_item_in_entries(client):
    """Cross-confirmed by the testing and security specialists during
    /ship's pre-landing review: a malformed (non-dict) entry stored
    verbatim would crash EVERY device's rendering of this date the next
    time it reads the log back -- workouts.html accesses entry.exercise/
    entry.sets unconditionally, with no defensive isinstance() guard the
    way the read-only admin/report consumers of this data already have."""
    user_id = _make_user("route-non-dict-entry@example.com")
    _login(client, user_id)

    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": ["not-a-dict", 5, None]})
    assert res.status_code == 400
    assert res.get_json()["ok"] is False

    stored = database.get_all_user_data(user_id).get(database.WORKOUT_LOG_KEY, {})
    assert stored.get("2026-08-13") is None, "the malformed payload must not be persisted"


def test_log_day_route_accepts_a_mix_of_valid_dict_entries(client):
    """The non-dict-item check must not be so strict it rejects genuinely
    valid multi-entry payloads."""
    user_id = _make_user("route-valid-multi-entry@example.com")
    _login(client, user_id)

    entries = [
        {"id": "e1", "exercise": "Bench Press", "addedAt": 1, "sets": [{"reps": 8}]},
        {"id": "e2", "exercise": "Squat", "addedAt": 2, "sets": [{"reps": 5}]},
    ]
    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": entries})
    assert res.status_code == 200
    assert res.get_json()["workout_log"]["2026-08-13"] == entries


def test_log_day_route_rejects_an_oversized_entries_list(client):
    """Caps entry count so nothing bloats this user's own user_data row
    (re-serialized on every debounced sync) with an unrealistic payload --
    flagged by the security specialist. 200 is well beyond any real
    workout day (a few dozen exercises, tops)."""
    user_id = _make_user("route-oversized-entries@example.com")
    _login(client, user_id)

    entries = [{"id": f"e{i}", "exercise": "Squat", "addedAt": i, "sets": []} for i in range(201)]
    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": entries})
    assert res.status_code == 400
    assert res.get_json()["ok"] is False


def test_log_day_route_accepts_exactly_the_cap(client):
    """Boundary check: 200 entries must still succeed -- only 201+ is rejected."""
    user_id = _make_user("route-at-cap-entries@example.com")
    _login(client, user_id)

    entries = [{"id": f"e{i}", "exercise": "Squat", "addedAt": i, "sets": []} for i in range(200)]
    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": entries})
    assert res.status_code == 200


def test_log_day_route_round_trips_unicode_and_long_exercise_names_intact(client):
    """Flagged by the testing specialist: no test previously exercised
    non-ASCII or boundary-length text through the JSON/SQLite round trip."""
    user_id = _make_user("route-unicode-entry@example.com")
    _login(client, user_id)

    long_name = "A" * 500
    entries = [
        {"id": "e1", "exercise": "深蹲 🏋️", "addedAt": 1, "sets": [{"reps": 8}]},
        {"id": "e2", "exercise": long_name, "addedAt": 2, "sets": []},
    ]
    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": entries})
    assert res.status_code == 200

    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-13"] == entries


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


def test_log_day_route_delete_via_route_does_not_resurrect(client):
    """The actual regression, exercised through the HTTP route rather than
    calling set_workout_log_day() directly: logging an exercise then
    deleting it (entries: []) through POST /api/workout/log-day must not
    leave it in storage -- this is the exact request workouts.html's
    saveLog() -> pushWorkoutDay() sends on delete. All the other
    set_workout_log_day() tests above cover the database function in
    isolation; this covers the endpoint workouts.html actually calls."""
    user_id = _make_user("route-delete@example.com")
    _login(client, user_id)

    entry = {"id": "entry-1", "exercise": "Row", "addedAt": 1, "sets": [{"reps": 10}]}
    res1 = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": [entry]})
    assert res1.status_code == 200
    assert res1.get_json()["workout_log"]["2026-08-13"] == [entry]

    res2 = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": []})
    assert res2.status_code == 200
    assert res2.get_json()["workout_log"]["2026-08-13"] == []

    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-13"] == [], f"deleted entry resurrected via the route: {stored}"


def test_log_day_route_does_not_touch_other_dates(client):
    """Same guarantee as test_set_workout_log_day_does_not_touch_other_dates
    above, but through the HTTP route -- the route wires straight into
    set_workout_log_day() but that wiring itself (date_iso, entries pulled
    off the right payload keys) is what's actually under test here."""
    user_id = _make_user("route-date-scoping@example.com")
    _login(client, user_id)

    monday = {"id": "mon-1", "exercise": "Push", "addedAt": 1, "sets": []}
    tuesday = {"id": "tue-1", "exercise": "Pull", "addedAt": 2, "sets": []}
    client.post("/api/workout/log-day", json={"date": "2026-08-10", "entries": [monday]})
    client.post("/api/workout/log-day", json={"date": "2026-08-11", "entries": [tuesday]})

    res = client.post("/api/workout/log-day", json={"date": "2026-08-10", "entries": []})
    assert res.status_code == 200

    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-10"] == []
    assert stored["2026-08-11"] == [tuesday], f"an unrelated date was clobbered via the route: {stored}"


def test_log_day_route_response_includes_the_full_log_not_just_the_touched_day(client):
    """set_workout_log_day() returns the whole log "so the caller can resync
    localStorage without a second round trip" (see its docstring) -- the
    route must pass that full dict straight through, not just the date that
    was written."""
    user_id = _make_user("route-full-log@example.com")
    _login(client, user_id)

    monday = {"id": "mon-1", "exercise": "Push", "addedAt": 1, "sets": []}
    client.post("/api/workout/log-day", json={"date": "2026-08-10", "entries": [monday]})

    tuesday = {"id": "tue-1", "exercise": "Pull", "addedAt": 2, "sets": []}
    res = client.post("/api/workout/log-day", json={"date": "2026-08-11", "entries": [tuesday]})

    body = res.get_json()["workout_log"]
    assert body["2026-08-10"] == [monday], f"response dropped an untouched date: {body}"
    assert body["2026-08-11"] == [tuesday]


def test_log_day_route_rejects_missing_entries_key(client):
    """entries missing from the payload entirely (payload.get("entries") is
    None) must be rejected the same as a wrong-typed value -- distinct code
    path from test_log_day_route_rejects_entries_that_are_not_a_list, which
    exercises a present-but-wrong-type value instead."""
    user_id = _make_user("route-missing-entries@example.com")
    _login(client, user_id)

    res = client.post("/api/workout/log-day", json={"date": "2026-08-13"})
    assert res.status_code == 400
    assert res.get_json()["ok"] is False


def test_log_day_route_rejects_missing_date_key(client):
    """date missing from the payload entirely -- payload.get("date") is
    None, str(None or "") is "", which the regex rejects."""
    user_id = _make_user("route-missing-date@example.com")
    _login(client, user_id)

    res = client.post("/api/workout/log-day", json={"entries": []})
    assert res.status_code == 400
    assert res.get_json()["ok"] is False


def test_log_day_route_rejects_an_empty_body(client):
    """No JSON body at all: request.get_json(silent=True) returns None, the
    route falls back to {}, and validation must still reject it rather than
    raising."""
    user_id = _make_user("route-empty-body@example.com")
    _login(client, user_id)

    res = client.post("/api/workout/log-day", content_type="application/json", data="")
    assert res.status_code == 400
    assert res.get_json()["ok"] is False


def test_log_day_route_date_validation_is_shape_only_not_calendar_aware(client):
    """The date regex (^\\d{4}-\\d{2}-\\d{2}$) checks shape, not that the date
    is a real calendar date. Documented here as the current, intentional
    behavior (workouts.html only ever sends real dates it generated itself)
    so a future tightening of the regex is a deliberate choice made against
    a failing test, not an accidental behavior change."""
    user_id = _make_user("route-shape-only-date@example.com")
    _login(client, user_id)

    res = client.post("/api/workout/log-day", json={"date": "2026-13-99", "entries": []})
    assert res.status_code == 200
    assert res.get_json()["workout_log"]["2026-13-99"] == []


def test_log_day_route_repeated_writes_to_same_date_converge_on_the_latest(client):
    """Mirrors pushWorkoutDay()'s retry-once-on-failure and the debounce
    collapsing rapid edits: if two requests for the same date land back to
    back, the last one to land wins outright -- no merging, no
    duplication."""
    user_id = _make_user("route-repeated-writes@example.com")
    _login(client, user_id)

    first = {"id": "entry-1", "exercise": "Squat", "addedAt": 1, "sets": [{"reps": 5}]}
    client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": [first]})

    second = {"id": "entry-1", "exercise": "Squat", "addedAt": 1, "sets": [{"reps": 8, "weightKg": 60}]}
    res = client.post("/api/workout/log-day", json={"date": "2026-08-13", "entries": [second]})

    assert res.get_json()["workout_log"]["2026-08-13"] == [second]
    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-13"] == [second]


def test_set_workout_log_day_does_not_protect_against_a_stale_merge_landing_after(tmp_path, monkeypatch):
    """Documents the boundary of what this fix protects, as a companion to
    test_set_workout_log_day_survives_a_stale_generic_merge_landing_first
    above: set_workout_log_day() only wins when it lands AFTER the generic
    merge, which is the expected order (the merge fires immediately on
    localStorage.setItem, the authoritative call is debounced 400ms later).
    If a stale merge instead lands AFTER the authoritative delete --
    out-of-order network delivery -- it can still resurrect the entry; that
    residual race belongs to the generic merge route itself and is not
    something set_workout_log_day() claims to fix. Pinned here so a change
    that silently narrows (or widens) that boundary gets noticed."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = _make_user("race-reversed-order@example.com")

    entry = {"id": "entry-1", "exercise": "Squat", "addedAt": 1, "sets": [{"reps": 10}]}
    set_workout_log_day(user_id, "2026-08-13", [entry])

    # The authoritative delete lands first this time.
    set_workout_log_day(user_id, "2026-08-13", [])

    # A stale generic merge -- still carrying the pre-delete entry -- lands
    # after it (out-of-order delivery).
    set_user_data(user_id, database.WORKOUT_LOG_KEY, {"2026-08-13": [entry]})

    stored = database.get_all_user_data(user_id)[database.WORKOUT_LOG_KEY]
    assert stored["2026-08-13"] == [entry], (
        "this pins a known, accepted limitation (a merge landing after the "
        "authoritative delete still resurrects the entry); if this now "
        f"fails because it's [] instead, protection improved elsewhere -- "
        f"update this test's expectation to match, got: {stored}"
    )
