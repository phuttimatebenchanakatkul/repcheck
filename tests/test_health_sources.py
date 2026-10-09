"""Citations for the AI chats' health advice (App Review Guideline 1.4.1).

0.12.10 (35) was rejected on 2026-10-06 because the AI coach gave health
recommendations "without citations, such as links to sources", and Apple
wants those citations "easy for the user to find". These tests pin the fix:

  - the catalog only holds well-formed https links with unique ids
  - the model can only cite catalog ids; its SOURCES line is stripped from
    the visible reply, and a reply it forgot to cite still gets sources
  - all three chatbots ask for citations and return them, and all three
    routes pass them to the client
  - /sources lists the whole catalog, without needing an account, and is
    linked from Settings and the coach page
"""

import json
import re
from pathlib import Path

import pytest

import analyze_chat
import coach_chat
import health_sources
import workout_chat
from health_sources import SOURCES, SOURCES_BY_ID, attach_sources, prompt_instruction

ROOT = Path(__file__).resolve().parent.parent


# ---------- the catalog ----------

def test_catalog_ids_are_unique_and_every_link_is_https():
    ids = [s["id"] for s in SOURCES]
    assert len(ids) == len(set(ids))
    for source in SOURCES:
        assert re.fullmatch(r"https://[^\s\"'<>]+", source["url"]), source["id"]
        assert source["title"] and source["publisher"]


def test_every_source_belongs_to_a_listed_topic():
    topics = {topic_id for topic_id, _ in health_sources.TOPICS}
    for source in SOURCES:
        assert source["topic"] in topics, source["id"]


def test_keyword_rules_only_name_real_catalog_ids():
    for _, ids in health_sources._KEYWORD_RULES:
        for source_id in ids:
            assert source_id in SOURCES_BY_ID


def test_prompt_instruction_offers_every_catalog_id_and_forbids_writing_urls():
    text = prompt_instruction()
    for source in SOURCES:
        assert source["id"] in text
    assert "SOURCES:" in text
    assert "never write a URL" in text


# ---------- attach_sources ----------

def test_model_citation_line_is_stripped_and_resolved():
    reply, sources = attach_sources(
        "- Rest **3 minutes** between sets.\n\nSOURCES: schoenfeld_rest_2016, grgic_rest_2017",
        "how long should I rest",
    )
    assert reply == "- Rest **3 minutes** between sets."
    assert [s["id"] for s in sources] == ["schoenfeld_rest_2016", "grgic_rest_2017"]
    assert sources[0]["url"] == "https://pubmed.ncbi.nlm.nih.gov/26605807/"


def test_markdown_dressing_on_the_citation_line_is_tolerated():
    reply, sources = attach_sources("Eat more protein.\n**Sources:** [issn_protein_2017]", "protein?")
    assert reply == "Eat more protein."
    assert [s["id"] for s in sources] == ["issn_protein_2017"]


def test_invented_ids_never_become_links_but_the_line_is_still_removed():
    reply, sources = attach_sources("Rest longer.\nSOURCES: smith_2099, fake_study", "rest between sets")
    assert reply == "Rest longer."
    assert all(s["id"] in SOURCES_BY_ID for s in sources)
    # Fell back to the keyword match for the question.
    assert [s["id"] for s in sources] == ["schoenfeld_rest_2016", "grgic_rest_2017"]


def test_a_reply_the_model_forgot_to_cite_still_gets_sources():
    reply, sources = attach_sources("Aim for about 1.6 g of protein per kg.", "how much protein do I need")
    assert reply == "Aim for about 1.6 g of protein per kg."
    assert [s["id"] for s in sources][:1] == ["issn_protein_2017"]


def test_advice_with_no_matching_topic_falls_back_to_general_guidelines():
    _, sources = attach_sources("Keep at it, consistency wins.", "any tips?")
    assert [s["id"] for s in sources] == ["acsm_2009", "who_2020"]


def test_none_means_no_sources_for_a_greeting():
    reply, sources = attach_sources("Hi! What would you like to know?\nSOURCES: none", "hello")
    assert reply == "Hi! What would you like to know?"
    assert sources == []


def test_an_answer_ending_in_a_prose_sources_line_is_left_intact():
    text = "Good protein options:\nSources: eggs, chicken, Greek yogurt"
    reply, _ = attach_sources(text, "what are good protein sources")
    assert reply == text


