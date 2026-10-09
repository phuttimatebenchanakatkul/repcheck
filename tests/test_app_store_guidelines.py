"""Pins the fixes from the full App Store Review Guidelines audit (2026-10-09).

Each section names the guideline it protects. The audit found RepCheck
short of these; the tests make sure it cannot quietly drift back:

  5.1.2(i)  explicit, revocable consent before content reaches Google Gemini
  4.7.1     chatbot output is filtered and can be reported
  1.2       a report can be acted on, not just filed
  1.6       the weekly check-in no longer calls Gemini for anonymous callers,
            and the food scan escapes the AI's text
  1.4       calorie floors at the usual unsupervised-diet minimums
  1.4.1     AI estimates say what they are where they are shown
  5.1.1(i)  the privacy policy matches what the code does
  2.1       no controls that can never work
  5.2.1     HYROX trademark notice
  5.2.2     food database attribution
"""

import io
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def client(tmp_path, monkeypatch):
    import app as app_module
    import database

    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _login(client, email, consent=False):
    import database
    user_id = database.create_local_user(email, "irrelevant-password", "Test User")
    if consent:
        database.set_ai_consent(user_id, True)
    with client.session_transaction() as sess:
        sess["user_id"] = user_id
    return user_id


# ---------- 5.1.2(i): consent before anything reaches a third-party AI ----------

AI_ROUTES = [
    ("/api/coach-chat", {"json": {"message": "hi"}}),
    ("/api/workout-chat", {"json": {"message": "hi"}}),
    ("/api/analyze-chat", {"json": {"message": "hi"}}),
    ("/api/analyze-food", {"data": {"image": (io.BytesIO(b"x"), "meal.jpg")}}),
    ("/api/hyrox/analyze", {"json": {}}),
    ("/api/generate-split", {"json": {"split_type": "ai_suggest", "days_per_week": 3}}),
    ("/api/challenges/1/submit", {"data": {}}),
]


@pytest.mark.parametrize("route,kwargs", AI_ROUTES, ids=[r for r, _ in AI_ROUTES])
def test_every_ai_route_refuses_an_account_that_has_not_agreed(client, route, kwargs, monkeypatch):
    import app as app_module

    # Nothing may reach a model: make every AI entry point explode if called.
    for name in ("get_coach_reply", "get_workout_chat_reply", "get_analysis_chat_reply",
                 "analyze_food_image", "analyze_hyrox_race", "suggest_split_plan", "analyze_reps"):
        if hasattr(app_module, name):
            monkeypatch.setattr(app_module, name, lambda *a, **k: pytest.fail("AI called without consent"))
    _login(client, f"noconsent{abs(hash(route))}@example.com")
    res = client.post(route, **kwargs)
    assert res.status_code == 403, res.get_data(as_text=True)[:200]
    body = res.get_json()
    assert body["needs_ai_consent"] is True


def test_the_form_analysis_upload_refuses_without_consent(client, monkeypatch):
    import app as app_module
    monkeypatch.setattr(app_module, "run_pipeline", lambda *a, **k: pytest.fail("AI called without consent"))
    _login(client, "form-noconsent@example.com")
    res = client.post(
        "/analyze",
        data={"video": (io.BytesIO(b"x"), "lift.mp4"), "exercise": "squat"},
        headers={"Accept": "application/json"},
    )
    assert res.status_code == 403
    assert res.get_json()["needs_ai_consent"] is True


def test_consent_can_be_given_and_withdrawn(client):
    import database
    user_id = _login(client, "toggle@example.com")
    assert client.post("/api/ai-consent", json={"granted": True}).get_json()["granted"] is True
    first = database.get_user_by_id(user_id)["ai_consent_at"]
    assert first
    # Granting again keeps the original moment of agreement.
    client.post("/api/ai-consent", json={"granted": True})
    assert database.get_user_by_id(user_id)["ai_consent_at"] == first
    assert client.post("/api/ai-consent", json={"granted": False}).get_json()["granted"] is False
    assert database.get_user_by_id(user_id)["ai_consent_at"] is None


def test_only_a_literal_true_grants_consent(client):
    import database
    user_id = _login(client, "truthy@example.com")
    client.post("/api/ai-consent", json={"granted": "yes"})
    assert database.get_user_by_id(user_id)["ai_consent_at"] is None


def test_consent_endpoint_needs_an_account(client):
    assert client.post("/api/ai-consent", json={"granted": True}).status_code == 401


