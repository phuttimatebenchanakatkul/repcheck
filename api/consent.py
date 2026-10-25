"""Consent to AI processing (App Review 5.1.2(i)).

Everything that sends a person's content to Google Gemini (photos, lift videos, chat messages, workout logs, body
stats) needs their explicit consent first, and they must be able to take it back. The app asks before the first request
leaves the device; these checks make the server refuse regardless, so a stale screen or a direct API call cannot skip
the question.
"""

from flask import jsonify

CONSENT_ERROR = "AI features are off for your account. Turn them on in Settings, under AI features, to use this."


def has_consent(profile):
    return bool(profile and profile["ai_consent_at"])


def refusal():
    response = jsonify({"ok": False, "needs_ai_consent": True, "error": CONSENT_ERROR})
    response.status_code = 403
    return response


def set_consent(conn, user_id, granted):
    """Record or withdraw consent. Granting again keeps the original timestamp: it records when the person first
    agreed, which is what a consent record is for. Returns whether the profile exists."""
    if granted:
        sql = "update public.profiles set ai_consent_at = coalesce(ai_consent_at, now()) where id = %s returning id"
    else:
        sql = "update public.profiles set ai_consent_at = null where id = %s returning id"
    return conn.execute(sql, (user_id,)).fetchone() is not None
