"""The three AI chats (coach, analysis follow-up, workout): input checks and the over-limit reply.

The website's routes had no server-side size limit on a message (only an `<input maxlength>`), took the history and
context as they came (a malformed one crashed inside the module and surfaced as the 'unreachable' fallback, spending a
message), and passed everything straight into the model's prompt. Here every field is bounded and shaped first, so a bad
request is a 400 that costs nothing and nobody can send a megabyte of prompt on someone else's Gemini bill.
"""

import json

from .limits import RATE_LIMITS, friendly_wait

MAX_MESSAGE_CHARS = 1000          # the website's input allows 600; this is the server-side bound it never had
MAX_HISTORY_TURNS = 40            # the modules use the last 16; accept a few more, keep the newest
MAX_TURN_CHARS = 4000
MAX_CONTEXT_CHARS = 40_000        # analysis feedback is capped at 6000 and a workout summary at 14000 by the modules


class ChatRejected(ValueError):
    """The message is safe to show the user."""


def clean_request(payload, *, takes_context):
    """(message, history, context) or ChatRejected. Messages are the website's: 'Message can't be empty.',
    'Invalid history.', 'Invalid context.'"""
    raw = payload.get("message", "")
    message = str(raw if raw is not None else "").strip()
    if not message:
        raise ChatRejected("Message can't be empty.")
    if len(message) > MAX_MESSAGE_CHARS:
        raise ChatRejected(f"That message is too long. Please keep it under {MAX_MESSAGE_CHARS:,} characters.")

    history = payload.get("history") or []
    if not isinstance(history, list):
        raise ChatRejected("Invalid history.")
    turns = []
    for turn in history[-MAX_HISTORY_TURNS:]:
        if not isinstance(turn, dict):
            raise ChatRejected("Invalid history.")
        role, text = turn.get("role"), turn.get("text", "")
        if not isinstance(role, str) or not isinstance(text, str):
            raise ChatRejected("Invalid history.")
        turns.append({"role": role[:20], "text": text[:MAX_TURN_CHARS]})

    context = {}
    if takes_context:
        context = payload.get("context") or {}
        if not isinstance(context, dict):
            raise ChatRejected("Invalid context.")
        try:
            size = len(json.dumps(context, default=str))
        except (TypeError, ValueError):
            raise ChatRejected("Invalid context.") from None
        if size > MAX_CONTEXT_CHARS:
            raise ChatRejected("Invalid context.")
    return message, turns, context


def limited_reply(retry_after):
    """What an over-limit chat answers: a normal-looking bot message plus the flags the chat widgets use to lock input."""
    uses = RATE_LIMITS["ai_chat"][0]
    return {
        "ok": True,
        "reply": f"You've reached your {uses} chat messages for now. Please check back in {friendly_wait(retry_after)}.",
        "sources": [],
        "limited": True,
        "retry_after_seconds": retry_after,
    }
