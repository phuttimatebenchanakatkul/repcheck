"""The three AI chats, HYROX analysis, split generation and the weekly check-in through the native API, against the REAL
Supabase project (real tokens, rows, Storage). The model is a fake: no Gemini calls, no cost, no flakiness.

Every refusal and failure is checked for its EFFECT: the backend was never called, no use of the allowance was spent,
nothing was counted. Mutation-check any change here (CLAUDE.md).
"""

import dataclasses
import io
import threading
import time
from collections import defaultdict

import pytest
from PIL import Image

from api import ai, chat, consent, limits
from api.app import create_app
from api.supabase_admin import SupabaseError
from coaching_engine import MALE_BODY_FAT_RANGES, apply_calorie_delta, weekly_adjustment
from workout_library import WORKOUT_EXERCISES
from api import coaching
from api_support import (  # noqa: F401 -- the fixtures are used by name
    bearer, client, db, forget, person, settings, storage)
from test_supabase_rls import Person, needs_api, needs_db

pytestmark = [needs_api, needs_db]

PROFILE = {"aspiration": "lose", "gender": "male", "activity_level": "lift_and_cardio", "protein_preference": "high",
           "diet_preference": "balanced", "body_fat_range_id": MALE_BODY_FAT_RANGES[0]["id"], "weight_kg": 80, "height_cm": 180,
           "loss_rate_pct": 0.5}
TARGETS = {"calories": 2400, "protein": 160, "fat": 70, "carbs": 280}
WEIGHTS = [{"date": "2026-10-19", "kg": 80.0}, {"date": "2026-10-25", "kg": 80.4}]
CALORIES = [{"date": f"2026-10-{20 + i}", "calories": 2500} for i in range(4)]


class FakeAI:
    """Records every call; each backend answers a canned result unless told to fail or raise."""

    def __init__(self):
        self.calls = defaultdict(list)
        self.failed, self.raises, self.delay = set(), {}, 0.0
        self.sources = [{"id": "s1", "title": "A source"}]

    def _go(self, name, args, kwargs, result):
        self.calls[name].append((args, kwargs))
        if self.delay:
            time.sleep(self.delay)
        if name in self.raises:
            raise self.raises[name]
        return dict(result, failed=name in self.failed)

    def coach(self, message, history, context):
        return self._go("coach", (message, history, context), {}, {"reply": "coach says hi", "sources": self.sources})

    def analysis_chat(self, message, history, context):
        return self._go("analysis_chat", (message, history, context), {}, {"reply": "analysis says hi", "sources": []})

    def workout_chat(self, message, history, context):
        return self._go("workout_chat", (message, history, context), {}, {"reply": "workout says hi", "sources": self.sources})

    def hyrox(self, race):
        return self._go("hyrox", (race,), {}, {"overall": "Fix your sled push.", "overall_detail": ["a", "b"],
                                               "tips": [{"key": "skierg", "rating": "solid", "tip": "Pace it", "detail": []}],
                                               "limited": False, "retry_after_seconds": 0})

    def suggest_split(self, *args, **kwargs):
        return self._go("suggest_split", args, kwargs, {"split_type": "full_body", "days": [{"label": "Full Body"}], "rationale": "ai"})

    def build_split(self, *args, **kwargs):
        return self._go("build_split", args, kwargs, {"days": [{"label": "Push"}], "schedule": {}, "rationale": "built"})

    def checkin(self, *args, **kwargs):
        return self._go("checkin", args, kwargs, {"delta": -120, "reason": "Trend is flat; trimming."})

    def count(self, name):
        return len(self.calls[name])


def app_with(settings, db, storage, fake, exempt=()):
    s = dataclasses.replace(settings, rate_limit_exempt=frozenset(e.lower() for e in exempt))
    return create_app(s, db=db, storage=storage, ai=fake, sweep=False).test_client()


@pytest.fixture
def fake():
    return FakeAI()


@pytest.fixture
def me(client, person):
    assert client.post("/api/profile", headers=bearer(person), json={"name": "Chatter"}).status_code == 201
    assert client.post("/api/ai-consent", headers=bearer(person), json={"granted": True}).status_code == 200
    return person


