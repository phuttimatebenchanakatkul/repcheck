"""Check-in's high-carb/bloating context flags reach the AI's prompt.

Weekly check-in only asks for a single weight input plus optional
progress photos -- nothing distinguishes "gained 0.6kg from a real
calorie surplus" from "gained 0.6kg overnight from a high-carb day or
bloating" (both look identical on the scale). static/coaching.js now
lets the user flag specific days from the week as high-carb and/or
bloated; these reach /api/coaching/weekly-adjustment as high_carb_days/
bloating_days and get folded into checkin_analyzer.py's Gemini prompt
so the model can read an outlier weigh-in as likely water weight rather
than real gain. The deterministic baseline (coaching_engine.weekly_adjustment)
deliberately never sees these -- it stays the untouched safety anchor/
fallback described in checkin_analyzer.py's module docstring.

These tests pin: the prompt-building helper actually includes flagged
dates when present and omits the line entirely when absent, the flags
survive the analyze_checkin() call boundary into the real prompt text,
and the server route filters non-string entries before they reach a
str.join() call that would otherwise TypeError.
"""

import json

import pytest

import checkin_analyzer
from checkin_analyzer import CheckinAnalysisError, _build_context_flags_line, _build_prompt

PROFILE = {"aspiration": "lose", "gender": "female", "weightKg": "68"}

PAYLOAD_BASE = {
    "aspiration": "lose",
    "gender": "female",
    "weight_kg": "68",
    "body_fat_range_id": "f3",
    "activity_level": "lift_and_cardio",
    "protein_preference": "high",
    "diet_preference": "balanced",
    "loss_rate_pct": 1.5,
    "gain_rate_pct": None,
    "current_targets": {"protein": 140, "fat": 55, "carbs": 160, "calories": 1830},
    "week_weight_entries": [
        {"date": "2026-08-08", "kg": 68.0},
        {"date": "2026-08-13", "kg": 68.6},
    ],
    "week_calorie_days": [],
    "photo_ids": [],
}


def test_context_flags_line_empty_when_nothing_flagged():
    assert _build_context_flags_line([], []) == ""
    assert _build_context_flags_line(None, None) == ""


def test_context_flags_line_mentions_flagged_dates():
    line = _build_context_flags_line(["2026-08-13"], [])
    assert "2026-08-13" in line
    assert "carb" in line.lower()
    assert "water retention" in line.lower()


def test_context_flags_line_covers_both_signals_together():
    line = _build_context_flags_line(["2026-08-12"], ["2026-08-13"])
    assert "2026-08-12" in line
    assert "2026-08-13" in line
    assert "carb" in line.lower()
    assert "bloat" in line.lower()


def test_prompt_omits_context_section_when_nothing_flagged():
    prompt = _build_prompt(PROFILE, PAYLOAD_BASE["week_weight_entries"], [], None, False, False)
    assert "flagged this about their own week" not in prompt


def test_prompt_includes_flagged_dates_when_present():
    """The actual regression this guards: a real weigh-in spike on a
    flagged date must be visible to the model as flagged, not silently
    dropped between coaching.js's payload and the text Gemini sees."""
    prompt = _build_prompt(
        PROFILE,
        PAYLOAD_BASE["week_weight_entries"],
        [],
        None,
        False,
        False,
        high_carb_days=["2026-08-13"],
        bloating_days=[],
    )
    assert "2026-08-13" in prompt
    assert "flagged this about their own week" in prompt
    # The date also appears in the raw weigh-in list -- confirm the flag
    # line and the weigh-in line both survive in the same prompt, so the
    # model can actually correlate the two.
    assert "68.6 kg" in prompt


def test_analyze_checkin_forwards_flags_into_the_real_prompt(monkeypatch):
    """Guards the analyze_checkin() call boundary itself: a caller passing
    high_carb_days/bloating_days must have them actually reach
    generate_content's prompt text, not get dropped by a missed
    positional-arg wire-up."""
    from google import genai as real_genai

    captured = {}

    class FakeModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            raise RuntimeError("stop here -- we only care about the prompt text")

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)

    with pytest.raises(CheckinAnalysisError):
        checkin_analyzer.analyze_checkin(
            PROFILE,
            PAYLOAD_BASE["week_weight_entries"],
            [],
            None,
            [],
            high_carb_days=["2026-08-13"],
            bloating_days=["2026-08-12"],
        )

    assert captured, "generate_content was never reached"
    contents = captured.get("contents")
    assert contents, "no prompt content sent to the model"
    prompt_text = contents[0]
    assert "2026-08-13" in prompt_text
    assert "2026-08-12" in prompt_text


def test_weekly_adjustment_route_forwards_flags(monkeypatch):
    """End-to-end through the Flask route: the payload's high_carb_days/
    bloating_days must reach analyze_checkin(), not get lost in
    api_coaching_weekly_adjustment()'s own payload parsing."""
    import app as app_module

    captured = {}

    def fake_analyze_checkin(profile, week_weight_entries, week_calorie_days, baseline, photo_files, high_carb_days=None, bloating_days=None):
        captured["high_carb_days"] = high_carb_days
        captured["bloating_days"] = bloating_days
        raise CheckinAnalysisError("stop here -- we only care about what was forwarded")

    monkeypatch.setattr(app_module, "analyze_checkin", fake_analyze_checkin)

    payload = dict(PAYLOAD_BASE)
    payload["high_carb_days"] = ["2026-08-13"]
    payload["bloating_days"] = ["2026-08-12", "2026-08-11"]

    client = app_module.app.test_client()
    res = client.post(
        "/api/coaching/weekly-adjustment",
        data=json.dumps(payload),
        content_type="application/json",
    )

    assert res.status_code == 200
    assert res.get_json()["ok"] is True
    assert captured["high_carb_days"] == ["2026-08-13"]
    assert captured["bloating_days"] == ["2026-08-12", "2026-08-11"]


def test_weekly_adjustment_route_filters_non_string_flags(monkeypatch):
    """A malformed/non-string entry in high_carb_days or bloating_days
    must not reach the "".join() call inside _build_context_flags_line()
    -- that would raise TypeError and 500 the whole check-in submission."""
    import app as app_module

    captured = {}

    def fake_analyze_checkin(profile, week_weight_entries, week_calorie_days, baseline, photo_files, high_carb_days=None, bloating_days=None):
        captured["high_carb_days"] = high_carb_days
        raise CheckinAnalysisError("stop here")

    monkeypatch.setattr(app_module, "analyze_checkin", fake_analyze_checkin)

    payload = dict(PAYLOAD_BASE)
    payload["high_carb_days"] = ["2026-08-13", 12345, None, {"not": "a date"}]
    payload["bloating_days"] = []

    client = app_module.app.test_client()
    res = client.post(
        "/api/coaching/weekly-adjustment",
        data=json.dumps(payload),
        content_type="application/json",
    )

    assert res.status_code == 200
    assert res.get_json()["ok"] is True
    assert captured["high_carb_days"] == ["2026-08-13"]
