"""The signed-in person's profile and the lifecycle of their account."""

from flask import Blueprint, current_app, jsonify, request

from .. import accounts
from ..auth import current_identity, login_required

bp = Blueprint("account", __name__)


def _iso(value):
    return value.isoformat() if value else None


def profile_json(profile):
    return {
        "id": str(profile["id"]),
        "name": profile["name"],
        "friend_code": profile["friend_code"],
        "onboarding_completed": profile["onboarding_completed"],
        "ai_consent": profile["ai_consent_at"] is not None,
        "deleted_at": _iso(profile["deleted_at"]),
        "due_at": accounts.due_at(profile["deleted_at"]),
    }


def fail(message, status):
    response = jsonify({"ok": False, "error": message})
    response.status_code = status
    return response


def json_body():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def services():
    return current_app.extensions["api"]


@bp.get("/api/profile")
@login_required
def get_profile():
    with services().db.connection() as conn:
        profile = accounts.get_profile(conn, current_identity().id)
    if not profile:
        return fail("No profile yet. Create it first.", 404)
    return jsonify({"ok": True, "profile": profile_json(profile)})


@bp.post("/api/profile")
@login_required
def create_profile():
    """Create the caller's profile if it does not exist (the app's first call after any sign-in, email or provider).
    Idempotent: an existing profile is returned as it is."""
    identity = current_identity()
    name = json_body().get("name")
    if name is not None and not isinstance(name, str):
        return fail("Please enter your name.", 400)
    try:
        with services().db.connection() as conn:
            profile, created = accounts.ensure_profile(conn, identity, name)
    except accounts.NameRejected as rejected:
        return fail(str(rejected), 400)
    response = jsonify({"ok": True, "created": created, "profile": profile_json(profile)})
    response.status_code = 201 if created else 200
    return response


@bp.post("/api/account")
@login_required
def update_account():
    """Rename. (Email and password belong to Supabase Auth; the app changes those there.)"""
    name = json_body().get("name")
    if not isinstance(name, str):
        return fail("Nothing to update.", 400)
    try:
        with services().db.connection() as conn:
            found = accounts.rename(conn, current_identity().id, name)
    except accounts.NameRejected as rejected:
        return fail(str(rejected), 400)
    if not found:
        return fail("No profile yet. Create it first.", 404)
    return jsonify({"ok": True})


# Apple App Store Guideline 5.1.1(v): an app that lets you create an account must let you delete it from inside the
# app. This schedules the deletion; the account keeps working for GRACE_DAYS and can be restored the whole time.
@bp.delete("/api/account")
@login_required
def delete_account():
    with services().db.connection() as conn:
        deleted_at = accounts.schedule_deletion(conn, current_identity().id)
    if deleted_at is None:
        return fail("No profile yet. Create it first.", 404)
    return jsonify({"ok": True, "deleted_at": _iso(deleted_at), "due_at": accounts.due_at(deleted_at),
                    "grace_days": accounts.GRACE_DAYS})


@bp.post("/api/account/restore")
@login_required
def restore_account():
    with services().db.connection() as conn:
        accounts.cancel_deletion(conn, current_identity().id)
    return jsonify({"ok": True})