def limit_count(db, uid, feature):
    with db.connection() as conn:
        r = conn.execute("select count from public.rate_limits where user_id = %s and feature = %s", (uid, feature)).fetchone()
    return r["count"] if r else 0


def usage(db, uid, event):
    with db.connection() as conn:
        r = conn.execute("select count from public.usage_events where user_id = %s and event = %s", (uid, event)).fetchone()
    return r["count"] if r else 0


def set_count(db, uid, feature, count, ago=0):
    with db.connection() as conn:
        conn.execute("insert into public.rate_limits (user_id, feature, window_start, count) values (%s, %s, %s, %s) "
                     "on conflict (user_id, feature) do update set window_start = excluded.window_start, count = excluded.count",
                     (uid, feature, int(time.time()) - ago, count))


CHATS = [("/api/coach-chat", "coach", "coach says hi", "coach_chat_message", False),
         ("/api/analyze-chat", "analysis_chat", "analysis says hi", "analyze_chat_message", True),
         ("/api/workout-chat", "workout_chat", "workout says hi", "workout_chat_message", True)]
IDS = [c[1] for c in CHATS]


# -- the chats ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("path,backend,reply,event,takes_context", CHATS, ids=IDS)
def test_a_chat_message_reaches_the_model_with_clean_inputs_and_comes_back_with_its_sources(settings, db, storage, fake, me, path, backend, reply, event, takes_context):
    c = app_with(settings, db, storage, fake)
    r = c.post(path, headers=bearer(me), json={"message": "  how much rest?  ", "history": [{"role": "user", "text": "hi", "x": 1}],
                                               "context": {"exercise_label": "Squat"}})
    body = r.get_json()
    assert r.status_code == 200 and body["ok"] is True and body["reply"] == reply and body["limited"] is False
    assert body["retry_after_seconds"] == 0 and isinstance(body["sources"], list)
    (args, _), = fake.calls[backend]
    assert args[0] == "how much rest?" and args[1] == [{"role": "user", "text": "hi"}]
    assert args[2] == ({"exercise_label": "Squat"} if takes_context else {}), "the coach chat takes no context"
    assert usage(db, me.id, "feature:" + event) == 1 and limit_count(db, me.id, "ai_chat") == 1


def test_sources_come_through_unchanged(settings, db, storage, fake, me):
    r = app_with(settings, db, storage, fake).post("/api/coach-chat", headers=bearer(me), json={"message": "x"})
    assert r.get_json()["sources"] == fake.sources


