"""Local web app: upload a workout video, pick an exercise, get form feedback.

Flow: browser upload -> saved to uploads/ -> pipeline.run_pipeline()
      (trim + sample frames + call Gemini) -> rendered
      Positives/Negatives/Improvements/Injury Prevention page.

Usage:
    python app.py

    Open http://127.0.0.1:5000 on this machine, or http://<this-pc's-LAN-IP>:5000
    from any other device on the same Wi-Fi network.

Requires:
    ffmpeg installed and on PATH
    pip install flask opencv-python google-genai python-dotenv markdown

    Put your key in a .env file next to this script:
        GEMINI_API_KEY=...

    Optional: FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET, a fallback
    barcode-nutrition source for products Open Food Facts doesn't have
    (see fatsecret_lookup.py) -- the barcode scanner works fine without
    these, just with narrower product coverage.
"""

import html
import mimetypes
import os
import re
import time
import traceback
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import markdown as markdown_lib
from flask import Flask, abort, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.utils import secure_filename

from analyze_chat import get_analysis_chat_reply
from analyze_food_gemini import FoodAnalysisError, analyze_food_photo
from auth import auth_bp, current_user
from hyrox_coach import get_hyrox_race_analysis
from barcode_scanner import (
    BarcodeScanError,
    ProductNotFoundError,
    decode_barcode,
    digits_only,
    lookup_by_barcode,
    search_open_food_facts,
)
from coach_chat import get_coach_reply
from workout_chat import get_workout_chat_reply
from checkin_analyzer import CheckinAnalysisError, analyze_checkin
from coaching_engine import (
    FEMALE_BODY_FAT_RANGES,
    GAIN_RATE_DEFAULT_PCT,
    GAIN_RATE_MAX_PCT,
    GAIN_RATE_MIN_PCT,
    LOSS_RATE_DEFAULT_PCT,
    LOSS_RATE_MAX_PCT,
    LOSS_RATE_MIN_PCT,
    MALE_BODY_FAT_RANGES,
    apply_calorie_delta,
    calculate_targets,
    distribute_weekly_calories,
    weekly_adjustment,
)
from database import (
    DB_PATH,
    add_friendship,
    append_hyrox_history_entry,
    append_nutrition_log_entry,
    create_challenge,
    create_custom_exercise,
    create_custom_food,
    create_hyrox_result,
    create_progress_photo,
    delete_custom_exercise,
    delete_custom_food,
    delete_progress_photo,
    delete_user_data,
    get_all_user_data,
    get_challenge,
    get_custom_exercises,
    get_custom_food_by_barcode,
    get_custom_foods,
    get_exercise_leaderboard,
    get_analyze_result,
    get_analyze_results,
    get_friends,
    get_hyrox_leaderboard,
    get_latest_analyze_result,
    get_or_create_friend_code,
    get_progress_photo,
    get_progress_photos,
    get_total_reps_leaderboard,
    get_usage_events,
    get_user_activity_counts,
    get_user_by_friend_code,
    get_user_by_id,
    get_visible_challenges,
    has_submitted_today,
    init_db,
    is_analyze_chat_key,
    list_users,
    mark_onboarding_completed,
    prune_analyze_results,
    rate_limit_consume,
    rate_limit_peek,
    remove_hyrox_history_entry,
    remove_nutrition_log_entry,
    save_analyze_result,
    save_submission,
    set_user_data,
    track_usage,
    set_weight_log_entry,
    set_workout_log_day,
    update_account,
)
from rep_form_analyzer import CHALLENGE_EXERCISES, RepCountError, analyze_reps
from exercise_details import EXERCISE_DETAILS
from exercise_icons import EXERCISE_ICONS
from exercise_videos import EXERCISE_VIDEOS, get_exercise_video
from food_library import FOOD_LIBRARY
from pipeline import run_pipeline
from sort_food_images import build_food_image_map
from split_planner import generate_split_plan, suggest_split_plan
from workout_library import BODYWEIGHT_EXERCISES, EXERCISE_CATEGORIES, UNILATERAL_EXERCISES, WORKOUT_EXERCISES

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Unlike UPLOAD_DIR above (scratch space -- videos are processed then
# deleted), these are kept permanently: the whole point of a weekly
# check-in photo is to compare it against future check-ins. Never served
# by a public static route -- always through /api/checkin/photo/<id>,
# which checks the photo's user_id against the logged-in session first.
PROGRESS_PHOTOS_DIR = DATA_DIR / "progress_photos"
PROGRESS_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# The trimmed clip each analysis was actually run on, kept so the history
# view can replay it alongside the stored feedback. Same access rule as
# progress photos: never a public static route, always /analyze/video/<id>
# with an owner check. Capped per user (see ANALYZE_HISTORY_KEEP) so disk
# use stays bounded on the small persistent volume.
ANALYZE_VIDEOS_DIR = DATA_DIR / "analyze_videos"
ANALYZE_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
ANALYZE_HISTORY_KEEP = 20

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}
ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_CONTENT_LENGTH = 300 * 1024 * 1024  # 300 MB
ISO_DATE_RE = re.compile(r"\A\d{4}-\d{2}-\d{2}\Z", re.ASCII)

# Any exercise name from this library can be picked and analyzed — see
# analyze_form_gemini.resolve_exercise for how curated vs. generic
# coaching notes get applied.
EXERCISE_LIBRARY = WORKOUT_EXERCISES

SECTION_STYLES = {
    "movement summary": "summary",
    "positives": "positives",
    "negatives": "negatives",
    "improvements": "improvements",
    "injury prevention": "injury",
    "how to progress": "progress",
}

SECTION_ICONS = {
    "summary": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
    "positives": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    "negatives": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    "improvements": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.46.46 1.15 1.26 1.41 2.5"/></svg>',
    "injury": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    "progress": '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# Signs the login session cookie (and the coach chat's per-session message
# cap). Identity comes straight back out of that cookie -- auth.py's
# current_user() trusts session["user_id"], and the admin gate keys off
# whichever user that resolves to -- so anyone holding this value can mint a
# cookie for any account, owner's included. This repo is public, so there is
# deliberately no in-code fallback: a default here would be a published
# master key. Refuse to boot instead of signing with something guessable.
_secret_key = os.environ.get("FLASK_SECRET_KEY")
if not _secret_key:
    raise RuntimeError(
        "FLASK_SECRET_KEY is not set. It signs session cookies, so a known or "
        "guessable value lets anyone forge a login for any account.\n"
        "Generate one with:\n"
        '  python -c "import secrets; print(secrets.token_hex(32))"\n'
        "then set it in .env for local dev, and in the Render dashboard "
        "(Environment tab) for production."
    )
app.secret_key = _secret_key

# Stay signed in "forever" -- until an explicit logout. Login already marks
# the session permanent (auth.py's _login_session), and Flask's default
# SESSION_REFRESH_EACH_REQUEST re-stamps the cookie's expiry on every
# request; the only missing piece was the lifetime that "permanent" uses,
# which defaults to 31 days -- so a user who didn't visit for a month got
# bounced back to the login page. A ~10-year window makes that effectively
# never happen, and _keep_session_permanent() below refreshes it each visit.
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=3650)

# Session cookie hardening (CSO audit Finding 3, 2026-08-10). Flask's
# defaults are HttpOnly=True (already fine -- JS/XSS can't read this
# cookie), Secure=False, SameSite unset -- and this cookie alone gates
# /admin/export-db, a full production-database download.
#
# SameSite=Lax is unconditionally safe here: it still allows the
# top-level-navigation redirects this app's own login form and Google
# OAuth callback rely on, while blocking the cookie from being sent on
# cross-site requests forged from another origin.
#
# Secure=True is NOT unconditionally safe -- local dev deliberately runs
# over plain HTTP (see the ssl_context="adhoc" revert note at the bottom
# of this file), and a Secure-flagged cookie is simply dropped by every
# browser on an http:// origin, which would lock every local dev session
# out immediately. RENDER is set automatically by Render's platform for
# every deployed service (undocumented from inside this repo -- verify
# against the deployed app's own Set-Cookie response header after this
# ships, not just this comment) and absent locally, so it's used here as
# the production/local switch instead of a value this app controls.
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = bool(os.environ.get("RENDER"))

app.register_blueprint(auth_bp)
init_db()


@app.context_processor
def inject_current_user():
    # Makes {{ current_user }} available in every template (including
    # base.html's sidebar) without passing it into each render_template call.
    user = current_user()
    # is_admin drives the "Signups" link in the sidebar account popup
    # (base.html) -- only the owner account ever sees it. ADMIN_EMAILS is
    # defined further down this file, but that's fine: this function only
    # runs per-request, long after the whole module (and ADMIN_EMAILS with
    # it) has finished loading.
    is_admin = bool(user) and (user.get("email") or "").lower() in ADMIN_EMAILS
    return {"current_user": user, "is_admin": is_admin}


# The only things reachable without a session: the auth pages/flows and the
# static assets they need. Everything else is gated (see require_login below).
_PUBLIC_ENDPOINTS = frozenset({
    "static",
    "auth.login_page", "auth.login",
    "auth.signup_page", "auth.signup",
    "auth.logout",
    "auth.google_login", "auth.google_callback",
    "auth.apple_login",
})


@app.before_request
def _keep_session_permanent():
    """Re-mark a logged-in session permanent on every request so its rolling
    10-year expiry (see PERMANENT_SESSION_LIFETIME above) keeps refreshing and
    never lapses. Guarded on user_id so anonymous visitors aren't handed a
    session cookie just for browsing the login page."""
    if session.get("user_id"):
        session.permanent = True


@app.before_request
def require_login():
    """Gate the whole app behind an account so a first-time (logged-out)
    visitor lands on the login page instead of the app. Only the auth
    pages/flows and static assets are public. API routes are left alone --
    they already answer with their own JSON 401 when not logged in, and
    turning that into an HTML redirect would just break their callers."""
    endpoint = request.endpoint
    if endpoint is None or endpoint in _PUBLIC_ENDPOINTS:
        return
    if request.path.startswith("/api/"):
        return
    if current_user():
        return
    # Preserve where they were headed so login can send them back there.
    target = request.full_path.rstrip("?") or "/"
    return redirect(url_for("auth.login_page", next=target))


@app.before_request
def track_page_view():
    """Count every logged-in page view per user for the admin activity
    view ("which page did they visit the most / how many times"). Runs
    after require_login (Flask runs before_request hooks in registration
    order, and stops if an earlier one returned a response), so it only
    ever fires for requests that were actually allowed through. GET page
    loads only -- static assets, /api/* JSON calls, and form POSTs aren't
    page views."""
    if request.method != "GET":
        return
    endpoint = request.endpoint
    if not endpoint or endpoint == "static" or request.path.startswith("/api/"):
        return
    user = current_user()
    if user:
        track_usage(user["id"], f"page:{endpoint}")


# Single owner-account allowlist, reused wherever this app needs an
# "admin" concept (the AI-limit exemption below, and the /admin signups
# page) -- one account, no roles/permissions system, per the owner's
# explicit request each time this has come up.
ADMIN_EMAILS = {"phuttimatebenchanakatkul@gmail.com"}


# ---------- Per-user AI usage limits ----------
# Applied to EVERY account. (A first version grandfathered accounts that
# existed before the limits shipped via database.py's `rate_limited` column,
# but that just made the limits look broken when testing with an existing
# account -- the column is now vestigial and ignored.) All three chatbots
# (Coach page, analysis follow-ups, and the workout-log chat) share the one
# "ai_chat" bucket. The AI routes all require login (the app is fully
# login-gated anyway), so there's no anonymous path that could dodge the
# per-user counter.
RATE_LIMITS = {
    "workout_analysis": (1, 24 * 60 * 60),  # 1 per day
    "food_analysis": (3, 24 * 60 * 60),     # 3 per day
    "ai_chat": (3, 24 * 60 * 60),           # 3 messages per day
}

# Admin exemption, per the owner's explicit request: this one account is
# never limited. Everyone else -- every other existing account and every
# future signup -- is limited.
RATE_LIMIT_EXEMPT_EMAILS = ADMIN_EMAILS


def _friendly_wait(seconds):
    """A short human phrase for how long until the window resets."""
    if seconds >= 3600:
        hours = max(1, round(seconds / 3600))
        return f"about {hours} hour{'s' if hours != 1 else ''}"
    minutes = max(1, round(seconds / 60))
    return f"about {minutes} minute{'s' if minutes != 1 else ''}"


