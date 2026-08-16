"""Route-level coverage for GET /api/activity/dates (app.py).

database.get_activity_dates() itself -- the query, the timezone shift, the
per-user scoping -- is pinned in tests/test_streak_activity_dates.py. This
file is about the thin route wrapped around it, none of which that other
file touches: is a logged-out caller turned away, does a logged-in caller
get the {"ok": True, "dates": {...}} shape static/streak.js's
seedFromServer() actually parses, and does the tz_offset_minutes query
param really make it from the URL through to the query (as opposed to,
say, being read from the wrong place and silently always defaulting to 0)."""

import app as app_module
import database
from app import app as flask_app


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = database.create_local_user(
        "streak-route@example.com", "irrelevant-password", "Streak Route Tester"
    )
    flask_app.config["TESTING"] = True
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client, user_id


def _add_challenge_attempt(user_id, created_at, challenge_id=1):
    with database.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO challenges (id, creator_id, exercise, duration_seconds) VALUES (?, ?, 'pushups', 25)",
            (challenge_id, user_id),
        )
        conn.execute(
            "INSERT INTO challenge_submissions (challenge_id, user_id, reps, notes, created_at) VALUES (?, ?, 20, '', ?)",
            (challenge_id, user_id, created_at),
        )


def test_requires_login(tmp_path, monkeypatch):
    """seedFromServer() only ever calls this when window.REPCHECK_LOGGED_IN
    is true, but the route itself is the actual security boundary -- a
    logged-out request (or one with a stale/forged session) must not be
    able to pull another account's activity by guessing a user id, and
    there IS no user id in this request to guess: it must come from the
    session, not a request param, which this test also incidentally
    pins."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    flask_app.config["TESTING"] = True
    client = flask_app.test_client()

    response = client.get("/api/activity/dates")

    assert response.status_code == 401
    data = response.get_json()
    assert data["ok"] is False


def test_returns_this_users_dates_in_the_shape_streakjs_expects(tmp_path, monkeypatch):
    """static/streak.js's seedFromServer() does
    `if (!data || !data.ok || !isPlainObject(data.dates)) return false;`
    then iterates Object.keys(data.dates) -- so the response has to be
    exactly {"ok": true, "dates": {day: [action, ...]}}, not e.g. a bare
    list or the dates nested one level deeper."""
    client, user_id = _client(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-15 09:00:00")

    response = client.get("/api/activity/dates")

    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["dates"] == {"2026-08-15": ["challenge"]}


def test_with_no_activity_returns_an_empty_dict_not_an_error(tmp_path, monkeypatch):
    client, _user_id = _client(tmp_path, monkeypatch)

    response = client.get("/api/activity/dates")

    assert response.status_code == 200
    assert response.get_json() == {"ok": True, "dates": {}}


def test_tz_offset_query_param_reaches_the_query(tmp_path, monkeypatch):
    """The one thing this route adds beyond calling the database function
    directly: reading tz_offset_minutes off request.args. Bangkok is
    UTC+7 (+420): an attempt at 21:00 local on the 15th is stored as
    14:00 UTC the same day, so at offset 0 it's still reported as the
    15th -- only the +420 shift moves it, which is what proves the param
    actually flowed through rather than the route silently always using
    UTC."""
    client, user_id = _client(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-15 20:30:00")  # 03:30 local Aug 16 at +420

    utc = client.get("/api/activity/dates").get_json()
    shifted = client.get("/api/activity/dates?tz_offset_minutes=420").get_json()

    assert utc["dates"] == {"2026-08-15": ["challenge"]}
    assert shifted["dates"] == {"2026-08-16": ["challenge"]}


def test_missing_tz_offset_defaults_to_utc_rather_than_erroring(tmp_path, monkeypatch):
    """request.args.get("tz_offset_minutes", 0) supplies 0 (an int, not the
    string every real query param arrives as) when the param is absent --
    a different code path through get_activity_dates()'s int(...) coercion
    than the "junk string" case tests/test_streak_activity_dates.py already
    covers, so it's worth pinning at the route separately."""
    client, user_id = _client(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-16 09:00:00")

    response = client.get("/api/activity/dates")

    assert response.status_code == 200
    assert response.get_json()["dates"] == {"2026-08-16": ["challenge"]}


def test_only_returns_the_logged_in_users_own_activity(tmp_path, monkeypatch):
    """current_user() (session-scoped) is what decides whose activity comes
    back -- not anything the caller can pass in -- so one account's
    challenge streak can never leak into another's."""
    client, _user_id = _client(tmp_path, monkeypatch)
    other_id = database.create_local_user(
        "streak-route-other@example.com", "irrelevant-password", "Someone Else"
    )
    _add_challenge_attempt(other_id, "2026-08-16 09:00:00")

    response = client.get("/api/activity/dates")

    assert response.get_json()["dates"] == {}


def test_route_is_registered_and_calls_get_activity_dates(monkeypatch):
    """Cheap smoke check that api_activity_dates() is actually wired to
    database.get_activity_dates() (as opposed to some copy-pasted or
    hand-rolled query drifting from what tests/test_streak_activity_dates.py
    pins) -- monkeypatches the database function itself and asserts the
    route's response is built straight from its return value."""

    sentinel = {"2099-01-01": ["challenge", "analysis"]}
    monkeypatch.setattr(app_module, "get_activity_dates", lambda user_id, tz: sentinel)
    monkeypatch.setattr(
        app_module, "current_user", lambda: {"id": 42, "name": "Stub", "email": "stub@example.com"}
    )

    flask_app.config["TESTING"] = True
    client = flask_app.test_client()

    response = client.get("/api/activity/dates?tz_offset_minutes=60")

    assert response.get_json() == {"ok": True, "dates": sentinel}
