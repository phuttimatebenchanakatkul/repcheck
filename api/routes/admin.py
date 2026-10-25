"""The owner's endpoints. Every one answers 404 to anyone who is not in ADMIN_EMAILS (the address comes from the verified token)."""

import functools

from flask import Blueprint, jsonify, make_response, request

from .. import admin
from ..auth import current_identity, login_required
from .account import fail, json_body, services

bp = Blueprint("admin", __name__)


def admin_only(view):
    @functools.wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not admin.is_admin(services().settings, current_identity()):
            return fail("Not found.", 404)
        return view(*args, **kwargs)
    return wrapped


@bp.get("/api/admin/reports")
@admin_only
def reports():
    with services().db.connection() as conn:
        return jsonify({"ok": True, "reports": admin.open_reports(conn), "ai_reports": admin.open_ai_reports(conn)})


@bp.post("/api/admin/reports/<int:report_id>/reset-name")
@admin_only
def reset_name(report_id):
    with services().db.connection() as conn:
        account = admin.reset_reported_name(conn, report_id)
    if account is None:
        return fail("Report not found.", 404)
    return jsonify({"ok": True, "reset": account})


@bp.post("/api/admin/reports/<int:report_id>/handled")
@admin_only
def report_handled(report_id):
    with services().db.connection() as conn:
        changed = admin.mark_report_handled(conn, report_id)
    return jsonify({"ok": True, "changed": changed})


@bp.post("/api/admin/ai-reports/<int:report_id>/handled")
@admin_only
def ai_report_handled(report_id):
    with services().db.connection() as conn:
        changed = admin.mark_ai_report_handled(conn, report_id)
    return jsonify({"ok": True, "changed": changed})


@bp.get("/api/admin/waitlist")
@admin_only
def waitlist():
    with services().db.connection() as conn:
        entries = admin.waitlist_entries(conn)
    if request.args.get("format") == "csv":
        response = make_response(admin.waitlist_csv(entries))
        response.headers["Content-Type"] = "text/csv; charset=utf-8"
        response.headers["Content-Disposition"] = 'attachment; filename="repcheck_waitlist.csv"'
        return response
    return jsonify({"ok": True, "total": len(entries), "entries": entries})


@bp.post("/api/admin/waitlist/delete")
@admin_only
def waitlist_delete():
    with services().db.connection() as conn:
        removed = admin.delete_waitlist_email(conn, json_body().get("email"))
    return jsonify({"ok": True, "removed": removed})


@bp.get("/api/admin/users")
@admin_only
def users():
    range_key = request.args.get("range", "today")
    if range_key not in admin.RANGES:
        range_key = "today"
    with services().db.connection() as conn:
        listed = admin.list_users(conn, admin.signup_cutoff(range_key))
    return jsonify({"ok": True, "range": range_key, "users": listed})


@bp.get("/api/admin/users/<user_id>")
@admin_only
def user_detail(user_id):
    from .. import social
    target = social.parse_user_id(user_id)
    detail = None
    if target:
        with services().db.connection() as conn:
            detail = admin.user_detail(conn, target)
    if not detail:
        return fail("Not found.", 404)
    return jsonify({"ok": True, "user": detail})
