"""Behavioural coverage for the Sign in with Apple callback (auth.py).

Apple's flow differs from Google's in ways that are invisible until a real
user hits them in production, and each of those differences is a place this
could silently break:

1. The callback is a cross-site POST (Apple forces response_mode=form_post
   whenever name/email scopes are requested). The session cookie is
   SameSite=Lax, so it is NOT sent on that POST -- which is why the CSRF
   state and the ?next= ride in a signed state token plus a SameSite=None
   cookie instead of in the session. The tests below deliberately drive the
   callback as a POST with no session, the way Apple does.
2. The state check still has to reject a forged or replayed callback, and
   "signed by us" is not enough on its own -- the nonce cookie is what ties
   the state to the browser that started the flow.
3. Apple sends the display name exactly once, as a JSON `user` form field
   on the first authorization only.
4. email_verified comes back as the *string* "true"/"false" as often as a
   real boolean, and "false" is truthy in Python -- so the account-adoption
   rule has to compare it explicitly.

The token exchange and the JWKS signature check are stubbed: this is about
the branch logic once the claims are in hand, and doing it for real would
make the suite depend on the network and on live Apple credentials.
"""

import json

import jwt
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


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    monkeypatch.setattr(auth, "APPLE_CLIENT_ID", "com.repcheck.web")
    monkeypatch.setattr(auth, "APPLE_TEAM_ID", "TEAMID1234")
    monkeypatch.setattr(auth, "APPLE_KEY_ID", "KEYID12345")
    # Only ever checked for truthiness here: _apple_client_secret, the one
    # thing that would actually parse a key, is stubbed on the next line.
    monkeypatch.setattr(auth, "APPLE_PRIVATE_KEY", "not-a-real-p8-key")
    monkeypatch.setattr(auth, "_apple_client_secret", lambda: "fake-client-secret")
    monkeypatch.setattr(auth.requests, "post", lambda *a, **k: _FakeResponse({"id_token": "fake-id-token"}))
    flask_app.config["TESTING"] = True
    # Werkzeug's test client refuses to send a Secure cookie to an http://
    # host, and the nonce cookie has to be Secure to also be SameSite=None.
    # Production is https (Render), so pretend to be https here too.
    return flask_app.test_client()


def _stub_claims(monkeypatch, claims):
    monkeypatch.setattr(auth, "_verify_apple_id_token", lambda id_token: claims)


def _start_flow(client, next_param=None, native=False):
    """Run the real /auth/apple leg so the state token and its nonce cookie
    are the genuine article, then hand back the state to post with."""
    query = [q for q in (f"next={next_param}" if next_param else "", "native=1" if native else "") if q]
    url = "/auth/apple" + ("?" + "&".join(query) if query else "")
    response = client.get(url, base_url="https://localhost")
    assert response.status_code == 302
    location = response.headers["Location"]
    assert location.startswith(auth.APPLE_AUTH_URL)
    from urllib.parse import parse_qs, urlparse

    return parse_qs(urlparse(location).query)["state"][0]


def _callback(client, state, **form):
    return client.post(
        "/auth/apple/callback",
        data={"code": "fake-code", "state": state, **form},
        base_url="https://localhost",
    )


def test_verified_email_signs_into_the_existing_password_account(client, monkeypatch):
    _stub_claims(monkeypatch, {"sub": "apple-sub-1", "email": "runner@example.com", "email_verified": "true"})
    existing_id = database.create_local_user("runner@example.com", "a-real-password", "Runner")

    response = _callback(client, _start_flow(client))

    assert response.status_code == 302
    with client.session_transaction() as session:
        assert session["user_id"] == existing_id, (
            "an Apple login for a verified address that already has a password "
            "account must adopt that account, not create a duplicate"
        )


