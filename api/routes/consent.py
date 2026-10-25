from flask import Blueprint, jsonify

from .. import consent, limits
from ..auth import current_identity, login_required
from .account import fail, json_body, services

bp = Blueprint("consent", __name__)


@bp.post("/api/ai-consent")
@login_required
def set_ai_consent():
    """Record or withdraw consent to AI processing. Only a JSON `true` grants; anything else withdraws."""
    granted = json_body().get("granted") is True
    user_id = current_identity().id
    with services().db.connection() as conn:
        found = consent.set_consent(conn, user_id, granted)
        if found:
            limits.track_usage(conn, user_id, "feature:" + ("ai_consent_granted" if granted else "ai_consent_withdrawn"))
    if not found:
        return fail("No profile yet. Create it first.", 404)
    return jsonify({"ok": True, "granted": granted})
