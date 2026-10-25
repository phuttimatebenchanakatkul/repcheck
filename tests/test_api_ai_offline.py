"""The AI slice's pure parts: coaching validation (compared with the website's own), chat input rules, the HYROX
session shim, and the two coaching routes that need no database. No network."""

import json
import random

import pytest
from flask import session

import app as website
from api import ai, chat, coaching
from api.app import create_app
from coaching_engine import FEMALE_BODY_FAT_RANGES, MALE_BODY_FAT_RANGES, calculate_targets, distribute_weekly_calories
from test_api_auth import SETTINGS, ExplodingDb, token, verifier

MALE_ID, FEMALE_ID = MALE_BODY_FAT_RANGES[0]["id"], FEMALE_BODY_FAT_RANGES[0]["id"]
PROFILE = {"aspiration": "lose", "gender": "male", "activity_level": "lift_and_cardio", "protein_preference": "high",
           "diet_preference": "balanced", "body_fat_range_id": MALE_ID, "weight_kg": 80, "height_cm": 180, "loss_rate_pct": 0.5}


def with_(**changes):
    return {k: v for k, v in dict(PROFILE, **changes).items() if v is not ...}


# -- the profile check is the website's ------------------------------------------------------------------------------

CASES = [
    {}, with_(aspiration="gain", gain_rate_pct=0.4, loss_rate_pct=None), with_(aspiration="maintain"),
    with_(aspiration="bulk"), with_(aspiration=None), with_(gender="female", body_fat_range_id=FEMALE_ID),
    with_(gender="female"), with_(gender="other"), with_(activity_level="couch"), with_(protein_preference="lots"),
    with_(diet_preference="keto"), with_(diet_preference="vegan"), with_(diet_preference=None), with_(diet_preference=...),
    with_(body_fat_range_id="nope"), with_(body_fat_range_id=...),
    *[with_(weight_kg=w) for w in (34.9, 35, 35.0, 300, 300.01, 0, -5, "80", "abc", None, True, [], float("nan"), float("inf"))],
    with_(weight_kg=...),
    *[with_(height_cm=h) for h in (99.9, 100, 250, 250.1, "180", "x", None, True)],
    *[with_(loss_rate_pct=r) for r in (None, 0.09, 0.1, 0.11, 2.0, 2.01, 2.02, "1", "x", 0, True)],
    with_(aspiration="gain", loss_rate_pct=99, gain_rate_pct=None),
    *[with_(aspiration="gain", loss_rate_pct=None, gain_rate_pct=r) for r in (0.24, 0.25, 0.35, 0.8, 0.81, 0.83, 5, "x")],
    with_(aspiration="lose", loss_rate_pct=...), with_(aspiration="maintain", loss_rate_pct=99, gain_rate_pct="junk"),
]


@pytest.mark.parametrize("payload", CASES, ids=lambda p: json.dumps(p, default=str)[:60])
def test_the_profile_check_gives_exactly_the_websites_answer(payload):
    assert coaching.validate_profile(payload) == website._validate_coaching_profile(payload)


def test_the_profile_check_agrees_with_the_website_on_random_garbage_and_refuses_cleanly_where_it_crashes():
    """Wherever the website answers, so do we, identically. Where the website raises (an unhashable value such as a list in a
    field that expects a word: a 500 there), we answer with a refusal instead."""
    rng = random.Random(4)
    junk = [None, True, False, 0, 1, -1, 35, 300, 1e9, "", "male", "female", "lose", "keto", "x", [], {}, [1], {"a": 1}, MALE_ID, FEMALE_ID]
    crashes = 0
    for _ in range(800):
        payload = {k: rng.choice(junk) for k in list(PROFILE) if rng.random() < 0.9}
        ours = coaching.validate_profile(payload)
        try:
            theirs = website._validate_coaching_profile(payload)
        except TypeError:
            crashes += 1
            assert ours[0] is None and isinstance(ours[1], str), payload
        else:
            assert ours == theirs, payload
    assert crashes > 0, "the fuzz never reached the website's crash: it is not testing what it claims"


@pytest.mark.parametrize("field", ["aspiration", "gender", "activity_level", "protein_preference", "diet_preference", "body_fat_range_id"])
@pytest.mark.parametrize("bad", [[1], ["lose"], {"a": 1}, [[]]])
def test_a_list_or_object_in_a_choice_field_is_a_clean_refusal_not_a_crash(field, bad):
    profile, error = coaching.validate_profile(dict(PROFILE, **{field: bad}))
    assert profile is None and isinstance(error, str)


# -- helpers ------------------------------------------------------------------------------------------------------

def test_only_real_weekdays_survive_as_training_days():
    assert coaching.training_days(["Monday", "friday", "FRIDAY", "someday", 3, None, ["monday"], {"a": 1}]) == {"monday", "friday"}
    assert coaching.training_days("monday") == set() and coaching.training_days(None) == set() and coaching.training_days({}) == set()


