"""Email/password signup+login, plus "Continue with Google" and "Continue
with Apple" buttons.

Both are real, working OAuth 2.0 / OIDC flows, and each activates on its own
as soon as its credentials are present in .env:

* Google — GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (create both at
  https://console.cloud.google.com/apis/credentials, with this app's
  /auth/google/callback URL added as an authorized redirect URI).
* Apple — APPLE_CLIENT_ID (a Services ID, not the app's bundle ID),
  APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (the contents of the
  .p8 Sign in with Apple key), all from
  https://developer.apple.com/account/resources/identifiers, with this
  app's /auth/apple/callback URL registered as a Return URL. See
  .env.example for the exact steps.

The two flows differ in three ways that matter here, all forced by Apple:
the client secret is a short-lived ES256 JWT rather than a fixed string,
the callback arrives as a cross-site POST (response_mode=form_post, which
Apple requires whenever name/email scopes are asked for), and the user's
name is handed over exactly once, on the very first authorization.
"""

import json
import os
import secrets
import time
from urllib.parse import urlencode

import requests
from flask import (
    Blueprint,
    current_app,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from itsdangerous import BadSignature, URLSafeTimedSerializer

from database import (
    create_local_user,
    create_oauth_user,
    get_user_by_email,
    get_user_by_id,
    get_user_by_provider,
    verify_password,
)
from name_filter import validate_display_name

auth_bp = Blueprint("auth", __name__)

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

APPLE_CLIENT_ID = os.environ.get("APPLE_CLIENT_ID")
APPLE_TEAM_ID = os.environ.get("APPLE_TEAM_ID")
APPLE_KEY_ID = os.environ.get("APPLE_KEY_ID")
# A .p8 key is a multi-line PEM and .env files are single-line, so the
# usual way to carry it (and the only way the Render dashboard accepts it)
# is with the newlines escaped as literal backslash-n. Unescape both that
# form and a genuinely multi-line value so either works.
APPLE_PRIVATE_KEY = (os.environ.get("APPLE_PRIVATE_KEY") or "").replace("\\n", "\n").strip()
APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_STATE_COOKIE = "apple_oauth_state"
APPLE_STATE_MAX_AGE = 600



def current_user():
    user_id = session.get("user_id")
    return get_user_by_id(user_id) if user_id else None


def _login_session(user):
    session["user_id"] = user["id"]
    session.permanent = True


def _auth_context(**extra):
    return {
        "google_enabled": bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET),
        "apple_enabled": _apple_configured(),
        **extra,
    }


def _safe_next(value):
    """Only ever redirect to a path within this app (must start with a
    single "/", not "//" or "/\\" which browsers can treat as protocol-
    relative and send the user off-site) -- prevents /login?next=<evil-url>
    from being used as an open redirect."""
    if value and value.startswith("/") and not value.startswith(("//", "/\\")):
        return value
    return None


@auth_bp.route("/signup", methods=["GET"])
def signup_page():
    if current_user():
        return redirect(url_for("home"))
    return render_template("signup.html", next=request.args.get("next", ""), **_auth_context())


@auth_bp.route("/signup", methods=["POST"])
def signup():
    email = request.form.get("email", "").strip()
    password = request.form.get("password", "")
    name = request.form.get("name", "").strip()
    next_url = _safe_next(request.form.get("next", ""))

    # This name is what shows up to other users everywhere (leaderboards,
    # friends, challenges) -- validate it here at signup rather than let an
    # inappropriate one into the account and get caught later, if ever.
    error = validate_display_name(name)
    if error:
        pass
    elif "@" not in email or "." not in email.split("@")[-1]:
        error = "Please enter a valid email address."
    elif len(password) < 8:
        error = "Password must be at least 8 characters."
    elif get_user_by_email(email):
        # Deliberately not "an account with that email already exists" --
        # that phrasing is a free, unthrottled oracle: script signup with a
        # list of candidate emails and get an instant, distinguishable
        # yes/no on which ones have accounts here. This message still
        # nudges a genuine returning user toward login (the actually useful
        # part), just without confirming registration to an attacker who
        # doesn't already know it.
        error = "We couldn't create an account with that email. If you already have one, try logging in instead."

    if error:
        return render_template(
            "signup.html", error=error, name=name, email=email, next=next_url or "", **_auth_context()
        ), 400

    user_id = create_local_user(email, password, name)
    _login_session(get_user_by_id(user_id))
    return redirect(next_url or url_for("home"))


