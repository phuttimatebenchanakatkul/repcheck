"""The native API's front door: settings, token verification and the JSON plumbing. No network and no database.

Tokens are signed here with a throwaway ES256 key, and the verifier is handed its public half, so every way a token
can be wrong is exercised for real (a live token proves only that a good one works).
"""

import base64
import hashlib
import hmac
import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from flask import Flask, g, jsonify

from api import auth
from api.app import create_app
from api.settings import Settings, SettingsError, from_env

SETTINGS = Settings(supabase_url="https://abc.supabase.co", service_key="the-secret", db_url="postgresql://u:p@h:6543/postgres")
USER = str(uuid.uuid4())

_private = ec.generate_private_key(ec.SECP256R1())
_other = ec.generate_private_key(ec.SECP256R1())
PRIVATE_PEM = _private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
OTHER_PEM = _other.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
PUBLIC_PEM = _private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)


def claims(**overrides):
    now = int(time.time())
    base = {"iss": SETTINGS.issuer, "aud": "authenticated", "sub": USER, "role": "authenticated", "email": "a@example.com",
            "iat": now, "exp": now + 3600, "is_anonymous": False}
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def token(payload=None, key=PRIVATE_PEM, alg="ES256"):
    return jwt.encode(payload if payload is not None else claims(), key, algorithm=alg, headers={"kid": "k1"})


def verifier():
    return auth.Verifier(SETTINGS, key_for=lambda _t: PUBLIC_PEM)


# -- the verifier --------------------------------------------------------------------------------------

def test_a_good_token_gives_the_callers_id_and_email():
    who = verifier().verify(token())
    assert who.id == USER and who.email == "a@example.com" and who.claims["role"] == "authenticated"


def test_the_subject_is_normalised_to_a_lowercase_uuid():
    assert verifier().verify(token(claims(sub=USER.upper()))).id == USER


def test_a_token_that_expired_a_moment_ago_is_still_inside_the_clock_skew_allowance():
    assert verifier().verify(token(claims(exp=int(time.time()) - 5))).id == USER


def reject(payload=None, **kw):
    with pytest.raises(auth.AuthFailure) as exc:
        verifier().verify(token(payload, **kw))
    return exc.value


def test_an_expired_token_says_so_so_the_app_can_refresh():
    failure = reject(claims(exp=int(time.time()) - 120))
    assert failure.status == 401 and "expired" in failure.message


@pytest.mark.parametrize("override", [
    {"aud": "anon"}, {"aud": "somebody-else"}, {"iss": "https://evil.example.com/auth/v1"},
    {"iss": "https://abc.supabase.co/auth/v1/"}, {"role": "service_role"}, {"role": "anon"}, {"role": None},
    {"is_anonymous": True}, {"sub": "not-a-uuid"}, {"sub": ""}, {"sub": 12345},
])
def test_a_token_of_the_wrong_kind_is_refused(override):
    assert reject(claims(**override)).status == 401


@pytest.mark.parametrize("missing", ["exp", "iat", "sub", "aud", "iss"])
def test_a_token_without_a_required_claim_is_refused(missing):
    assert reject(claims(**{missing: None})).status == 401


def test_an_anonymous_session_is_told_to_sign_in():
    assert "sign in" in reject(claims(is_anonymous=True)).message


def test_a_token_signed_with_another_key_is_refused():
    assert reject(key=OTHER_PEM).message == "Invalid session."


def test_a_tampered_token_is_refused():
    t = token()
    head, body, sig = t.split(".")
    forged = json.loads(base64.urlsafe_b64decode(body + "=="))
    forged["sub"] = str(uuid.uuid4())
    body2 = base64.urlsafe_b64encode(json.dumps(forged).encode()).rstrip(b"=").decode()
    with pytest.raises(auth.AuthFailure):
        verifier().verify(f"{head}.{body2}.{sig}")


def test_alg_none_is_refused():
    unsigned = jwt.encode(claims(), None, algorithm="none")
    with pytest.raises(auth.AuthFailure):
        verifier().verify(unsigned)


