"""Account deletion: the grace period, the purge, and what it leaves behind.

Apple App Store Guideline 5.1.1(v) requires an app that creates accounts to
let you delete them from inside the app. RepCheck implements that as a
scheduled deletion -- users.deleted_at is stamped, the account keeps working
for ACCOUNT_DELETION_GRACE_DAYS, and purge_deleted_accounts() does the
irreversible part afterwards.

The property worth pinning hardest is *completeness*: a purge that misses a
table leaves personal data behind after we told the user (and Apple, in
/privacy) that it was erased. So the coverage below is not "does deletion
work" but "does every user-scoped table actually end up empty", derived from
the live schema rather than a hand-copied list -- a table added to init_db()
later with a user_id column and not wired into _purge_user_rows() has to fail
this file.

The other half is the grace window itself: an account inside it must still be
intact and restorable, because the whole point of the window is that the user
can change their mind.
"""

import datetime

import pytest

import app as app_module
import database
from app import app as flask_app


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    return database


def _make_user(email="deleteme@example.com", name="Delete Me"):
    return database.create_local_user(email, "irrelevant-password", name)


def _fill_every_user_table(user_id, other_user_id):
    """Put one row belonging to user_id into every table that stores per-user
    rows, including the two that only reach the user through a parent row
    (custom_food_servings, and someone else's submission to their challenge)."""
    database.set_user_data(user_id, "workout_log", {"2026-08-01": []})
    with database.get_db() as conn:
        conn.execute(
            "INSERT INTO rate_limits (user_id, feature, window_start, count) VALUES (?, 'analyze', datetime('now'), 1)",
            (user_id,),
        )
        conn.execute(
            "INSERT INTO usage_events (user_id, event, count) VALUES (?, 'page:/', 3)",
            (user_id,),
        )
        # Friendship is two rows, one per direction -- the purge has to catch
        # this user as friend_id, not just as user_id. OR IGNORE because
        # tests that fill both sides of a friendship call this helper twice
        # with the ids swapped, which would re-insert the same pair.
        conn.execute("INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)", (user_id, other_user_id))
        conn.execute("INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)", (other_user_id, user_id))
        cursor = conn.execute(
            "INSERT INTO challenges (creator_id, exercise, duration_seconds) VALUES (?, 'pushups', 25)",
            (user_id,),
        )
        challenge_id = cursor.lastrowid
        conn.execute(
            "INSERT INTO challenge_submissions (challenge_id, user_id, reps, notes) VALUES (?, ?, 20, '')",
            (challenge_id, user_id),
        )
        # Someone else's submission to the leaving user's challenge: the
        # challenge row goes, so this has to go with it or it dangles.
        conn.execute(
            "INSERT INTO challenge_submissions (challenge_id, user_id, reps, notes) VALUES (?, ?, 18, '')",
            (challenge_id, other_user_id),
        )
        cursor = conn.execute(
            """INSERT INTO custom_foods (user_id, name, emoji, calories, protein, fat, carbs)
               VALUES (?, 'Test Food', '🍎', 100, 1, 2, 3)""",
            (user_id,),
        )
        conn.execute(
            "INSERT INTO custom_food_servings (custom_food_id, label, grams) VALUES (?, 'bowl', 250)",
            (cursor.lastrowid,),
        )
        conn.execute("INSERT INTO custom_exercises (user_id, name) VALUES (?, 'Test Lift')", (user_id,))
        conn.execute(
            "INSERT INTO progress_photos (user_id, date, angle, filename) VALUES (?, '2026-08-01', 'front', 'p1.jpg')",
            (user_id,),
        )
        conn.execute(
            "INSERT INTO hyrox_results (user_id, gender, category, format, total_seconds) VALUES (?, 'male', 'open', 'full', 4200)",
            (user_id,),
        )
        conn.execute(
            """INSERT INTO analyze_results (user_id, exercise_label, feedback_text, video_filename)
               VALUES (?, 'Bench Press', 'good depth', 'v1.mp4')""",
            (user_id,),
        )
    return challenge_id


def _user_scoped_tables():
    """Every table in the live schema with a column pointing at users.id, read
    back out of SQLite rather than hardcoded, so a table added later is
    covered automatically."""
    with database.get_db() as conn:
        tables = [
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            if not row["name"].startswith("sqlite_")
        ]
        found = []
        for table in tables:
            if table == "users":
                continue
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(" + table + ")")}
            for column in ("user_id", "creator_id", "friend_id"):
                if column in columns:
                    found.append((table, column))
                    break
    return found


