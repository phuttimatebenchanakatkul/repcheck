"""Guards the two halves of the "my check-in never adjusts my calories" bug.

Reported case: a "lose" user whose target said 1800 kcal/day was eating
~2500 kcal/day and still losing weight steadily, and every weekly check-in
came back "you're on track" with the target unchanged at 1800.

Both layers that can decide a delta were wrong in the same direction:

1. coaching_engine.weekly_adjustment()'s on-track branch moved the target
   AWAY from the intake that was demonstrably working -- eating over target
   produced a CUT -- while telling the user it had "nudged [the target] to
   match reality".
2. checkin_analyzer._build_prompt() never put the current calorie target in
   the prompt at all, so the model only saw what the user ate, had no gap
   to close, and answered delta 0 ("your intake is working, keeping your
   target where it is") -- which app.py turns into no adjustment, and
   static/coaching.js renders as the plain "on track" result screen.

The prompt half is asserted on the built string rather than on a live
model call (same tradeoff as the source-level suites CLAUDE.md describes):
the model's answer isn't deterministic, but whether it is given the target
to reason about is.
"""

import checkin_analyzer
import coaching_engine as ce

PROFILE = {
    "aspiration": "lose",
    "gender": "male",
    "weight_kg": 80,
    "weightKg": 80,
    "body_fat_range_id": "m4",
    "activity_level": "lift_and_cardio",
    "protein_preference": "moderate",
    "diet_preference": "balanced",
    "loss_rate_pct": 0.7,
}
TARGETS = {"calories": 1800, "protein": 180, "fat": 50, "carbs": 145}

# -0.5 kg over the week on 80 kg = -0.62%, inside the "lose" band
# (-1.0% .. -0.3%), so weekly_adjustment() takes its on-track branch.
ON_TRACK_WEIGHTS = [
    {"date": "2026-08-17", "kg": 80.5},
    {"date": "2026-08-23", "kg": 80.0},
]


def _calorie_days(kcal):
    return [{"date": f"2026-08-{d}", "calories": kcal} for d in range(17, 23)]


def test_on_track_but_eating_over_target_raises_the_target():
    result = ce.weekly_adjustment(PROFILE, TARGETS, ON_TRACK_WEIGHTS, _calorie_days(2500))
    assert result is not None
    # 700 kcal over target * 0.3 = 210, capped at the +/-150 weekly limit.
    assert result["delta"] == 150
    assert result["calories"] == 1950


def test_on_track_but_eating_under_target_lowers_the_target():
    """The mirror image -- the delta follows the sign of the gap either
    way, so the target converges on the intake that's actually working
    instead of drifting further from it."""
    result = ce.weekly_adjustment(PROFILE, TARGETS, ON_TRACK_WEIGHTS, _calorie_days(1500))
    assert result is not None
    assert result["delta"] == -90  # 300 * 0.3, under the cap
    assert result["calories"] == 1710


def test_on_track_and_hitting_target_still_changes_nothing():
    """A gap under 100 kcal/day is noise, not a mis-set target."""
    assert ce.weekly_adjustment(PROFILE, TARGETS, ON_TRACK_WEIGHTS, _calorie_days(1850)) is None


def test_prompt_states_the_current_target_and_the_gap():
    prompt = checkin_analyzer._build_prompt(
        PROFILE, TARGETS, ON_TRACK_WEIGHTS, _calorie_days(2500),
        baseline=None, has_front=False, has_back=False,
    )
    assert "1800 kcal" in prompt          # the target itself
    assert "averaged 2500 kcal/day" in prompt
    assert "700 kcal above that target" in prompt


def test_prompt_forbids_a_lazy_zero_when_the_target_is_the_thing_thats_wrong():
    prompt = checkin_analyzer._build_prompt(
        PROFILE, TARGETS, ON_TRACK_WEIGHTS, _calorie_days(2500),
        baseline=None, has_front=False, has_back=False,
    )
    assert "do not return 0 just because the weight trend looks fine" in prompt
    assert "move the target TOWARD what they actually ate" in prompt


def test_prompt_omits_the_target_line_when_nothing_was_logged():
    """No logged days means no measurable gap -- the prompt shouldn't
    invent one (or crash dividing by zero)."""
    prompt = checkin_analyzer._build_prompt(
        PROFILE, TARGETS, ON_TRACK_WEIGHTS, [],
        baseline=None, has_front=False, has_back=False,
    )
    assert "1800 kcal" in prompt
    assert "averaged" not in prompt


def test_checkin_screen_no_longer_references_the_removed_context_section():
    """The "Anything unusual this week?" high-carb/bloating section was
    removed from the check-in. Its markup, its two methods, its i18n keys
    and its CSS all had to go together -- a half-removal leaves the render
    path calling a method that no longer exists, which nothing else here
    would catch (it only blows up when the sheet is opened).
    """
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    for rel in ("static/coaching.js", "static/i18n.js", "static/coaching.css"):
        text = (root / rel).read_text(encoding="utf-8")
        for token in (
            "renderCheckinFlagGrid",
            "toggleCheckinFlag",
            "highCarbDays",
            "bloatedDays",
            "checkin.contextLabel",
            "pc-ck-flag-day",
        ):
            assert token not in text, f"{rel} still references {token}"
