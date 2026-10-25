"""HYROX race analysis and workout-split generation."""

import json

from flask import Blueprint, jsonify

from workout_library import WORKOUT_EXERCISES

from .. import accounts, ai, consent
from ..auth import current_identity, login_required
from ..limits import RATE_LIMITS, friendly_wait
from .account import fail, json_body, services

bp = Blueprint("planning", __name__)

MAX_RACE_SEGMENTS = 40            # a race is 8 runs + 8 stations + transitions
MAX_RACE_CHARS = 20_000
SPLIT_TYPES = {"ppl", "upper_lower", "full_body", "bro_split", "custom", "ai_suggest"}
MAX_CUSTOM_DAYS = 14
MAX_GOAL_CHARS = 300              # app.py cuts the goal to 300 characters


def _profile_and_consent(svc, user_id, *, needed=True):
    """(profile, early response). A missing profile is a 404; missing consent (when it is needed) the usual 403."""
    with svc.db.connection() as conn:
        profile = accounts.get_profile(conn, user_id)
    if not profile:
        return None, fail("No profile yet. Create it first.", 404)
    if needed and not consent.has_consent(profile):
        return None, consent.refusal()
    return profile, None


# -- HYROX race analysis --------------------------------------------------------------------------------------

@bp.post("/api/hyrox/analyze")
@login_required
def hyrox_analyze():
    svc, identity = services(), current_identity()
    user_id = identity.id
    _profile, early = _profile_and_consent(svc, user_id)
    if early:
        return early
    race = json_body().get("race") or {}
    if not isinstance(race, dict):
        return fail("Invalid race.", 400)
    segments = race.get("segments")
    if not isinstance(segments, list) or not segments:
        return fail("Race has no segments to analyze.", 400)
    try:
        too_big = len(segments) > MAX_RACE_SEGMENTS or len(json.dumps(race, default=str)) > MAX_RACE_CHARS
    except (TypeError, ValueError):
        too_big = True
    if too_big:
        return fail("Invalid race.", 400)

    reservation = ai.reserve(svc, identity, "hyrox_analysis")
    if not reservation.allowed:
        # The shape the client already understands (hyrox_coach's own limited branch): a normal message, not an error.
        return jsonify({
            "ok": True,
            "overall": (f"You've analyzed {RATE_LIMITS['hyrox_analysis'][0]} races today. "
                        f"Please check back in {friendly_wait(reservation.retry_after)}."),
            "overall_detail": [], "tips": [], "limited": True, "retry_after_seconds": reservation.retry_after})
    try:
        result = svc.ai.hyrox(race)
    except Exception:
        ai.release(svc, user_id, "hyrox_analysis", reservation)
        raise
    if result.get("failed"):                       # the model was unreachable: the neutral tips are not an analysis
        ai.release(svc, user_id, "hyrox_analysis", reservation)
    else:
        ai.track(svc, user_id, "hyrox_ai_analysis")
    return jsonify({"ok": True, "overall": result["overall"], "overall_detail": result["overall_detail"],
                    "tips": result["tips"], "limited": result["limited"], "retry_after_seconds": result["retry_after_seconds"]})


# -- split generation -----------------------------------------------------------------------------------------

def _optional_positive_float(value):
    """A body weight from the coaching profile, or None. Everything about that profile is optional here, so anything
    missing, non-numeric or implausible counts as 'not provided': a bad weight costs the prompt one detail, not the user
    their plan."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if 20 <= number <= 500 else None


def _custom_days(raw):
    if not raw:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_CUSTOM_DAYS or not all(isinstance(d, str) for d in raw):
        return None
    return [d.strip()[:60] for d in raw if d.strip()]


def _hand_picked_exercises(raw):
    """Exercises the user picked per custom day, kept only if they are in the real library: nothing unvalidated reaches the
    prompt or the fallback plan."""
    if not isinstance(raw, dict):
        return None
    valid = set(WORKOUT_EXERCISES)
    cleaned = {}
    for label, names in raw.items():
        if not isinstance(names, list):
            continue
        picked = [n for n in names if isinstance(n, str) and n in valid]
        if picked:
            cleaned[str(label)[:60]] = picked
    return cleaned


@bp.post("/api/generate-split")
@login_required
def generate_split():
    svc, identity = services(), current_identity()
    user_id = identity.id
    payload = json_body()
    split_type = str(payload.get("split_type", "")).strip()
    goal = str(payload.get("goal") or "").strip()[:MAX_GOAL_CHARS]
    location = str(payload.get("location") or "").strip().lower()

    if split_type not in SPLIT_TYPES:
        return fail("Unknown split type.", 400)
    days = payload.get("days_per_week")
    try:
        days_per_week = int(days) if not isinstance(days, bool) else None
    except (TypeError, ValueError, OverflowError):
        days_per_week = None
    if days_per_week is None:
        return fail("days_per_week must be a number.", 400)
    if not 1 <= days_per_week <= 7:
        return fail("days_per_week must be between 1 and 7.", 400)
    custom_days = _custom_days(payload.get("custom_days"))
    if custom_days is None:
        return fail("Please name at least one custom day." if split_type == "custom" else "Invalid custom days.", 400)
    if split_type == "custom" and not custom_days:
        return fail("Please name at least one custom day.", 400)
    custom_days_exercises = _hand_picked_exercises(payload.get("custom_days_exercises"))

    _profile, early = _profile_and_consent(svc, user_id, needed=(split_type == "ai_suggest"))
    if early:
        return early

    reservation = ai.reserve(svc, identity, "split_generation")
    if not reservation.allowed:
        response = jsonify({
            "ok": False,
            "error": (f"You've built {RATE_LIMITS['split_generation'][0]} plans today. "
                      f"Please check back in {friendly_wait(reservation.retry_after)}."),
            "limited": True, "retry_after_seconds": reservation.retry_after})
        response.status_code = 429
        response.headers["Retry-After"] = str(reservation.retry_after)
        return response
    try:
        if split_type == "ai_suggest":
            gender = str(payload.get("gender") or "").strip().lower()
            plan = svc.ai.suggest_split(
                days_per_week, goal=goal, gender=gender if gender in {"male", "female"} else None,
                goal_weight_kg=_optional_positive_float(payload.get("goal_weight_kg")),
                current_weight_kg=_optional_positive_float(payload.get("current_weight_kg")), location=location)
        else:
            plan = svc.ai.build_split(split_type, days_per_week, custom_days, goal, custom_days_exercises, location)
    except Exception:
        ai.release(svc, user_id, "split_generation", reservation)
        raise
    if split_type == "ai_suggest":
        ai.track(svc, user_id, "split_ai_suggested")
    return jsonify({"ok": True, **plan})
