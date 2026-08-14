"""Guards coaching_engine.calculate_targets()'s rate-to-calorie interpolation
at the exact boundary values recalibrated by the weight-loss-rate-slider-
redesign branch (LOSS_RATE_MIN_PCT 1.0 -> 0.1, LOSS_RATE_DEFAULT_PCT
1.5 -> ~0.267, GAIN_RATE_MAX_PCT 0.5 -> 0.8).

This math was manually verified once, end-to-end, during that branch's QA
pass (see .gstack/qa-reports/qa-report-localhost-2026-08-14.md -- at
rate=0.10%, TDEE=2963, the generated target was 2607 kcal, a precise 12%
deficit matching LOSS_RATE_DEFICIT_FRACTION_MIN at rate_t=0). But before this
file, no test anywhere in tests/ imported coaching_engine.calculate_targets
at all -- the only existing coverage of these constants
(test_coaching_rate_null.py) exercises app.py's _validate_coaching_profile()
request-validation wrapper, not the calorie-math interpolation itself. A
future change to these constants, or a bug in the rate_t interpolation, had
nothing automated to catch it.

These tests pin the interpolation formula itself (deficit/surplus fraction
at the MIN/MAX endpoints, and the omitted-rate default), not just the
current constant values, so they keep passing across future recalibrations
as long as the endpoint behavior stays correct.
"""

import pytest

import coaching_engine as ce

BASE_PROFILE = {
    "weight_kg": 80,
    "gender": "male",
    "body_fat_range_id": "m3",  # 15-20% -> midpoint 17.5%
    "activity_level": "lift_and_cardio",
    "protein_preference": "moderate",
    "diet_preference": "balanced",
}


def _tdee(profile):
    """Recomputes the exact (unrounded) TDEE calculate_targets() uses
    internally from the same building blocks it uses, so expectations are
    derived from the formula rather than a hand-copied magic number that
    could silently drift from the real implementation."""
    body_fat_pct = ce._range_midpoint(profile["gender"], profile["body_fat_range_id"])
    lean_mass_kg = profile["weight_kg"] * (1 - body_fat_pct / 100)
    bmr = 370 + 21.6 * lean_mass_kg
    return bmr * ce.ACTIVITY_MULTIPLIERS[profile["activity_level"]]


def test_loss_rate_at_min_uses_min_deficit_fraction():
    profile = {**BASE_PROFILE, "aspiration": "lose", "loss_rate_pct": ce.LOSS_RATE_MIN_PCT}
    result = ce.calculate_targets(profile)
    tdee = _tdee(profile)
    expected = max(ce.min_calories_for("male"), round(tdee * (1 - ce.LOSS_RATE_DEFICIT_FRACTION_MIN)))
    assert result["calories"] == expected


def test_loss_rate_at_max_uses_max_deficit_fraction():
    profile = {**BASE_PROFILE, "aspiration": "lose", "loss_rate_pct": ce.LOSS_RATE_MAX_PCT}
    result = ce.calculate_targets(profile)
    tdee = _tdee(profile)
    expected = max(ce.min_calories_for("male"), round(tdee * (1 - ce.LOSS_RATE_DEFICIT_FRACTION_MAX)))
    assert result["calories"] == expected


def test_loss_rate_omitted_falls_back_to_recalibrated_default():
    # loss_rate_pct absent entirely -- calculate_targets must use
    # LOSS_RATE_DEFAULT_PCT (now ~0.267%, derived from the 0.2 kg/week
    # standard-zone floor at the 75kg reference weight), not the old 1.5%.
    with_default = {**BASE_PROFILE, "aspiration": "lose"}
    explicit = {**BASE_PROFILE, "aspiration": "lose", "loss_rate_pct": ce.LOSS_RATE_DEFAULT_PCT}
    assert ce.calculate_targets(with_default) == ce.calculate_targets(explicit)


def test_loss_rate_below_min_is_clamped_not_negative_or_erroring():
    # calculate_targets() clamps independently of app.py's own request
    # validation (defense in depth) -- a value under LOSS_RATE_MIN_PCT must
    # not push the deficit fraction below LOSS_RATE_DEFICIT_FRACTION_MIN.
    profile = {**BASE_PROFILE, "aspiration": "lose", "loss_rate_pct": -5}
    at_min = {**BASE_PROFILE, "aspiration": "lose", "loss_rate_pct": ce.LOSS_RATE_MIN_PCT}
    assert ce.calculate_targets(profile) == ce.calculate_targets(at_min)


def test_gain_rate_at_min_uses_min_surplus_fraction():
    profile = {**BASE_PROFILE, "aspiration": "gain", "gain_rate_pct": ce.GAIN_RATE_MIN_PCT}
    result = ce.calculate_targets(profile)
    tdee = _tdee(profile)
    expected = max(ce.min_calories_for("male"), round(tdee * (1 + ce.GAIN_RATE_SURPLUS_FRACTION_MIN)))
    assert result["calories"] == expected


def test_gain_rate_at_new_ceiling_uses_max_surplus_fraction():
    # GAIN_RATE_MAX_PCT was raised from 0.5 to 0.8 (the 0.6 kg/week ceiling
    # at the 75kg reference weight) -- pin the new ceiling's behavior.
    assert ce.GAIN_RATE_MAX_PCT == pytest.approx(0.8)
    profile = {**BASE_PROFILE, "aspiration": "gain", "gain_rate_pct": ce.GAIN_RATE_MAX_PCT}
    result = ce.calculate_targets(profile)
    tdee = _tdee(profile)
    expected = max(ce.min_calories_for("male"), round(tdee * (1 + ce.GAIN_RATE_SURPLUS_FRACTION_MAX)))
    assert result["calories"] == expected


def test_gain_rate_above_new_ceiling_is_clamped():
    profile = {**BASE_PROFILE, "aspiration": "gain", "gain_rate_pct": 99}
    at_max = {**BASE_PROFILE, "aspiration": "gain", "gain_rate_pct": ce.GAIN_RATE_MAX_PCT}
    assert ce.calculate_targets(profile) == ce.calculate_targets(at_max)