def _limited_user():
    """The account the AI usage limits are counted against -- every
    logged-in user except the admin account(s) in
    RATE_LIMIT_EXEMPT_EMAILS."""
    user = current_user()
    if not user or (user.get("email") or "").lower() in RATE_LIMIT_EXEMPT_EMAILS:
        return None
    return user


def _rate_limit_blocked(feature):
    """Read-only: (blocked, retry_after_seconds) for `feature`. Does not spend
    a use -- call _rate_limit_record once the work actually succeeds."""
    user = _limited_user()
    if not user:
        return False, 0
    limit, window = RATE_LIMITS[feature]
    allowed, retry = rate_limit_peek(user["id"], feature, limit, window, int(time.time()))
    return (not allowed), retry


def _rate_limit_record(feature):
    """Spend one use of `feature` for the current (limited) user."""
    user = _limited_user()
    if user:
        _, window = RATE_LIMITS[feature]
        rate_limit_consume(user["id"], feature, window, int(time.time()))


def _track_feature(name):
    """Lifetime usage counter for the admin activity view. Unlike
    _rate_limit_record this counts EVERY account including the admin
    (an exemption from limits shouldn't mean invisible in analytics)."""
    user = current_user()
    if user:
        track_usage(user["id"], f"feature:{name}")


def _chat_limit_response(retry_seconds):
    """The over-limit reply shape both chat routes return -- a normal-looking
    bot message plus the flags the chat widgets already use to lock input."""
    limit = RATE_LIMITS["ai_chat"][0]
    return {
        "reply": f"You've reached your {limit} chat messages for now. Please check back in {_friendly_wait(retry_seconds)}.",
        "limited": True,
        "retry_after_seconds": retry_seconds,
    }


# The "Analyze" nav used to jump one hardcoded account straight to its most
# recent result instead of the upload form. Removed at that account owner's
# request: tapping Analyze is how you start a new analysis, so landing on
# the previous one made the primary action a back-navigation away. The nav
# now goes to the upload page for everyone, and templates link
# url_for('analyze_page') directly rather than through a context processor
# that no longer decides anything. /analyze/latest still exists as a deep
# link and self-heals to the upload page when there is no stored result.


def asset_url(filename):
    # Plain url_for('static', filename=...) has no cache-busting, so once
    # a browser (especially mobile Safari/Chrome) has cached style.css/
    # hyrox.css/hyrox.js/etc., editing those files server-side doesn't
    # actually change what that device renders until the user manually
    # hard-refreshes or clears cache -- which looks exactly like "the fix
    # didn't work" even though the server is serving the new file. Append
    # the file's on-disk mtime as a query string so every edit gets a new
    # URL and is always fetched fresh.
    path = os.path.join(app.static_folder, filename)
    try:
        version = int(os.path.getmtime(path))
    except OSError:
        version = 0
    return f"{url_for('static', filename=filename)}?v={version}"


@app.context_processor
def inject_asset_url():
    return {"asset_url": asset_url}


# Every localStorage key that used to be the *only* copy of that data,
# now also mirrored server-side (see database.get_all_user_data /
# set_user_data) so it follows a logged-in user's account instead of
# being stranded on whichever browser origin wrote it. static/
# account_sync.js has the matching client-side allowlist — keep both in
# sync if a new synced key is ever added.
SYNCED_DATA_KEYS = {
    "repcheck_theme",
    "repcheck_language",
    "repcheck_units_v1",
    "repcheck_workout_log_v2",
    "repcheck_split_plan_v1",
    "repcheck_nutrition_log_v1",
    "repcheck_nutrition_goals_v1",
    "repcheck_nutrition_favorites_v1",
    "repcheck_analyze_log_v1",
    "repcheck_coach_chat_v1",
    "repcheck_workout_chat_v1",
    "repcheck_coaching_profile_v1",
    "repcheck_weight_log_v1",
    "repcheck_day_status_v1",
    "repcheck_coaching_last_adjustment_v1",
    "repcheck_coaching_distribution_v1",
    "repcheck_coaching_inactivity_notified_v1",
    "repcheck_coaching_goal_achieved_v1",
    "repcheck_coaching_goal_achieved_handled_v1",
    "repcheck_hyrox_history_v1",
    "repcheck_hyrox_history_synced_v1",
    # Favourited exercises (the heart toggle in the exercise picker) --
    # same shape and same "user-curated set" semantics as
    # repcheck_nutrition_favorites_v1 above, and it was the last curated
    # list still stranded per-browser.
    "repcheck_exercise_favorites_v1",
    # Which of the four global HYROX leaderboards the user counts as
    # theirs, and the lane length of the gym they train in. hyrox.js calls
    # the first "a standing identity" and asks for the second exactly once
    # -- both are answers the user gave, so both belong on the account
    # rather than on whichever browser happened to be open that day.
    "repcheck_hyrox_leaderboard_gender_v1",
    "repcheck_hyrox_facility_lane_v1",
}


def is_synced_data_key(key):
    """Whether /api/sync accepts writes for this key. Everything in
    SYNCED_DATA_KEYS, plus the per-analysis chat threads, which are keyed by
    analyze_results row id and so can't be listed by name (see
    database.is_analyze_chat_key)."""
    return key in SYNCED_DATA_KEYS or is_analyze_chat_key(key)


@app.route("/api/sync", methods=["GET"])
def api_sync_get_all():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    # user_id lets the client tell "this browser's local data belongs to
    # whichever account was last logged in here" apart from "it belongs to
    # ME" -- see the owner-id check in static/account_sync.js.
    return jsonify({"ok": True, "user_id": user["id"], "values": get_all_user_data(user["id"])})


COACHING_PROFILE_KEY = "repcheck_coaching_profile_v1"

# Fields _validate_coaching_profile() rejects the whole check-in over. Losing
# any one of these makes the weekly check-in permanently impossible.
_COACHING_PROFILE_REQUIRED = (
    "aspiration",
    "gender",
    "activityLevel",
    "proteinPreference",
    "bodyFatRangeId",
    "weightKg",
)


def _merge_coaching_profile_write(user_id, incoming):
    """Never let a client DROP a required profile field that's already stored.

    account_sync.js treats a recent local write as authoritative and pushes it
    up (deliberately -- that's what stops a stale hydration GET from wiping
    freshly-logged data). The cost is that a browser whose profile copy is
    partial -- an interrupted wizard save, a half-finished hydration, a copy
    written by an older build -- pushes that partial object over the good
    server copy. Once that lands there is no intact copy left anywhere, and
    every future check-in 400s with "Please choose a gender." naming a field
    the check-in screen never asks about. Confirmed reproducible: removing
    `gender` from localStorage alone corrupted the stored server profile.

    A real profile edit always goes through the wizard, which sends every
    field, so preserving a stored value the client omitted can't block a
    legitimate change -- it only refuses the destructive case. Anything that
    isn't a dict (or with no prior profile) passes straight through.
    """
    if not isinstance(incoming, dict):
        return incoming
    # get_all_user_data(), not a per-key getter -- database.py exposes no
    # single-key read (only get_all_user_data/set_user_data/delete_user_data).
    stored = (get_all_user_data(user_id) or {}).get(COACHING_PROFILE_KEY)
    if not isinstance(stored, dict):
        return incoming
    merged = dict(incoming)
    restored = []
    for field in _COACHING_PROFILE_REQUIRED:
        incoming_val = incoming.get(field)
        stored_val = stored.get(field)
        if incoming_val in (None, "") and stored_val not in (None, ""):
            merged[field] = stored_val
            restored.append(field)
    if restored:
        app.logger.warning(
            "coaching profile write for user %s omitted required field(s) %s; "
            "kept the stored value(s) instead of dropping them",
            user_id, ", ".join(restored),
        )
    return merged


@app.route("/api/sync/<key>", methods=["PUT", "POST"])
def api_sync_put(key):
    # POST is accepted as an alias for PUT specifically so the client can
    # use navigator.sendBeacon() (which only ever sends POST) for writes
    # made right before a page navigation -- a normal fetch(), even with
    # {keepalive: true}, gets cancelled by some browsers/payload sizes on
    # unload, which was silently dropping the write: the user logs food,
    # navigates to another page, that page's own /api/sync GET pulls the
    # still-stale server copy and overwrites the fresh local data with it.
    # See static/account_sync.js for the client side of this.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    if not is_synced_data_key(key):
        return jsonify({"ok": False, "error": "Unknown sync key."}), 400
    payload = request.get_json(silent=True) or {}
    if "value" not in payload:
        return jsonify({"ok": False, "error": "Missing value."}), 400
    value = payload["value"]
    if key == COACHING_PROFILE_KEY:
        value = _merge_coaching_profile_write(user["id"], value)
    set_user_data(user["id"], key, value)
    return jsonify({"ok": True})


@app.route("/api/sync/<key>", methods=["DELETE"])
def api_sync_delete(key):
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    if not is_synced_data_key(key):
        return jsonify({"ok": False, "error": "Unknown sync key."}), 400
    delete_user_data(user["id"], key)
    return jsonify({"ok": True})


@app.route("/api/nutrition/log-entry", methods=["POST"])
def api_nutrition_log_entry():
    # Authoritative, synchronous "add one food entry" write path. The
    # generic /api/sync/<key> route above re-sends the *whole* nutrition
    # log blob on every localStorage write, fire-and-forget from the
    # browser (sendBeacon or a keepalive fetch) -- good enough for most
    # synced data, but it was letting freshly-logged food quietly vanish
    # if that write raced with the user navigating to another page before
    # it landed. nutrition.html now calls this endpoint directly (and
    # awaits the response) for every "Add to log" action, so a food is
    # only treated as logged once the server has actually confirmed it,
    # with a real error surfaced to the user otherwise instead of a
    # silent loss.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    date_iso = str(payload.get("date") or "").strip()
    entry = payload.get("entry")

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso):
        return jsonify({"ok": False, "error": "Invalid date."}), 400
    if not isinstance(entry, dict) or not entry.get("id"):
        return jsonify({"ok": False, "error": "Invalid entry."}), 400

    day_entries = append_nutrition_log_entry(user["id"], date_iso, entry)
    _track_feature("food_logged")
    return jsonify({"ok": True, "date": date_iso, "day_entries": day_entries})


@app.route("/api/nutrition/log-entry", methods=["DELETE"])
def api_nutrition_log_entry_delete():
    # Authoritative, synchronous "remove one food entry" write path --
    # counterpart to the POST above. Needed as its own endpoint (rather
    # than just relying on the generic /api/sync/<key> route) now that
    # that route merges the nutrition log instead of overwriting it (see
    # database.py's MERGE_LOG_KEYS): a merge can only ever bring entries
    # back from an older stored copy, never remove one, so a deletion has
    # to edit the stored value directly.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    date_iso = str(payload.get("date") or "").strip()
    entry_id = payload.get("entry_id")

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso):
        return jsonify({"ok": False, "error": "Invalid date."}), 400
    if not entry_id:
        return jsonify({"ok": False, "error": "Invalid entry."}), 400

    day_entries = remove_nutrition_log_entry(user["id"], date_iso, str(entry_id))
    return jsonify({"ok": True, "date": date_iso, "day_entries": day_entries})


@app.route("/api/weight/log-entry", methods=["POST"])
def api_weight_log_entry():
    # Same authoritative-write fix as /api/nutrition/log-entry above,
    # applied to weigh-ins: coaching.js's logWeight() used to only go
    # through the generic fire-and-forget blob sync, so a weigh-in could
    # get silently dropped by a stale hydration pull if the user navigated
    # away right after logging it. This is awaited directly from
    # logWeight(), so a weigh-in is only treated as saved once the server
    # has actually confirmed it.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    date_iso = str(payload.get("date") or "").strip()
    entry = payload.get("entry")

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso):
        return jsonify({"ok": False, "error": "Invalid date."}), 400
    if not isinstance(entry, dict) or not isinstance(entry.get("kg"), (int, float)) or entry["kg"] <= 0 or entry["kg"] > 400:
        return jsonify({"ok": False, "error": "Invalid entry."}), 400

    weight_log = set_weight_log_entry(user["id"], date_iso, entry)
    _track_feature("weight_logged")
    return jsonify({"ok": True, "date": date_iso, "weight_log": weight_log})