def test_never_more_than_three_sources():
    _, sources = attach_sources(
        "x\nSOURCES: acsm_2009, who_2020, pag_2018, acsm_2011, helms_2014", "q")
    assert len(sources) == health_sources.MAX_SOURCES_PER_REPLY == 3


def test_sources_carry_only_the_public_fields():
    _, sources = attach_sources("x\nSOURCES: acsm_2009", "q")
    assert set(sources[0]) == {"id", "title", "publisher", "url"}


# ---------- the three chatbots ----------

def _fake_gemini(monkeypatch, text, captured):
    from google import genai as real_genai

    class FakeModels:
        def generate_content(self, **kwargs):
            captured["system"] = kwargs["config"].system_instruction

            class Response:
                pass
            Response.text = text
            return Response()

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)


@pytest.mark.parametrize("call", [
    lambda: coach_chat.get_coach_reply("how long should I rest between sets", []),
    lambda: workout_chat.get_workout_chat_reply("how long should I rest between sets", [], {}),
    lambda: analyze_chat.get_analysis_chat_reply("how long should I rest between sets", [], {}),
], ids=["coach", "workout", "analyze"])
def test_every_chatbot_asks_for_and_returns_citations(monkeypatch, call):
    captured = {}
    _fake_gemini(monkeypatch, "- Rest **3 min**.\nSOURCES: schoenfeld_rest_2016", captured)
    result = call()
    assert prompt_instruction() in captured["system"]
    assert result["reply"] == "- Rest **3 min**."
    assert [s["id"] for s in result["sources"]] == ["schoenfeld_rest_2016"]


@pytest.mark.parametrize("call", [
    lambda: coach_chat.get_coach_reply("hi", []),
    lambda: workout_chat.get_workout_chat_reply("hi", [], {}),
    lambda: analyze_chat.get_analysis_chat_reply("hi", [], {}),
], ids=["coach", "workout", "analyze"])
def test_fallback_replies_cite_nothing(monkeypatch, call):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    result = call()
    assert "isn't reachable" in result["reply"]
    assert result["sources"] == []


# ---------- the HTTP surface ----------

@pytest.fixture
def client(tmp_path, monkeypatch):
    import app as app_module
    import database

    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _login(client, email):
    from database import create_local_user, set_ai_consent
    user_id = create_local_user(email, "irrelevant-password", "Test User")
    set_ai_consent(user_id, True)
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


@pytest.mark.parametrize("route,fn", [
    ("/api/coach-chat", "get_coach_reply"),
    ("/api/workout-chat", "get_workout_chat_reply"),
    ("/api/analyze-chat", "get_analysis_chat_reply"),
])
def test_chat_routes_pass_sources_to_the_client(client, monkeypatch, route, fn):
    import app as app_module

    sources = [health_sources._public(SOURCES_BY_ID["acsm_2009"])]
    monkeypatch.setattr(
        app_module, fn,
        lambda *args: {"reply": "ok", "sources": sources, "limited": False, "retry_after_seconds": 0},
    )
    _login(client, f"src{fn}@example.com")
    res = client.post(route, data=json.dumps({"message": "q"}), content_type="application/json")
    assert res.status_code == 200
    assert res.get_json()["sources"] == sources


def test_sources_page_is_public_and_lists_every_citation():
    import app as app_module
    app_module.app.config["TESTING"] = True
    res = app_module.app.test_client().get("/sources")
    assert res.status_code == 200
    page = res.get_data(as_text=True)
    for source in SOURCES:
        assert f'href="{source["url"]}"' in page, source["id"]
    assert "Not medical advice" in page


def test_sources_page_is_linked_from_settings_and_the_coach_page():
    settings = (ROOT / "templates" / "settings.html").read_text(encoding="utf-8")
    coach = (ROOT / "templates" / "coach.html").read_text(encoding="utf-8")
    assert "url_for('health_sources_page')" in settings
    assert coach.count("url_for('health_sources_page')") >= 2  # corner button + welcome note


def test_coach_page_keeps_and_renders_each_replys_sources():
    """coach.html has no JS harness; pin the two lines that matter. Remove
    either and the citations silently vanish from the coach page."""
    coach = (ROOT / "templates" / "coach.html").read_text(encoding="utf-8")
    assert re.search(r'history\.push\(\{ role: "coach", text: reply, sources,', coach)
    assert 'RepCheckSources.html(turn.sources, "coach")' in coach


def test_base_template_loads_the_shared_renderer():
    base = (ROOT / "templates" / "base.html").read_text(encoding="utf-8")
    assert "asset_url('ai_sources.js')" in base
