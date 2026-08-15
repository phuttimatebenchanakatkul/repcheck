"""Covers the new workout-log-scoped AI chat: /api/workout-chat and
workout_chat.py's prompt building.

This chat is deliberately narrower than coach_chat.py (general Q&A) and
analyze_chat.py (one analysis result) -- it may only ground answers in the
client-supplied last-7-days workout summary, and must refuse everything
else. The tests below pin:
  - the system prompt actually embeds the client's workout_summary and
    carries an explicit refusal instruction for off-topic questions
  - the route follows the same auth/validation/rate-limit contract as the
    other two chatbots, sharing the one "ai_chat" bucket (see app.py's
    RATE_LIMITS comment)
  - a Gemini failure degrades to a friendly fallback rather than a 500
"""

import json

import pytest

import workout_chat
from workout_chat import _build_system_prompt, get_workout_chat_reply


# ---------- prompt building ----------

def test_prompt_embeds_the_clients_workout_summary():
    summary = "Yesterday (2026-08-12):\n- Tricep Pushdown: 27kg x 8 reps; 27kg x 5 reps"
    prompt = _build_system_prompt({"workout_summary": summary})
    assert summary in prompt


def test_prompt_falls_back_when_no_workouts_logged():
    prompt = _build_system_prompt({})
    assert "No workouts logged yet" in prompt
    prompt_none = _build_system_prompt(None)
    assert "No workouts logged yet" in prompt_none


def test_prompt_carries_an_explicit_scope_and_refusal_instruction():
    """Unlike coach_chat.py's softer "politely say that's outside what you
    can help with", this chatbot needs a hard, explicit refusal for
    anything beyond the logged workout data -- it must not casually answer
    general fitness/nutrition questions just because it's a fitness app."""
    prompt = _build_system_prompt({"workout_summary": "(No workouts logged yet.)"})
    assert "only help with their logged workouts" in prompt
    assert "nutrition" in prompt.lower()


def test_prompt_tells_the_model_not_to_invent_ungrounded_exercise_data():
    prompt = _build_system_prompt({"workout_summary": "Today (2026-08-13): no workout logged."})
    assert "don't see it logged" in prompt or "guessing or inventing" in prompt


def test_prompt_requires_reciting_exact_logged_sessions_before_advice():
    """The headline feature: ask about a specific exercise's progressive
    overload, and the model must recite the exact logged sessions from the
    'Exercise history' section before giving a weight/increment
    recommendation -- not just vaguely reference "your recent workouts"."""
    prompt = _build_system_prompt({"workout_summary": "Exercise history (last 4 sessions each):\nTricep Pushdown:\n- Aug 12: 27kg x 8 reps"})
    assert "recite its logged history" in prompt
    assert "Exercise history" in prompt
    assert "do not skip, round, or invent any" in prompt
    assert "starting weight" in prompt
    assert "increment" in prompt


def test_prompt_caps_an_oversized_summary():
    huge = "x" * 50000
    prompt = _build_system_prompt({"workout_summary": huge})
    assert len(prompt) < 50000 + 2000  # bounded, not passed through raw and unbounded


# ---------- get_workout_chat_reply: no API key / failure degrade ----------

def test_no_api_key_returns_a_friendly_fallback(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    result = get_workout_chat_reply("How do I progressive overload?", [], {"workout_summary": ""})
    assert "isn't reachable" in result["reply"]
    assert result["limited"] is False


def test_gemini_failure_degrades_instead_of_raising(monkeypatch):
    from google import genai as real_genai

    class FakeModels:
        def generate_content(self, **kwargs):
            raise RuntimeError("boom")

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)

    result = get_workout_chat_reply("test", [], {})
    assert "isn't reachable" in result["reply"]


def test_successful_generation_returns_gemini_text_verbatim(monkeypatch):
    """The role-mapping test above pins the request shape but never checks
    what get_workout_chat_reply() actually returns on a real success --
    covering that here so a change that mangles the response (e.g. wrapping
    it, dropping whitespace handling) doesn't slip through unnoticed."""
    from google import genai as real_genai

    class FakeModels:
        def generate_content(self, **kwargs):
            class Response:
                text = "  - Try **34 kg** for 6 reps next session.  "
            return Response()

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)

    result = get_workout_chat_reply("how do I progress?", [], {"workout_summary": "..."})
    assert result["reply"] == "- Try **34 kg** for 6 reps next session."
    assert result["limited"] is False
    assert result["retry_after_seconds"] == 0


def test_empty_gemini_text_falls_back_to_a_generic_retry_message(monkeypatch):
    """Gemini can return a response with empty/whitespace-only text (e.g.
    safety filtering with no candidates); that must not surface as a blank
    chat bubble."""
    from google import genai as real_genai

    class FakeModels:
        def generate_content(self, **kwargs):
            class Response:
                text = "   "
            return Response()

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)

    result = get_workout_chat_reply("how do I progress?", [], {})
    assert result["reply"] == "Sorry, I couldn't come up with a reply there — could you try asking that again?"