@auth_bp.route("/login", methods=["GET"])
def login_page():
    if current_user():
        return redirect(url_for("home"))
    return render_template("login.html", next=request.args.get("next", ""), **_auth_context())


@auth_bp.route("/login", methods=["POST"])
def login():
    email = request.form.get("email", "").strip()
    password = request.form.get("password", "")
    next_url = _safe_next(request.form.get("next", ""))
    user = verify_password(email, password)
    if not user:
        return render_template(
            "login.html", error="Incorrect email or password.", email=email, next=next_url or "", **_auth_context()
        ), 400
    _login_session(user)
    return redirect(next_url or url_for("home"))


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("auth.login_page"))


# ---------- Google OAuth ----------

@auth_bp.route("/auth/google")
def google_login():
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET):
        return render_template(
            "login.html",
            error="Google sign-in isn't set up yet — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.",
            **_auth_context(),
        ), 400

    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state
    # Google's callback comes back with only ?code and ?state on it, so a
    # "next" typed into /login?next=/nutrition would be lost across the
    # round-trip and every Google user would land on home instead of the
    # page that sent them to log in. Park it in the session (already
    # validated by _safe_next, and the session is server-signed) rather
    # than smuggling it through the state param, which has to stay an
    # opaque CSRF nonce.
    next_url = _safe_next(request.args.get("next", ""))
    if next_url:
        session["oauth_next"] = next_url
    else:
        session.pop("oauth_next", None)
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": url_for("auth.google_callback", _external=True),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return redirect(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@auth_bp.route("/auth/google/callback")
def google_callback():
    if not request.args.get("state") or request.args["state"] != session.pop("oauth_state", None):
        return redirect(url_for("auth.login_page"))

    code = request.args.get("code")
    if not code:
        return redirect(url_for("auth.login_page"))

    try:
        token_resp = requests.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": url_for("auth.google_callback", _external=True),
            "grant_type": "authorization_code",
        }, timeout=10)
        token_resp.raise_for_status()
        access_token = token_resp.json()["access_token"]

        userinfo_resp = requests.get(
            GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=10
        )
        userinfo_resp.raise_for_status()
        info = userinfo_resp.json()
    except requests.RequestException:
        return render_template("login.html", error="Google sign-in failed. Please try again.", **_auth_context()), 502

    user = get_user_by_provider("google", info["sub"])
    if not user:
        # Same email already registered the normal way — sign them into
        # that existing account rather than creating a duplicate.
        #
        # This is the one place an OAuth login can take over an account
        # that was created with a password, so it needs Google to have
        # actually verified the address. Google normally sets
        # email_verified true, but not always (some Workspace/federated
        # accounts come back false), and an unverified address here would
        # mean anyone who can attach any email to a Google account gets
        # straight into the RepCheck account registered under it. When
        # it's unverified, fall through and create a separate account keyed
        # on the Google subject id instead of merging.
        email = info.get("email") if info.get("email_verified") else None
        user = get_user_by_email(email) if email else None
        if not user:
            user_id = create_oauth_user(
                email, info.get("name", "Google User"), "google", info["sub"], info.get("picture")
            )
            user = get_user_by_id(user_id)

    _login_session(user)
    return redirect(session.pop("oauth_next", None) or url_for("home"))