@app.route("/api/workout/log-day", methods=["POST"])
def api_workout_log_day():
    # Authoritative, synchronous write path for a single day's workout log
    # -- see set_workout_log_day() in database.py for why this exists
    # instead of relying solely on the generic /api/sync/<key> route.
    # workouts.html calls this (debounced) on every add/delete/edit to a
    # day's exercises, sending that ONE day's full, current entry list so
    # the server can overwrite rather than merge.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    date_iso = str(payload.get("date") or "").strip()
    entries = payload.get("entries")

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso):
        return jsonify({"ok": False, "error": "Invalid date."}), 400
    # Caps entry count (a real workout day tops out at a few dozen
    # exercises; 200 is generous headroom) and requires dict shape per
    # entry -- both flagged in pre-landing review. Without the count cap,
    # nothing stops an oversized payload from bloating this user's own
    # user_data row (read/re-serialized on every debounced sync) or
    # tripping Python's default JSON recursion limit on deeply nested
    # input. Without the shape check, a malformed entry (e.g. a bare
    # string) would be stored verbatim and crash EVERY device's rendering
    # of this date the next time it reads the log back, not just the one
    # that sent it -- workouts.html accesses entry.exercise/entry.sets
    # unconditionally, with no defensive isinstance() guard the way the
    # read-only admin/report consumers of this same data already have.
    if not isinstance(entries, list) or len(entries) > 200 or not all(isinstance(e, dict) for e in entries):
        return jsonify({"ok": False, "error": "Invalid entries."}), 400

    workout_log = set_workout_log_day(user["id"], date_iso, entries)
    return jsonify({"ok": True, "date": date_iso, "workout_log": workout_log})


@app.route("/api/checkin/photo", methods=["POST"])
def api_checkin_photo_upload():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    angle = request.form.get("angle")
    if angle not in ("front", "back"):
        return jsonify({"ok": False, "error": "angle must be 'front' or 'back'."}), 400
    date_iso = str(request.form.get("date") or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso):
        return jsonify({"ok": False, "error": "Invalid date."}), 400

    file = request.files.get("photo")
    if not file or not file.filename:
        return jsonify({"ok": False, "error": "No photo uploaded."}), 400
    ext = Path(secure_filename(file.filename)).suffix.lower()
    if ext not in ALLOWED_PHOTO_EXTENSIONS:
        return jsonify({"ok": False, "error": "Unsupported image format."}), 400

    # Filename is a fresh uuid, not the user's original filename or any
    # guessable id -- the DB row (gated by user_id) is the only real
    # access control, but there's no reason to also make the on-disk name
    # itself predictable.
    filename = f"{uuid.uuid4().hex}{ext}"
    file.save(PROGRESS_PHOTOS_DIR / filename)
    photo_id = create_progress_photo(user["id"], date_iso, angle, filename)
    return jsonify({"ok": True, "id": photo_id})


@app.route("/api/checkin/photos", methods=["GET"])
def api_checkin_photos_list():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    photos = get_progress_photos(user["id"])
    return jsonify({"ok": True, "photos": [{"id": p["id"], "date": p["date"], "angle": p["angle"]} for p in photos]})


@app.route("/api/checkin/photo/<int:photo_id>", methods=["GET"])
def api_checkin_photo_get(photo_id):
    # Progress photos are never public -- every request here re-checks
    # that the logged-in session actually owns this specific photo, the
    # same way a video URL guess can't pull up someone else's HYROX
    # submission or challenge attempt elsewhere in this app.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    photo = get_progress_photo(photo_id)
    if not photo or photo["user_id"] != user["id"]:
        return jsonify({"ok": False, "error": "Not found."}), 404
    path = PROGRESS_PHOTOS_DIR / photo["filename"]
    if not path.exists():
        return jsonify({"ok": False, "error": "Not found."}), 404
    return send_file(path)


@app.route("/api/checkin/photo/<int:photo_id>", methods=["DELETE"])
def api_checkin_photo_delete(photo_id):
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    photo = get_progress_photo(photo_id)
    if not photo or photo["user_id"] != user["id"]:
        return jsonify({"ok": False, "error": "Not found."}), 404
    path = PROGRESS_PHOTOS_DIR / photo["filename"]
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
    delete_progress_photo(user["id"], photo_id)
    return jsonify({"ok": True})


def split_summary_and_detail(html):
    """Split a section's rendered HTML into (summary_html, detail_html).

    summary_html is just the first bullet -- the "most important takeaway"
    the prompt asks Gemini to lead with -- unwrapped from its <li> into a
    bare <p> so it reads like a plain headline, and is ALWAYS shown.
    detail_html is every *remaining* bullet as a <ul>, revealed only when
    the card is expanded (the redesigned breakdown keeps the headline
    visible and reveals the extra detail beneath it, rather than swapping
    one for the other), or None when there's just the single bullet and so
    nothing extra to reveal. A section that isn't a bullet list at all
    becomes summary=the whole html, detail=None.
    """
    items = re.findall(r"<li>.*?</li>", html, flags=re.DOTALL)
    if not items:
        return html, None
    first_text = re.sub(r"</?li>", "", items[0])
    summary = f"<p>{first_text}</p>"
    if len(items) == 1:
        return summary, None
    return summary, f"<ul>{''.join(items[1:])}</ul>"


def section_emphasis(css_class, overall_score):
    """How prominently to show a feedback section, driven by the overall
    score. A poor set (<50) should confront the lifter with what went wrong
    and how to avoid injury rather than flatter them with positives, so
    positives are dropped entirely along with the neutral sections
    (summary/improvements/progress). A strong set (>=80) should lead with
    what they nailed and how to progress, with everything else kept as
    secondary. A middling set (50-79) shows every section evenly. Returns
    "featured", "muted", or "hidden".

    Note: the full, unfiltered feedback text is still sent to the client for
    the AI chatbot's context (see the analyze route), so hiding a section
    here only changes what's rendered, not what the user can ask about."""
    if overall_score is None:
        return "featured"
    if overall_score < 50:
        if css_class in ("negatives", "injury"):
            return "featured"
        return "hidden"
    if overall_score >= 80:
        if css_class in ("positives", "progress"):
            return "featured"
        return "muted"
    return "featured"


def split_feedback_sections(feedback_markdown, overall_score=None):
    """Split Gemini's "## Heading" markdown into section dicts: a friendly
    display title, a plain-language summary (first bullet), and the extra
    detail revealed on expand. When overall_score is given, each section is
    tagged with an "emphasis" (see section_emphasis) and hidden sections are
    dropped; featured sections are ordered before muted ones so the result
    reads in priority order regardless of Gemini's heading order."""
    parts = re.split(r"^##\s+(.+)$", feedback_markdown, flags=re.MULTILINE)
    sections = []
    # parts[0] is any preamble before the first heading; skip it
    for heading, body in zip(parts[1::2], parts[2::2]):
        css_class = SECTION_STYLES.get(heading.strip().lower(), "improvements")
        emphasis = section_emphasis(css_class, overall_score)
        if emphasis == "hidden":
            continue
        # Gemini's text is rendered with | safe in result.html and via raw
        # innerHTML in index.html's AJAX view -- Markdown (3.0+, no safe_mode
        # left in the library) passes any literal HTML in the source straight
        # through unescaped. Escaping before conversion neutralizes that
        # without touching the markdown syntax itself: **bold**/"- bullet"
        # use none of the five characters html.escape() rewrites, so **/- /
        # newlines still parse into <strong>/<li> normally -- only literal
        # <, >, &, ", ' already present in Gemini's own text get inerted.
        rendered_html = markdown_lib.markdown(html.escape(body.strip()))
        summary_html, detail_html = split_summary_and_detail(rendered_html)
        sections.append({
            "heading": heading.strip(),
            "css_class": css_class,
            "emphasis": emphasis,
            # Friendlier, less-clinical display title than Gemini's raw
            # "## Movement Summary"/"## Negatives" headings -- localized via
            # i18n (see analyze.section.* keys); the raw heading is kept for
            # any debugging/fallback need.
            "title_key": "analyze.section." + css_class,
            "icon": SECTION_ICONS.get(css_class, SECTION_ICONS["improvements"]),
            "summary_html": summary_html,
            "detail_html": detail_html,
        })
    # Stable sort keeps Gemini's within-bucket order; featured floats up.
    sections.sort(key=lambda s: 0 if s["emphasis"] == "featured" else 1)
    return sections


@app.route("/", methods=["GET"])
def home():
    user = current_user()
    # New accounts land here straight from signup/login (see auth.py) --
    # send them to the combined onboarding wizard first instead, no matter
    # which page they land on /'s redirect from. Accounts that existed
    # before this feature shipped were backfilled to onboarding_completed=1
    # (see database.py's init_db) so this only ever fires for genuinely
    # new signups.
    if user and not user["onboarding_completed"]:
        return redirect(url_for("onboarding_page"))
    return render_template("home.html", active_nav="home", i18n_page="home")


@app.route("/onboarding", methods=["GET"])
def onboarding_page():
    user = current_user()
    if not user:
        return redirect(url_for("auth.login_page"))
    if user["onboarding_completed"]:
        return redirect(url_for("home"))
    return render_template("onboarding.html", exercise_icons=EXERCISE_ICONS)


@app.route("/api/onboarding/complete", methods=["POST"])
def api_onboarding_complete():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    mark_onboarding_completed(user["id"])
    return jsonify({"ok": True})


@app.route("/analyze", methods=["GET"])
def analyze_page():
    return render_template(
        "index.html",
        exercise_library=EXERCISE_LIBRARY,
        active_nav="analyze",
        i18n_page="analyze",
        exercise_icons=EXERCISE_ICONS,
        exercise_videos=EXERCISE_VIDEOS,
    )


@app.route("/workouts", methods=["GET"])
def workouts():
    return render_template(
        "workouts.html",
        active_nav="workouts",
        exercise_library=WORKOUT_EXERCISES,
        exercise_details=EXERCISE_DETAILS,
        exercise_videos=EXERCISE_VIDEOS,
        exercise_categories=EXERCISE_CATEGORIES,
        exercise_icons=EXERCISE_ICONS,
        unilateral_exercises=sorted(UNILATERAL_EXERCISES),
        bodyweight_exercises=sorted(BODYWEIGHT_EXERCISES),
        i18n_page="workouts",
    )


@app.route("/nutrition", methods=["GET"])
def nutrition():
    # Rebuilt on every request (cheap directory listing) so newly sorted
    # photos show up immediately, without restarting the server.
    return render_template(
        "nutrition.html",
        active_nav="nutrition",
        food_library=FOOD_LIBRARY,
        food_images=build_food_image_map(),
        i18n_page="nutrition",
    )


@app.route("/coach", methods=["GET"])
def coach():
    return render_template("coach.html", active_nav="coach", i18n_page="coach")


@app.route("/api/analyze-food", methods=["POST"])
def api_analyze_food():
    # Login required so every scan is counted against an account -- an
    # anonymous caller would otherwise have no counter and be unlimited.
    if not current_user():
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    image_file = request.files.get("image")
    if not image_file or image_file.filename == "":
        return jsonify({"ok": False, "error": "Please provide a photo."}), 400

    blocked, retry = _rate_limit_blocked("food_analysis")
    if blocked:
        limit = RATE_LIMITS["food_analysis"][0]
        return jsonify({
            "ok": False,
            "error": f"You've used your {limit} food scans for today — try again in {_friendly_wait(retry)}.",
        }), 429

    # Camera captures come through as a Blob with no real filename, so the
    # browser-reported content type (not the filename extension) is the
    # reliable signal here.
    mime_type = image_file.mimetype if image_file.mimetype in ALLOWED_IMAGE_MIME_TYPES else "image/jpeg"
    # Optional context the photo alone can't convey (an amount, a swapped
    # ingredient, "no dressing") -- see nutrition.html's renderAfNotePrompt().
    note = str(request.form.get("note") or "").strip()[:300]

    try:
        result = analyze_food_photo(image_file.read(), mime_type=mime_type, note=note or None)
        _rate_limit_record("food_analysis")
        _track_feature("food_scan")
        return jsonify({"ok": True, **result})
    except FoodAnalysisError as exc:
        app.logger.warning("Food photo analysis failed: %s", exc)
        return jsonify({"ok": False, "error": "Couldn't analyze that photo. Please try again."}), 502


