"""The one door an imported account's old password comes through. Public (there is no session yet); see api/legacy.py."""

import time

from flask import Blueprint, jsonify, request

from .. import legacy
from .account import json_body, services

bp = Blueprint("legacy", __name__)

MISMATCH = "That email and password don't match."


@bp.post("/api/auth/legacy-login")
def legacy_login():
    svc, body = services(), json_body()
    with svc.db.connection() as conn:
        outcome, wait = legacy.migrate(conn, svc.auth_admin, body.get("email"), body.get("password"), request.remote_addr, int(time.time()))
    if outcome == legacy.Outcome.MIGRATED:
        return jsonify({"ok": True})
    if outcome == legacy.Outcome.LIMITED:
        response = jsonify({"ok": False, "error": "Too many tries. Please wait a few minutes and try again."})
        response.status_code = 429
        response.headers["Retry-After"] = str(wait)
        return response
    if outcome == legacy.Outcome.RESET_REQUIRED:
        response = jsonify({"ok": False, "reset_required": True,
                            "error": "Your old password can't be carried over. Reset it with the link we'll email you."})
        response.status_code = 409
        return response
    response = jsonify({"ok": False, "error": MISMATCH})
    response.status_code = 401
    return response
