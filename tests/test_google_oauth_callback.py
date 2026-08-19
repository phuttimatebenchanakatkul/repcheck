"""Behavioural coverage for the Google sign-in callback (auth.py).

Three things this pins, all of which are invisible until a real user hits
them in production:

1. An existing password account is only adopted by a Google login when
   Google says it verified that address. This is the single place where an
   OAuth login can walk into an account someone else created with a
   password, so "email_verified is false" has to mean "make a separate
   account", not "close enough".
2. The ?next= a logged-out user was carrying survives the round-trip to
   Google and back -- the callback only comes back with ?code and ?state,
   so it has to be parked server-side or it is simply lost.
3. The CSRF state check still rejects a callback whose state doesn't match
   the session.

The token/userinfo HTTP calls are stubbed: this is about the branch logic
after the tokens come back, and hitting Google for real would make the
suite depend on network and live credentials.
"""

import auth
import database
from app import app as flask_app


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _stub_google(monkeypatch, userinfo):
    monkeypatch.setattr(auth.requests, "post", lambda *a, **k: _FakeResponse({"access_token": "fake-token"}))
    monkeypatch.setattr(auth.requests, "get", lambda *a, **k: _FakeResponse(userinfo))


def _client(tmp_path, monkeypatch, userinfo):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    monkeypatch.setattr(auth, "GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(auth, "GOOGLE_CLIENT_SECRET", "test-client-secret")
    _stub_google(monkeypatch, userinfo)
    flask_app.config["TESTING"] = True
    return flask_app.test_client()


def _callback(client, state="state-123", session_extra=None):
    with client.session_transaction() as session:
        session["oauth_state"] = state
        session.update(session_extra or {})
    return client.get(f"/auth/google/callback?code=fake-code&state={state}")


def test_verified_email_signs_into_the_existing_password_account(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, {
        "sub": "google-sub-1", "email": "runner@example.com", "email_verified": True, "name": "Runner",
    })
    existing_id = database.create_local_user("runner@example.com", "a-real-password", "Runner")

    response = _callback(client)

    assert response.status_code == 302
    with client.session_transaction() as session:
        assert session["user_id"] == existing_id, (
            "a Google login for a verified address that already has a password "
            "account must adopt that account, not create a duplicate"
        )


def test_unverified_email_does_not_take_over_the_existing_account(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, {
        "sub": "google-sub-2", "email": "runner@example.com", "email_verified": False, "name": "Not Runner",
    })
    existing_id = database.create_local_user("runner@example.com", "a-real-password", "Runner")

    response = _callback(client)

    assert response.status_code == 302
    with client.session_transaction() as session:
        signed_in = session["user_id"]
    assert signed_in != existing_id, (
        "Google reported the address as UNverified -- adopting the password "
        "account here would hand it to anyone who can attach that address to "
        "a Google account"
    )
    assert database.get_user_by_id(signed_in)["auth_provider"] == "google"


def test_next_survives_the_round_trip_to_google(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, {
        "sub": "google-sub-3", "email": "new@example.com", "email_verified": True, "name": "New User",
    })

    start = client.get("/auth/google?next=/nutrition")
    assert start.status_code == 302
    with client.session_transaction() as session:
        state = session["oauth_state"]

    response = client.get(f"/auth/google/callback?code=fake-code&state={state}")

    assert response.headers["Location"] == "/nutrition"


def test_offsite_next_is_refused(tmp_path, monkeypatch):
    """_safe_next is what stops /auth/google?next=https://evil.example from
    turning the sign-in into an open redirect, and parking next in the
    session must not sneak past it."""
    client = _client(tmp_path, monkeypatch, {
        "sub": "google-sub-4", "email": "safe@example.com", "email_verified": True, "name": "Safe",
    })

    client.get("/auth/google?next=https://evil.example/steal")
    with client.session_transaction() as session:
        state = session["oauth_state"]
        assert "oauth_next" not in session

    response = client.get(f"/auth/google/callback?code=fake-code&state={state}")

    assert response.headers["Location"] != "https://evil.example/steal"


def test_mismatched_state_is_rejected(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, {
        "sub": "google-sub-5", "email": "csrf@example.com", "email_verified": True, "name": "CSRF",
    })

    with client.session_transaction() as session:
        session["oauth_state"] = "the-real-state"
    response = client.get("/auth/google/callback?code=fake-code&state=an-attackers-state")

    assert response.headers["Location"].endswith("/login")
    with client.session_transaction() as session:
        assert "user_id" not in session
