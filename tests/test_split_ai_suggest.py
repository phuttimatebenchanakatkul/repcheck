"""Covers the split wizard's "Let AI build it" path, where the user never
picks a split type and the AI chooses one for them.

The user answers two questions (how many days they can train, and what
they're going for in their own words); everything else comes from the
coaching profile they may or may not have filled in elsewhere. The AI is
told to treat them as a complete beginner. Because that whole path degrades
to a deterministic fallback on ANY failure, the tests that matter here are
the ones that prove a degraded result is still a good plan, and that we
don't degrade unnecessarily.

Three real bugs found while building this, all pinned below:
  - The AI, told "never fewer than 4", returned exactly 4 every time. After
    _validate_plan dropped names that weren't in the library verbatim (or
    weren't doable at the user's training location), days fell under 4 and
    the ENTIRE AI plan was discarded -- one bad exercise name silently cost
    the user the AI suggestion this path exists to provide.
  - The deterministic fallback had the mirror-image problem from the other
    direction: DAY_TYPE_POOLS["Push"] has 7 entries but only 2 are doable at
    home, so a home-training beginner got a 2-exercise "Push" day.
  - The exercise count per day was a FLAT 4-6 window regardless of weekly
    frequency, which shipped 6-exercise sessions 6 days a week -- more than
    30 exercises across the week, not a program a raw beginner keeps up for
    more than a few days (caught by the user testing this in production).
    Per-day count now scales down as frequency rises (see
    _beginner_exercise_range): 5-6 at 1-2 days/week down to 3-4 at 6-7.
Both of the first two are handled by topping the day up from the same day
type's exercises instead of rejecting the plan.
"""

import json

import pytest

import split_planner as sp
from split_planner import (
    BEGINNER_MAX_EXERCISES,
    BEGINNER_MIN_EXERCISES,
    BEGINNER_SPLIT_BY_DAYS,
    SUGGESTIBLE_SPLIT_TYPES,
    suggest_split_plan,
)
from split_planner import _beginner_exercise_range

ALL_LOCATIONS = ["home", "gym", "hybrid", None]


def _fake_gemini(monkeypatch, payload):
    """Point the suggest path at a canned Gemini response. Only genai.Client
    is replaced, so the real request-building code still runs."""
    from google import genai as real_genai

    class FakeModels:
        def generate_content(self, **kwargs):
            captured["prompt"] = kwargs["contents"][0]
            captured["model"] = kwargs.get("model")
            captured["config"] = kwargs.get("config")

            class Response:
                text = json.dumps(payload) if not isinstance(payload, str) else payload

            return Response()

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    captured = {}
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)
    return captured


def _plan_payload(days, split_type="ppl"):
    schedule = {d: "Rest" for d in sp.WEEKDAY_ORDER}
    for i, day in enumerate(days):
        schedule[sp.WEEKDAY_ORDER[i]] = day["label"]
    return {
        "split_type": split_type,
        "days": days,
        "schedule": schedule,
        "rationale": "Because you are just starting out.",
    }


# ---------- the frequency-scaled exercise-count contract, on every path ----------

def test_exercise_range_shrinks_as_weekly_frequency_rises():
    """The table itself: session length must never increase, and must
    strictly decrease at least once, as days_per_week goes up -- this is
    the actual fix for "6 exercises x 6 days is not realistic for a
    beginner". A flat range for every frequency is exactly the regression
    this guards against."""
    ranges = [_beginner_exercise_range(d) for d in range(1, 8)]
    maxes = [mx for _, mx in ranges]
    assert maxes == sorted(maxes, reverse=True), f"max exercises/day rose with frequency: {maxes}"
    assert len(set(ranges)) > 1, "every frequency got the identical window"
    # The two ends of the spectrum this bug report was actually about.
    assert _beginner_exercise_range(1)[1] >= 5, "a once-a-week full-body session shouldn't be this short"
    assert _beginner_exercise_range(6)[1] <= 4, "6 days/week must not still be a 5-6 exercise session"
    assert _beginner_exercise_range(7)[1] <= 4


