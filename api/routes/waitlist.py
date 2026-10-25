"""The pre-launch waitlist the marketing site posts to. The one route that needs no sign-in and the one that answers a
cross-origin request, so it answers only the marketing site's own hostnames, echoed one at a time (a wildcard would let any
page on the internet submit through it)."""

import time

from flask import Blueprint, jsonify, make_response, request

from .. import admin
from .account import json_body, services

bp = Blueprint("waitlist", __name__)


def _cors(response):
    origin = request.headers.get("Origin", "")
    if origin in admin.WAITLIST_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"               # the allowed origin varies by request, so a cache must not mix them up
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Max-Age"] = "86400"
    return response


@bp.route("/api/waitlist", methods=["POST", "OPTIONS"])
def join_waitlist():
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    payload = json_body()
    email = admin.clean_email(payload.get("email"))
    if email is None:
        return _cors(jsonify({"error": "invalid-email"})), 400
    source = admin.clean_source(payload.get("source"))
    # request.remote_addr and nothing else: the app is behind ProxyFix, which resolved it from the entry the platform itself
    # appended. Reading X-Forwarded-For by hand would take a value the CALLER controls and let one machine mint unlimited keys.
    key = "waitlist:" + (request.remote_addr or "unknown")[:64]
    with services().db.connection() as conn:
        allowed, retry = admin.take_attempt(conn, key, int(time.time()))
        if not allowed:
            response = jsonify({"error": "rate-limited", "retry_after_seconds": retry})
            response.status_code = 429
            return _cors(response)
        added = admin.add_waitlist_email(conn, email, source)
    # "already" is reported but is not shown differently and does not change the status: a route that answered differently for
    # a known address would let anyone test whether a given person had signed up.
    return _cors(jsonify({"ok": True, "already": not added}))