def test_history_role_mapping_matches_analyze_chat_convention(monkeypatch):
    """Client history uses {role: "user"|"assistant"}, same as
    analyze_chat.py (NOT coach_chat.py's "coach") -- pin the mapping so a
    future edit can't silently invert user/model turns."""
    from google import genai as real_genai
    from google.genai import types

    captured = {}

    class FakeModels:
        def generate_content(self, **kwargs):
            captured["contents"] = kwargs["contents"]

            class Response:
                text = "ok"
            return Response()

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)

    history = [
        {"role": "user", "text": "how's my bench doing"},
        {"role": "assistant", "text": "Looking solid."},
    ]
    get_workout_chat_reply("follow up", history, {})

    roles = [c.role for c in captured["contents"]]
    assert roles == ["user", "model", "user"]


def test_malformed_history_item_degrades_to_fallback_instead_of_raising(monkeypatch):
    """History is client-supplied (localStorage) and re-sent verbatim, so a
    non-dict entry (corrupted storage, a bad merge) must not 500 the route --
    the whole content-building block is inside get_workout_chat_reply's
    try/except, so this should degrade exactly like a Gemini failure."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    result = get_workout_chat_reply("hi", ["not-a-dict", {"role": "user", "text": "ok"}], {})
    assert "isn't reachable" in result["reply"]


# ---------- the HTTP surface ----------

@pytest.fixture
def client(tmp_path, monkeypatch):
    import app as app_module
    import database

    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _login(client, user_id):
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


def _make_user(email):
    from database import create_local_user
    return create_local_user(email, "irrelevant-password", "Test User")


def test_requires_login():
    import app as app_module
    app_module.app.config["TESTING"] = True
    c = app_module.app.test_client()
    res = c.post("/api/workout-chat", data=json.dumps({"message": "hi"}), content_type="application/json")
    assert res.status_code == 401


def test_rejects_empty_message(client):
    user_id = _make_user("wc-empty@example.com")
    _login(client, user_id)
    res = client.post("/api/workout-chat", data=json.dumps({"message": "  "}), content_type="application/json")
    assert res.status_code == 400


def test_rejects_non_list_history(client):
    user_id = _make_user("wc-history@example.com")
    _login(client, user_id)
    res = client.post(
        "/api/workout-chat",
        data=json.dumps({"message": "hi", "history": "not a list"}),
        content_type="application/json",
    )
    assert res.status_code == 400


def test_rejects_non_dict_context(client):
    user_id = _make_user("wc-context@example.com")
    _login(client, user_id)
    res = client.post(
        "/api/workout-chat",
        data=json.dumps({"message": "hi", "context": "not a dict"}),
        content_type="application/json",
    )
    assert res.status_code == 400


def test_successful_reply_round_trip(client, monkeypatch):
    import app as app_module

    monkeypatch.setattr(
        app_module, "get_workout_chat_reply",
        lambda message, history, context: {"reply": "Try **32 kg** for 6 reps.", "limited": False, "retry_after_seconds": 0},
    )
    user_id = _make_user("wc-success@example.com")
    _login(client, user_id)

    res = client.post(
        "/api/workout-chat",
        data=json.dumps({"message": "How do I overload tricep pushdowns?", "context": {"workout_summary": "..."}}),
        content_type="application/json",
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["reply"] == "Try **32 kg** for 6 reps."
    assert body["limited"] is False


def test_shares_the_ai_chat_rate_limit_bucket(client, monkeypatch):
    """All three chatbots share one "ai_chat" budget (see app.py's
    RATE_LIMITS comment) -- this pins that the workout chat actually spends
    from that same bucket rather than getting an unlimited or separate one."""
    import app as app_module

    monkeypatch.setattr(
        app_module, "get_workout_chat_reply",
        lambda message, history, context: {"reply": "ok", "limited": False, "retry_after_seconds": 0},
    )
    user_id = _make_user("wc-limit@example.com")
    _login(client, user_id)

    limit = app_module.RATE_LIMITS["ai_chat"][0]
    for _ in range(limit):
        res = client.post(
            "/api/workout-chat",
            data=json.dumps({"message": "hi"}),
            content_type="application/json",
        )
        assert res.get_json()["limited"] is False

    res = client.post("/api/workout-chat", data=json.dumps({"message": "hi"}), content_type="application/json")
    body = res.get_json()
    assert body["ok"] is True
    assert body["limited"] is True

    # And it counts against the SAME bucket the coach chat draws from.
    res2 = client.post(
        "/api/coach-chat",
        data=json.dumps({"message": "hi", "history": []}),
        content_type="application/json",
    )
    assert res2.get_json()["limited"] is True


def test_admin_account_is_exempt_from_the_limit(client, monkeypatch):
    import app as app_module

    monkeypatch.setattr(
        app_module, "get_workout_chat_reply",
        lambda message, history, context: {"reply": "ok", "limited": False, "retry_after_seconds": 0},
    )
    admin_email = next(iter(app_module.ADMIN_EMAILS))
    user_id = _make_user(admin_email)
    _login(client, user_id)

    limit = app_module.RATE_LIMITS["ai_chat"][0]
    for _ in range(limit + 2):
        res = client.post("/api/workout-chat", data=json.dumps({"message": "hi"}), content_type="application/json")
        assert res.get_json()["limited"] is False