@pytest.mark.parametrize("days_per_week", [1, 2, 3, 4, 5, 6, 7])
def test_weekly_exercise_total_stays_bounded_as_frequency_rises(days_per_week):
    """The actual complaint, checked directly: total exercises across the
    week (days x max-per-day) must not run away as days_per_week grows.
    With the old flat 4-6 window, 6 days/week -> 36; that's the number that
    prompted this fix."""
    _, max_exercises = _beginner_exercise_range(days_per_week)
    weekly_total = days_per_week * max_exercises
    assert weekly_total <= 28, f"{days_per_week}d/week x {max_exercises}/day = {weekly_total} total, too high"


@pytest.mark.parametrize("days_per_week", [1, 2, 3, 4, 5, 6, 7])
@pytest.mark.parametrize("location", ALL_LOCATIONS)
def test_fallback_lands_in_the_frequency_scaled_window(monkeypatch, days_per_week, location):
    """No API key means every user takes the deterministic path, so it has to
    satisfy the per-frequency contract on its own -- this is the case that
    shipped a 2-exercise "Push" day at home, and (separately) the case that
    shipped a flat 6-exercise day at every frequency including 6-7 days/week."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    min_expected, max_expected = _beginner_exercise_range(days_per_week)

    plan = suggest_split_plan(days_per_week, goal="build muscle", location=location)

    assert len(plan["days"]) == days_per_week
    assert plan["split_type"] == BEGINNER_SPLIT_BY_DAYS[days_per_week]
    for day in plan["days"]:
        assert min_expected <= len(day["exercises"]) <= max_expected, (
            f"{location} / {days_per_week}d: {day['label']} has {len(day['exercises'])}, "
            f"expected {min_expected}-{max_expected}"
        )
        # A topped-up day still has to be a real, doable session.
        assert len(set(day["exercises"])) == len(day["exercises"]), "duplicate exercise"
        for name in day["exercises"]:
            assert name in sp.VALID_EXERCISES


def test_ai_day_that_filters_below_the_minimum_is_topped_up_not_discarded():
    """The regression that cost users the AI plan outright: the AI returns 4
    exercises, two aren't real library names, and the day lands at 2. The
    plan must survive with that day topped back up to the minimum, not be
    thrown away. Uses an explicit 4-6 window (not _beginner_exercise_range)
    -- this test is about the top-up mechanism itself, independent of which
    frequency picked that window."""
    days = [
        {"label": "Push", "exercises": ["Flat Bench Press", "Shoulder Press", "Bench Pressing", "Chest Machine Thing"]},
        {"label": "Pull", "exercises": ["Pull-Up", "Bicep Curl", "Seated Cable Row", "Lat Pulldown"]},
    ]
    plan = sp._validate_plan(
        _plan_payload(days), 2, None, "gym",
        min_exercises=4,
        max_exercises=6,
        top_up_short_days=True,
    )

    push = plan["days"][0]
    assert len(push["exercises"]) >= 4
    # The two real names the AI picked are kept; only the junk is replaced.
    assert push["exercises"][:2] == ["Flat Bench Press", "Shoulder Press"]
    assert "Bench Pressing" not in push["exercises"]
    for name in push["exercises"]:
        assert name in sp.VALID_EXERCISES


def test_top_up_stays_on_topic_for_the_day():
    """Backfilling a Legs day with chest work would be worse than the short
    day it replaced, so the filler comes from that day type's own pool."""
    topped = sp._top_up_exercises(["Squat"], "Legs", "gym", 4, 6)

    assert len(topped) == 4
    assert topped[0] == "Squat"
    legs_pool = set(sp.DAY_TYPE_POOLS["Legs"]) | set(sp.DAY_TYPE_WIDE_POOLS["Legs"])
    for name in topped[1:]:
        assert name in legs_pool, f"{name} is not a Legs exercise"


