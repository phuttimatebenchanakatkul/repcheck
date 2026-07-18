"""AI chat scoped to one specific Analyze result -- lets the user ask
follow-up questions about the critique/scores/rep count they were just
given for their uploaded set.

Separate from coach_chat.py (the general-purpose Coach page chatbot) even
though the shape is nearly identical, for the same reason rep_form_analyzer.py
gives for splitting from video_trimmer.py: this file's only job is
answering questions grounded in one specific analysis, not being a
general fitness Q&A assistant -- keeping them as separate small modules
means the two system prompts/rate limits can evolve independently without
tangling unrelated concerns together.

Unlike coach_chat.py, there's no fixed SYSTEM_PROMPT constant here -- the
whole point is that the system prompt is built fresh per request from the
specific analysis (exercise, scores, rep count, full critique text) the
client sends as `context`. Nothing about the analysis is stored
server-side; the client re-sends it on every chat turn, exactly like
`history` already works in coach_chat.py.
"""

import os
import time

from dotenv import load_dotenv
from flask import session

load_dotenv()

GEMINI_MODEL = "gemini-3.1-flash-lite"

# Same reasoning as coach_chat.py's identical constant: keeps requests
# small and avoids re-litigating very old parts of the chat.
MAX_HISTORY_TURNS = 16

# A full critique (6 sections) comfortably fits well under this; capped
# mainly so a malformed/unexpectedly huge context object can't blow up
# the prompt size, not because real critiques get anywhere close.
MAX_FEEDBACK_CHARS = 6000

# Independent from coach_chat.py's session limit -- a visitor analyzing a
# set and asking about it shouldn't share a budget with (or be blocked by)
# unrelated Coach page usage in the same browser session.
SESSION_MESSAGE_LIMIT = 6
SESSION_WINDOW_SECONDS = 5 * 60 * 60  # 5 hours


def _fallback_reply():
    return (
        "The analysis assistant isn't reachable right now (no Gemini connection). "
        "Please try again in a moment."
    )


def _format_wait(seconds_left):
    seconds_left = max(seconds_left, 0)
    hours, remainder = divmod(seconds_left, 3600)
    minutes = remainder // 60
    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    return f"{max(minutes, 1)}m"


def _check_session_limit():
    """Tracked entirely in the Flask session cookie -- no server-side
    storage needed, and it resets on its own once the window elapses.

    Returns (allowed, seconds_until_reset).
    """
    now = time.time()
    window_start = session.get("analyze_chat_window_start")
    count = session.get("analyze_chat_message_count", 0)

    if window_start is None or now - window_start >= SESSION_WINDOW_SECONDS:
        window_start = now
        count = 0

    if count >= SESSION_MESSAGE_LIMIT:
        return False, int(SESSION_WINDOW_SECONDS - (now - window_start))

    session["analyze_chat_window_start"] = window_start
    session["analyze_chat_message_count"] = count + 1
    return True, 0


def _build_system_prompt(context):
    context = context or {}
    exercise_label = str(context.get("exercise_label") or "the exercise").strip()
    feedback_text = str(context.get("feedback_text") or "").strip()[:MAX_FEEDBACK_CHARS]

    def score_line(label, key):
        value = context.get(key)
        return f"{label}: {value}/100" if isinstance(value, (int, float)) else None

    score_lines = [
        line for line in [
            score_line("Overall form & technique", "overall_score"),
            score_line("Stretch", "stretch_score"),
            score_line("Squeeze", "squeeze_score"),
        ] if line
    ]
    reps = context.get("reps")
    if isinstance(reps, (int, float)):
        score_lines.append(f"Reps counted: {int(reps)}")
    scores_block = "\n".join(score_lines) if score_lines else "(not available)"

    return (
        f"You are RepCheck's Analyze assistant. The user just had a set of "
        f"{exercise_label} analyzed from a video they uploaded, and you have "
        f"the complete analysis that was given to them below. Answer their "
        f"follow-up questions about THIS specific analysis -- stay grounded "
        f"in what's actually written below, and don't invent new visual "
        f"details about the video that aren't stated in it (you weren't shown "
        f"the video yourself, only this analysis of it). If they ask something "
        f"the analysis doesn't cover, say so plainly rather than guessing.\n\n"
        f"Scores:\n{scores_block}\n\n"
        f"Full analysis given to the user:\n{feedback_text}\n\n"
        f"Rules for how you write:\n"
        f"- Prefer bullet points for the body of your answer so it's easy to "
        f"scan -- each line starting with \"- \". A short intro sentence "
        f"before the bullets is fine if it helps.\n"
        f"- Do not use jargon. If a technical term is genuinely necessary, "
        f"immediately explain it in plain, everyday language in the same "
        f"sentence.\n"
        f"- Keep answers short and practical, not an essay, unless the user "
        f"clearly asks for depth.\n"
        f"- Bold important keywords or phrases by wrapping them in double "
        f"asterisks, e.g. **progressive overload**.\n"
        f"- Be encouraging and direct, like a knowledgeable coach, not a "
        f"textbook.\n"
        f"- You are not a doctor. For pain that sounds like an injury, "
        f"suggest seeing a medical professional rather than guessing what's "
        f"wrong."
    )


def get_analysis_chat_reply(message, history=None, context=None):
    allowed, seconds_left = _check_session_limit()
    if not allowed:
        return {
            "reply": (
                f"You've used your {SESSION_MESSAGE_LIMIT} messages for this analysis. "
                f"Come back in about {_format_wait(seconds_left)} and I'll be ready to help again."
            ),
            "limited": True,
            "retry_after_seconds": seconds_left,
        }

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {"reply": _fallback_reply(), "limited": False, "retry_after_seconds": 0}

    history = history or []

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        contents = []
        for turn in history[-MAX_HISTORY_TURNS:]:
            role = "model" if turn.get("role") == "assistant" else "user"
            text = str(turn.get("text", "")).strip()
            if text:
                contents.append(types.Content(role=role, parts=[types.Part.from_text(text=text)]))
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=_build_system_prompt(context)),
        )
        text = (response.text or "").strip()
        reply = text or "Sorry, I couldn't come up with a reply there — could you try asking that again?"
    except Exception:
        reply = _fallback_reply()

    return {"reply": reply, "limited": False, "retry_after_seconds": 0}