def _backdate_deletion(user_id, days):
    # UTC, matching what SQLite's datetime('now') writes into deleted_at --
    # backdating in local time would make these tests pass or fail by the
    # machine's timezone offset rather than by the code under test.
    now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    stamp = (now_utc - datetime.timedelta(days=days)).isoformat(sep=" ", timespec="seconds")
    with database.get_db() as conn:
        conn.execute("UPDATE users SET deleted_at = ? WHERE id = ?", (stamp, user_id))


# ---------- The grace period ----------

def test_scheduling_does_not_delete_anything_yet(db):
    user_id = _make_user()
    other_id = _make_user("friend@example.com", "A Friend")
    _fill_every_user_table(user_id, other_id)

    database.schedule_account_deletion(user_id)

    user = database.get_user_by_id(user_id)
    assert user is not None, "the account must survive the grace period"
    assert user["deleted_at"], "scheduling must stamp deleted_at"
    assert database.get_all_user_data(user_id), "their data must survive the grace period"


def test_scheduling_twice_does_not_push_the_purge_date_back(db):
    user_id = _make_user()
    first = database.schedule_account_deletion(user_id)
    _backdate_deletion(user_id, 20)
    backdated = database.get_user_by_id(user_id)["deleted_at"]

    again = database.schedule_account_deletion(user_id)

    assert first is not None
    assert again == backdated, (
        "re-asking must be a no-op -- otherwise an account could be held open "
        "forever by clicking delete once a month"
    )


def test_cancel_restores_the_account(db):
    user_id = _make_user()
    database.schedule_account_deletion(user_id)

    database.cancel_account_deletion(user_id)

    assert database.get_user_by_id(user_id)["deleted_at"] is None


def test_purge_leaves_accounts_inside_the_window_alone(db):
    user_id = _make_user()
    database.schedule_account_deletion(user_id)
    _backdate_deletion(user_id, database.ACCOUNT_DELETION_GRACE_DAYS - 1)

    database.purge_deleted_accounts()

    assert database.get_user_by_id(user_id) is not None, (
        "one day short of the window is still inside the window"
    )


def test_purge_cutoff_is_computed_in_utc(db):
    """deleted_at is written by SQLite's datetime('now'), which is UTC. A
    cutoff built from Python's local datetime.now() instead would fire early
    by the machine's UTC offset -- three hours short of the window is inside
    it, but a local-time cutoff on UTC+7 would purge it anyway.

    Only bites on a machine whose offset is non-zero, which is the machine
    this app is developed and used on. On a UTC host this test still passes
    with the bug present; it is a guard, not a proof."""
    user_id = _make_user()
    database.schedule_account_deletion(user_id)
    now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    stamp = (
        now_utc
        - datetime.timedelta(days=database.ACCOUNT_DELETION_GRACE_DAYS)
        + datetime.timedelta(hours=3)
    ).isoformat(sep=" ", timespec="seconds")
    with database.get_db() as conn:
        conn.execute("UPDATE users SET deleted_at = ? WHERE id = ?", (stamp, user_id))

    database.purge_deleted_accounts()

    assert database.get_user_by_id(user_id) is not None, (
        "three hours inside the window is inside the window, whatever the "
        "host machine's timezone is"
    )


def test_purge_ignores_accounts_that_never_asked(db):
    user_id = _make_user()

    database.purge_deleted_accounts()

    assert database.get_user_by_id(user_id) is not None


def test_due_date_is_the_grace_period_after_the_request(db):
    due = database.account_deletion_due_at("2026-08-01 12:00:00")
    expected = datetime.date(2026, 8, 1) + datetime.timedelta(days=database.ACCOUNT_DELETION_GRACE_DAYS)

    assert due == expected.isoformat()
    assert database.account_deletion_due_at(None) is None


# ---------- The purge ----------

def test_purge_empties_every_user_scoped_table(db):
    user_id = _make_user()
    other_id = _make_user("friend@example.com", "A Friend")
    _fill_every_user_table(user_id, other_id)
    database.schedule_account_deletion(user_id)
    _backdate_deletion(user_id, database.ACCOUNT_DELETION_GRACE_DAYS + 1)

    database.purge_deleted_accounts()

    assert database.get_user_by_id(user_id) is None
    leftovers = []
    with database.get_db() as conn:
        for table, column in _user_scoped_tables():
            count = conn.execute(
                "SELECT COUNT(*) AS n FROM " + table + " WHERE " + column + " = ?", (user_id,)
            ).fetchone()["n"]
            if count:
                leftovers.append(table + "." + column)
        # custom_food_servings reaches the user only through custom_foods, so
        # it has no user column of its own for the loop above to check.
        orphan_servings = conn.execute("SELECT COUNT(*) AS n FROM custom_food_servings").fetchone()["n"]

    assert leftovers == [], "purge left personal data behind in: " + repr(leftovers)
    assert orphan_servings == 0, "custom food servings must go with their parent food"


