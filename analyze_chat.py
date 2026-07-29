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

from dotenv import load_dotenv

load_dotenv()

GEMINI_MODEL = "gemini-3.1-flash-lite"

# Same reasoning as coach_chat.py's identical constant: keeps requests
# small and avoids re-litigating very old parts of the chat.
MAX_HISTORY_TURNS = 16

# A full critique (6 sections) comfortably fits well under this; capped
# mainly so a malformed/unexpectedly huge context object can't blow up
# the prompt size, not because real critiques get anywhere close.
MAX_FEEDBACK_CHARS = 6000

def _fallback_reply():
    return (
        "The analysis assistant isn't reachable right now (no Gemini connection). "
        "Please try again in a moment."
    )


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
        f"Rules for how you write (strict -- the reply renders in a small "
        f"chat bubble over the page, so brevity is a hard requirement):\n"
        f"- Keep every answer SHORT and precise. Hard cap: 60 words total.\n"
        f"- Default format: 2-4 bullet points, each one line, each starting "
        f"with \"- \". No intro sentence before them.\n"
        f"- If the whole answer fits in one short sentence, give just that "
        f"sentence instead of bullets.\n"
        f"- In every answer, bold the few words that carry the point by "
        f"wrapping them in double asterisks, e.g. **pause at the top** -- "
        f"the important words should be findable at a glance.\n"
        f"- Never write paragraphs. Never restate the question. Never pad "
        f"with encouragement filler; one short encouraging phrase at most.\n"
        f"- No jargon; if a technical term is unavoidable, explain it in "
        f"plain words in the same line.\n"
        f"- Be direct, like a knowledgeable coach.\n"
        f"- You are not a doctor. For pain that sounds like an injury, "
        f"suggest seeing a medical professional rather than guessing what's "
        f"wrong."
    )


def get_analysis_chat_reply(message, history=None, context=None):
    # Usage limiting now lives in app.py's /api/analyze-chat route (a shared
    # per-user "ai_chat" budget across both chatbots), so this module just
    # generates a reply.
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
