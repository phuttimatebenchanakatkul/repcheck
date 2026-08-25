"""init_db() must survive several workers running it at the same instant.

gunicorn boots multiple workers and every one of them imports app.py, which
calls init_db() at module scope. The migrations in there used to be
probe-then-ALTER: read PRAGMA table_info, ALTER if the column is absent.
That is check-then-act. On the first boot after a new column is introduced,
two workers can both read "absent" and the loser's ALTER raises
"duplicate column name" -- and a worker that cannot import the app cannot
boot, so gunicorn gives up and the deploy fails.

This is not hypothetical. It is what users.deleted_at did to the v0.4.0.0
deploy: the column landed in the production database, the second worker
crashed on it, Render marked the deploy failed and rolled back to the
previous release. The feature was merged and absent from production at the
same time.

The race only fires on the FIRST boot after a column is added, which is why
it stayed hidden through every earlier migration in this file and then bit
the one that happened to be deployed onto a multi-worker service. That
timing is also why an ordinary "does init_db work" test could never catch
it -- the tests below have to force the losing interleaving explicitly.
"""

import sqlite3
import threading

import pytest

import database


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "repcheck-test.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    return path


# ---------- The helper ----------

def test_reports_who_actually_added_the_column(db_path):
    """The return value is what one-time backfills hang off (see the
    onboarding_completed migration), so it has to mean "I added it", not
    "it exists"."""
    database.init_db()

    with database.get_db() as conn:
        conn.execute("ALTER TABLE users DROP COLUMN deleted_at")

        first = database._add_column_if_missing(conn, "users", "deleted_at", "TEXT")
        second = database._add_column_if_missing(conn, "users", "deleted_at", "TEXT")

    assert first is True
    assert second is False, (
        "the second caller must not claim the add -- a backfill hanging off "
        "this would run twice"
    )


def test_losing_the_race_is_not_an_error(db_path):
    """The exact interleaving that broke the v0.4.0.0 deploy: this caller
    probes and sees the column missing, another worker adds it, then this
    caller's ALTER fires anyway. It must return False, not raise."""
    database.init_db()

    class RacingConnection:
        """sqlite3.Connection.execute is read-only, so the other worker is
        simulated by proxying rather than by patching the method."""

        def __init__(self, conn):
            self._conn = conn

        def execute(self, sql, *args, **kwargs):
            if sql.startswith("ALTER TABLE users ADD COLUMN deleted_at"):
                # The other worker wins the ALTER in the window between our
                # probe and our own.
                self._conn.execute("ALTER TABLE users ADD COLUMN deleted_at TEXT")
            return self._conn.execute(sql, *args, **kwargs)

    with database.get_db() as conn:
        conn.execute("ALTER TABLE users DROP COLUMN deleted_at")

        added = database._add_column_if_missing(
            RacingConnection(conn), "users", "deleted_at", "TEXT"
        )

        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}

    assert added is False, "we did not add it -- the other worker did"
    assert "deleted_at" in columns, "the column must exist either way"


def test_a_real_sql_error_still_raises(db_path):
    """Only the duplicate-column case is swallowed. A genuinely broken
    migration must still fail loudly rather than being silently skipped."""
    database.init_db()

    with database.get_db() as conn:
        with pytest.raises(sqlite3.OperationalError):
            database._add_column_if_missing(conn, "users", "bad_col", "NOT A REAL TYPE(((")


# ---------- init_db() as a whole ----------

def test_init_db_is_safe_to_run_twice(db_path):
    database.init_db()
    database.init_db()  # must not raise

    with database.get_db() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}

    assert "deleted_at" in columns


def test_init_db_survives_concurrent_workers(db_path):
    """The deploy-shaped case: several workers calling init_db() on a fresh
    database at the same moment, the way gunicorn does on boot."""
    errors = []
    barrier = threading.Barrier(4)

    def worker():
        try:
            barrier.wait(timeout=10)
            database.init_db()
        except Exception as exc:  # noqa: BLE001 -- the assertion below reports it
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert errors == [], "concurrent init_db() raised: " + repr(errors)
    with database.get_db() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    assert "deleted_at" in columns


def test_onboarding_backfill_runs_exactly_once(db_path):
    """The backfill marks pre-existing accounts as already onboarded. If it
    ran on every init_db() it would silently re-onboard-complete accounts
    that had deliberately been reset to 0."""
    database.init_db()
    user_id = database.create_local_user("backfill@example.com", "irrelevant-password", "Backfill")
    with database.get_db() as conn:
        conn.execute("UPDATE users SET onboarding_completed = 0 WHERE id = ?", (user_id,))

    database.init_db()

    with database.get_db() as conn:
        value = conn.execute(
            "SELECT onboarding_completed FROM users WHERE id = ?", (user_id,)
        ).fetchone()["onboarding_completed"]

    assert value == 0, "a later init_db() must not re-run the one-time backfill"
