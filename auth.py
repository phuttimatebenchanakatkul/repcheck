"""Email/password signup+login, plus a "Continue with Google" button.

Google sign-in is a real, working OAuth 2.0 flow — it activates as soon as
GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in .env (create both at
https://console.cloud.google.com/apis/credentials, with this app's
/auth/google/callback URL added as an authorized redirect URI).
"""

import os
import secrets
from urllib.parse import urlencode

import requests
from flask import Blueprint, redirect, render_template, request, session, url_for

from database import (
    consume_native_auth_token,
    create_local_user,
    create_native_auth_token,
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

# Custom URL scheme the iOS shell registers (see the Info.plist step in
# codemagic.yaml). Only ever used to hand a one-time token back to the app
# after Google sign-in finishes in the external browser.
NATIVE_URL_SCHEME = "repcheck"



def current_user():
    user_id = session.get("user_id")
    return get_user_by_id(user_id) if user_id else None


def _login_session(user):
    session["user_id"] = user["id"]
    session.permanent = True


def _auth_context(**extra):
    return {
        "google_enabled": bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET),
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
    # The iOS shell cannot run this flow in its own webview -- Google rejects
    # embedded webviews -- so it opens SFSafariViewController instead. That
    # browser has a separate cookie jar, which means the session this flow is
    # about to establish belongs to the browser and not to the app. Remember
    # that we are in that case so the callback hands a token back to the app
    # rather than just redirecting to a page the user will never see.
    if request.args.get("native") == "1":
        session["oauth_native"] = True
    else:
        session.pop("oauth_native", None)
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

    next_url = session.pop("oauth_next", None)

    if session.pop("oauth_native", None):
        # Deliberately do NOT call _login_session here. This request is being
        # served to SFSafariViewController, so a session cookie set now lands
        # in the browser's jar, where the app can never use it -- that is the
        # exact bug this path exists to fix. Hand back a single-use token and
        # let the webview redeem it for a session of its own.
        token = create_native_auth_token(user["id"], next_url)
        return redirect(f"{NATIVE_URL_SCHEME}://auth?token={token}")

    _login_session(user)
    return redirect(next_url or url_for("home"))


@auth_bp.route("/auth/native-complete")
def native_complete():
    """Trade a one-time token from the iOS shell for a real session.

    Requested by the app's own webview, so the cookie set here is the one the
    app will actually use. An invalid, expired, or already-redeemed token is
    not an error worth explaining -- it is either a stale link or someone
    else's token -- so it lands on the login page like any other signed-out
    visit.
    """
    claim = consume_native_auth_token(request.args.get("token"))
    if not claim:
        return redirect(url_for("auth.login_page"))

    user = get_user_by_id(claim["user_id"])
    if not user:
        return redirect(url_for("auth.login_page"))

    _login_session(user)
    return redirect(_safe_next(claim["next_url"]) or url_for("home"))