def test_unverified_email_does_not_take_over_the_existing_account(client, monkeypatch):
    # The string "false" is truthy -- if this is ever tested for truthiness
    # instead of compared, this login walks straight into Runner's account.
    _stub_claims(monkeypatch, {"sub": "apple-sub-2", "email": "runner@example.com", "email_verified": "false"})
    existing_id = database.create_local_user("runner@example.com", "a-real-password", "Runner")

    response = _callback(client, _start_flow(client))

    assert response.status_code == 302
    with client.session_transaction() as session:
        signed_in = session["user_id"]
    assert signed_in != existing_id, (
        "Apple reported the address as UNverified -- adopting the password "
        "account here would hand it to whoever attached that address"
    )
    assert database.get_user_by_id(signed_in)["auth_provider"] == "apple"


def test_first_authorization_keeps_the_name_apple_sends_once(client, monkeypatch):
    _stub_claims(monkeypatch, {"sub": "apple-sub-3", "email": "new@example.com", "email_verified": True})

    _callback(client, _start_flow(client), user=json.dumps({
        "name": {"firstName": "Ada", "lastName": "Lovelace"}, "email": "new@example.com",
    }))

    with client.session_transaction() as session:
        user_id = session["user_id"]
    assert database.get_user_by_id(user_id)["name"] == "Ada Lovelace", (
        "Apple posts the name on the first authorization only -- dropping it "
        "here means it can never be recovered"
    )


def test_returning_user_without_a_name_field_is_not_renamed(client, monkeypatch):
    """Apple omits `user` on every authorization after the first, which must
    not overwrite the name already on the account."""
    _stub_claims(monkeypatch, {"sub": "apple-sub-4", "email": "ada@example.com", "email_verified": True})
    _callback(client, _start_flow(client), user=json.dumps({"name": {"firstName": "Ada", "lastName": "Lovelace"}}))

    _callback(client, _start_flow(client))  # second sign-in, no `user` field

    with client.session_transaction() as session:
        user_id = session["user_id"]
    assert database.get_user_by_id(user_id)["name"] == "Ada Lovelace"


def test_next_survives_the_round_trip_to_apple(client, monkeypatch):
    """The session cookie doesn't come back on Apple's cross-site POST, so
    ?next= has to travel inside the signed state or it is simply lost."""
    _stub_claims(monkeypatch, {"sub": "apple-sub-5", "email": "next@example.com", "email_verified": True})

    response = _callback(client, _start_flow(client, next_param="/nutrition"))

    assert response.headers["Location"] == "/nutrition"


def test_offsite_next_is_refused(client, monkeypatch):
    """_safe_next is what stops /auth/apple?next=https://evil.example from
    turning sign-in into an open redirect, and packing next into the signed
    state must not sneak past it."""
    _stub_claims(monkeypatch, {"sub": "apple-sub-6", "email": "safe@example.com", "email_verified": True})

    response = _callback(client, _start_flow(client, next_param="https://evil.example/steal"))

    assert response.headers["Location"] != "https://evil.example/steal"


def test_forged_state_is_rejected(client, monkeypatch):
    _stub_claims(monkeypatch, {"sub": "apple-sub-7", "email": "csrf@example.com", "email_verified": True})
    _start_flow(client)  # gives the client a valid nonce cookie

    response = _callback(client, "an-attackers-unsigned-state")

    assert response.headers["Location"].endswith("/login")
    with client.session_transaction() as session:
        assert "user_id" not in session


def test_validly_signed_state_without_the_nonce_cookie_is_rejected(client, monkeypatch):
    """A state token we signed is not on its own proof that *this* browser
    started the flow -- replaying one captured elsewhere has to fail."""
    _stub_claims(monkeypatch, {"sub": "apple-sub-8", "email": "replay@example.com", "email_verified": True})
    state = _start_flow(client)
    client.delete_cookie(auth.APPLE_STATE_COOKIE, path="/auth/apple/callback", domain="localhost")

    response = _callback(client, state)

    assert response.headers["Location"].endswith("/login")
    with client.session_transaction() as session:
        assert "user_id" not in session


