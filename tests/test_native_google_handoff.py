"""Google sign-in inside the iOS shell must hand a session to the app, not to Safari.

The bug this covers, from a real TestFlight build: tapping "Continue with
Google" in the packaged app completed the whole OAuth flow and then left the
user looking at the website, still signed out in the app.

Google refuses OAuth in an embedded webview, and Capacitor sends off-origin
navigations to the system browser, so the flow necessarily runs outside the
app's webview. That browser has its own cookie jar -- which means the session
cookie `_login_session` sets during the callback belongs to Safari and is
invisible to the app. Redirecting "back" would not have helped; the session
was in the wrong browser, not at the wrong URL.

So the native callback mints a single-use token instead, hands it to the app
over the repcheck:// scheme, and the app's own webview redeems it at
/auth/native-complete for a session that actually belongs to it.

The single-use and expiry rules are the security boundary here, not
housekeeping: a custom URL scheme is not exclusive on iOS, so another app
that registers repcheck:// can receive the token. Both are asserted below.
"""

import time

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


def _client(tmp_path, monkeypatch, userinfo):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    monkeypatch.setattr(auth, "GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(auth, "GOOGLE_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr(auth.requests, "post", lambda *a, **k: _FakeResponse({"access_token": "fake-token"}))
    monkeypatch.setattr(auth.requests, "get", lambda *a, **k: _FakeResponse(userinfo))
    flask_app.config["TESTING"] = True
    return flask_app.test_client()


def _default_client(tmp_path, monkeypatch):
    return _client(tmp_path, monkeypatch, {
        "sub": "google-sub-native", "email": "lifter@example.com",
        "email_verified": True, "name": "Lifter",
    })


def _callback(client, state="state-native", session_extra=None):
    with client.session_transaction() as session:
        session["oauth_state"] = state
        session.update(session_extra or {})
    return client.get(f"/auth/google/callback?code=fake-code&state={state}")


def _token_from(response):
    location = response.headers["Location"]
    assert location.startswith("repcheck://auth?token="), location
    return location.split("token=", 1)[1]


def test_native_callback_redirects_to_the_app_scheme(tmp_path, monkeypatch):
    client = _default_client(tmp_path, monkeypatch)

    response = _callback(client, session_extra={"oauth_native": True})

    assert response.status_code == 302
    _token_from(response)
    with client.session_transaction() as session:
        assert "user_id" not in session, (
            "the native callback is served to the external browser -- signing "
            "in there is the bug, the session must be established by the app "
            "redeeming the token instead"
        )


def test_browser_callback_still_signs_in_directly(tmp_path, monkeypatch):
    """A normal browser login must be completely unaffected."""
    client = _default_client(tmp_path, monkeypatch)

    response = _callback(client)

    assert response.status_code == 302
    assert not response.headers["Location"].startswith("repcheck://")
    with client.session_transaction() as session:
        assert session.get("user_id"), "browser sign-in must still set the session directly"


def test_redeeming_the_token_signs_the_app_in(tmp_path, monkeypatch):
    client = _default_client(tmp_path, monkeypatch)
    token = _token_from(_callback(client, session_extra={"oauth_native": True}))

    response = client.get(f"/auth/native-complete?token={token}")

    assert response.status_code == 302
    with client.session_transaction() as session:
        assert session.get("user_id"), "redeeming the token must establish the app's own session"


def test_a_token_cannot_be_redeemed_twice(tmp_path, monkeypatch):
    """Single-use is the mitigation for scheme hijacking, not tidiness.

    iOS does not give an app exclusive ownership of a custom URL scheme, so a
    malicious app registering repcheck:// may receive the token too. Replay
    has to fail.
    """
    client = _default_client(tmp_path, monkeypatch)
    token = _token_from(_callback(client, session_extra={"oauth_native": True}))

    client.get(f"/auth/native-complete?token={token}")
    with client.session_transaction() as session:
        session.clear()

    response = client.get(f"/auth/native-complete?token={token}")

    assert response.status_code == 302
    assert "/login" in response.headers["Location"]
    with client.session_transaction() as session:
        assert "user_id" not in session, "a redeemed token must never sign anyone in again"


def test_an_expired_token_is_refused(tmp_path, monkeypatch):
    client = _default_client(tmp_path, monkeypatch)
    token = _token_from(_callback(client, session_extra={"oauth_native": True}))

    # Capture the real clock first: database.time IS the time module, so a
    # lambda that called time.time() would call the replacement it is meant
    # to be standing in for.
    later = time.time() + database.NATIVE_AUTH_TOKEN_TTL_SECONDS + 1
    monkeypatch.setattr(database.time, "time", lambda: later)
    response = client.get(f"/auth/native-complete?token={token}")

    assert response.status_code == 302
    with client.session_transaction() as session:
        assert "user_id" not in session, "an expired handoff token must not sign anyone in"


def test_garbage_and_missing_tokens_are_refused(tmp_path, monkeypatch):
    client = _default_client(tmp_path, monkeypatch)

    for query in ("", "?token=", "?token=not-a-real-token"):
        response = client.get(f"/auth/native-complete{query}")
        assert response.status_code == 302
        with client.session_transaction() as session:
            assert "user_id" not in session, f"/auth/native-complete{query} must not sign anyone in"


def test_the_next_url_survives_the_handoff(tmp_path, monkeypatch):
    """A logged-out tap on a deep link has to land back there, not on home."""
    client = _default_client(tmp_path, monkeypatch)
    token = _token_from(_callback(
        client, session_extra={"oauth_native": True, "oauth_next": "/nutrition"}
    ))

    response = client.get(f"/auth/native-complete?token={token}")

    assert response.headers["Location"].endswith("/nutrition")


def test_an_offsite_next_url_is_not_honoured(tmp_path, monkeypatch):
    """The stored next is re-validated on the way out.

    It was checked by _safe_next before being parked, so this is defence in
    depth -- but the token row is the one piece of this flow that survives
    outside the session, and an open redirect on a login endpoint is exactly
    what phishing wants.
    """
    client = _default_client(tmp_path, monkeypatch)
    _callback(client, session_extra={"oauth_native": True})
    user = database.get_user_by_provider("google", "google-sub-native")
    token = database.create_native_auth_token(user["id"], "https://evil.example.com/steal")

    response = client.get(f"/auth/native-complete?token={token}")

    assert "evil.example.com" not in response.headers["Location"]