def _custom_food_to_scan_result(food):
    """Reshapes a row from get_custom_food_by_barcode()/create_custom_food()
    into the same {food_name, confidence, note, ingredients, calories/
    protein/fat/carbs} shape barcode_scanner.py's _validate() produces, so
    a barcode that matches a user's own saved food renders through the
    exact same result screen as a fresh Open Food Facts/FatSecret lookup.
    ingredients[0].grams is the food's own defined serving size (not a
    hardcoded 100g), and "servings" carries every serving size option
    (the base one plus any extra named ones) for the amount editor's
    serving-size picker."""
    servings = [{"label": food["serving_label"], "grams": food["serving_grams"]}]
    servings.extend(food.get("servings") or [])
    return {
        "food_name": food["name"],
        "confidence": "custom",
        "note": "Your own saved food entry.",
        "custom_food_id": food["id"],
        "ingredients": [{
            "name": food["name"], "grams": food["serving_grams"],
            "calories": food["calories"], "protein": food["protein"],
            "fat": food["fat"], "carbs": food["carbs"],
        }],
        "calories": food["calories"], "protein": food["protein"],
        "fat": food["fat"], "carbs": food["carbs"],
        "servings": servings,
    }


def _custom_food_to_json(food):
    """Reshapes a database.py custom_foods row (snake_case, as stored) into
    the camelCase shape nutrition.html's JS expects (matches what
    api_create_custom_food() below returns) -- used by both the GET list
    and the POST create response so a food looks identical whether it just
    got created or was loaded from GET /api/custom-foods."""
    return {
        "id": food["id"], "name": food["name"], "emoji": food["emoji"],
        "calories": food["calories"], "protein": food["protein"],
        "fat": food["fat"], "carbs": food["carbs"],
        "barcode": food.get("barcode"),
        "servingLabel": food["serving_label"], "servingGrams": food["serving_grams"],
        "servings": food.get("servings") or [],
    }


def _resolve_barcode(user, barcode):
    """Shared by /api/scan-barcode and /api/lookup-barcode: a logged-in
    user's own custom food for this exact barcode always wins over an
    external lookup (it's their verified data for their product), checked
    before ever calling out to Open Food Facts/FatSecret. Falls through to
    lookup_by_barcode() otherwise, which raises ProductNotFoundError (a
    BarcodeScanError subclass) when nothing matches anywhere -- callers
    catch that specifically to offer the "create this food yourself" flow."""
    if user:
        custom_food = get_custom_food_by_barcode(user["id"], barcode)
        if custom_food:
            return _custom_food_to_scan_result(custom_food)
    return lookup_by_barcode(barcode)