def test_user_cancelling_on_apples_sheet_goes_back_to_login(client, monkeypatch):
    _stub_claims(monkeypatch, {"sub": "apple-sub-9"})

    response = client.post(
        "/auth/apple/callback",
        data={"error": "user_cancelled_authorize", "state": _start_flow(client)},
        base_url="https://localhost",
    )

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/login")
    with client.session_transaction() as session:
        assert "user_id" not in session


def test_button_is_marked_setup_needed_when_credentials_are_missing(client, monkeypatch):
    monkeypatch.setattr(auth, "APPLE_PRIVATE_KEY", "")

    body = client.get("/login").get_data(as_text=True)

    assert "auth-apple-btn" in body
    assert "setup needed" in body


def test_the_ios_shell_gets_a_token_instead_of_a_cookie(client, monkeypatch):
    """?native=1 means the flow is running in SFSafariViewController, whose
    cookie jar the app cannot read. Setting a session here would look like a
    successful sign-in and leave the app logged out, so the callback has to
    hand back a one-time token over the repcheck:// scheme instead. The flag
    cannot ride in the session the way the Google flow parks it -- Apple's
    callback is a cross-site POST that carries no session cookie -- so it
    travels inside the signed state."""
    _stub_claims(monkeypatch, {"sub": "apple-sub-10", "email": "shell@example.com", "email_verified": True})

    response = _callback(client, _start_flow(client, native=True))

    assert response.status_code == 302
    location = response.headers["Location"]
    assert location.startswith(f"{auth.NATIVE_URL_SCHEME}://auth?token="), location
    with client.session_transaction() as session:
        assert "user_id" not in session, (
            "a session cookie set here belongs to the in-app browser, not the "
            "app -- that is the exact bug this path exists to avoid"
        )

    token = location.split("token=", 1)[1]
    redeem = client.get(f"/auth/native-complete?token={token}", base_url="https://localhost")
    assert redeem.status_code == 302
    with client.session_transaction() as session:
        assert database.get_user_by_id(session["user_id"])["auth_provider"] == "apple"


def test_a_browser_sign_in_still_gets_a_session(client, monkeypatch):
    """The native flag must be opt-in -- without it, the ordinary web flow
    still sets a cookie rather than bouncing to a repcheck:// URL no browser
    can follow."""
    _stub_claims(monkeypatch, {"sub": "apple-sub-11", "email": "web@example.com", "email_verified": True})

    response = _callback(client, _start_flow(client))

    assert not response.headers["Location"].startswith(auth.NATIVE_URL_SCHEME)
    with client.session_transaction() as session:
        assert "user_id" in session


# ---------- The client secret, actually signed ----------
#
# Every test above stubs _apple_client_secret, and the fixture's
# APPLE_PRIVATE_KEY is the string "not-a-real-p8-key". That stub is the right
# call for the branch-logic tests, but it leaves the one piece of this flow
# with no coverage at all -- and it is the piece most likely to fail in
# production rather than in review.