CHECKIN = {
    "aspiration": "lose", "gender": "male", "weight_kg": "77", "body_fat_range_id": "m3",
    "activity_level": "lift_and_cardio", "protein_preference": "high",
    "diet_preference": "balanced", "loss_rate_pct": 1.0, "gain_rate_pct": None,
    "current_targets": {"protein": 180, "fat": 60, "carbs": 200, "calories": 2060},
    "week_weight_entries": [{"date": "2026-07-30", "kg": 78}, {"date": "2026-08-05", "kg": 77}],
    "week_calorie_days": [], "photo_ids": [],
}


def test_weekly_checkin_without_consent_completes_without_calling_gemini(client, monkeypatch):
    import app as app_module
    monkeypatch.setattr(app_module, "analyze_checkin", lambda *a, **k: pytest.fail("AI called without consent"))
    _login(client, "checkin-noconsent@example.com")
    res = client.post("/api/coaching/weekly-adjustment", json=CHECKIN)
    assert res.status_code == 200
    assert res.get_json()["ok"] is True


# ---------- 1.6: no anonymous Gemini spend ----------

def test_weekly_checkin_refuses_an_anonymous_caller(client, monkeypatch):
    import app as app_module
    monkeypatch.setattr(app_module, "analyze_checkin", lambda *a, **k: pytest.fail("AI called anonymously"))
    assert client.post("/api/coaching/weekly-adjustment", json=CHECKIN).status_code == 401


def test_food_scan_escapes_the_ai_text_it_shows():
    page = (ROOT / "templates" / "nutrition.html").read_text(encoding="utf-8")
    assert "${escapeHtml(result.note)}" in page
    assert "${escapeHtml(result.confidence)}" in page
    assert "${result.note}" not in page


# ---------- 4.7.1: chatbot output filtered and reportable ----------

@pytest.mark.parametrize("module_name,call", [
    ("coach_chat", lambda m: m.get_coach_reply("hi", [])),
    ("workout_chat", lambda m: m.get_workout_chat_reply("hi", [], {})),
    ("analyze_chat", lambda m: m.get_analysis_chat_reply("hi", [], {})),
])
def test_every_chatbot_passes_explicit_safety_settings(monkeypatch, module_name, call):
    import importlib
    from google import genai as real_genai
    from google.genai import types

    captured = {}

    class FakeModels:
        def generate_content(self, **kwargs):
            captured["config"] = kwargs["config"]

            class Response:
                text = "ok\nSOURCES: none"
            return Response()

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)
    call(importlib.import_module(module_name))
    settings = captured["config"].safety_settings
    categories = {s.category for s in settings}
    assert {
        types.HarmCategory.HARM_CATEGORY_HARASSMENT,
        types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    } <= categories
    assert all(s.threshold == types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE for s in settings)


def test_an_ai_reply_can_be_reported_and_lands_in_the_review_queue(client):
    import database
    _login(client, "reporter@example.com")
    res = client.post("/api/ai-report", json={"feature": "coach", "reason": "harmful", "reply": "Bad advice"})
    assert res.get_json()["ok"] is True
    # The same reply twice is one complaint.
    client.post("/api/ai-report", json={"feature": "coach", "reason": "harmful", "reply": "Bad advice"})
    reports = database.get_open_ai_reports()
    assert len(reports) == 1
    assert reports[0]["reply_text"] == "Bad advice"
    assert reports[0]["reason"] == "harmful"


def test_ai_reports_are_bounded_per_user(client):
    import database
    _login(client, "flooder@example.com")
    for i in range(database.MAX_OPEN_AI_REPORTS_PER_USER):
        assert client.post("/api/ai-report", json={"reply": f"r{i}"}).status_code == 200
    assert client.post("/api/ai-report", json={"reply": "one too many"}).status_code == 429


def test_ai_report_needs_an_account_and_a_reply(client):
    assert client.post("/api/ai-report", json={"reply": "x"}).status_code == 401
    _login(client, "empty-report@example.com")
    assert client.post("/api/ai-report", json={"reply": "  "}).status_code == 400


def test_ai_reports_go_when_the_reporters_account_is_purged(client):
    import database
    user_id = _login(client, "leaver@example.com")
    client.post("/api/ai-report", json={"reply": "something"})
    with database.get_db() as conn:
        database._purge_user_rows(conn, user_id)
        left = conn.execute("SELECT COUNT(*) AS n FROM ai_reports").fetchone()["n"]
    assert left == 0


# ---------- 1.2: a report can be acted on ----------

def test_reset_name_replaces_the_reported_display_name_and_closes_reports(client):
    import database
    reporter = database.create_local_user("a@example.com", "irrelevant-password", "Alice")
    offender = database.create_local_user("b@example.com", "irrelevant-password", "Bob")
    report_id = database.create_content_report(reporter, offender, "offensive_name")
    assert database.reset_reported_name(report_id) == offender
    assert database.get_user_by_id(offender)["name"] == database.MODERATED_DISPLAY_NAME
    assert database.get_open_reports() == []


