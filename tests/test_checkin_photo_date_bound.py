"""Bounds check on POST /api/checkin/photo's `date` field.

Before this diff, an unbounded (only shape-validated) date here was a
cosmetic issue at worst -- progress_photos.date only ever drove what the
check-in history showed the user themselves. This diff changes that: it's
now one of the sources database.py's get_activity_dates() reads to
back-fill the streak (see tests/test_streak_activity_dates.py), so an
unbounded date turns "upload a photo" into "fabricate an arbitrary day of
streak history" -- upload the same photo N times with N different forged
dates and the streak's longest-run number goes up by N, with nothing else
in the app able to tell the difference from real activity.

The fix bounds `date` to [account creation date, tomorrow] -- tomorrow
rather than today to give slack for the client's local clock running ahead
of the server's UTC one, same kind of allowance the app already makes for
timezone handling elsewhere (see get_activity_dates()'s tz_offset_minutes).
"""

import io
from datetime import date, timedelta

import database
from app import app as flask_app


def _client(tmp_path, monkeypatch, created_at=None):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = database.create_local_user(
        "checkin-photo-tester@example.com", "irrelevant-password", "Checkin Photo Tester"
    )
    if created_at:
        with database.get_db() as conn:
            conn.execute("UPDATE users SET created_at = ? WHERE id = ?", (created_at, user_id))
    flask_app.config["TESTING"] = True
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client, user_id


def _upload(client, date_iso):
    return client.post(
        "/api/checkin/photo",
        data={
            "angle": "front",
            "date": date_iso,
            "photo": (io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 32), "photo.png"),
        },
    )


def test_todays_date_is_accepted(tmp_path, monkeypatch):
    client, _user_id = _client(tmp_path, monkeypatch, created_at="2020-01-01 00:00:00")

    response = _upload(client, date.today().isoformat())

    assert response.status_code == 200
    assert response.get_json()["ok"] is True


def test_a_date_far_in_the_future_is_rejected(tmp_path, monkeypatch):
    client, _user_id = _client(tmp_path, monkeypatch, created_at="2020-01-01 00:00:00")

    forged = (date.today() + timedelta(days=30)).isoformat()
    response = _upload(client, forged)

    assert response.status_code == 400
    assert response.get_json()["ok"] is False


def test_one_day_ahead_is_still_accepted_for_clock_skew(tmp_path, monkeypatch):
    """The client's local "today" can be a day ahead of the server's UTC
    clock near midnight -- this must not be rejected as a forgery."""
    client, _user_id = _client(tmp_path, monkeypatch, created_at="2020-01-01 00:00:00")

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    response = _upload(client, tomorrow)

    assert response.status_code == 200


def test_a_date_before_the_account_existed_is_rejected(tmp_path, monkeypatch):
    client, _user_id = _client(tmp_path, monkeypatch, created_at="2026-08-01 00:00:00")

    forged = "2020-01-01"  # long before the account was created
    response = _upload(client, forged)

    assert response.status_code == 400
    assert response.get_json()["ok"] is False


def test_the_accounts_own_creation_date_is_accepted(tmp_path, monkeypatch):
    client, _user_id = _client(tmp_path, monkeypatch, created_at="2026-08-01 09:30:00")

    response = _upload(client, "2026-08-01")

    assert response.status_code == 200


def test_malformed_date_is_still_rejected_by_the_existing_shape_check(tmp_path, monkeypatch):
    """Confirms the new bound check didn't quietly replace or bypass the
    original regex-based shape validation."""
    client, _user_id = _client(tmp_path, monkeypatch, created_at="2020-01-01 00:00:00")

    response = _upload(client, "not-a-date")

    assert response.status_code == 400
    assert response.get_json()["ok"] is False