@app.route("/api/scan-barcode", methods=["POST"])
def api_scan_barcode():
    image_file = request.files.get("image")
    if not image_file or image_file.filename == "":
        return jsonify({"ok": False, "error": "Please provide a photo of the barcode."}), 400

    user = current_user()
    try:
        barcode = decode_barcode(image_file.read())
    except BarcodeScanError as exc:
        app.logger.warning("Barcode decode failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 502

    try:
        result = _resolve_barcode(user, barcode)
        _track_feature("barcode_scan")
        return jsonify({"ok": True, **result})
    except ProductNotFoundError as exc:
        return jsonify({"ok": False, "not_found": True, "barcode": barcode, "error": str(exc)})
    except BarcodeScanError as exc:
        app.logger.warning("Barcode scan failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 502


@app.route("/api/lookup-barcode", methods=["POST"])
def api_lookup_barcode():
    # Companion to /api/scan-barcode: for browsers that support the
    # BarcodeDetector API, the barcode is decoded live in-browser from the
    # camera feed (see nutrition.html) -- no photo upload needed, just the
    # decoded value to look up.
    payload = request.get_json(silent=True) or {}
    # Normalize before _resolve_barcode(), not just inside lookup_by_barcode():
    # the user's-own-custom-food fast path does an exact string match, so a
    # dirty value would skip past their saved food and hit the external API.
    barcode = digits_only(str(payload.get("barcode") or ""))
    if not barcode:
        return jsonify({"ok": False, "error": "No barcode value given."}), 400

    user = current_user()
    try:
        result = _resolve_barcode(user, barcode)
        return jsonify({"ok": True, **result})
    except ProductNotFoundError as exc:
        # Not a hard error -- a normal, expected outcome the frontend
        # handles by offering to create this barcode as a custom food (see
        # renderAfCreateForm(false, barcode) in nutrition.html), so this
        # stays a 200 rather than the 502 a genuine lookup failure gets.
        return jsonify({"ok": False, "not_found": True, "barcode": barcode, "error": str(exc)})
    except BarcodeScanError as exc:
        app.logger.warning("Barcode lookup failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 502


@app.route("/api/search-food-online", methods=["GET"])
def api_search_food_online():
    # Extends the food-log search bar beyond the curated FOOD_LIBRARY
    # (food_library.py) out to Open Food Facts' full product database, so
    # branded/packaged items that aren't in the hand-curated library can
    # still be found and logged by name, not just by scanning a barcode.
    query = request.args.get("q", "")
    try:
        results = search_open_food_facts(query, limit=12)
        return jsonify({"ok": True, "results": results})
    except BarcodeScanError as exc:
        app.logger.warning("Open Food Facts search failed: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 502


@app.route("/api/custom-foods", methods=["GET"])
def api_get_custom_foods():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    foods = [_custom_food_to_json(f) for f in get_custom_foods(user["id"])]
    return jsonify({"ok": True, "foods": foods})


@app.route("/api/custom-foods", methods=["POST"])
def api_create_custom_food():
    # A user-made food/dish -- name, emoji, and macros, all typed in by
    # hand for things a barcode scan or AI photo can't cover. Stored per
    # user_id (see database.create_custom_food), so it only ever shows up
    # in that one user's own search results, never the shared
    # FOOD_LIBRARY/DISHES data or any other user's account.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    emoji = str(payload.get("emoji") or "").strip()

    def _positive_float(key):
        try:
            return max(0.0, float(payload.get(key, 0) or 0))
        except (TypeError, ValueError):
            return 0.0

    protein = _positive_float("protein")
    fat = _positive_float("fat")
    carbs = _positive_float("carbs")

    # Name and emoji are optional -- someone who just wants to log
    # protein/fat/carbs (no barcode, no dish name) shouldn't be blocked
    # from doing so, so both fall back to a generic default instead of
    # erroring.
    name = name or "Custom food"
    emoji = emoji or "\U0001F37D️"
    if protein == 0 and fat == 0 and carbs == 0:
        return jsonify({"ok": False, "error": "Enter at least one macro (protein, fat, or carbs)."}), 400

    # Set only when this food is being created from the barcode-scan
    # "not found" flow (see renderAfCreateForm(false, barcode) in
    # nutrition.html) -- lets a future scan of the same code resolve
    # straight to this food (see _resolve_barcode() above) instead of
    # failing again. Optional otherwise: a food created via the plain
    # "Create food" tile has no barcode.
    # Digits only, same as every other barcode path -- the client already
    # does this, but a direct API call doesn't, and a dirty value stored
    # here would never match the clean value a real scan produces (and
    # would slip past the duplicate check just below).
    barcode = digits_only(str(payload.get("barcode") or ""))[:20] or None
    if barcode and get_custom_food_by_barcode(user["id"], barcode):
        return jsonify({
            "ok": False,
            "error": "You already have a custom food saved for this barcode.",
        }), 409

    # What the entered calories/protein/fat/carbs above are FOR -- e.g.
    # "1 bar" = 45g. Defaults to the same "100g" assumption every other
    # custom food used to hardcode, so old behavior is unchanged when a
    # caller doesn't specify one.
    serving_label = str(payload.get("servingLabel") or "").strip()[:40] or "1 serving"
    try:
        serving_grams = float(payload.get("servingGrams") or 100)
    except (TypeError, ValueError):
        serving_grams = 100
    if serving_grams <= 0:
        serving_grams = 100

    # Extra named serving sizes beyond the base one above (e.g. base "1
    # bar" = 45g, plus "1 box" = 270g) -- each just needs a label and a
    # gram weight; the macros for it are derived client-side/at log time
    # by scaling from the base serving, so nothing else is stored per size.
    extra_servings = []
    for raw in (payload.get("servings") or [])[:20]:
        if not isinstance(raw, dict):
            continue
        label = str(raw.get("label") or "").strip()[:40]
        try:
            grams = float(raw.get("grams") or 0)
        except (TypeError, ValueError):
            grams = 0
        if label and grams > 0:
            extra_servings.append({"label": label, "grams": grams})

    # Always derived server-side from the macros, never trusted from the
    # client -- protein and carbs are 4 kcal/g, fat is 9 kcal/g, so the
    # calories shown always genuinely match the entered macros.
    calories = round(protein * 4 + carbs * 4 + fat * 9)

    name = name[:60]
    food_id = create_custom_food(
        user["id"], name, emoji, calories, protein, fat, carbs,
        barcode=barcode, serving_label=serving_label, serving_grams=serving_grams,
        extra_servings=extra_servings,
    )
    return jsonify({
        "ok": True,
        "food": {
            "id": food_id, "name": name, "emoji": emoji,
            "calories": calories, "protein": protein, "fat": fat, "carbs": carbs,
            "barcode": barcode, "servingLabel": serving_label, "servingGrams": serving_grams,
            "servings": extra_servings,
        },
    })


@app.route("/api/custom-foods/<int:food_id>", methods=["DELETE"])
def api_delete_custom_food(food_id):
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    delete_custom_food(user["id"], food_id)
    return jsonify({"ok": True})


@app.route("/api/custom-exercises", methods=["GET"])
def api_get_custom_exercises():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    return jsonify({"ok": True, "exercises": get_custom_exercises(user["id"])})


@app.route("/api/custom-exercises", methods=["POST"])
def api_create_custom_exercise():
    # An exercise a user invented themselves, not in workout_library.py's
    # shared EXERCISE_CATEGORIES. Stored per user_id (see
    # database.create_custom_exercise), so it only ever shows up in that
    # one user's own split-builder search, never any other user's account.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Enter a name for the exercise."}), 400

    # emoji is the user-picked icon (a single glyph; cap length so a pasted
    # string can't bloat the row). mode is how its sets get logged.
    emoji = (str(payload.get("emoji") or "").strip() or None)
    if emoji:
        emoji = emoji[:8]
    mode = str(payload.get("mode") or "both").strip()
    if mode not in ("both", "each", "either"):
        mode = "both"

    exercise_id = create_custom_exercise(user["id"], name[:60], emoji, mode)
    return jsonify({
        "ok": True,
        "exercise": {"id": exercise_id, "name": name[:60], "emoji": emoji, "mode": mode},
    })


@app.route("/api/custom-exercises/<int:exercise_id>", methods=["DELETE"])
def api_delete_custom_exercise(exercise_id):
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    delete_custom_exercise(user["id"], exercise_id)
    return jsonify({"ok": True})


@app.route("/hyrox", methods=["GET"])
def hyrox():
    # This page's content is intentionally not server-rendered — see
    # templates/hyrox.html and static/hyrox.js for why.
    return render_template("hyrox.html", active_nav="hyrox", i18n_page="hyrox")


@app.route("/settings", methods=["GET"])
def settings():
    return render_template("settings.html", active_nav="settings")


@app.route("/friends", methods=["GET"])
def friends():
    return render_template(
        "friends.html", active_nav="friends", i18n_page="friends",
        add_code=request.args.get("add", ""),
    )


@app.route("/challenges", methods=["GET"])
def challenges():
    # Dedicated page for the daily rep-count challenge -- used to be a
    # bottom sheet opened from Quick Actions (base.html's "+" menu); moved
    # here so the hero + leaderboard have room to breathe instead of being
    # crammed into one sheet. The backend contract (/api/challenges*,
    # /api/leaderboard) is unchanged, only the entry point/presentation.
    return render_template(
        "challenges.html", active_nav="challenges", i18n_page="challenges",
    )


# ---------- Admin: signups list ----------
# Own account, own eyes only -- see ADMIN_EMAILS. 404 (not 403) for
# non-admins so the page's existence isn't revealed to anyone else; the
# app-wide login gate already keeps logged-out visitors out entirely.
#
# Thailand time (ICT, UTC+7) for the owner viewing this page, both for
# "today" meaning Bangkok's calendar day and for the displayed timestamps.
# A fixed offset, not a zoneinfo lookup, on purpose: Thailand has never
# observed DST, so there's no rule to get wrong, and it works identically
# on a Windows dev box and the Linux container without needing the
# tzdata package installed either place.
THAILAND_TZ = timezone(timedelta(hours=7))
ADMIN_SIGNUP_RANGES = {"today", "week", "month", "all"}


@app.route("/admin/users", methods=["GET"])
def admin_users():
    user = current_user()
    if not user or (user.get("email") or "").lower() not in ADMIN_EMAILS:
        abort(404)

    range_key = request.args.get("range", "today")
    if range_key not in ADMIN_SIGNUP_RANGES:
        range_key = "today"

    now_th = datetime.now(timezone.utc).astimezone(THAILAND_TZ)
    if range_key == "today":
        since_th = now_th.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_key == "week":
        since_th = now_th - timedelta(days=7)
    elif range_key == "month":
        since_th = now_th - timedelta(days=30)
    else:
        since_th = None
    # created_at is stored as SQLite's naive UTC datetime('now'), so the
    # cutoff passed to the query has to be naive UTC too.
    since = since_th.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S") if since_th else None

    users = list_users(since=since)
    for u in users:
        created_utc = datetime.strptime(u["created_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        u["created_at_th"] = created_utc.astimezone(THAILAND_TZ).strftime("%Y-%m-%d %H:%M") + " ICT"

    return render_template(
        "admin_users.html",
        active_nav="",
        users=users,
        range_key=range_key,
        ranges=list(ADMIN_SIGNUP_RANGES),
    )


def _utc_str_to_ict(value):
    """Stored naive-UTC 'YYYY-MM-DD HH:MM:SS' -> displayed Thailand time."""
    try:
        dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.astimezone(THAILAND_TZ).strftime("%Y-%m-%d %H:%M") + " ICT"
    except (TypeError, ValueError):
        return value or ""


# Friendly display names for tracked page endpoints -- anything untracked
# here falls back to the raw endpoint name, so new pages still show up.
ADMIN_PAGE_LABELS = {
    "home": "Home", "analyze_page": "Analyze", "analyze_latest": "Analyze (latest result)",
    "workouts": "Workouts", "nutrition": "Nutrition", "coach": "Coach", "hyrox": "HYROX",
    "friends": "Friends", "settings": "Settings", "weight_history": "Weight History",
    "logging_history": "Logging History", "streaks": "Streaks", "onboarding": "Onboarding",
    "admin_users": "Admin: Signups", "admin_user_detail": "Admin: User Detail",
    "auth.login_page": "Login page", "auth.signup_page": "Signup page",
    "analyze": "Analyze (upload)", "result_latest": "Analyze result",
}

ADMIN_FEATURE_LABELS = {
    "workout_analysis": "Workout analyses (AI)", "food_scan": "Food photo scans (AI)",
    "coach_chat_message": "Coach chat messages", "analyze_chat_message": "Analysis chat messages",
    "workout_chat_message": "Workout chat messages",
    "hyrox_ai_analysis": "HYROX race analyses (AI)", "challenge_submission": "Challenge submissions",
    "food_logged": "Foods logged", "weight_logged": "Weigh-ins logged", "barcode_scan": "Barcode scans",
}


@app.route("/admin/users/<int:user_id>", methods=["GET"])
def admin_user_detail(user_id):
    admin = current_user()
    if not admin or (admin.get("email") or "").lower() not in ADMIN_EMAILS:
        abort(404)

    target = get_user_by_id(user_id)
    if not target:
        abort(404)

    # Page views + feature uses from the lifetime counters (collected from
    # the moment this feature deployed onward -- there's no historical
    # clickstream to backfill from).
    page_views, feature_uses = [], []
    for ev in get_usage_events(user_id):
        kind, _, name = ev["event"].partition(":")
        entry = {
            "label": (ADMIN_PAGE_LABELS if kind == "page" else ADMIN_FEATURE_LABELS).get(name, name),
            "count": ev["count"],
            "last_at": _utc_str_to_ict(ev["last_at"]),
        }
        (page_views if kind == "page" else feature_uses).append(entry)

    # What they've actually logged, from the account-synced localStorage
    # mirror (user_data, values already JSON-decoded by get_all_user_data).
    # Shape-checked defensively -- any malformed blob just renders as empty
    # rather than 500ing the admin page.
    synced = get_all_user_data(user_id)

    def synced_dict(key):
        value = synced.get(key)
        return value if isinstance(value, dict) else {}

    foods, total_foods = [], 0
    nutrition_log = synced_dict("repcheck_nutrition_log_v1")
    for date_iso in sorted(nutrition_log, reverse=True):
        entries = nutrition_log.get(date_iso) or []
        if not isinstance(entries, list):
            continue
        total_foods += len(entries)
        for e in entries:
            if len(foods) < 15 and isinstance(e, dict):
                foods.append({"date": date_iso, "name": e.get("food") or e.get("name") or "?", "grams": e.get("grams")})

    workouts, total_exercises = [], 0
    workout_log = synced_dict("repcheck_workout_log_v2")
    for date_iso in sorted(workout_log, reverse=True):
        entries = workout_log.get(date_iso) or []
        if not isinstance(entries, list):
            continue
        total_exercises += len(entries)
        for e in entries:
            if len(workouts) < 15 and isinstance(e, dict):
                workouts.append({"date": date_iso, "name": e.get("exercise") or "?", "sets": len(e.get("sets") or [])})

    weight_log = synced_dict("repcheck_weight_log_v1")
    latest_weight = None
    if weight_log:
        latest_day = max(weight_log)
        entry = weight_log.get(latest_day) or {}
        if isinstance(entry, dict) and entry.get("kg"):
            latest_weight = {"date": latest_day, "kg": entry["kg"]}

    analyses = get_analyze_results(user_id, limit=10)
    for a in analyses:
        a["created_at_th"] = _utc_str_to_ict(a["created_at"])

    return render_template(
        "admin_user_detail.html",
        active_nav="",
        target=target,
        created_at_th=_utc_str_to_ict(target["created_at"]),
        page_views=page_views,
        feature_uses=feature_uses,
        counts=get_user_activity_counts(user_id),
        foods=foods,
        total_foods=total_foods,
        workouts=workouts,
        total_exercises=total_exercises,
        weight_entries=len(weight_log),
        latest_weight=latest_weight,
        analyses=analyses,
    )


@app.route("/admin/export-db", methods=["GET"])
def admin_export_db():
    # Lets the owner pull a consistent snapshot of the live SQLite file
    # (e.g. from Render) for local inspection with user_report.py, without
    # SSHing into the box. Same ADMIN_EMAILS / 404 gate as the other admin
    # routes. Uses sqlite3's backup API rather than just streaming DB_PATH
    # so a concurrent write on the live server can't hand back a torn file.
    user = current_user()
    if not user or (user.get("email") or "").lower() not in ADMIN_EMAILS:
        abort(404)

    import sqlite3
    import tempfile

    fd, snapshot_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(snapshot_path)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()

    response = send_file(
        snapshot_path,
        mimetype="application/x-sqlite3",
        as_attachment=True,
        download_name="repcheck_production.db",
    )
    response.call_on_close(lambda: os.unlink(snapshot_path))
    return response


@app.route("/weight-history", methods=["GET"])
def weight_history():
    # Client-side rendered from repcheck_weight_log_v1, same as everything
    # else coaching.js owns — no server-side weight data to pass in here.
    return render_template("weight_history.html", active_nav="nutrition", i18n_page="weightHistory")


@app.route("/logging-history", methods=["GET"])
def logging_history():
    # Same "client-side rendered from localStorage" pattern as
    # /weight-history above -- reads repcheck_nutrition_log_v1 and
    # repcheck_day_status_v1 directly, same keys/status logic as the
    # Daily logging card on the nutrition page (static/coaching.js), just
    # expanded to a full month of circles instead of one week's strip.
    return render_template("logging_history.html", active_nav="nutrition", i18n_page="loggingHistory")


@app.route("/nutrition/full-stats", methods=["GET"])
def nutrition_full_stats():
    # Same "client-side rendered from localStorage" pattern as
    # /weight-history above -- reads repcheck_nutrition_log_v1 and
    # repcheck_nutrition_goals_v1 directly. Linked from the home page's
    # "Calories & macros" card ("Full stats" pill) -- the full 7-day,
    # day-by-day macro/calorie chart that card only shows a single-day
    # snapshot of.
    return render_template("full_stats.html", active_nav="nutrition", i18n_page="fullStats")


@app.route("/streaks", methods=["GET"])
def streaks():
    # Same "client-side rendered from localStorage" pattern as
    # /weight-history and /logging-history above -- reads
    # repcheck_workout_log_v2 and repcheck_nutrition_log_v1 directly, same
    # activity/streak logic as the home page's streak tile
    # (templates/home.html), just expanded into its own page with a
    # current/longest streak summary and a full month pictograph.
    return render_template("streaks.html", active_nav="home", i18n_page="streaks")


@app.route("/api/account", methods=["POST"])
def api_account_update():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    payload = request.get_json(silent=True) or {}
    error = update_account(user["id"], name=payload.get("name"), email=payload.get("email"))
    if error:
        return jsonify({"ok": False, "error": error}), 400
    return jsonify({"ok": True})


# ---------- Friends ----------
@app.route("/api/friends", methods=["GET"])
def api_friends():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    return jsonify({
        "ok": True,
        "code": get_or_create_friend_code(user["id"]),
        "friends": [{"id": f["id"], "name": f["name"]} for f in get_friends(user["id"])],
    })


@app.route("/api/friends/qr.png", methods=["GET"])
def api_friends_qr():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    import io

    import qrcode

    # Encode a real link, not the bare code -- scanning with the in-app
    # scanner still works exactly the same (it reads the code out of the
    # query string), but this way scanning with the phone's own camera
    # app or any other QR reader opens RepCheck directly to the add-friend
    # flow instead of just showing an inert text string to copy by hand.
    add_url = f"{request.host_url}friends?add={get_or_create_friend_code(user['id'])}"
    img = qrcode.make(add_url, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


@app.route("/api/friends/add", methods=["POST"])
def api_friends_add():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    payload = request.get_json(silent=True) or {}
    code = (payload.get("code") or "").strip()
    if not code:
        return jsonify({"ok": False, "error": "Enter a friend code."}), 400
    other = get_user_by_friend_code(code)
    if not other:
        return jsonify({"ok": False, "error": "No user found with that code."}), 404
    if other["id"] == user["id"]:
        return jsonify({"ok": False, "error": "That's your own code."}), 400
    add_friendship(user["id"], other["id"])
    return jsonify({"ok": True, "friend": {"id": other["id"], "name": other["name"]}})


# ---------- Challenges ----------
@app.route("/api/challenges", methods=["GET"])
def api_challenges():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    return jsonify({"ok": True, "challenges": get_visible_challenges(user["id"]), "me": user["id"]})


# Fixed reference date so the rotation is stable across restarts and for
# every user at once — no per-user/per-challenge state needed, "today's
# exercise" is just a pure function of the calendar date. Cycles through
# CHALLENGE_EXERCISES in its declared order (push-ups -> sit-ups ->
# pull-ups -> push-ups -> ...), forever.
_CHALLENGE_ROTATION_EPOCH = date(2026, 1, 1)
_CHALLENGE_ROTATION_ORDER = list(CHALLENGE_EXERCISES.keys())


def get_todays_challenge_exercise():
    days_since_epoch = (date.today() - _CHALLENGE_ROTATION_EPOCH).days
    return _CHALLENGE_ROTATION_ORDER[days_since_epoch % len(_CHALLENGE_ROTATION_ORDER)]


@app.route("/api/challenges", methods=["POST"])
def api_challenges_create():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    # The exercise is no longer a user choice -- one exercise rotates in
    # per day for everybody, so there's nothing to read from the request
    # body anymore.
    exercise = get_todays_challenge_exercise()
    if has_submitted_today(user["id"], exercise):
        return jsonify({
            "ok": False,
            "error": "You've already recorded today's attempt — come back tomorrow.",
            "limitReached": True,
        }), 429
    challenge_id = create_challenge(user["id"], exercise)
    return jsonify({"ok": True, "id": challenge_id, "exercise": exercise})


@app.route("/api/challenges/today", methods=["GET"])
def api_challenges_today():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    exercise = get_todays_challenge_exercise()
    return jsonify({
        "ok": True,
        "exercise": exercise,
        "label": CHALLENGE_EXERCISES[exercise]["label"],
        "attempted": has_submitted_today(user["id"], exercise),
    })


@app.route("/api/challenges/<int:challenge_id>/submit", methods=["POST"])
def api_challenge_submit(challenge_id):
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    challenge = get_challenge(challenge_id)
    if not challenge:
        return jsonify({"ok": False, "error": "Challenge not found."}), 404
    # Re-checked here (on top of the check in api_challenges_create) in case
    # the record modal was left open across a day boundary, or another tab
    # already used up today's attempt for this exercise in the meantime.
    if has_submitted_today(user["id"], challenge["exercise"]):
        return jsonify({
            "ok": False,
            "error": "You've already recorded an attempt for this exercise today — try again tomorrow.",
            "limitReached": True,
        }), 429

    file = request.files.get("video")
    if not file or not file.filename:
        return jsonify({"ok": False, "error": "No video uploaded."}), 400
    # .webm is deliberately allowed here (on top of ALLOWED_EXTENSIONS)
    # because the in-app recorder uses MediaRecorder, which produces
    # video/webm in every major browser — the old check only allowed
    # upload-from-file extensions, so every in-app recorded attempt was
    # rejected before it ever reached the rep counter.
    ext = Path(secure_filename(file.filename)).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS and ext != ".webm":
        return jsonify({"ok": False, "error": "Unsupported video format."}), 400

    raw_path = UPLOAD_DIR / f"challenge_{challenge_id}_{user['id']}_{uuid.uuid4().hex}{ext}"
    trimmed_path = raw_path.with_name(raw_path.stem + "_25s.mp4")
    file.save(raw_path)
    try:
        result = analyze_reps(raw_path, challenge["exercise"], trimmed_path=trimmed_path)
    except RepCountError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception:
        # Anything else here is an internal failure (e.g. a raw Gemini SDK
        # error) whose message is developer jargon, not something a user
        # can act on -- log it for debugging but never surface it raw, same
        # reasoning as RepCountError's use in video_trimmer.py.
        traceback.print_exc()
        return jsonify({"ok": False, "error": "An error has occurred. Please record again."}), 500
    finally:
        # The clips only exist to be counted — don't hoard user videos.
        for p in (raw_path, trimmed_path):
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass

    save_submission(challenge_id, user["id"], result["reps"], result["notes"])
    _track_feature("challenge_submission")
    rejected = result.get("rejected", 0)
    return jsonify({
        "ok": True,
        "exercise": challenge["exercise"],   # so the result screen names the movement
        "reps": result["reps"],              # valid reps, counted toward the leaderboard
        "rejected": rejected,
        "total": result["reps"] + rejected,  # every attempt detected, valid or not
        "notes": result["notes"],
    })


@app.route("/api/leaderboard", methods=["GET"])
def api_leaderboard():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    scope = request.args.get("scope", "friends")
    limit = request.args.get("limit", type=int)

    if scope == "global":
        user_ids = None
    else:
        friend_ids = [f["id"] for f in get_friends(user["id"])]
        user_ids = [user["id"]] + friend_ids

    # Ranked by total reps accumulated across every exercise combined
    # (push-ups + sit-ups + pull-ups all feed the same running total) --
    # see get_total_reps_leaderboard's docstring. Always fetched
    # unlimited so "my rank" is correct even when it falls outside
    # whatever `limit` the caller wants displayed (e.g. rank 80 of 200 on
    # the global board, which a limit=50 list would never include).
    all_rows = get_total_reps_leaderboard(user_ids=user_ids)
    my_rank = None
    for i, row in enumerate(all_rows):
        if row["user_id"] == user["id"]:
            my_rank = {"rank": i + 1, "total_reps": row["total_reps"], "name": row["name"]}
            break

    return jsonify({
        "ok": True,
        "scope": scope,
        "me": user["id"],
        "leaderboard": all_rows[:limit] if limit else all_rows,
        "totalEntries": len(all_rows),
        "myRank": my_rank,
    })


HYROX_GENDERS = {"men", "women"}
HYROX_CATEGORIES = {"open", "pro"}
HYROX_FORMATS = {"singles", "doubles"}
# Anything faster than this for a full race is not a real finish (matches
# the same implausibly-fast guard static/hyrox.js already applies before
# a run is even offered to save locally) -- rejected here too so a bad
# client request can't pollute the global leaderboard.
HYROX_MIN_PLAUSIBLE_SECONDS = 20 * 60


@app.route("/api/hyrox/history-entry", methods=["POST"])
def api_hyrox_history_entry():
    # Authoritative, synchronous "save one finished race" write path.
    # hyrox.js's saveHistory() previously only wrote to localStorage,
    # which the generic /api/sync/<key> route then re-sends as a whole-
    # blob PUT, fire-and-forget from the browser -- good enough for most
    # synced data, but it was the only path a finished race ever went
    # through, making it vulnerable to quietly vanishing if that write
    # raced with another save. finishRace() now calls this directly for
    # every race, so a time is only durably "saved" once the server has
    # actually confirmed it.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    entry = payload.get("entry")
    if not isinstance(entry, dict) or not entry.get("id"):
        return jsonify({"ok": False, "error": "Invalid entry."}), 400

    history = append_hyrox_history_entry(user["id"], entry)
    return jsonify({"ok": True, "history": history})


@app.route("/api/hyrox/history-entry", methods=["DELETE"])
def api_hyrox_history_entry_delete():
    # Authoritative "remove one race" path -- counterpart to the POST
    # above. Needed as its own endpoint now that the generic /api/sync/<key>
    # route merges the HYROX history instead of overwriting it (see
    # database.py's MERGE_LOG_KEYS): a merge can only ever bring entries
    # back from an older stored copy, never remove one.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    entry_id = payload.get("entry_id")
    if not entry_id:
        return jsonify({"ok": False, "error": "Invalid entry."}), 400

    history = remove_hyrox_history_entry(user["id"], str(entry_id))
    return jsonify({"ok": True, "history": history})


@app.route("/api/hyrox/results", methods=["POST"])
def api_create_hyrox_result():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    gender = str(payload.get("gender") or "").strip()
    category = str(payload.get("category") or "").strip()
    format_ = str(payload.get("format") or "").strip()
    try:
        total_seconds = float(payload.get("total_seconds"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Invalid time."}), 400

    if gender not in HYROX_GENDERS or category not in HYROX_CATEGORIES or format_ not in HYROX_FORMATS:
        return jsonify({"ok": False, "error": "Invalid gender, category, or format."}), 400
    if total_seconds < HYROX_MIN_PLAUSIBLE_SECONDS:
        return jsonify({"ok": False, "error": "That time isn't a plausible race finish."}), 400

    result_id = create_hyrox_result(user["id"], gender, category, format_, total_seconds)
    return jsonify({"ok": True, "id": result_id})


@app.route("/api/hyrox/leaderboard", methods=["GET"])
def api_hyrox_leaderboard():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    gender = request.args.get("gender", "")
    category = request.args.get("category", "")
    format_ = request.args.get("format", "")
    if gender not in HYROX_GENDERS or category not in HYROX_CATEGORIES or format_ not in HYROX_FORMATS:
        return jsonify({"ok": False, "error": "Invalid gender, category, or format."}), 400

    rows = get_hyrox_leaderboard(gender, category, format_)
    my_rank = None
    for i, row in enumerate(rows):
        if row["user_id"] == user["id"]:
            my_rank = {"rank": i + 1, "best_seconds": row["best_seconds"], "name": row["name"]}
            break

    return jsonify({
        "ok": True,
        "leaderboard": rows[:50],
        "totalEntries": len(rows),
        "me": my_rank,
    })


@app.route("/api/coach-chat", methods=["POST"])
def api_coach_chat():
    # Same reasoning as /api/analyze-food: every message must count against
    # an account, so no anonymous access.
    if not current_user():
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message", "")).strip()
    history = payload.get("history") or []

    if not message:
        return jsonify({"ok": False, "error": "Message can't be empty."}), 400
    if not isinstance(history, list):
        return jsonify({"ok": False, "error": "Invalid history."}), 400

    blocked, retry = _rate_limit_blocked("ai_chat")
    if blocked:
        return jsonify({"ok": True, **_chat_limit_response(retry)})

    result = get_coach_reply(message, history)
    _rate_limit_record("ai_chat")
    _track_feature("coach_chat_message")
    return jsonify({
        "ok": True,
        "reply": result["reply"],
        "limited": result["limited"],
        "retry_after_seconds": result["retry_after_seconds"],
    })


@app.route("/api/analyze-chat", methods=["POST"])
def api_analyze_chat():
    # Same reasoning as /api/analyze-food: every message must count against
    # an account, so no anonymous access.
    if not current_user():
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message", "")).strip()
    history = payload.get("history") or []
    context = payload.get("context") or {}

    if not message:
        return jsonify({"ok": False, "error": "Message can't be empty."}), 400
    if not isinstance(history, list):
        return jsonify({"ok": False, "error": "Invalid history."}), 400
    if not isinstance(context, dict):
        return jsonify({"ok": False, "error": "Invalid context."}), 400

    blocked, retry = _rate_limit_blocked("ai_chat")
    if blocked:
        return jsonify({"ok": True, **_chat_limit_response(retry)})

    result = get_analysis_chat_reply(message, history, context)
    _rate_limit_record("ai_chat")
    _track_feature("analyze_chat_message")
    return jsonify({
        "ok": True,
        "reply": result["reply"],
        "limited": result["limited"],
        "retry_after_seconds": result["retry_after_seconds"],
    })


@app.route("/api/workout-chat", methods=["POST"])
def api_workout_chat():
    # Same reasoning as /api/analyze-food: every message must count against
    # an account, so no anonymous access.
    if not current_user():
        return jsonify({"ok": False, "error": "Not logged in."}), 401

    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message", "")).strip()
    history = payload.get("history") or []
    context = payload.get("context") or {}

    if not message:
        return jsonify({"ok": False, "error": "Message can't be empty."}), 400
    if not isinstance(history, list):
        return jsonify({"ok": False, "error": "Invalid history."}), 400
    if not isinstance(context, dict):
        return jsonify({"ok": False, "error": "Invalid context."}), 400

    blocked, retry = _rate_limit_blocked("ai_chat")
    if blocked:
        return jsonify({"ok": True, **_chat_limit_response(retry)})

    result = get_workout_chat_reply(message, history, context)
    _rate_limit_record("ai_chat")
    _track_feature("workout_chat_message")
    return jsonify({
        "ok": True,
        "reply": result["reply"],
        "limited": result["limited"],
        "retry_after_seconds": result["retry_after_seconds"],
    })


@app.route("/api/hyrox/analyze", methods=["POST"])
def api_hyrox_analyze():
    payload = request.get_json(silent=True) or {}
    race = payload.get("race") or {}
    if not isinstance(race, dict):
        return jsonify({"ok": False, "error": "Invalid race."}), 400

    segments = race.get("segments")
    if not isinstance(segments, list) or not segments:
        return jsonify({"ok": False, "error": "Race has no segments to analyze."}), 400

    result = get_hyrox_race_analysis(race)
    _track_feature("hyrox_ai_analysis")
    return jsonify({
        "ok": True,
        "overall": result["overall"],
        "overall_detail": result["overall_detail"],
        "tips": result["tips"],
        "limited": result["limited"],
        "retry_after_seconds": result["retry_after_seconds"],
    })


def _optional_positive_float(value):
    """A body weight from the coaching profile, or None. Everything about
    that profile is optional here (the split wizard never asks for it, it
    just reuses it if it's there), so anything missing, non-numeric, or
    physically implausible is treated the same as "not provided" rather
    than failing the request -- a bad weight should cost the prompt one
    detail, not cost the user their plan."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if 20 <= number <= 500 else None


@app.route("/api/generate-split", methods=["POST"])
def api_generate_split():
    payload = request.get_json(silent=True) or {}
    split_type = str(payload.get("split_type", "")).strip()
    days_per_week = payload.get("days_per_week")
    custom_days = payload.get("custom_days") or []
    # Free text the user typed themselves (e.g. "I want more mobility and
    # to gain muscle") -- steers day-type/exercise selection in
    # generate_split_plan(), never trusted as exercise names directly.
    goal = str(payload.get("goal") or "").strip()[:300]
    # "home" / "gym" / "hybrid" from the wizard's "Where do you usually
    # train?" question -- generate_split_plan() treats anything else
    # (missing, unrecognized) as no preference, same as before this
    # question existed.
    location = str(payload.get("location") or "").strip().lower()
    # Exercises the user hand-picked per custom day from the categorized
    # picker (see workouts.html's "plan your own split" flow) -- each
    # name is checked against the real library so nothing unvalidated
    # reaches the AI prompt or the fallback plan.
    valid_exercise_names = set(WORKOUT_EXERCISES)
    raw_custom_days_exercises = payload.get("custom_days_exercises")
    custom_days_exercises = None
    if isinstance(raw_custom_days_exercises, dict):
        custom_days_exercises = {}
        for label, names in raw_custom_days_exercises.items():
            if not isinstance(names, list):
                continue
            cleaned = [str(n) for n in names if str(n) in valid_exercise_names]
            if cleaned:
                custom_days_exercises[str(label)[:60]] = cleaned

    if split_type not in {"ppl", "upper_lower", "full_body", "bro_split", "custom", "ai_suggest"}:
        return jsonify({"ok": False, "error": "Unknown split type."}), 400
    try:
        days_per_week = int(days_per_week)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "days_per_week must be a number."}), 400
    if not 1 <= days_per_week <= 7:
        return jsonify({"ok": False, "error": "days_per_week must be between 1 and 7."}), 400
    if split_type == "custom" and not custom_days:
        return jsonify({"ok": False, "error": "Please name at least one custom day."}), 400

    # "Let AI build it": the user never picked a split type, so the AI picks
    # one for them (see suggest_split_plan) from just their training days,
    # their goal in their own words, and whatever the coaching profile knows
    # about them. Every profile field is optional -- that profile is filled
    # in from a different part of the app, so a user can reach this wizard
    # having never opened it, and the plan still has to come out sensible.
    if split_type == "ai_suggest":
        gender = str(payload.get("gender") or "").strip().lower()
        gender = gender if gender in {"male", "female"} else None
        plan = suggest_split_plan(
            days_per_week,
            goal=goal,
            gender=gender,
            goal_weight_kg=_optional_positive_float(payload.get("goal_weight_kg")),
            current_weight_kg=_optional_positive_float(payload.get("current_weight_kg")),
            location=location,
        )
        _track_feature("split_ai_suggested")
        return jsonify({"ok": True, **plan})

    plan = generate_split_plan(split_type, days_per_week, custom_days, goal, custom_days_exercises, location)
    return jsonify({"ok": True, **plan})


@app.route("/api/coaching/body-fat-ranges", methods=["GET"])
def api_coaching_body_fat_ranges():
    gender = request.args.get("gender", "male")
    ranges = FEMALE_BODY_FAT_RANGES if gender == "female" else MALE_BODY_FAT_RANGES
    return jsonify({"ok": True, "ranges": ranges})


def _validate_coaching_profile(payload):
    aspiration = payload.get("aspiration")
    gender = payload.get("gender")
    activity_level = payload.get("activity_level")
    protein_preference = payload.get("protein_preference")
    body_fat_range_id = payload.get("body_fat_range_id")
    # Defaults to "balanced" rather than requiring it, so older saved
    # profiles from before this question existed (no diet_preference in
    # their payload at all) keep working exactly as before instead of
    # failing validation.
    diet_preference = payload.get("diet_preference") or "balanced"

    if aspiration not in {"lose", "maintain", "gain"}:
        return None, "Please choose a goal: lose, maintain, or gain weight."
    if gender not in {"male", "female"}:
        return None, "Please choose a gender."
    if activity_level not in {"none", "cardio_only", "lift_only", "lift_and_cardio"}:
        return None, "Please choose an activity level."
    if protein_preference not in {"low_moderate", "moderate", "high", "highest"}:
        return None, "Please choose a protein intake level."
    if diet_preference not in {"balanced", "low_fat", "low_carb", "keto"}:
        return None, "Please choose a diet type."
    valid_range_ids = {r["id"] for r in (FEMALE_BODY_FAT_RANGES if gender == "female" else MALE_BODY_FAT_RANGES)}
    if body_fat_range_id not in valid_range_ids:
        return None, "Please choose a body type."
    try:
        weight_kg = float(payload.get("weight_kg"))
        # 35kg floor rather than a lower "technically possible" number --
        # below this the Katch-McArdle BMR/protein-per-kg-lean math this
        # profile feeds into stops producing safe, realistic targets, and
        # this app isn't built/reviewed for that population (e.g. children,
        # or a weight someone in eating-disorder recovery might enter).
        if not 35 <= weight_kg <= 300:
            raise ValueError
    except (TypeError, ValueError):
        return None, "Please enter a realistic weight of at least 35 kg."

    # Height is collected for the profile (and shown in the user's chosen
    # units); Katch-McArdle doesn't need it, so it's stored, not computed on.
    height_cm = None
    if payload.get("height_cm") is not None:
        try:
            height_cm = float(payload.get("height_cm"))
            if not 100 <= height_cm <= 250:
                raise ValueError
        except (TypeError, ValueError):
            return None, "Please choose a realistic height."

    # An explicit null has to mean "not supplied", exactly like an absent
    # key -- dict.get(key, default) only falls back when the key is MISSING,
    # so a payload carrying "loss_rate_pct": null returned None and
    # float(None) raised, failing the whole request. That is reachable in
    # normal use, not a theoretical edge: the client stores whichever rate
    # doesn't match the user's goal as null (see onboarding.js's
    # `w.aspiration === "lose" ? w.lossRatePct : null`) and always sends
    # both keys, so a profile that ever held null for the rate its current
    # goal needs could never complete a check-in -- every attempt 400'd
    # with a message about a rate the user was never asked to pick.
    raw_loss_rate = payload.get("loss_rate_pct")
    loss_rate_pct = None
    if aspiration == "lose":
        try:
            if raw_loss_rate is None:
                raw_loss_rate = LOSS_RATE_DEFAULT_PCT
            loss_rate_pct = float(raw_loss_rate)
            if not LOSS_RATE_MIN_PCT - 0.01 <= loss_rate_pct <= LOSS_RATE_MAX_PCT + 0.01:
                raise ValueError
        except (TypeError, ValueError):
            return None, "Please choose a realistic weekly weight loss rate."

    raw_gain_rate = payload.get("gain_rate_pct")
    gain_rate_pct = None
    if aspiration == "gain":
        try:
            if raw_gain_rate is None:
                raw_gain_rate = GAIN_RATE_DEFAULT_PCT
            gain_rate_pct = float(raw_gain_rate)
            if not GAIN_RATE_MIN_PCT - 0.01 <= gain_rate_pct <= GAIN_RATE_MAX_PCT + 0.01:
                raise ValueError
        except (TypeError, ValueError):
            return None, "Please choose a realistic weekly weight gain rate."

    return {
        "aspiration": aspiration,
        "gender": gender,
        "activity_level": activity_level,
        "protein_preference": protein_preference,
        "diet_preference": diet_preference,
        "body_fat_range_id": body_fat_range_id,
        "weight_kg": weight_kg,
        "height_cm": height_cm,
        "loss_rate_pct": loss_rate_pct,
        "gain_rate_pct": gain_rate_pct,
    }, None


@app.route("/api/coaching/calculate", methods=["POST"])
def api_coaching_calculate():
    payload = request.get_json(silent=True) or {}
    profile, error = _validate_coaching_profile(payload)
    if error:
        return jsonify({"ok": False, "error": error}), 400

    targets = calculate_targets(profile)

    distribution = None
    if payload.get("distribution") == "weekly":
        training_days = set(payload.get("training_days") or [])
        distribution = distribute_weekly_calories(
            targets["calories"], targets["protein"], targets["fat"], targets["carbs"], training_days
        )

    return jsonify({"ok": True, "targets": targets, "distribution": distribution})


def _filter_iso_date_list(raw, limit=31):
    """Used for high_carb_days/bloating_days below -- these get "".join()-ed
    straight into the Gemini prompt in checkin_analyzer.py, and unlike every
    other value reaching that prompt (all numeric), they're client-supplied
    strings. Slices to `limit` BEFORE filtering so a client can't pad the
    array to force wasted regex work; `limit` defaults to 31 (a generous
    month -- a check-in week only ever has 7 dates)."""
    if not isinstance(raw, list):
        return []
    return [d for d in raw[:limit] if isinstance(d, str) and ISO_DATE_RE.match(d)]


@app.route("/api/coaching/weekly-adjustment", methods=["POST"])
def api_coaching_weekly_adjustment():
    payload = request.get_json(silent=True) or {}
    profile, error = _validate_coaching_profile(payload)
    if error:
        return jsonify({"ok": False, "error": error}), 400

    current_targets = payload.get("current_targets")
    week_weight_entries = payload.get("week_weight_entries") or []
    week_calorie_days = payload.get("week_calorie_days") or []
    if not isinstance(current_targets, dict) or "calories" not in current_targets:
        return jsonify({"ok": False, "error": "Missing current_targets."}), 400

    # Optional self-reported context (see checkin_analyzer.py's
    # _build_context_flags_line() and _filter_iso_date_list() above).
    high_carb_days = _filter_iso_date_list(payload.get("high_carb_days"))
    bloating_days = _filter_iso_date_list(payload.get("bloating_days"))

    # The deterministic trend calculation always runs first, both as the
    # anchor/fallback for the Gemini call below and as the answer on its
    # own if that call fails (see checkin_analyzer.py's module docstring).
    baseline = weekly_adjustment(profile, current_targets, week_weight_entries, week_calorie_days)

    photo_ids = payload.get("photo_ids") or []
    user = current_user()
    photo_files = []
    if photo_ids and user:
        for raw_id in photo_ids[:2]:  # front + back at most
            try:
                photo = get_progress_photo(int(raw_id))
            except (TypeError, ValueError):
                continue
            if not photo or photo["user_id"] != user["id"]:
                continue
            path = PROGRESS_PHOTOS_DIR / photo["filename"]
            if not path.exists():
                continue
            mime_type = mimetypes.guess_type(photo["filename"])[0] or "image/jpeg"
            photo_files.append((path.read_bytes(), mime_type))

    try:
        ai_result = analyze_checkin(profile, week_weight_entries, week_calorie_days, baseline, photo_files, high_carb_days, bloating_days)
        adjustment = apply_calorie_delta(profile, current_targets, ai_result["delta"], ai_result["reason"])
    except CheckinAnalysisError:
        # Gemini call failed (no API key, hiccup, bad response) -- fall
        # back to the deterministic number rather than failing the whole
        # check-in the user just spent time completing.
        adjustment = baseline

    return jsonify({"ok": True, "adjustment": adjustment})


@app.route("/analyze", methods=["POST"])
def analyze():
    wants_json = "application/json" in request.headers.get("Accept", "")

    def fail(message):
        if wants_json:
            return jsonify({"ok": False, "error": message}), 400
        return render_template(
            "index.html", exercise_library=EXERCISE_LIBRARY, active_nav="analyze", i18n_page="analyze",
            exercise_videos=EXERCISE_VIDEOS, error=message
        )

    video_file = request.files.get("video")
    exercise = request.form.get("exercise", "").strip()

    if not video_file or video_file.filename == "":
        return fail("Please choose a video file.")

    if not exercise:
        return fail("Please choose an exercise.")

    suffix = Path(video_file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        return fail(f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    blocked, retry = _rate_limit_blocked("workout_analysis")
    if blocked:
        limit = RATE_LIMITS["workout_analysis"][0]
        plural = "analysis" if limit == 1 else "analyses"
        return fail(f"You've used your {limit} workout {plural} for now — try again in {_friendly_wait(retry)}.")

    job_id = uuid.uuid4().hex[:12]
    safe_name = secure_filename(video_file.filename) or "upload"
    raw_path = UPLOAD_DIR / f"{job_id}_{safe_name}"
    trimmed_path = UPLOAD_DIR / f"{job_id}_trimmed{suffix}"

    video_file.save(raw_path)

    try:
        result = run_pipeline(raw_path, exercise, trimmed_path=trimmed_path)
        # Only count a use once the analysis actually succeeded, so a failed
        # Gemini call doesn't burn the user's one analysis for the day.
        _rate_limit_record("workout_analysis")
        _track_feature("workout_analysis")
        sections = split_feedback_sections(result["feedback"], result["overall_score"])

        # Model name / clip duration are useful for debugging but not
        # shown to the user — keep them in the server log only.
        app.logger.info(
            "Analyzed %s with %s: %.1fs clip, %s reps",
            result["exercise_label"], result["model"],
            result["duration_seconds"], result["reps"],
        )

        # For a logged-in user the analysis (and the trimmed clip it was
        # run on) is kept so the history view can replay it -- the raw
        # upload is still always deleted (see the `finally` below).
        # Anonymous/local-only use has no account to store against, so
        # everything is deleted as before.
        user = current_user()
        new_result_id = None
        video_filename = None
        if user:
            try:
                video_filename = f"{user['id']}_{job_id}{suffix}"
                trimmed_path.replace(ANALYZE_VIDEOS_DIR / video_filename)
            except OSError:
                video_filename = None  # analysis still saves, just without a replayable clip
            new_result_id = save_analyze_result(
                user["id"], result["exercise_label"], result["overall_score"],
                result["stretch_score"], result["squeeze_score"], result["favored"],
                result["reps"], result["feedback"], video_filename,
            )
            # Bound disk use: drop this user's oldest history entries (and
            # their clips) beyond the newest ANALYZE_HISTORY_KEEP.
            for stale_name in prune_analyze_results(user["id"], keep=ANALYZE_HISTORY_KEEP):
                try:
                    (ANALYZE_VIDEOS_DIR / stale_name).unlink(missing_ok=True)
                except OSError:
                    pass

        # This instant is, for all practical purposes, this analysis's
        # created_at (the DB row was just inserted above) -- used by the
        # AI chat widget to scope its own per-analysis chat thread and
        # start its 24h prompting window (see analyze_chat_widget.js).
        new_result_created_at_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        if wants_json:
            return jsonify({
                "ok": True,
                "id": new_result_id,
                "created_at_ms": new_result_created_at_ms,
                "exercise_label": result["exercise_label"],
                "overall_score": result["overall_score"],
                "stretch_score": result["stretch_score"],
                "squeeze_score": result["squeeze_score"],
                "favored": result["favored"],
                "reps": result["reps"],
                "sections": sections,
                "feedback_text": result["feedback"],
                # Lets the AJAX result view lead with the clip, the same way
                # the server-rendered result.html and the history detail do.
                "video_url": (
                    url_for("analyze_video", result_id=new_result_id)
                    if new_result_id and video_filename else None
                ),
            })

        return render_template(
            "result.html",
            result_id=new_result_id,
            created_at_ms=new_result_created_at_ms,
            exercise_label=result["exercise_label"],
            overall_score=result["overall_score"],
            stretch_score=result["stretch_score"],
            squeeze_score=result["squeeze_score"],
            favored=result["favored"],
            reps=result["reps"],
            sections=sections,
            feedback_text=result["feedback"],
            tutorial_video_id=get_exercise_video(result["exercise_label"]),
            # Leads the results screen when the clip was kept (logged-in
            # users only -- anonymous runs delete it, and the stage falls
            # back to a flat field).
            video_url=(
                url_for("analyze_video", result_id=new_result_id)
                if new_result_id and video_filename else None
            ),
            active_nav="analyze",
            i18n_page="result",
        )
    except SystemExit as exc:
        return fail(str(exc))
    finally:
        raw_path.unlink(missing_ok=True)
        trimmed_path.unlink(missing_ok=True)


def _render_analyze_result_page(row):
    # Shared by every page that opens one stored analysis in the full
    # video-led result view (analyze_latest below, and
    # analyze_history_detail_page) -- kept in one place so the two can't
    # drift apart on which fields reach result.html.
    sections = split_feedback_sections(row["feedback_text"], row["overall_score"])
    return render_template(
        "result.html",
        result_id=row["id"],
        created_at_ms=_analyze_created_at_ms(row["created_at"]),
        exercise_label=row["exercise_label"],
        overall_score=row["overall_score"],
        stretch_score=row["stretch_score"],
        squeeze_score=row["squeeze_score"],
        favored=row["favored"],
        reps=row["reps"],
        sections=sections,
        feedback_text=row["feedback_text"],
        tutorial_video_id=get_exercise_video(row["exercise_label"]),
        # The clip the analysis ran on leads the results screen (see the
        # .an-stage block in style.css). None when it is no longer on disk
        # -- the layout falls back to a flat stage rather than a dead
        # <video> element.
        video_url=url_for("analyze_video", result_id=row["id"]) if _analyze_video_available(row) else None,
        active_nav="analyze",
        i18n_page="result",
    )


@app.route("/analyze/latest", methods=["GET"])
def analyze_latest():
    # Opens a user's most recent analysis result directly. This is a deep
    # link (bookmark, notification, shared URL) -- the UI itself links to
    # specific analyses via analyze_history_detail_page below, and to the
    # full list via analyze_history_page. Falls back to the upload page for
    # anyone who lands on it without a stored result (logged out, or never
    # analyzed anything yet), rather than erroring.
    user = current_user()
    if not user:
        return redirect(url_for("analyze_page"))
    row = get_latest_analyze_result(user["id"])
    if not row:
        return redirect(url_for("analyze_page"))
    return _render_analyze_result_page(row)


@app.route("/analyze/history", methods=["GET"])
def analyze_history_page():
    # The full log of every analysis this user has stored -- linked from
    # the "View full logs" pill next to the Analyze page's "Recent
    # analyses" strip. That strip already shows the same ANALYZE_HISTORY_KEEP
    # cap this page does (it renders every entry the API returns, no
    # further slicing), just as a horizontally-scrolling row of cards; this
    # page's value is a plain scrollable list that's actually easy to scan
    # past a handful of entries, not more history than the strip has. Either
    # way, nothing here goes beyond ANALYZE_HISTORY_KEEP: that's the
    # server-side cap this user's history is pruned to (see api_analyze()
    # above), so this page already shows everything that still exists.
    user = current_user()
    if not user:
        return redirect(url_for("analyze_page"))
    entries = get_analyze_results(user["id"], limit=ANALYZE_HISTORY_KEEP)
    return render_template(
        "analyze_history.html",
        entries=entries,
        exercise_icons=EXERCISE_ICONS,
        active_nav="analyze",
        i18n_page="analyzeHistory",
    )


@app.route("/analyze/history/<int:result_id>", methods=["GET"])
def analyze_history_detail_page(result_id):
    # Page-level counterpart to api_analyze_history_detail below: opens one
    # specific stored analysis in the full result view, linked from
    # analyze_history_page's list (a plain, bookmarkable URL, rather than
    # the JSON endpoint the "Recent analyses" strip fetches to swap the
    # result view in over AJAX without a page navigation).
    user = current_user()
    if not user:
        return redirect(url_for("analyze_page"))
    row = get_analyze_result(user["id"], result_id)
    if not row:
        return redirect(url_for("analyze_history_page"))
    return _render_analyze_result_page(row)


def _analyze_video_available(row):
    return bool(row.get("video_filename")) and (ANALYZE_VIDEOS_DIR / row["video_filename"]).exists()


def _analyze_created_at_ms(created_at_str):
    # analyze_results.created_at is stored as SQLite's datetime('now')
    # (UTC, "YYYY-MM-DD HH:MM:SS") -- converted to epoch ms here so the AI
    # chat widget can compare it against Date.now() client-side without
    # any date-string parsing of its own (see analyze_chat_widget.js's
    # 24h prompting-window lockout).
    dt = datetime.strptime(created_at_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


@app.route("/api/analyze/history", methods=["GET"])
def api_analyze_history():
    # The Analyze page's "Recent analyses" strip for logged-in users:
    # every stored analysis, newest first, each openable in full via
    # /api/analyze/history/<id> below.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    entries = [
        {
            "id": row["id"],
            "exercise_label": row["exercise_label"],
            "overall_score": row["overall_score"],
            "reps": row["reps"],
            "created_at": row["created_at"],
            "has_video": _analyze_video_available(row),
        }
        for row in get_analyze_results(user["id"], limit=ANALYZE_HISTORY_KEEP)
    ]
    return jsonify({"ok": True, "entries": entries})


@app.route("/api/analyze/history/<int:result_id>", methods=["GET"])
def api_analyze_history_detail(result_id):
    # One stored analysis in the exact shape the fresh-analysis JSON uses
    # (scores + pre-split sections + raw feedback), plus a video_url when
    # the clip it was run on is still on disk, so the client can render it
    # with the same result view.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    row = get_analyze_result(user["id"], result_id)
    if not row:
        return jsonify({"ok": False, "error": "Not found."}), 404
    return jsonify({
        "ok": True,
        "id": row["id"],
        "exercise_label": row["exercise_label"],
        "overall_score": row["overall_score"],
        "stretch_score": row["stretch_score"],
        "squeeze_score": row["squeeze_score"],
        "favored": row["favored"],
        "reps": row["reps"],
        "sections": split_feedback_sections(row["feedback_text"], row["overall_score"]),
        "feedback_text": row["feedback_text"],
        "created_at": row["created_at"],
        "created_at_ms": _analyze_created_at_ms(row["created_at"]),
        "video_url": url_for("analyze_video", result_id=row["id"]) if _analyze_video_available(row) else None,
    })


@app.route("/analyze/video/<int:result_id>", methods=["GET"])
def analyze_video(result_id):
    # Serves the trimmed clip an analysis was run on. Owner-checked, same
    # rule as /api/checkin/photo/<id> -- these files are never exposed via
    # a public static route. conditional=True enables HTTP Range requests,
    # which video elements need for seeking.
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not logged in."}), 401
    row = get_analyze_result(user["id"], result_id)
    if not row or not row.get("video_filename"):
        return jsonify({"ok": False, "error": "Not found."}), 404
    path = ANALYZE_VIDEOS_DIR / row["video_filename"]
    if not path.exists():
        return jsonify({"ok": False, "error": "Not found."}), 404
    return send_file(path, conditional=True)


if __name__ == "__main__":
    # host="0.0.0.0" makes this reachable from other devices on the same
    # Wi-Fi network, not just this machine, at http://<this-pc's-LAN-IP>:5000
    #
    # HTTPS via ssl_context="adhoc" was tried here to enable the in-app
    # live-camera features (barcode/QR scanning need getUserMedia, which
    # requires a secure context off of localhost) -- reverted back to
    # plain HTTP because the self-signed cert's browser trust warning was
    # too much friction. Those camera features are commented out in
    # nutrition.html/friends.html to match (they fall back to photo
    # upload / manual entry instead, both of which work fine over plain
    # HTTP). Re-enable both together if camera scanning comes back:
    # app.run(host="0.0.0.0", port=5000, debug=True, ssl_context="adhoc")
    #
    # threaded=True matters beyond just responsiveness: the onboarding
    # wizard's save() fires several background saves (profile, nutrition
    # goals, split plan) right before navigating to a brand-new page that
    # itself needs an immediate response from this same server. Without
    # threading, Flask's dev server can only handle one request at a time,
    # so that in-flight burst could get starved by the next page's own
    # requests (or vice versa) — this was silently dropping some of the
    # onboarding saves, leaving onboarding_completed=1 with no profile or
    # split plan actually persisted, which then also made the app think
    # onboarding was already done next time (so it never re-asked to fix
    # itself either).
    # Port is env-overridable because the port was hardcoded and every git
    # worktree of this repo runs the SAME app.py -- so a second worktree
    # silently bound 5000 alongside the first instead of failing loudly
    # (Windows allows the duplicate bind; the OS then picks which process
    # answers). Each worktree carries its OWN repcheck.db, so requests
    # landed on an app whose database didn't have your account: you appear
    # logged out at random, saved data seems to vanish, and a check-in
    # can't complete because the session/profile it needs lives in the
    # other database. Set PORT=5050 (etc.) when running a worktree.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True, threaded=True)