# ---------- Sign in with Apple ----------
#
# Three things here are Apple-specific, and they are the reason this isn't
# simply the Google flow above with different URLs:
#
# 1. There is no static client secret. Apple wants a JWT signed with the
#    ES256 private key from the developer portal; one is minted per token
#    exchange below.
# 2. Asking for the name/email scopes forces response_mode=form_post, so
#    the callback arrives as a cross-site POST. This app's session cookie
#    is SameSite=Lax (see app.py), which by design is NOT sent on a
#    cross-site POST -- so the CSRF state and the ?next= cannot be parked
#    in the session the way the Google flow parks them. Instead the state
#    is a signed, expiring token carrying both, cross-checked against a
#    dedicated SameSite=None cookie so that replaying someone else's state
#    from a different browser is still rejected.
# 3. The user's name is sent exactly once, in a `user` form field on the
#    first authorization only. Miss it and it is gone for good -- Apple
#    will not send it again unless the user removes this app from their
#    Apple ID.


class AppleAuthError(Exception):
    """This Apple sign-in cannot be trusted or completed."""


_apple_jwk_client = None


def _apple_configured():
    return all((APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY))


def _apple_client_secret():
    """Apple's "client secret" is a short-lived ES256 JWT signed with the
    .p8 key, not a fixed string. Minted per exchange (it costs nothing)
    rather than cached, so a rotated key takes effect on the next sign-in
    instead of at the next restart."""
    import jwt

    now = int(time.time())
    try:
        return jwt.encode(
            {
                "iss": APPLE_TEAM_ID,
                "iat": now,
                "exp": now + 600,
                "aud": APPLE_ISSUER,
                "sub": APPLE_CLIENT_ID,
            },
            APPLE_PRIVATE_KEY,
            algorithm="ES256",
            headers={"kid": APPLE_KEY_ID},
        )
    except Exception as exc:  # malformed / truncated APPLE_PRIVATE_KEY
        raise AppleAuthError(f"could not sign the Apple client secret: {exc}") from exc


def _apple_state_serializer():
    return URLSafeTimedSerializer(current_app.secret_key, salt="apple-oauth-state")


def _verify_apple_id_token(id_token):
    """Verify signature, issuer, audience and expiry against Apple's
    published JWKS. Reading the token's payload without this would mean
    anyone who can POST to the callback gets to name their own `sub` and
    be signed in as that user."""
    import jwt
    from jwt import PyJWKClient

    global _apple_jwk_client
    if _apple_jwk_client is None:
        _apple_jwk_client = PyJWKClient(APPLE_KEYS_URL)
    try:
        signing_key = _apple_jwk_client.get_signing_key_from_jwt(id_token)
        return jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=APPLE_CLIENT_ID,
            issuer=APPLE_ISSUER,
        )
    except Exception as exc:
        raise AppleAuthError(f"Apple id_token failed verification: {exc}") from exc


def _apple_email_verified(claims):
    """Apple sends this as the string "true"/"false" about as often as it
    sends a real boolean, and the string "false" is truthy in Python -- so
    compare explicitly rather than testing the value for truthiness."""
    value = claims.get("email_verified")
    return value is True or value == "true"


def _apple_display_name(raw_user):
    """The `user` field is a JSON blob Apple posts back on the first
    authorization only. Anything missing or malformed just falls back to a
    default -- a display name is not worth failing a sign-in over, and the
    user can change it in settings."""
    try:
        parsed = json.loads(raw_user) if raw_user else {}
    except (TypeError, ValueError):
        parsed = {}
    name = parsed.get("name") if isinstance(parsed, dict) else None
    if not isinstance(name, dict):
        return "Apple User"
    parts = [str(name.get(key) or "").strip() for key in ("firstName", "lastName")]
    return " ".join(part for part in parts if part) or "Apple User"


def _apple_state_cookie_path():
    return url_for("auth.apple_callback")


def _clear_apple_state(response):
    # The attributes have to match the ones it was set with, or browsers
    # treat the expiry as being for a different cookie and leave the
    # original in place.
    response.delete_cookie(
        APPLE_STATE_COOKIE,
        path=_apple_state_cookie_path(),
        httponly=True,
        secure=True,
        samesite="None",
    )
    return response