def test_all_three_chats_share_one_daily_budget_and_the_fourth_message_is_a_normal_looking_limited_reply(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    for path, *_ in CHATS:
        assert c.post(path, headers=bearer(me), json={"message": "hello"}).get_json()["limited"] is False
    r = c.post("/api/coach-chat", headers=bearer(me), json={"message": "again"})
    body = r.get_json()
    assert r.status_code == 200 and body["ok"] is True and body["limited"] is True
    assert body["reply"] == "You've reached your 3 chat messages for now. Please check back in about 24 hours."
    assert 86000 <= body["retry_after_seconds"] <= 86400
    assert sum(fake.count(n) for n in IDS) == 3, "the limited message must never reach the model"
    assert limit_count(db, me.id, "ai_chat") == 3


def test_the_chat_budget_comes_back_after_the_window(settings, db, storage, fake, me):
    set_count(db, me.id, "ai_chat", 3, ago=86400 + 5)
    r = app_with(settings, db, storage, fake).post("/api/coach-chat", headers=bearer(me), json={"message": "x"})
    assert r.get_json()["limited"] is False and limit_count(db, me.id, "ai_chat") == 1


def test_the_owner_and_app_review_chat_without_limit(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake, exempt=[me.email])
    for _ in range(5):
        assert c.post("/api/coach-chat", headers=bearer(me), json={"message": "x"}).get_json()["limited"] is False
    assert limit_count(db, me.id, "ai_chat") == 0 and usage(db, me.id, "feature:coach_chat_message") == 5


@pytest.mark.parametrize("path,backend,reply,event,takes_context", CHATS, ids=IDS)
def test_a_model_that_could_not_be_reached_does_not_cost_a_message(settings, db, storage, fake, me, path, backend, reply, event, takes_context):
    fake.failed.add(backend)
    c = app_with(settings, db, storage, fake)
    for _ in range(5):
        assert c.post(path, headers=bearer(me), json={"message": "x"}).status_code == 200
    assert limit_count(db, me.id, "ai_chat") == 0 and usage(db, me.id, "feature:" + event) == 0


def test_an_unexpected_crash_is_a_generic_500_that_leaks_nothing_and_refunds_the_message(settings, db, storage, fake, me):
    fake.raises["coach"] = RuntimeError("secret detail: api_key=abc")
    r = app_with(settings, db, storage, fake).post("/api/coach-chat", headers=bearer(me), json={"message": "x"})
    assert r.status_code == 500 and "secret" not in r.get_data(as_text=True)
    assert limit_count(db, me.id, "ai_chat") == 0


@pytest.mark.parametrize("path,backend,reply,event,takes_context", CHATS, ids=IDS)
def test_no_profile_is_a_404_and_no_consent_the_websites_403_and_nothing_is_called(settings, db, storage, fake, client, person, path, backend, reply, event, takes_context):
    c = app_with(settings, db, storage, fake)
    assert c.post(path, headers=bearer(person), json={"message": "x"}).status_code == 404
    client.post("/api/profile", headers=bearer(person), json={"name": "Unconsenting"})
    r = c.post(path, headers=bearer(person), json={"message": "x"})
    assert r.status_code == 403 and r.get_json() == {"ok": False, "needs_ai_consent": True, "error": consent.CONSENT_ERROR}
    assert fake.count(backend) == 0 and limit_count(db, person.id, "ai_chat") == 0


@pytest.mark.parametrize("path,backend,reply,event,takes_context", CHATS, ids=IDS)
@pytest.mark.parametrize("payload,message", [
    ({}, "Message can't be empty."), ({"message": "   "}, "Message can't be empty."), ({"message": None}, "Message can't be empty."),
    ({"message": "x" * 1001}, "That message is too long. Please keep it under 1,000 characters."),
    ({"message": "x", "history": "hi"}, "Invalid history."), ({"message": "x", "history": [1]}, "Invalid history."),
    ({"message": "x", "history": [{"role": "user", "text": 5}]}, "Invalid history."),
])
def test_a_bad_chat_request_is_a_400_that_costs_nothing(settings, db, storage, fake, me, path, backend, reply, event, takes_context, payload, message):
    r = app_with(settings, db, storage, fake).post(path, headers=bearer(me), json=payload)
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": message}
    assert fake.count(backend) == 0 and limit_count(db, me.id, "ai_chat") == 0


@pytest.mark.parametrize("path", ["/api/analyze-chat", "/api/workout-chat"])
@pytest.mark.parametrize("context", ["x", [1], 5, {"big": "y" * 40_001}])
def test_a_bad_context_is_refused_by_the_two_chats_that_take_one(settings, db, storage, fake, me, path, context):
    r = app_with(settings, db, storage, fake).post(path, headers=bearer(me), json={"message": "x", "context": context})
    assert r.status_code == 400 and r.get_json()["error"] == "Invalid context."
    assert limit_count(db, me.id, "ai_chat") == 0


def test_the_coach_chat_ignores_a_context_it_does_not_take(settings, db, storage, fake, me):
    r = app_with(settings, db, storage, fake).post("/api/coach-chat", headers=bearer(me), json={"message": "x", "context": "garbage"})
    assert r.status_code == 200 and fake.calls["coach"][0][0][2] == {}


def test_a_long_history_is_cut_to_the_newest_turns_before_it_reaches_the_model(settings, db, storage, fake, me):
    history = [{"role": "user", "text": f"t{i}"} for i in range(60)]
    app_with(settings, db, storage, fake).post("/api/coach-chat", headers=bearer(me), json={"message": "x", "history": history})
    sent = fake.calls["coach"][0][0][1]
    assert len(sent) == chat.MAX_HISTORY_TURNS and sent[-1]["text"] == "t59"


def test_simultaneous_messages_cannot_get_past_the_budget(settings, db, storage, me):
    fake = FakeAI()
    fake.delay = 1.2
    results, gate = [], threading.Barrier(6)

    def go():
        c = app_with(settings, db, storage, fake)
        gate.wait()
        results.append(c.post("/api/coach-chat", headers=bearer(me), json={"message": "x"}).get_json()["limited"])
    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join(120) for t in threads]
    assert sorted(results) == [False] * 3 + [True] * 3 and fake.count("coach") == 3 and limit_count(db, me.id, "ai_chat") == 3