def test_max_exercises_is_enforced_against_an_overlong_ai_day():
    days = [{"label": "Full Body", "exercises": sp.DAY_TYPE_POOLS["Full Body"] + sp.LEGS_BALANCED}]
    plan = sp._validate_plan(
        _plan_payload(days, "full_body"), 1, None, None,
        min_exercises=4,
        max_exercises=6,
        top_up_short_days=True,
    )
    assert len(plan["days"][0]["exercises"]) == 6


def test_type_picked_path_keeps_its_original_exercise_window(monkeypatch):
    """The beginner suggest path's window (5-6 exercises even at its
    roomiest, 1-2 days/week) belongs to that path alone. The pre-existing
    "I already know I want PPL" path must keep its roomier 6-8 sessions."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    plan = sp.generate_split_plan("ppl", 3, location="gym")
    assert any(len(d["exercises"]) > BEGINNER_MAX_EXERCISES for d in plan["days"]), (
        "type-picked path was narrowed to the beginner window"
    )


# ---------- trusting the model only as far as it's earned ----------

def test_hallucinated_split_type_falls_back_to_the_beginner_default(monkeypatch):
    days = [{"label": "Full Body", "exercises": ["Squat", "Flat Bench Press", "Pull-Up", "Plank"]}] * 3
    _fake_gemini(monkeypatch, _plan_payload(days, split_type="german_volume_nonsense"))

    plan = suggest_split_plan(3, location="gym")

    assert plan["split_type"] == BEGINNER_SPLIT_BY_DAYS[3]
    assert plan["split_type"] in SUGGESTIBLE_SPLIT_TYPES


def test_unparseable_response_falls_back_instead_of_raising(monkeypatch):
    """Gemini intermittently emitted a stray closing brace after the days
    array, which is what motivated attaching a response schema. A user must
    still get a plan when something slips through anyway."""
    _fake_gemini(monkeypatch, '{"split_type": "ppl", "days": [}]}, "schedule": {}}')

    plan = suggest_split_plan(4, location="home")

    assert plan["split_type"] == BEGINNER_SPLIT_BY_DAYS[4]
    assert len(plan["days"]) == 4


def test_response_schema_is_attached_to_the_request(monkeypatch):
    """The schema is the fix for that malformed JSON -- a constant nobody
    passes to the API is not a fix."""
    days = [{"label": "Full Body", "exercises": ["Squat", "Flat Bench Press", "Pull-Up", "Plank"]}]
    captured = _fake_gemini(monkeypatch, _plan_payload(days, "full_body"))

    suggest_split_plan(1, location="gym")

    config = captured["config"]
    assert config is not None, "generate_content called with no config"
    assert config.response_mime_type == "application/json"
    assert config.response_schema is not None
    assert captured["model"] == sp.SUGGEST_GEMINI_MODEL


# ---------- what actually reaches the prompt ----------

def test_prompt_carries_the_beginner_framing_and_profile(monkeypatch):
    days = [{"label": "Full Body", "exercises": ["Squat", "Flat Bench Press", "Pull-Up", "Plank"]}] * 3
    captured = _fake_gemini(monkeypatch, _plan_payload(days, "full_body"))

    suggest_split_plan(
        3, goal="I want to build muscle", gender="female",
        goal_weight_kg=60, current_weight_kg=68, location="home",
    )

    prompt = captured["prompt"]
    assert "COMPLETE BEGINNER" in prompt
    assert "female" in prompt
    assert "60" in prompt and "68" in prompt
    assert "I want to build muscle" in prompt
    assert "3 day(s) per week" in prompt
    # The AI is asked to choose the split, not handed one.
    for split_type in SUGGESTIBLE_SPLIT_TYPES:
        assert split_type in prompt


def test_prompt_survives_a_user_with_no_coaching_profile(monkeypatch):
    """The split wizard never asks for gender or weight, so reaching this
    path with none of it is normal, not an error."""
    days = [{"label": "Full Body", "exercises": ["Squat", "Flat Bench Press", "Pull-Up", "Plank"]}] * 2
    captured = _fake_gemini(monkeypatch, _plan_payload(days, "full_body"))

    plan = suggest_split_plan(2, location="gym")

    assert "About this person:" not in captured["prompt"]
    assert len(plan["days"]) == 2


def test_prompt_asks_for_fewer_exercises_at_higher_frequency():
    """The prompt text itself has to change with frequency, not just the
    post-hoc validator -- otherwise the model is never actually told to
    build a shorter session, and only gets capped after the fact."""
    low = sp._build_suggest_prompt(1, None, None, None, None, None)
    high = sp._build_suggest_prompt(7, None, None, None, None, None)

    low_min, low_max = _beginner_exercise_range(1)
    high_min, high_max = _beginner_exercise_range(7)
    assert low_max > high_max
    assert f"exactly {low_max} exercises" in low
    assert f"exactly {high_max} exercises" in high
    assert f"never fewer than {low_min}" in low
    assert f"never fewer than {high_min}" in high


def test_weight_direction_is_spelled_out_for_the_model():
    losing = sp._describe_lifter("male", goal_weight_kg=75, current_weight_kg=85)
    gaining = sp._describe_lifter("male", goal_weight_kg=85, current_weight_kg=75)
    holding = sp._describe_lifter("male", goal_weight_kg=80, current_weight_kg=80)

    assert "LOSE about 10.0 kg" in losing
    assert "GAIN about 10.0 kg" in gaining
    assert "MAINTAIN" in holding


# ---------- the HTTP surface ----------

def test_endpoint_returns_the_chosen_split_type(monkeypatch):
    import app as app_module

    days = [{"label": "Full Body", "exercises": ["Squat", "Flat Bench Press", "Pull-Up", "Plank"]}] * 3
    _fake_gemini(monkeypatch, _plan_payload(days, "full_body"))

    client = app_module.app.test_client()
    res = client.post("/api/generate-split", data=json.dumps({
        "split_type": "ai_suggest", "days_per_week": 3, "location": "gym",
        "goal": "build muscle", "gender": "male",
        "goal_weight_kg": 75, "current_weight_kg": 85,
    }), content_type="application/json")

    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    # The UI needs this to tell the user which split they got, and to save
    # the plan as a real split type rather than the "ai_suggest" sentinel.
    assert body["split_type"] == "full_body"
    assert len(body["days"]) == 3


@pytest.mark.parametrize("bad_profile", [
    {"gender": "attack helicopter", "goal_weight_kg": "abc", "current_weight_kg": -5},
    {"gender": None, "goal_weight_kg": 99999, "current_weight_kg": 0},
    {},
])
def test_endpoint_tolerates_a_junk_or_absent_profile(monkeypatch, bad_profile):
    """These fields are read out of localStorage, so they are whatever is
    actually sitting in the browser -- a bad one should cost the prompt a
    detail, not cost the user their plan."""
    import app as app_module

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = app_module.app.test_client()
    res = client.post("/api/generate-split", data=json.dumps({
        "split_type": "ai_suggest", "days_per_week": 3, "location": "gym", **bad_profile,
    }), content_type="application/json")

    assert res.status_code == 200
    assert res.get_json()["ok"] is True


def test_endpoint_still_rejects_an_out_of_range_day_count():
    import app as app_module

    client = app_module.app.test_client()
    for days in (0, 8, "many"):
        res = client.post("/api/generate-split", data=json.dumps({
            "split_type": "ai_suggest", "days_per_week": days,
        }), content_type="application/json")
        assert res.status_code == 400


def test_every_supported_day_count_has_a_beginner_default():
    assert set(BEGINNER_SPLIT_BY_DAYS) == {1, 2, 3, 4, 5, 6, 7}
    for split_type in BEGINNER_SPLIT_BY_DAYS.values():
        assert split_type in SUGGESTIBLE_SPLIT_TYPES
