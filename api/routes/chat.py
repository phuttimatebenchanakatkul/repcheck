"""The three AI chats. They share one per-account daily budget ('ai_chat'). See api/chat.py for the input rules."""

import logging

from flask import Blueprint, jsonify, request

from .. import accounts, ai, chat, consent
from ..auth import current_identity, login_required
from .account import fail, json_body, services

bp = Blueprint("chat", __name__)
log = logging.getLogger(__name__)

FEATURE = "ai_chat"


def _chat(backend_name, usage_event, takes_context):
    svc, identity = services(), current_identity()
    user_id = identity.id
    with svc.db.connection() as conn:
        profile = accounts.get_profile(conn, user_id)
    if not profile:
        return fail("No profile yet. Create it first.", 404)
    if not consent.has_consent(profile):
        return consent.refusal()
    try:
        message, history, context = chat.clean_request(json_body(), takes_context=takes_context)
    except chat.ChatRejected as rejected:
        return fail(str(rejected), 400)

    reservation = ai.reserve(svc, identity, FEATURE)
    if not reservation.allowed:
        return jsonify(chat.limited_reply(reservation.retry_after))        # a normal-looking reply, not an error
    try:
        result = getattr(svc.ai, backend_name)(message, history, context)
    except Exception:
        ai.release(svc, user_id, FEATURE, reservation)
        raise
    if result.get("failed"):                                                # the model was unreachable: not a use
        ai.release(svc, user_id, FEATURE, reservation)
    else:
        ai.track(svc, user_id, usage_event)
    return jsonify({"ok": True, "reply": result["reply"], "sources": result.get("sources", []),
                    "limited": False, "retry_after_seconds": 0})


@bp.post("/api/coach-chat")
@login_required
def coach_chat():
    return _chat("coach", "coach_chat_message", takes_context=False)


@bp.post("/api/analyze-chat")
@login_required
def analyze_chat():
    return _chat("analysis_chat", "analyze_chat_message", takes_context=True)


@bp.post("/api/workout-chat")
@login_required
def workout_chat():
    return _chat("workout_chat", "workout_chat_message", takes_context=True)