def test_an_hs256_token_signed_with_the_public_key_is_refused():
    """The classic algorithm-confusion attack: the public key is public, so anyone can 'sign' with it as an HMAC secret."""
    def b64(raw):
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    signing = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()) + "." + b64(json.dumps(claims()).encode())
    forged = signing + "." + b64(hmac.new(PUBLIC_PEM, signing.encode(), hashlib.sha256).digest())
    with pytest.raises(auth.AuthFailure) as exc:
        verifier().verify(forged)
    assert exc.value.status == 401


@pytest.mark.parametrize("junk", ["", "abc", "a.b.c", "....", "Bearer x", "eyJ.eyJ.sig"])
def test_malformed_tokens_are_refused_not_crashed_on(junk):
    with pytest.raises(auth.AuthFailure) as exc:
        verifier().verify(junk)
    assert exc.value.status == 401


def test_an_unknown_key_id_is_a_bad_session_not_an_outage():
    def key_for(_t):
        raise jwt.PyJWKClientError("Unable to find a signing key that matches")
    with pytest.raises(auth.AuthFailure) as exc:
        auth.Verifier(SETTINGS, key_for=key_for).verify(token())
    assert exc.value.status == 401


def test_failing_to_fetch_the_keys_is_a_503_so_the_app_retries_instead_of_signing_the_user_out():
    def key_for(_t):
        raise jwt.PyJWKClientConnectionError("connection refused")
    with pytest.raises(auth.AuthFailure) as exc:
        auth.Verifier(SETTINGS, key_for=key_for).verify(token())
    assert exc.value.status == 503


def test_a_non_string_email_claim_is_ignored():
    assert verifier().verify(token(claims(email=["x"]))).email is None


# -- the Flask decorator -------------------------------------------------------------------------------

@pytest.fixture
def client():
    app = Flask(__name__)
    app.extensions["api"] = type("S", (), {"verifier": verifier()})()

    @app.get("/who")
    @auth.login_required
    def who():
        return jsonify({"ok": True, "id": g.identity.id})
    return app.test_client()


def test_a_valid_bearer_token_reaches_the_view_with_the_callers_identity(client):
    r = client.get("/who", headers={"Authorization": "Bearer " + token()})
    assert r.status_code == 200 and r.get_json()["id"] == USER


@pytest.mark.parametrize("header", [None, "", "Bearer", "Bearer ", "Basic abc", "bearer " + "x", "Bearer a b", "Token abc", " "])
def test_a_missing_or_malformed_authorization_header_is_a_401_with_a_challenge(client, header):
    headers = {"Authorization": header} if header is not None else {}
    r = client.get("/who", headers=headers)
    assert r.status_code == 401 and r.get_json() == {"ok": False, "error": "Not logged in."}
    assert r.headers["WWW-Authenticate"] == "Bearer"


def test_a_bad_token_is_a_401_and_an_outage_is_a_503_without_a_challenge(client):
    r = client.get("/who", headers={"Authorization": "Bearer " + token(key=OTHER_PEM)})
    assert r.status_code == 401 and r.get_json()["error"] == "Invalid session."

    def down(_t):
        raise jwt.PyJWKClientConnectionError("x")
    client.application.extensions["api"].verifier = auth.Verifier(SETTINGS, key_for=down)
    r = client.get("/who", headers={"Authorization": "Bearer " + token()})
    assert r.status_code == 503 and "WWW-Authenticate" not in r.headers


# -- settings ------------------------------------------------------------------------------------------

GOOD_ENV = {"SUPABASE_URL": "https://abc.supabase.co/", "SUPABASE_SERVICE_ROLE_KEY": "'k'",
            "SUPABASE_DB_URL": "postgresql://u:p@h:6543/postgres"}


