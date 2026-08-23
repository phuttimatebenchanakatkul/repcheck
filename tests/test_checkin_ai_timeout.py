"""Guards the check-in submit path against an unbounded Gemini call.

checkin_analyzer.analyze_checkin() called client.models.generate_content()
with no timeout, and static/coaching.js's submitCheckin() awaits that request
with no timeout of its own. A plain text-only check-in was measured at 12.9s,
so a stalled or queued request had nothing stopping it: "Complete check-in"
stayed disabled on "Loading..." indefinitely, no error was shown, and the
user had nothing to retry or act on -- the check-in became impossible to
finish rather than merely slow.

app.py already treats CheckinAnalysisError as "use the deterministic number
instead", so the fix is to make a slow call raise that rather than hang. These
tests pin both halves of that contract: the timeout is actually attached to
the request, and a timing-out AI still lets the check-in COMPLETE with the
deterministic adjustment instead of failing the whole submission.

Regression: ISSUE-001 -- check-in could hang forever on a slow AI call
Found by /qa on 2026-08-05
"""

import json

import pytest

import checkin_analyzer
from checkin_analyzer import CheckinAnalysisError

PROFILE_PAYLOAD = {
    "aspiration": "lose",
    "gender": "male",
    "weight_kg": "77",
    "body_fat_range_id": "m3",
    "activity_level": "lift_and_cardio",
    "protein_preference": "high",
    "diet_preference": "balanced",
    "loss_rate_pct": 1.5,
    "gain_rate_pct": None,
    "current_targets": {"protein": 180, "fat": 60, "carbs": 200, "calories": 2060},
    "week_weight_entries": [
        {"date": "2026-07-30", "kg": 78},
        {"date": "2026-08-05", "kg": 77},
    ],
    "week_calorie_days": [],
    "photo_ids": [],
}


def test_timeout_budget_is_configured():
    """A missing/None budget is the bug itself, so pin that it exists and is sane."""
    budget = checkin_analyzer.CHECKIN_ANALYSIS_TIMEOUT_SECONDS
    assert isinstance(budget, (int, float)) and budget > 0
    # Long enough for a real text+2-photo call (12.9s measured), short enough
    # that a user isn't left staring at a disabled button.
    assert 10 <= budget <= 60


def test_timeout_is_passed_to_the_model_call(monkeypatch):
    """The budget must reach generate_content -- a constant nobody reads is not a fix.

    Only genai.Client is replaced, not the whole google.genai module: the real
    types.HttpOptions has to do the constructing, otherwise this test would
    pass against a fake that accepts anything.
    """
    from google import genai as real_genai

    captured = {}

    class FakeModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            raise RuntimeError("stop here -- we only care about the config")

    class FakeClient:
        def __init__(self, **_):
            self.models = FakeModels()

    monkeypatch.setattr(checkin_analyzer, "CHECKIN_ANALYSIS_TIMEOUT_SECONDS", 30)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(real_genai, "Client", FakeClient)

    with pytest.raises(CheckinAnalysisError):
        checkin_analyzer.analyze_checkin({"aspiration": "lose"}, {"calories": 2000}, [], [], None, [])

    assert captured, "generate_content was never reached -- test is not exercising the call"
    config = captured.get("config")
    assert config is not None, "generate_content called with no config -- no timeout attached"
    http_options = getattr(config, "http_options", None)
    assert http_options is not None, "config carries no http_options -- request is unbounded"
    # google-genai takes milliseconds.
    assert http_options.timeout == 30 * 1000


def test_checkin_completes_when_the_ai_times_out(monkeypatch):
    """The whole point: a timing-out AI must not fail the user's check-in."""
    import app as app_module

    def boom(*_args, **_kwargs):
        raise CheckinAnalysisError("Couldn't analyze this check-in: timed out")

    monkeypatch.setattr(app_module, "analyze_checkin", boom)

    client = app_module.app.test_client()
    res = client.post(
        "/api/coaching/weekly-adjustment",
        data=json.dumps(PROFILE_PAYLOAD),
        content_type="application/json",
    )

    assert res.status_code == 200, f"AI timeout must not fail the request: {res.data[:200]}"
    body = res.get_json()
    assert body["ok"] is True
    # coaching.js only treats ok:false as a failure, so ok:true here is what
    # actually lets the user reach the result screen and finish the check-in.