# ---------- 1.4: calorie floors ----------

def test_calorie_floors_are_the_usual_unsupervised_minimums():
    import coaching_engine
    assert coaching_engine.MIN_CALORIES_MALE >= 1500
    assert coaching_engine.MIN_CALORIES_FEMALE >= 1200


def test_the_rate_slider_warns_above_the_standard_zone():
    i18n = (ROOT / "static" / "i18n.js").read_text(encoding="utf-8")
    assert i18n.count('"coaching.wizard.rateCaution"') == 2  # en + th
    for js in ("onboarding.js", "coaching.js"):
        src = (ROOT / "static" / js).read_text(encoding="utf-8")
        assert 'badgeKey === "coaching.wizard.rateFaster"' in src, js
        assert 't("coaching.wizard.rateCaution")' in src, js


# ---------- 1.4.1: estimates labelled where they appear ----------

def test_ai_estimates_are_labelled_where_they_are_shown():
    index = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    result = (ROOT / "templates" / "result.html").read_text(encoding="utf-8")
    nutrition = (ROOT / "templates" / "nutrition.html").read_text(encoding="utf-8")
    challenges = (ROOT / "templates" / "challenges.html").read_text(encoding="utf-8")
    assert 't("analyze.estimateNote")' in index
    assert 'data-i18n="analyze.estimateNote"' in result
    assert '"nutrition.aiEstimateNote"' in nutrition
    assert 'data-i18n="challenges.estimateNote"' in challenges
    i18n = (ROOT / "static" / "i18n.js").read_text(encoding="utf-8")
    assert "AI counts the calories" not in i18n
    assert "Get exact nutrition" not in i18n


# ---------- 5.1.1(i): privacy policy matches the code ----------

def test_privacy_policy_describes_the_ai_consent_and_drops_openai(client):
    page = client.get("/privacy").get_data(as_text=True)
    prose = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    assert "OpenAI" not in prose
    assert "Settings → AI features" in prose
    for item in ("Weekly check-in", "Daily challenge", "AI workout plan", "HYROX race analysis"):
        assert item in prose, item
    assert "deleted right after analysis. Only the resulting" not in prose


def test_settings_lets_the_user_withdraw_ai_consent(client):
    _login(client, "settings@example.com", consent=True)
    page = client.get("/settings").get_data(as_text=True)
    assert 'id="st-ai-toggle"' in page
    assert "RepCheckAIConsent.set(false)" in page


def test_base_template_loads_the_consent_gate_with_the_accounts_state(client):
    _login(client, "base@example.com", consent=True)
    page = client.get("/settings").get_data(as_text=True)
    assert "window.REPCHECK_AI_CONSENT = true;" in page
    assert "ai_consent.js" in page


# ---------- 2.1: no controls that can never work ----------

def test_friends_page_has_no_dead_qr_or_contacts_buttons(client):
    _login(client, "friends@example.com")
    page = client.get("/friends").get_data(as_text=True)
    assert 'id="fr-scan-btn"' not in page
    assert 'id="fr-contacts-btn"' not in page


def test_workouts_no_longer_embeds_a_youtube_search_list():
    page = (ROOT / "templates" / "workouts.html").read_text(encoding="utf-8")
    assert "embed?listType=search" not in page.replace("(embed?listType=search)", "")


# ---------- 5.2.1 / 5.2.2: trademarks and attribution ----------

def test_hyrox_page_carries_the_trademark_notice(client):
    _login(client, "hyrox@example.com")
    page = client.get("/hyrox").get_data(as_text=True)
    assert "registered trademark of upsolut Sports AG" in page
    assert "not affiliated" in page
    i18n = (ROOT / "static" / "i18n.js").read_text(encoding="utf-8")
    assert "The official HYROX race." not in i18n


def test_barcode_results_name_their_database_and_the_ui_credits_it():
    import barcode_scanner
    product = {
        "product_name": "Test Bar",
        "nutriments": {"energy-kcal_100g": 400, "proteins_100g": 10, "fat_100g": 20, "carbohydrates_100g": 45},
        "serving_size": "40 g",
    }
    assert barcode_scanner._validate("123", product, source="FatSecret")["data_source"] == "FatSecret"
    nutrition = (ROOT / "templates" / "nutrition.html").read_text(encoding="utf-8")
    assert "Powered by fatsecret" in nutrition
    assert "https://world.openfoodfacts.org" in nutrition


def test_sources_page_credits_third_party_data(client):
    page = client.get("/sources").get_data(as_text=True)
    assert 'id="credits"' in page
    for name in ("Powered by fatsecret", "Open Food Facts", "MediaPipe", "YouTube", "Unsplash"):
        assert name in page, name