def test_log_lists_are_bounded_and_must_hold_objects():
    assert coaching.bounded_list(None) == [] and coaching.bounded_list([]) == []
    assert coaching.bounded_list([{"a": 1}] * 31) == [{"a": 1}] * 31
    for bad in ([{}] * 32, "x", {"a": 1}, [1], [{}, "x"], [None]):
        assert coaching.bounded_list(bad) is None


@pytest.mark.parametrize("name,mime", [("a.jpg", "image/jpeg"), ("a.PNG", "image/png"), ("a.webp", "image/webp"), ("a", "image/jpeg"), ("a.zzz", "image/jpeg")])
def test_the_photo_type_comes_from_its_stored_name(name, mime):
    assert coaching.mime_for(name) == mime


# -- chat input rules -----------------------------------------------------------------------------------------------

def test_a_good_request_is_trimmed_and_shaped():
    message, history, context = chat.clean_request(
        {"message": "  how much rest?  ", "history": [{"role": "user", "text": "hi"}, {"role": "coach", "text": "hello", "extra": 1}],
         "context": {"exercise_label": "Squat"}}, takes_context=True)
    assert message == "how much rest?"
    assert history == [{"role": "user", "text": "hi"}, {"role": "coach", "text": "hello"}]
    assert context == {"exercise_label": "Squat"}


def test_the_coach_chat_takes_no_context_whatever_is_sent():
    assert chat.clean_request({"message": "x", "context": "not even a dict"}, takes_context=False)[2] == {}


@pytest.mark.parametrize("message", [None, "", "   ", "\n\t "])
def test_an_empty_message_is_refused(message):
    with pytest.raises(chat.ChatRejected, match="Message can't be empty."):
        chat.clean_request({"message": message}, takes_context=False)
    with pytest.raises(chat.ChatRejected, match="Message can't be empty."):
        chat.clean_request({}, takes_context=False)


def test_a_message_longer_than_the_bound_is_refused_and_the_bound_itself_is_fine():
    chat.clean_request({"message": "x" * chat.MAX_MESSAGE_CHARS}, takes_context=False)
    with pytest.raises(chat.ChatRejected, match="too long"):
        chat.clean_request({"message": "x" * (chat.MAX_MESSAGE_CHARS + 1)}, takes_context=False)


def test_the_message_bound_is_the_1000_the_refusal_text_promises():
    assert chat.MAX_MESSAGE_CHARS == 1000
    assert len(chat.clean_request({"message": "x" * 1000}, takes_context=False)[0]) == 1000
    with pytest.raises(chat.ChatRejected, match="1,000 characters"):
        chat.clean_request({"message": "x" * 1001}, takes_context=False)


@pytest.mark.parametrize("history", ["hi", {"a": 1}, 5, [1], ["x"], [None], [{"role": "user"}, 3], [{"role": 1, "text": "x"}],
                                     [{"role": "user", "text": 5}], [{"role": "user", "text": None}], [{"text": "x"}]])
def test_a_malformed_history_is_refused(history):
    with pytest.raises(chat.ChatRejected, match="Invalid history."):
        chat.clean_request({"message": "x", "history": history}, takes_context=False)


def test_history_keeps_the_newest_turns_and_clips_long_ones():
    turns = [{"role": "user", "text": f"t{i}"} for i in range(chat.MAX_HISTORY_TURNS + 10)]
    _, kept, _ = chat.clean_request({"message": "x", "history": turns}, takes_context=False)
    assert len(kept) == chat.MAX_HISTORY_TURNS and kept[-1]["text"] == f"t{chat.MAX_HISTORY_TURNS + 9}" and kept[0]["text"] == "t10"
    _, long, _ = chat.clean_request({"message": "x", "history": [{"role": "r" * 50, "text": "y" * 9000}]}, takes_context=False)
    assert len(long[0]["text"]) == chat.MAX_TURN_CHARS and len(long[0]["role"]) == 20


def test_an_empty_or_missing_history_is_fine():
    for h in (None, [], 0, ""):
        assert chat.clean_request({"message": "x", "history": h}, takes_context=False)[1] == []


@pytest.mark.parametrize("context", ["x", [1], 5, {"big": "y" * (chat.MAX_CONTEXT_CHARS + 1)}])
def test_a_malformed_or_oversized_context_is_refused(context):
    with pytest.raises(chat.ChatRejected, match="Invalid context."):
        chat.clean_request({"message": "x", "context": context}, takes_context=True)


def test_a_context_just_inside_the_bound_is_accepted():
    ctx = {"k": "y" * (chat.MAX_CONTEXT_CHARS - 20)}
    assert chat.clean_request({"message": "x", "context": ctx}, takes_context=True)[2] == ctx


def test_the_over_limit_chat_reply_reads_as_the_websites_does():
    ours = chat.limited_reply(86000)
    theirs = website._chat_limit_response(86000)
    assert ours["reply"] == theirs["reply"] and ours["limited"] is True and ours["retry_after_seconds"] == 86000 and ours["ok"] is True


# -- the HYROX session shim -----------------------------------------------------------------------------------------