def test_settings_come_from_the_environment_unquoted_and_without_a_trailing_slash(tmp_path):
    s = from_env(GOOD_ENV, env_file=tmp_path / "none.env")
    assert (s.supabase_url, s.service_key) == ("https://abc.supabase.co", "k")
    assert s.issuer == "https://abc.supabase.co/auth/v1" and s.jwks_url.endswith("/auth/v1/.well-known/jwks.json")
    assert s.project_ref == "abc"


def test_a_missing_setting_is_named_but_never_its_neighbours_values(tmp_path):
    with pytest.raises(SettingsError) as exc:
        from_env({"SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_DB_URL": "postgresql://u:SECRETPW@h/db"},
                 env_file=tmp_path / "none.env")
    assert "SUPABASE_SERVICE_ROLE_KEY" in str(exc.value) and "SECRETPW" not in str(exc.value)


@pytest.mark.parametrize("key,value", [("SUPABASE_URL", "http://abc.supabase.co"), ("SUPABASE_URL", "abc.supabase.co"),
                                       ("SUPABASE_DB_URL", "mysql://u:p@h/db")])
def test_a_malformed_setting_is_refused_without_echoing_it(tmp_path, key, value):
    with pytest.raises(SettingsError) as exc:
        from_env(dict(GOOD_ENV, **{key: value}), env_file=tmp_path / "none.env")
    assert value not in str(exc.value)


def test_the_env_file_fills_in_only_what_the_process_lacks(tmp_path):
    f = tmp_path / ".env"
    f.write_text("SUPABASE_URL=https://file.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=from-file\nSUPABASE_DB_URL=postgresql://f\n"
                 "UNRELATED=1\n", encoding="utf-8")
    s = from_env({"SUPABASE_SERVICE_ROLE_KEY": "from-process"}, env_file=f)
    assert s.service_key == "from-process" and s.supabase_url == "https://file.supabase.co"


# -- the app's JSON plumbing ---------------------------------------------------------------------------

class ExplodingDb:
    def connection(self):
        raise RuntimeError("password=hunter2 host=internal-db")


@pytest.fixture
def api_client():
    app = create_app(SETTINGS, db=ExplodingDb(), verifier=verifier(), storage=object(), auth_admin=object(), sweep=False)
    return app.test_client()


def test_unknown_routes_and_wrong_methods_answer_json(api_client):
    r = api_client.get("/nope")
    assert r.status_code == 404 and r.get_json() == {"ok": False, "error": "Not found."}
    r = api_client.put("/api/health")
    assert r.status_code == 405 and r.get_json()["ok"] is False


def test_every_response_is_uncacheable_and_not_sniffed(api_client):
    r = api_client.get("/nope")
    assert r.headers["Cache-Control"] == "no-store" and r.headers["X-Content-Type-Options"] == "nosniff"


def test_an_oversized_body_is_a_413_json(api_client):
    r = api_client.post("/api/profile", data=b"x" * (2 * 1024 * 1024),
                        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    assert r.status_code == 413 and r.get_json()["ok"] is False


def test_an_unexpected_failure_is_a_generic_500_that_leaks_nothing(api_client):
    r = api_client.get("/api/profile", headers={"Authorization": "Bearer " + token()})
    assert r.status_code == 500
    assert r.get_json() == {"ok": False, "error": "Something went wrong. Please try again."}
    assert "hunter2" not in r.get_data(as_text=True) and "internal-db" not in r.get_data(as_text=True)


def test_the_health_check_is_public_and_reports_a_dead_database_as_503(api_client):
    r = api_client.get("/api/health")
    assert r.status_code == 503 and r.get_json()["ok"] is False
    assert "hunter2" not in r.get_data(as_text=True)


def test_every_route_but_health_demands_a_token(api_client):
    public = {"health.health"}
    for rule in api_client.application.url_map.iter_rules():
        if rule.endpoint == "static" or rule.endpoint in public:
            continue
        method = next(m for m in rule.methods if m in ("GET", "POST", "DELETE", "PUT"))
        r = api_client.open(rule.rule, method=method)
        assert r.status_code == 401, f"{method} {rule.rule} answered {r.status_code} without a token"