def test_purge_returns_the_files_the_caller_must_unlink(db):
    user_id = _make_user()
    other_id = _make_user("friend@example.com", "A Friend")
    _fill_every_user_table(user_id, other_id)
    database.schedule_account_deletion(user_id)
    _backdate_deletion(user_id, database.ACCOUNT_DELETION_GRACE_DAYS + 1)

    files = database.purge_deleted_accounts()

    assert files["photos"] == ["p1.jpg"], "progress photos live on disk and must be reported for unlinking"
    assert files["videos"] == ["v1.mp4"], "saved analysis clips live on disk too"


def test_purge_does_not_touch_other_users(db):
    user_id = _make_user()
    other_id = _make_user("keeper@example.com", "Keeper")
    _fill_every_user_table(user_id, other_id)
    _fill_every_user_table(other_id, user_id)
    database.schedule_account_deletion(user_id)
    _backdate_deletion(user_id, database.ACCOUNT_DELETION_GRACE_DAYS + 1)

    database.purge_deleted_accounts()

    assert database.get_user_by_id(other_id) is not None
    assert database.get_all_user_data(other_id), "the other account's data must be untouched"
    with database.get_db() as conn:
        own_challenge = conn.execute(
            "SELECT COUNT(*) AS n FROM challenges WHERE creator_id = ?", (other_id,)
        ).fetchone()["n"]

    assert own_challenge == 1, "their own challenge must outlive the other account's purge"


# ---------- The routes ----------

def _client(user_id):
    flask_app.config["TESTING"] = True
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client


def test_delete_route_requires_a_session(db):
    flask_app.config["TESTING"] = True

    assert flask_app.test_client().delete("/api/account").status_code == 401


def test_restore_route_requires_a_session(db):
    flask_app.config["TESTING"] = True

    assert flask_app.test_client().post("/api/account/restore").status_code == 401


def test_delete_route_schedules_and_reports_the_due_date(db):
    user_id = _make_user()

    payload = _client(user_id).delete("/api/account").get_json()

    assert payload["ok"] is True
    assert payload["grace_days"] == database.ACCOUNT_DELETION_GRACE_DAYS
    assert payload["due_at"] == database.account_deletion_due_at(payload["deleted_at"])
    assert database.get_user_by_id(user_id)["deleted_at"], "the route must actually stamp the row"


def test_restore_route_clears_the_schedule(db):
    user_id = _make_user()
    client = _client(user_id)
    client.delete("/api/account")

    assert client.post("/api/account/restore").get_json()["ok"] is True
    assert database.get_user_by_id(user_id)["deleted_at"] is None


def test_run_deletion_purge_unlinks_the_files_on_disk(db, tmp_path, monkeypatch):
    user_id = _make_user()
    other_id = _make_user("friend@example.com", "A Friend")
    _fill_every_user_table(user_id, other_id)
    database.schedule_account_deletion(user_id)
    _backdate_deletion(user_id, database.ACCOUNT_DELETION_GRACE_DAYS + 1)
    photos_dir = tmp_path / "photos"
    videos_dir = tmp_path / "videos"
    photos_dir.mkdir()
    videos_dir.mkdir()
    (photos_dir / "p1.jpg").write_bytes(b"jpeg")
    (videos_dir / "v1.mp4").write_bytes(b"mp4")
    monkeypatch.setattr(app_module, "PROGRESS_PHOTOS_DIR", photos_dir)
    monkeypatch.setattr(app_module, "ANALYZE_VIDEOS_DIR", videos_dir)

    app_module.run_deletion_purge()

    assert not (photos_dir / "p1.jpg").exists(), "a purged account's body photos must leave the disk"
    assert not (videos_dir / "v1.mp4").exists()


def test_run_deletion_purge_survives_a_missing_file(db, tmp_path, monkeypatch):
    """The row is already gone by the time we unlink, so a file that vanished
    underneath us must not strand the rest of the sweep."""
    user_id = _make_user()
    other_id = _make_user("friend@example.com", "A Friend")
    _fill_every_user_table(user_id, other_id)
    database.schedule_account_deletion(user_id)
    _backdate_deletion(user_id, database.ACCOUNT_DELETION_GRACE_DAYS + 1)
    monkeypatch.setattr(app_module, "PROGRESS_PHOTOS_DIR", tmp_path / "nope")
    monkeypatch.setattr(app_module, "ANALYZE_VIDEOS_DIR", tmp_path / "also-nope")

    app_module.run_deletion_purge()  # must not raise

    assert database.get_user_by_id(user_id) is None