def _generated_p8():
    """A throwaway EC P-256 key in the PEM shape Apple's .p8 download uses."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    return key, pem


@pytest.fixture
def apple_credentials(monkeypatch):
    """Real key, real signing -- deliberately NOT the stubbed `client` fixture."""
    key, pem = _generated_p8()
    monkeypatch.setattr(auth, "APPLE_CLIENT_ID", "com.repcheck.web")
    monkeypatch.setattr(auth, "APPLE_TEAM_ID", "TEAMID1234")
    monkeypatch.setattr(auth, "APPLE_KEY_ID", "KEYID12345")
    monkeypatch.setattr(auth, "APPLE_PRIVATE_KEY", pem)
    return key, pem


def test_the_client_secret_is_a_real_signable_es256_jwt(apple_credentials):
    """Signs with a real key instead of stubbing it out.

    This covers the failure that survives a fully green suite: the client
    secret is an ES256 JWT, ES256 needs PyJWT's crypto extra, and a plain
    `pip install PyJWT` satisfies `import jwt` and then raises
    NotImplementedError at the first real sign-in. requirements.txt pins
    PyJWT[crypto] -- this asserts the pin is doing its job, so dropping the
    extra breaks the suite instead of only breaking production.

    The claims are Apple's documented shape. Getting iss or sub wrong is an
    invalid_client from the token endpoint with no other symptom, which is
    slow to diagnose against a live Apple account.
    """
    key, _ = apple_credentials

    secret = auth._apple_client_secret()

    header = jwt.get_unverified_header(secret)
    assert header["alg"] == "ES256"
    assert header["kid"] == "KEYID12345", (
        "Apple selects the public key by kid; without it the signature "
        "cannot be checked and every exchange fails"
    )

    claims = jwt.decode(
        secret, key.public_key(), algorithms=["ES256"], audience=auth.APPLE_ISSUER
    )
    assert claims["iss"] == "TEAMID1234", "iss is the Team ID, not the Services ID"
    assert claims["sub"] == "com.repcheck.web", "sub is the Services ID"
    assert 0 < claims["exp"] - claims["iat"] <= 15777000, (
        "Apple caps the client secret lifetime at 6 months and rejects longer"
    )


def test_a_p8_pasted_with_escaped_newlines_still_signs(monkeypatch):
    """.env.example tells you to paste the .p8 with newlines as backslash-n.

    Asserting the unescaping round-trips as a *string* would not prove much;
    what matters is that the result still deserializes into a usable key.
    """
    key, pem = _generated_p8()
    monkeypatch.setattr(auth, "APPLE_CLIENT_ID", "com.repcheck.web")
    monkeypatch.setattr(auth, "APPLE_TEAM_ID", "TEAMID1234")
    monkeypatch.setattr(auth, "APPLE_KEY_ID", "KEYID12345")
    monkeypatch.setattr(auth, "APPLE_PRIVATE_KEY", pem.replace("\n", "\n"))

    secret = auth._apple_client_secret()

    jwt.decode(secret, key.public_key(), algorithms=["ES256"], audience=auth.APPLE_ISSUER)


# ---------- Failure paths on the way back from Apple ----------


def test_a_failed_token_exchange_does_not_sign_anyone_in(client, monkeypatch):
    """Apple's token endpoint being unreachable must not become a login."""
    state = _start_flow(client)

    def _explode(*args, **kwargs):
        raise auth.requests.RequestException("apple is unreachable")

    monkeypatch.setattr(auth.requests, "post", _explode)
    response = _callback(client, state)

    assert response.status_code == 502
    with client.session_transaction() as session:
        assert "user_id" not in session


def test_a_token_response_without_an_id_token_is_refused(client, monkeypatch):
    """Apple answers 200 with an error body for a bad client secret.

    raise_for_status does not fire, so without the KeyError guard this is an
    unhandled 500 on a path users reach by tapping the button.
    """
    state = _start_flow(client)
    monkeypatch.setattr(
        auth.requests, "post", lambda *a, **k: _FakeResponse({"error": "invalid_client"})
    )

    response = _callback(client, state)

    assert response.status_code == 502
    with client.session_transaction() as session:
        assert "user_id" not in session


@pytest.mark.parametrize("case,blob", [
    ("unparseable", "not json at all"),
    ("name-is-a-string", '{"name": "Ada"}'),
    ("name-is-null", '{"name": null}'),
    ("top-level-is-a-list", '["not", "an", "object"]'),
])
def test_a_malformed_name_blob_falls_back_instead_of_500ing(client, monkeypatch, case, blob):
    """The `user` field is attacker-shaped: it arrives in the POST body.

    A crash here lands *after* Apple has authenticated the user, turning a
    successful sign-in into a 500 with no way through it.
    """
    _stub_claims(monkeypatch, {
        "sub": f"apple-name-{case}",
        "email": f"{case}@example.com",
        "email_verified": True,
    })

    response = _callback(client, _start_flow(client), user=blob)

    assert response.status_code == 302
    with client.session_transaction() as session:
        assert database.get_user_by_id(session["user_id"])["name"] == "Apple User"
