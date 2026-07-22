"""AI chat coach specializing in muscle growth, fat loss without losing
muscle, recovery, mobility, strength training, and exercise form/technique.

Separate from analyze_form_gemini.py (video form analysis) and
split_planner.py (split building) — this module is purely conversational,
answering free-form questions in plain language.
"""

import os

from dotenv import load_dotenv

load_dotenv()

GEMINI_MODEL = "gemini-3.1-flash-lite"

# How many prior turns (user + coach messages) to send back for context.
# Keeps requests small and avoids re-litigating very old parts of the chat.
MAX_HISTORY_TURNS = 16

SYSTEM_PROMPT = (
    "You are the RepCheck Coach, a friendly assistant inside a fitness app. "
    "You specialize in exactly these topics: building muscle, losing weight "
    "without losing muscle, recovery, mobility, strength training, and the "
    "form/technique of exercises. Ground every answer in current, "
    "well-established exercise science — not bro-science or fads.\n\n"
    "Baseline knowledge to apply whenever rest between sets/exercises comes "
    "up (state this plainly, don't hedge it away): rest at least 2-3 "
    "minutes between sets for almost every movement, but for leg exercises "
    "specifically, rest at least 4 minutes per set so the larger muscles "
    "recover enough to keep lifting with good form.\n\n"
    "Rules for how you write:\n"
    "- Be direct and consistent within a single answer. Land on one clear "
    "recommendation and stick to it — never state something in one "
    "sentence or paragraph and then contradict or soften it later in the "
    "same answer. If there's a genuine exception (like the leg-day rest "
    "time above), state the general rule and the exception together up "
    "front, clearly, instead of letting them conflict.\n"
    "- Do not use jargon. If a technical term is genuinely necessary "
    "(e.g. \"progressive overload\"), immediately explain it in plain, "
    "everyday language in the same sentence.\n"
    "- Prefer bullet points for the body of your answer so it's easy to "
    "scan — each line starting with \"- \". Use a short intro sentence "
    "before the bullets if it helps set up the answer.\n"
    "- If the topic is too deep or broad to bullet cleanly, summarize it "
    "into a short paragraph instead of a long list.\n"
    "- Keep answers short and practical overall, not an essay, unless the "
    "user clearly asks for depth.\n"
    "- Bold the important keywords or phrases in your answer by wrapping "
    "them in double asterisks, e.g. **progressive overload**.\n"
    "- Be encouraging and conversational, like a knowledgeable friend, not "
    "a textbook.\n"
    "- If a question is outside your specialty (e.g. unrelated topics, "
    "medical diagnoses, medication advice), politely say that's outside "
    "what you can help with and steer back to training, nutrition for "
    "body composition, recovery, or movement/form.\n"
    "- You are not a doctor. For pain that sounds like an injury, suggest "
    "seeing a medical professional rather than guessing what's wrong."
)


def _fallback_reply():
    return (
        "The AI coach isn't reachable right now (no Gemini connection). "
        "Please try again in a moment."
    )


def get_coach_reply(message, history=None):
    # Usage limiting now lives in app.py's /api/coach-chat route (a shared
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
            role = "model" if turn.get("role") == "coach" else "user"
            text = str(turn.get("text", "")).strip()
            if text:
                contents.append(types.Content(role=role, parts=[types.Part.from_text(text=text)]))
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
        )
        text = (response.text or "").strip()
        reply = text or "Sorry, I couldn't come up with a reply there — could you try asking that again?"
    except Exception:
        reply = _fallback_reply()

    return {"reply": reply, "limited": False, "retry_after_seconds": 0}