def test_one_persons_budget_is_not_anothers(settings, db, storage, fake, client, me):
    other = Person("chatty")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Chatty"})
        client.post("/api/ai-consent", headers=bearer(other), json={"granted": True})
        c = app_with(settings, db, storage, fake)
        for _ in range(3):
            c.post("/api/coach-chat", headers=bearer(me), json={"message": "x"})
        assert c.post("/api/coach-chat", headers=bearer(me), json={"message": "x"}).get_json()["limited"] is True
        assert c.post("/api/coach-chat", headers=bearer(other), json={"message": "x"}).get_json()["limited"] is False
    finally:
        forget(other)


# -- HYROX race analysis -----------------------------------------------------------------------------------------

RACE = {"category": "open", "format": "singles", "gender": "male", "total_seconds": 4000,
        "segments": [{"key": "skierg", "type": "station", "title": "SkiErg", "seconds": 240}, {"key": "run1", "type": "run", "seconds": 300}]}


def test_a_race_is_analyzed_and_the_answer_returned_in_the_clients_shape(settings, db, storage, fake, me):
    r = app_with(settings, db, storage, fake).post("/api/hyrox/analyze", headers=bearer(me), json={"race": RACE})
    body = r.get_json()
    assert r.status_code == 200 and body == {"ok": True, "overall": "Fix your sled push.", "overall_detail": ["a", "b"],
                                             "tips": fake.hyrox(RACE)["tips"], "limited": False, "retry_after_seconds": 0}
    assert fake.calls["hyrox"][0][0][0] == RACE
    assert limit_count(db, me.id, "hyrox_analysis") == 1 and usage(db, me.id, "feature:hyrox_ai_analysis") == 1


def test_the_ninth_race_in_five_hours_gets_the_limited_message_not_an_error(settings, db, storage, fake, me):
    set_count(db, me.id, "hyrox_analysis", 8, ago=60)
    r = app_with(settings, db, storage, fake).post("/api/hyrox/analyze", headers=bearer(me), json={"race": RACE})
    body = r.get_json()
    assert r.status_code == 200 and body["limited"] is True and body["tips"] == [] and body["overall_detail"] == []
    assert body["overall"].startswith("You've analyzed 8 races today. Please check back in about ")
    assert 17900 <= body["retry_after_seconds"] <= 18000 and fake.count("hyrox") == 0


def test_a_race_the_model_could_not_analyze_does_not_use_up_the_budget(settings, db, storage, fake, me):
    fake.failed.add("hyrox")
    c = app_with(settings, db, storage, fake)
    for _ in range(10):
        assert c.post("/api/hyrox/analyze", headers=bearer(me), json={"race": RACE}).status_code == 200
    assert limit_count(db, me.id, "hyrox_analysis") == 0


def test_a_hyrox_crash_refunds_and_leaks_nothing(settings, db, storage, fake, me):
    fake.raises["hyrox"] = RuntimeError("secret detail")
    r = app_with(settings, db, storage, fake).post("/api/hyrox/analyze", headers=bearer(me), json={"race": RACE})
    assert r.status_code == 500 and "secret" not in r.get_data(as_text=True) and limit_count(db, me.id, "hyrox_analysis") == 0


@pytest.mark.parametrize("payload,message", [
    ({}, "Race has no segments to analyze."), ({"race": "x"}, "Invalid race."), ({"race": []}, "Race has no segments to analyze."),
    ({"race": {"segments": []}}, "Race has no segments to analyze."), ({"race": {"segments": "x"}}, "Race has no segments to analyze."),
    ({"race": {"segments": [{}] * 41}}, "Invalid race."), ({"race": {"segments": [{"k": 1}], "note": "y" * 20_001}}, "Invalid race."),
])
def test_a_bad_race_is_a_400_that_costs_nothing(settings, db, storage, fake, me, payload, message):
    r = app_with(settings, db, storage, fake).post("/api/hyrox/analyze", headers=bearer(me), json=payload)
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": message}
    assert fake.count("hyrox") == 0 and limit_count(db, me.id, "hyrox_analysis") == 0


