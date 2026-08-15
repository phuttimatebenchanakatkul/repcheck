"""Guards the check-in submit path against an explicit-null weekly rate.

_validate_coaching_profile() read the rate with
dict.get("loss_rate_pct", LOSS_RATE_DEFAULT_PCT). That default only applies
when the key is MISSING -- a payload carrying an explicit null returned None,
and float(None) raised, so the whole request 400'd.

That is reachable in normal use, not a theoretical edge. The client stores
whichever rate does not match the user's goal as null (onboarding.js:
`w.aspiration === "lose" ? w.lossRatePct : null`) and coaching.js always
sends BOTH keys on check-in. So a profile that ever held null for the rate
its current goal needs could never complete a check-in: every attempt failed,
and the UI showed a generic "something went wrong", leaving the user pressing
a button that could not succeed with nothing to act on.

These tests assert null is treated exactly like an absent key (fall back to
the default), while genuinely invalid rates are still rejected -- the fix
must not turn the validator into a rubber stamp.
"""

import pytest

from app import _validate_coaching_profile

BASE = {
    "gender": "male",
    "weight_kg": 80,
    "body_fat_range_id": "m3",
    "activity_level": "lift_and_cardio",
    "protein_preference": "high",
    "diet_preference": "balanced",
}


def _validate(**over):
    return _validate_coaching_profile({**BASE, **over})


@pytest.mark.parametrize("aspiration,key", [("lose", "loss_rate_pct"), ("gain", "gain_rate_pct")])
def test_explicit_null_rate_falls_back_to_default(aspiration, key):
    profile, error = _validate(aspiration=aspiration, **{key: None})
    assert error is None, f"explicit null {key} rejected: {error}"
    assert profile[key] is not None, "should have fallen back to the default rate"


@pytest.mark.parametrize("aspiration,key", [("lose", "loss_rate_pct"), ("gain", "gain_rate_pct")])
def test_omitted_rate_still_falls_back_to_default(aspiration, key):
    # The pre-existing behaviour, pinned so the fix can't regress it.
    profile, error = _validate(aspiration=aspiration)
    assert error is None
    assert profile[key] is not None


def test_null_rate_for_the_other_goal_is_ignored():
    # A "lose" user sends gain_rate_pct: null (and vice versa). The rate that
    # doesn't apply to the goal must never be validated at all.
    profile, error = _validate(aspiration="lose", loss_rate_pct=1.5, gain_rate_pct=None)
    assert error is None
    assert profile["loss_rate_pct"] == 1.5
    assert profile["gain_rate_pct"] is None


def test_maintain_needs_neither_rate():
    profile, error = _validate(aspiration="maintain", loss_rate_pct=None, gain_rate_pct=None)
    assert error is None
    assert profile["loss_rate_pct"] is None and profile["gain_rate_pct"] is None


# The fix must not stop rejecting real garbage -- an out-of-range or
# non-numeric rate is a genuine validation failure, not a missing value.
@pytest.mark.parametrize("aspiration,key,bad", [
    ("lose", "loss_rate_pct", 9),        # above LOSS_RATE_MAX_PCT
    ("lose", "loss_rate_pct", 0.01),     # below LOSS_RATE_MIN_PCT
    ("lose", "loss_rate_pct", "abc"),    # non-numeric
    ("gain", "gain_rate_pct", 5),        # above GAIN_RATE_MAX_PCT
    ("gain", "gain_rate_pct", "abc"),
])
def test_invalid_rate_is_still_rejected(aspiration, key, bad):
    profile, error = _validate(aspiration=aspiration, **{key: bad})
    assert profile is None and error, f"{key}={bad!r} should have been rejected"
