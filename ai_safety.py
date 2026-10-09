"""Content filtering for the AI chatbots (App Review Guideline 4.7.1).

Apple holds hosted chatbots to the same rules as user-generated content:
the app must filter objectionable output and give users a way to report it
(the report side lives in /api/ai-report and static/ai_sources.js). Gemini's
defaults are not something to lean on -- they differ by model and have been
relaxed between releases -- so the three free-text chats (coach_chat.py,
workout_chat.py, analyze_chat.py) pass these explicitly.

Deliberately NOT applied to the photo/video analyzers (food photos, check-in
progress photos, lift videos): a progress photo is often shirtless, and a
sexual-content filter at this threshold can refuse it, which would break a
core feature for no safety gain -- those calls return structured scores, not
free text a user can steer.

A blocked reply comes back with empty text, which every chat already turns
into its "couldn't come up with a reply" message.
"""


def chat_safety_settings():
    from google.genai import types

    threshold = types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
    return [
        types.SafetySetting(category=category, threshold=threshold)
        for category in (
            types.HarmCategory.HARM_CATEGORY_HARASSMENT,
            types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        )
    ]