def test_hyrox_needs_a_profile_and_consent(settings, db, storage, fake, client, person):
    c = app_with(settings, db, storage, fake)
    assert c.post("/api/hyrox/analyze", headers=bearer(person), json={"race": RACE}).status_code == 404
    client.post("/api/profile", headers=bearer(person), json={"name": "No Consent"})
    assert c.post("/api/hyrox/analyze", headers=bearer(person), json={"race": RACE}).status_code == 403
    assert fake.count("hyrox") == 0


def test_the_owner_is_never_limited_on_hyrox(settings, db, storage, fake, me):
    set_count(db, me.id, "hyrox_analysis", 8, ago=60)
    r = app_with(settings, db, storage, fake, exempt=[me.email]).post("/api/hyrox/analyze", headers=bearer(me), json={"race": RACE})
    assert r.get_json()["limited"] is False and fake.count("hyrox") == 1


# -- split generation ----------------------------------------------------------------------------------------------

SPLIT = {"split_type": "ppl", "days_per_week": 4}


def split_post(c, who, **fields):
    return c.post("/api/generate-split", headers=bearer(who), json=dict(SPLIT, **fields))


def test_a_split_is_built_with_the_cleaned_inputs_and_returned_with_ok(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    real, other_real = sorted(WORKOUT_EXERCISES)[:2]
    r = split_post(c, me, custom_days=["  Push  ", "", "Pull"], goal="  " + "g" * 400 + "  ", location=" HOME ",
                   custom_days_exercises={"Push": [real, "Not A Real Exercise", 5], "Skip": "no", "X" * 100: [other_real]})
    assert r.status_code == 200 and r.get_json() == {"ok": True, **fake.build_split("x", 1)}
    args, _ = fake.calls["build_split"][0]
    assert args[0] == "ppl" and args[1] == 4 and args[2] == ["Push", "Pull"]
    assert args[3] == "g" * 300, "the goal is cut to 300 characters"
    assert args[5] == "home"
    assert set(args[4]) == {"Push", "X" * 60} and args[4]["Push"] == [real] and args[4]["X" * 60] == [other_real]
    assert limit_count(db, me.id, "split_generation") == 1 and fake.count("suggest_split") == 0


@pytest.mark.parametrize("split_type", ["ppl", "upper_lower", "full_body", "bro_split"])
def test_the_ordinary_split_types_work_without_ai_consent(settings, db, storage, fake, client, person, split_type):
    client.post("/api/profile", headers=bearer(person), json={"name": "No Consent"})
    r = split_post(app_with(settings, db, storage, fake), person, split_type=split_type)
    assert r.status_code == 200 and fake.count("build_split") == 1


def test_a_custom_split_needs_at_least_one_day_and_works_without_consent(settings, db, storage, fake, client, person):
    client.post("/api/profile", headers=bearer(person), json={"name": "Custom"})
    c = app_with(settings, db, storage, fake)
    for custom in (None, [], ["", "  "]):
        r = split_post(c, person, split_type="custom", custom_days=custom)
        assert r.status_code == 400 and r.get_json()["error"] == "Please name at least one custom day."
    assert limit_count(db, person.id, "split_generation") == 0
    assert split_post(c, person, split_type="custom", custom_days=["Arms"]).status_code == 200


def test_ai_suggest_needs_consent_and_passes_only_clean_optional_details(settings, db, storage, fake, client, person, me):
    other = Person("noconsent")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Nobody"})
        c = app_with(settings, db, storage, fake)
        r = split_post(c, other, split_type="ai_suggest")
        assert r.status_code == 403 and r.get_json()["needs_ai_consent"] is True and fake.count("suggest_split") == 0
        assert limit_count(db, other.id, "split_generation") == 0
    finally:
        forget(other)
    c = app_with(settings, db, storage, fake)
    r = split_post(c, me, split_type="ai_suggest", goal="more mobility", gender=" FEMALE ", goal_weight_kg="65.5", current_weight_kg=10,
                   location="Gym")
    assert r.status_code == 200 and r.get_json()["split_type"] == "full_body"
    (args, kwargs), = fake.calls["suggest_split"]
    assert args == (4,) and kwargs == {"goal": "more mobility", "gender": "female", "goal_weight_kg": 65.5, "current_weight_kg": None, "location": "gym"}
    assert usage(db, me.id, "feature:split_ai_suggested") == 1 and fake.count("build_split") == 0


@pytest.mark.parametrize("gender,weight", [("other", "abc"), ("", None), (None, True), ("male", 501), ("male", 19.9)])
def test_odd_optional_details_are_dropped_not_fatal(settings, db, storage, fake, me, gender, weight):
    r = split_post(app_with(settings, db, storage, fake), me, split_type="ai_suggest", gender=gender, goal_weight_kg=weight)
    assert r.status_code == 200
    kwargs = fake.calls["suggest_split"][0][1]
    assert kwargs["goal_weight_kg"] is None and kwargs["gender"] in (None, "male")


@pytest.mark.parametrize("fields,message", [
    ({"split_type": "weird"}, "Unknown split type."), ({"split_type": ""}, "Unknown split type."), ({"split_type": None}, "Unknown split type."),
    ({"days_per_week": "x"}, "days_per_week must be a number."), ({"days_per_week": None}, "days_per_week must be a number."),
    ({"days_per_week": True}, "days_per_week must be a number."), ({"days_per_week": [3]}, "days_per_week must be a number."),
    ({"days_per_week": 0}, "days_per_week must be between 1 and 7."), ({"days_per_week": 8}, "days_per_week must be between 1 and 7."),
    ({"days_per_week": -2}, "days_per_week must be between 1 and 7."),
    ({"custom_days": "Push"}, "Invalid custom days."), ({"custom_days": [1, 2]}, "Invalid custom days."),
    ({"custom_days": ["d"] * 15}, "Invalid custom days."),
])
def test_a_bad_split_request_is_a_400_that_costs_nothing(settings, db, storage, fake, me, fields, message):
    r = split_post(app_with(settings, db, storage, fake), me, **fields)
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": message}
    assert fake.count("build_split") == 0 and limit_count(db, me.id, "split_generation") == 0


@pytest.mark.parametrize("days,expected", [(1, 1), (7, 7), ("3", 3), (2.9, 2)])
def test_days_per_week_accepts_a_number_in_range_in_any_ordinary_form(settings, db, storage, fake, me, days, expected):
    assert split_post(app_with(settings, db, storage, fake), me, days_per_week=days).status_code == 200
    assert fake.calls["build_split"][0][0][1] == expected


def test_one_plan_a_day_and_the_second_is_a_429_with_the_wait(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    assert split_post(c, me).status_code == 200
    r = split_post(c, me)
    assert r.status_code == 429
    assert r.get_json()["error"] == "You've built 1 plans today. Please check back in about 24 hours."
    assert r.get_json()["limited"] is True and 86000 <= r.get_json()["retry_after_seconds"] <= 86400
    assert 86000 <= int(r.headers["Retry-After"]) <= 86400 and fake.count("build_split") == 1


def test_the_limit_covers_every_split_type_ai_or_not(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    assert split_post(c, me, split_type="ai_suggest").status_code == 200
    assert split_post(c, me, split_type="ppl").status_code == 429


def test_the_owner_is_never_limited_on_splits(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake, exempt=[me.email])
    assert all(split_post(c, me).status_code == 200 for _ in range(3)) and limit_count(db, me.id, "split_generation") == 0


def test_a_crash_while_building_a_plan_refunds_the_one_a_day(settings, db, storage, fake, me):
    fake.raises["build_split"] = RuntimeError("secret detail")
    c = app_with(settings, db, storage, fake)
    r = split_post(c, me)
    assert r.status_code == 500 and "secret" not in r.get_data(as_text=True) and limit_count(db, me.id, "split_generation") == 0
    del fake.raises["build_split"]
    assert split_post(c, me).status_code == 200


def test_building_a_plan_needs_a_profile(settings, db, storage, fake, person):
    assert split_post(app_with(settings, db, storage, fake), person).status_code == 404 and fake.count("build_split") == 0


# -- the weekly check-in -------------------------------------------------------------------------------------------

def checkin_payload(**changes):
    payload = dict(PROFILE, current_targets=TARGETS, week_weight_entries=WEIGHTS, week_calorie_days=CALORIES)
    payload.update(changes)
    return payload


def expected_baseline():
    return weekly_adjustment(coaching.validate_profile(PROFILE)[0], TARGETS, WEIGHTS, CALORIES)


def post_photo(storage, db, uid, name, color=(10, 10, 10), fmt="JPEG"):
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color).save(buf, format=fmt)
    data = buf.getvalue()
    storage.upload("progress-photos", f"{uid}/{name}", data, "image/jpeg" if fmt == "JPEG" else "image/png")
    with db.connection() as conn:
        pid = conn.execute("insert into public.progress_photos (user_id, date, angle, filename) values (%s, current_date, 'front', %s) returning id",
                           (uid, name)).fetchone()["id"]
    return pid, data


def test_the_baseline_is_a_real_adjustment_in_the_fixture():
    assert expected_baseline() is not None and expected_baseline()["delta"] != 0


def test_without_consent_the_deterministic_adjustment_stands_and_the_model_is_never_asked(settings, db, storage, fake, client, person):
    client.post("/api/profile", headers=bearer(person), json={"name": "No Consent"})
    r = app_with(settings, db, storage, fake).post("/api/coaching/weekly-adjustment", headers=bearer(person), json=checkin_payload())
    assert r.status_code == 200 and r.get_json() == {"ok": True, "adjustment": expected_baseline()}
    assert fake.count("checkin") == 0 and limit_count(db, person.id, "checkin_analysis") == 0


def test_with_consent_the_model_refines_the_adjustment_through_the_same_safety_maths(settings, db, storage, fake, me):
    r = app_with(settings, db, storage, fake).post("/api/coaching/weekly-adjustment", headers=bearer(me), json=checkin_payload())
    expected = apply_calorie_delta(coaching.validate_profile(PROFILE)[0], TARGETS, -120, "Trend is flat; trimming.")
    assert r.get_json() == {"ok": True, "adjustment": expected}
    (args, _), = fake.calls["checkin"]
    assert args[2] == WEIGHTS and args[3] == CALORIES and args[4] == expected_baseline() and args[5] == []
    assert limit_count(db, me.id, "checkin_analysis") == 1 and usage(db, me.id, "feature:checkin_ai_analysis") == 1


def test_a_model_failure_quietly_falls_back_to_the_deterministic_number_and_costs_nothing(settings, db, storage, fake, me):
    fake.raises["checkin"] = RuntimeError("model fell over")
    r = app_with(settings, db, storage, fake).post("/api/coaching/weekly-adjustment", headers=bearer(me), json=checkin_payload())
    assert r.status_code == 200 and r.get_json() == {"ok": True, "adjustment": expected_baseline()}
    assert limit_count(db, me.id, "checkin_analysis") == 0 and usage(db, me.id, "feature:checkin_ai_analysis") == 0


def test_past_five_a_day_the_check_in_still_completes_without_the_model(settings, db, storage, fake, me):
    set_count(db, me.id, "checkin_analysis", 5, ago=60)
    r = app_with(settings, db, storage, fake).post("/api/coaching/weekly-adjustment", headers=bearer(me), json=checkin_payload())
    assert r.status_code == 200 and r.get_json()["adjustment"] == expected_baseline() and fake.count("checkin") == 0


def test_the_owner_is_never_limited_on_check_ins(settings, db, storage, fake, me):
    set_count(db, me.id, "checkin_analysis", 5, ago=60)
    app_with(settings, db, storage, fake, exempt=[me.email]).post("/api/coaching/weekly-adjustment", headers=bearer(me), json=checkin_payload())
    assert fake.count("checkin") == 1


def test_only_the_callers_own_photos_reach_the_model_taking_the_first_two_ids_as_the_website_does(settings, db, storage, client, fake, me):
    other = Person("photographer")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Photographer"})
        first, first_bytes = post_photo(storage, db, me.id, "a.jpg", (200, 0, 0))
        second, second_bytes = post_photo(storage, db, me.id, "b.png", (0, 200, 0), fmt="PNG")
        third, _ = post_photo(storage, db, me.id, "c.jpg", (0, 0, 200))
        theirs, _ = post_photo(storage, db, other.id, "theirs.jpg", (1, 2, 3))
        c = app_with(settings, db, storage, fake)

        def files_for(ids):
            c.post("/api/coaching/weekly-adjustment", headers=bearer(me), json=checkin_payload(photo_ids=ids))
            return fake.calls["checkin"][-1][0][5]
        assert files_for([second, first, third]) == [(second_bytes, "image/png"), (first_bytes, "image/jpeg")], "two at most, in order"
        assert files_for([second, theirs, first]) == [(second_bytes, "image/png")], "someone else's photo is skipped, never sent"
        assert files_for(["junk", first, second]) == [(first_bytes, "image/jpeg")], "the first two ids are taken, then the unusable skipped"
        assert files_for([theirs, theirs]) == [] and files_for([None, True, {}, []]) == [] and files_for("x") == [] and files_for(None) == []
    finally:
        forget(other)


def test_a_photo_that_is_gone_from_storage_is_skipped_not_fatal(settings, db, storage, fake, me):
    pid, _ = post_photo(storage, db, me.id, "gone.jpg")
    storage.remove("progress-photos", [f"{me.id}/gone.jpg"])
    r = app_with(settings, db, storage, fake).post("/api/coaching/weekly-adjustment", headers=bearer(me), json=checkin_payload(photo_ids=[pid]))
    assert r.status_code == 200 and fake.calls["checkin"][0][0][5] == []


class DownStorage:
    def download(self, *a, **k):
        raise SupabaseError("storage down")


def test_storage_being_down_costs_the_check_in_only_its_photos(settings, db, fake, me, storage):
    pid, _ = post_photo(storage, db, me.id, "x.jpg")
    r = app_with(settings, db, DownStorage(), fake).post("/api/coaching/weekly-adjustment", headers=bearer(me), json=checkin_payload(photo_ids=[pid]))
    assert r.status_code == 200 and fake.calls["checkin"][0][0][5] == []


def test_a_check_in_does_not_need_a_profile_it_just_gets_no_model_help(settings, db, storage, fake, person):
    r = app_with(settings, db, storage, fake).post("/api/coaching/weekly-adjustment", headers=bearer(person), json=checkin_payload(photo_ids=[1]))
    assert r.status_code == 200 and r.get_json()["adjustment"] == expected_baseline() and fake.count("checkin") == 0


@pytest.mark.parametrize("changes,message", [
    ({"aspiration": "x"}, "Please choose a goal: lose, maintain, or gain weight."),
    ({"current_targets": None}, "Missing current_targets."), ({"current_targets": {"protein": 1}}, "Missing current_targets."),
    ({"current_targets": "x"}, "Missing current_targets."),
    ({"week_weight_entries": "x"}, "Invalid check-in data."), ({"week_weight_entries": [1]}, "Invalid check-in data."),
    ({"week_calorie_days": [{}] * 32}, "Invalid check-in data."),
    ({"week_weight_entries": [{"date": "d"}, {"date": "e"}]}, "Invalid check-in data."),                 # the maths needs kg
    ({"week_calorie_days": [{"date": "d", "calories": "lots"}] * 3}, "Invalid check-in data."),
    ({"current_targets": {"calories": "high", "protein": 1}}, "Invalid check-in data."),
])
def test_bad_check_in_data_is_a_400_never_a_crash_and_costs_nothing(settings, db, storage, fake, me, changes, message):
    r = app_with(settings, db, storage, fake).post("/api/coaching/weekly-adjustment", headers=bearer(me), json=checkin_payload(**changes))
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": message}
    assert fake.count("checkin") == 0 and limit_count(db, me.id, "checkin_analysis") == 0


def test_too_little_data_means_no_adjustment_not_an_error(settings, db, storage, fake, me):
    fake.raises["checkin"] = RuntimeError("no model for you")
    r = app_with(settings, db, storage, fake).post("/api/coaching/weekly-adjustment", headers=bearer(me),
                                                   json=checkin_payload(week_weight_entries=[], week_calorie_days=[]))
    assert r.status_code == 200 and r.get_json() == {"ok": True, "adjustment": None}