def test_the_hyrox_modules_cookie_session_works_without_a_cookie_and_starts_empty_every_time(monkeypatch):
    import hyrox_coach
    seen = []

    def fake(race):
        seen.append(dict(session))                     # would raise outside a request context with a secret key
        session["hyrox_analysis_count"] = 99           # the module writes its budget here
        return {"overall": "ok", "overall_detail": [], "tips": [{"tip": "t"}], "limited": False, "retry_after_seconds": 0}
    monkeypatch.setattr(hyrox_coach, "get_hyrox_race_analysis", fake)
    first, second = ai._hyrox_backend({"segments": [1]}), ai._hyrox_backend({"segments": [1]})
    assert seen == [{}, {}], "each call must start with an empty session, so the module's own budget never trips"
    assert first["failed"] is False and second["overall"] == "ok"


@pytest.mark.parametrize("result,failed", [
    ({"overall": "", "overall_detail": [], "tips": [{"tip": ""}, {"tip": ""}], "limited": False}, True),
    ({"overall": "x", "overall_detail": [], "tips": [{"tip": ""}], "limited": False}, False),
    ({"overall": "", "overall_detail": [], "tips": [{"tip": "t"}], "limited": False}, False),
    ({"overall": "", "overall_detail": [], "tips": [], "limited": True}, False),
])
def test_a_hyrox_answer_with_no_ai_content_counts_as_failed(monkeypatch, result, failed):
    import hyrox_coach
    monkeypatch.setattr(hyrox_coach, "get_hyrox_race_analysis", lambda race: dict(result, retry_after_seconds=0))
    assert ai._hyrox_backend({})["failed"] is failed


@pytest.mark.parametrize("module,function,takes_context", [("coach_chat", "get_coach_reply", False),
                                                           ("analyze_chat", "get_analysis_chat_reply", True),
                                                           ("workout_chat", "get_workout_chat_reply", True)])
def test_a_chat_that_fell_back_is_marked_failed_and_a_real_reply_is_not(monkeypatch, module, function, takes_context):
    import importlib
    mod = importlib.import_module(module)
    backend = ai._chat_backend(module, function, takes_context)
    monkeypatch.setattr(mod, function, lambda *a, **k: {"reply": mod._fallback_reply(), "sources": [], "limited": False, "retry_after_seconds": 0})
    assert backend("hi", [], {})["failed"] is True
    monkeypatch.setattr(mod, function, lambda *a, **k: {"reply": "A real answer", "sources": [], "limited": False, "retry_after_seconds": 0})
    assert backend("hi", [], {})["failed"] is False


def test_without_a_gemini_key_every_chat_reports_failure_instead_of_pretending(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    backends = ai.default_backends()
    for fn in (backends.coach, backends.analysis_chat, backends.workout_chat):
        assert fn("hi", [], {})["failed"] is True


# -- the coaching routes that need no database -----------------------------------------------------------------------

@pytest.fixture
def api():
    app = create_app(SETTINGS, db=ExplodingDb(), verifier=verifier(), storage=object(), auth_admin=object(), sweep=False)
    c = app.test_client()
    c.environ_base["HTTP_AUTHORIZATION"] = "Bearer " + token()
    return c


def test_the_body_fat_ranges_are_the_engines_with_male_as_the_default(api):
    assert api.get("/api/coaching/body-fat-ranges").get_json() == {"ok": True, "ranges": MALE_BODY_FAT_RANGES}
    assert api.get("/api/coaching/body-fat-ranges?gender=female").get_json()["ranges"] == FEMALE_BODY_FAT_RANGES
    assert api.get("/api/coaching/body-fat-ranges?gender=whatever").get_json()["ranges"] == MALE_BODY_FAT_RANGES


def test_the_targets_are_the_engines(api):
    r = api.post("/api/coaching/calculate", json=PROFILE)
    expected = calculate_targets(coaching.validate_profile(PROFILE)[0])
    assert r.status_code == 200 and r.get_json() == {"ok": True, "targets": expected, "distribution": None}


def test_a_weekly_distribution_uses_only_real_training_days(api):
    body = api.post("/api/coaching/calculate", json=dict(PROFILE, distribution="weekly", training_days=["Monday", "bogus", 7, None, ["x"]])).get_json()
    targets = body["targets"]
    assert body["distribution"] == distribute_weekly_calories(targets["calories"], targets["protein"], targets["fat"], targets["carbs"], {"monday"})
    assert api.post("/api/coaching/calculate", json=dict(PROFILE, distribution="weekly", training_days="monday")).status_code == 200


@pytest.mark.parametrize("change,message", [
    ({"aspiration": "x"}, "Please choose a goal: lose, maintain, or gain weight."), ({"gender": None}, "Please choose a gender."),
    ({"weight_kg": 20}, "Please enter a realistic weight of at least 35 kg."), ({"body_fat_range_id": "z"}, "Please choose a body type."),
])
def test_a_bad_profile_is_a_400_with_the_websites_message(api, change, message):
    r = api.post("/api/coaching/calculate", json=dict(PROFILE, **change))
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": message}


def test_calculate_ignores_a_body_that_is_not_an_object(api):
    for body in ("[]", "5", "null", ""):
        r = api.post("/api/coaching/calculate", data=body, content_type="application/json")
        assert r.status_code == 400 and r.get_json()["ok"] is False