@auth_bp.route("/auth/apple")
def apple_login():
    if not _apple_configured():
        return render_template(
            "login.html",
            error="Apple sign-in isn't set up yet — add APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY to .env.",
            **_auth_context(),
        ), 400

    nonce = secrets.token_urlsafe(16)
    next_url = _safe_next(request.args.get("next", ""))
    state = _apple_state_serializer().dumps({"nonce": nonce, "next": next_url})
    params = {
        "client_id": APPLE_CLIENT_ID,
        "redirect_uri": url_for("auth.apple_callback", _external=True),
        "response_type": "code",
        "response_mode": "form_post",
        "scope": "name email",
        "state": state,
    }
    response = redirect(f"{APPLE_AUTH_URL}?{urlencode(params)}")
    # SameSite=None (and therefore Secure, which browsers require alongside
    # it) is the entire point of this cookie: it is the one thing of ours
    # that still reaches us on Apple's cross-site POST back. Secure means
    # Apple sign-in only works over https, which costs nothing -- Apple
    # refuses to register an http:// Return URL in the first place.
    response.set_cookie(
        APPLE_STATE_COOKIE,
        nonce,
        max_age=APPLE_STATE_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="None",
        path=_apple_state_cookie_path(),
    )
    return response


@auth_bp.route("/auth/apple/callback", methods=["GET", "POST"])
def apple_callback():
    # form_post means the real callback is a POST; GET is accepted only so
    # a stray visit lands on the login page instead of a 405.
    payload = request.form if request.method == "POST" else request.args

    if payload.get("error"):
        # Usually user_cancelled_authorize -- someone tapped Cancel on
        # Apple's sheet. Not worth an error banner.
        return _clear_apple_state(redirect(url_for("auth.login_page")))

    cookie_nonce = request.cookies.get(APPLE_STATE_COOKIE)
    try:
        state = _apple_state_serializer().loads(
            payload.get("state", ""), max_age=APPLE_STATE_MAX_AGE
        )
    except BadSignature:
        return _clear_apple_state(redirect(url_for("auth.login_page")))
    if not isinstance(state, dict) or not cookie_nonce or not secrets.compare_digest(
        cookie_nonce, str(state.get("nonce", ""))
    ):
        return _clear_apple_state(redirect(url_for("auth.login_page")))

    code = payload.get("code")
    if not code:
        return _clear_apple_state(redirect(url_for("auth.login_page")))

    try:
        token_resp = requests.post(APPLE_TOKEN_URL, data={
            "code": code,
            "client_id": APPLE_CLIENT_ID,
            "client_secret": _apple_client_secret(),
            "redirect_uri": url_for("auth.apple_callback", _external=True),
            "grant_type": "authorization_code",
        }, timeout=10)
        token_resp.raise_for_status()
        claims = _verify_apple_id_token(token_resp.json()["id_token"])
    except (requests.RequestException, AppleAuthError, KeyError, ValueError):
        response, status = render_template(
            "login.html", error="Apple sign-in failed. Please try again.", **_auth_context()
        ), 502
        return _clear_apple_state(current_app.make_response((response, status)))

    subject = claims.get("sub")
    if not subject:
        return _clear_apple_state(redirect(url_for("auth.login_page")))

    user = get_user_by_provider("apple", subject)
    if not user:
        # Same reasoning as the Google callback above: adopting an account
        # that was created with a password is only safe when the provider
        # says it verified the address; otherwise fall through and make a
        # separate account keyed on Apple's subject id. Apple's
        # private-relay addresses come back verified and are real,
        # deliverable addresses, so they merge like any other.
        email = claims.get("email") if _apple_email_verified(claims) else None
        user = get_user_by_email(email) if email else None
        if not user:
            # Deliberately the None-ified `email`, not claims["email"]: an
            # address Apple would not vouch for must not be written onto
            # the new account either, or it collides with the UNIQUE index
            # held by whoever registered it properly. create_oauth_user
            # synthesises a placeholder address in that case.
            user_id = create_oauth_user(
                email,
                _apple_display_name(payload.get("user")),
                "apple",
                subject,
            )
            user = get_user_by_id(user_id)

    _login_session(user)
    return _clear_apple_state(redirect(state.get("next") or url_for("home")))
