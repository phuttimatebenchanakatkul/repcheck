"""AI chat scoped to the user's last 7 days of logged workouts -- lets the
user ask things like "how do I progressive overload on tricep pushdowns"
and get an answer grounded in the actual weights/reps/sets they logged
this week, not generic advice.

Separate from coach_chat.py (general fitness Q&A) and analyze_chat.py
(follow-ups on one video analysis) for the same reason those two are kept
apart: this file's only job is answering questions grounded in the
client's last-7-days workout log, so its system prompt/scope can evolve
independently of the other two chatbots.

Like analyze_chat.py, there's no fixed SYSTEM_PROMPT constant -- it's
built fresh per request from `context`, which the client fills in from
its own in-memory workout log (see templates/workouts.html). Nothing is
stored server-side; the client re-sends the last-7-days summary and
`history` on every turn.
"""

import os

from dotenv import load_dotenv

load_dotenv()

GEMINI_MODEL = "gemini-3.1-flash-lite"

# Same reasoning as coach_chat.py/analyze_chat.py's identical constant:
# keeps requests small and avoids re-litigating very old parts of the chat.
MAX_HISTORY_TURNS = 16

# The last-7-days summary is a handful of exercises/sets per day at most,
# so this is a safety cap against a malformed/huge payload, not something
# a real 7-day log gets anywhere close to.
MAX_SUMMARY_CHARS = 6000


def _fallback_reply():
    return (
        "The workout chat isn't reachable right now (no Gemini connection). "
        "Please try again in a moment."
    )


def _build_system_prompt(context):
    context = context or {}
    summary = str(context.get("workout_summary") or "").strip()[:MAX_SUMMARY_CHARS]
    if not summary:
        summary = "(No workouts logged in the last 7 days.)"

    return (
        "You are the RepCheck Workout Chat, an assistant embedded directly "
        "beneath a user's workout log. You can see ONLY the last 7 days of "
        "workouts they've logged, provided below -- you have no access to "
        "anything older than that, and no access to their nutrition, body "
        "weight, or profile.\n\n"
        "You may only help with:\n"
        "- Progressive overload: concrete next-workout numbers (specific "
        "weight and reps per set) grounded in the actual trend in the data "
        "below -- never vague advice like \"just add more weight over "
        "time.\"\n"
        "- Tips on performing/technique for an exercise that appears in the "
        "log below.\n"
        "- Estimating rep max / one-rep max from the logged sets.\n"
        "- General training questions clearly about their recent workouts "
        "(rest times between sets, how many sets/reps to do next, whether "
        "they're training an exercise/muscle often enough this week, etc).\n\n"
        "If asked about anything else -- nutrition/diet, body weight, "
        "medical or injury questions beyond suggesting a professional, or "
        "any topic unrelated to their recent training -- say plainly that "
        "you can only help with their last 7 days of workouts and steer "
        "back to that. If they ask about an exercise that ISN'T in the log "
        "below, say you don't see it logged in the last 7 days rather than "
        "guessing or inventing numbers for it.\n\n"
        f"The user's last 7 days of logged workouts:\n{summary}\n\n"
        "Rules for how you write (strict -- the reply renders in a small "
        "chat bubble under the workout list, so brevity is a hard "
        "requirement):\n"
        "- Keep every answer SHORT and precise. Hard cap: 80 words total.\n"
        "- Default format: short bullet points, each starting with \"- \", "
        "one line each. A one-line intro sentence is fine if it helps set "
        "up the answer.\n"
        "- If the whole answer fits in one short sentence, give just that "
        "sentence instead of bullets.\n"
        "- Bold the important numbers/keywords by wrapping them in double "
        "asterisks, e.g. **32 kg**, **progressive overload**.\n"
        "- No jargon; if a technical term is unavoidable, explain it in "
        "plain words in the same line.\n"
        "- Be direct and encouraging, like a knowledgeable coach, not a "
        "textbook.\n"
        "- You are not a doctor. For pain that sounds like an injury, "
        "suggest seeing a medical professional rather than guessing what's "
        "wrong."
    )


def get_workout_chat_reply(message, history=None, context=None):
    # Usage limiting lives in app.py's /api/workout-chat route (the shared
    # per-user "ai_chat" budget across all three chatbots), so this module
    # just generates a reply.
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
