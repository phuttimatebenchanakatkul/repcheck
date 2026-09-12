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

import pytest

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


@pytest.mark.parametrize("supplied", [None, "", "   ", "\t\n "])
def test_a_blank_name_from_google_does_not_become_a_blank_display_name(
    tmp_path, monkeypatch, supplied
):
    """`info.get("name", "Google User")` only defaulted on a MISSING key.

    Google sending "name": "" or null handed that straight to
    create_oauth_user, which does name.strip(). An empty display name is
    unreachable everywhere else (signup runs validate_display_name;
    update_account refuses a blank), and templates/friends.html renders the
    avatar initial as f.name[0].toUpperCase(), which throws on "" -- one
    blank-named friend takes the whole list to zero rows for whoever added
    them, including the button they would block them with.

    Behavioural and parametrised rather than a source regex, because the
    first fix here was `or` alone and a source check could not see what it
    missed: "   " is TRUTHY, so it sailed past the `or` and create_oauth_user
    stripped it to "" anyway. Same dict.get trap as the loss_rate_pct fix in
    app.py, plus the truthiness trap on top.
    """
    userinfo = {"sub": "google-sub-blank", "email": "blank@example.com", "email_verified": True}
    if supplied is not None:
        userinfo["name"] = supplied
    client = _client(tmp_path, monkeypatch, userinfo)

    assert _callback(client).status_code == 302

    user = database.get_user_by_email("blank@example.com")
    assert user is not None
    assert user["name"] == "Google User", (
        f"a name of {supplied!r} from Google became {user['name']!r}"
    )


def test_a_blocked_word_in_a_google_profile_name_does_not_reach_the_leaderboard(
    tmp_path, monkeypatch
):
    """Guideline 1.2's FIRST obligation: filter objectionable material.

    validate_display_name guarded signup and rename. OAuth account creation
    is the third place a display name gets set and it had no guard at all,
    so a Google profile named with a blocked word went straight onto the
    global leaderboard every other account sees -- past the same filter the
    app applies to a name typed into its own signup form.

    Guarded in database.oauth_display_name() rather than in each callback,
    so Apple and any future provider inherit it.
    """
    import name_filter

    blocked = next(iter(name_filter._BAD_WORDS))
    client = _client(tmp_path, monkeypatch, {
        "sub": "google-sub-rude", "email": "rude@example.com",
        "email_verified": True, "name": blocked,
    })

    assert _callback(client).status_code == 302

    stored = database.get_user_by_email("rude@example.com")["name"]
    assert stored == "Google User", (
        f"a blocked word passed straight through as the display name: {stored!r}"
    )


def test_a_normal_google_name_is_left_alone():
    """The filter must not rewrite ordinary names."""
    assert database.oauth_display_name("Ada Lovelace", "google") == "Ada Lovelace"
    assert database.oauth_display_name("  Ada  ", "google") == "Ada"
    assert database.oauth_display_name("", "apple") == "Apple User"
