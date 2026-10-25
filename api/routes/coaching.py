"""Coaching: body-fat ranges, the target calculation, and the weekly check-in adjustment."""

import logging

from flask import Blueprint, jsonify, request

from coaching_engine import (
    FEMALE_BODY_FAT_RANGES, MALE_BODY_FAT_RANGES, apply_calorie_delta, calculate_targets, distribute_weekly_calories,
    weekly_adjustment)

from .. import accounts, ai, coaching, consent
from ..auth import current_identity, login_required
from ..supabase_admin import SupabaseError
from .account import fail, json_body, services

bp = Blueprint("coaching", __name__)
log = logging.getLogger(__name__)
PHOTO_BUCKET = "progress-photos"
FEATURE = "checkin_analysis"


@bp.get("/api/coaching/body-fat-ranges")
@login_required
def body_fat_ranges():
    gender = request.args.get("gender", "male")
    return jsonify({"ok": True, "ranges": FEMALE_BODY_FAT_RANGES if gender == "female" else MALE_BODY_FAT_RANGES})


@bp.post("/api/coaching/calculate")
@login_required
def calculate():
    payload = json_body()
    profile, error = coaching.validate_profile(payload)
    if error:
        return fail(error, 400)
    targets = calculate_targets(profile)
    distribution = None
    if payload.get("distribution") == "weekly":
        distribution = distribute_weekly_calories(targets["calories"], targets["protein"], targets["fat"], targets["carbs"],
                                                  coaching.training_days(payload.get("training_days")))
    return jsonify({"ok": True, "targets": targets, "distribution": distribution})


@bp.post("/api/coaching/weekly-adjustment")
@login_required
def weekly_check_in():
    """The deterministic trend adjustment always runs and is the answer on its own; with consent, and while the daily
    check-in allowance lasts, the model may refine it (photos included) and a failure there quietly falls back to the
    deterministic number: a check-in the person just spent time on is never lost to an AI hiccup."""
    svc, identity = services(), current_identity()
    user_id = identity.id
    payload = json_body()
    profile, error = coaching.validate_profile(payload)
    if error:
        return fail(error, 400)
    current_targets = payload.get("current_targets")
    if not isinstance(current_targets, dict) or "calories" not in current_targets:
        return fail("Missing current_targets.", 400)
    week_weights = coaching.bounded_list(payload.get("week_weight_entries"))
    week_calories = coaching.bounded_list(payload.get("week_calorie_days"))
    if week_weights is None or week_calories is None:
        return fail("Invalid check-in data.", 400)

    try:
        baseline = weekly_adjustment(profile, current_targets, week_weights, week_calories)
    except (KeyError, TypeError, ValueError, AttributeError):
        return fail("Invalid check-in data.", 400)

    with svc.db.connection() as conn:
        stored = accounts.get_profile(conn, user_id)
        photos = coaching.own_photos(conn, user_id, payload.get("photo_ids")) if stored else []
    adjustment = baseline
    reservation = None
    if consent.has_consent(stored):
        reservation = ai.reserve(svc, identity, FEATURE)
        if reservation.allowed:
            files = []
            for row in photos:
                try:
                    data = svc.storage.download(PHOTO_BUCKET, f"{user_id}/{row['filename']}")
                except SupabaseError:
                    data = None
                if data:
                    files.append((data, coaching.mime_for(row["filename"])))
            try:
                outcome = svc.ai.checkin(profile, current_targets, week_weights, week_calories, baseline, files)
                adjustment = apply_calorie_delta(profile, current_targets, outcome["delta"], outcome["reason"])
                ai.track(svc, user_id, "checkin_ai_analysis")
            except Exception:                                  # noqa: BLE001 -- any failure: the deterministic number stands
                log.warning("check-in analysis failed; using the deterministic adjustment", exc_info=True)
                ai.release(svc, user_id, FEATURE, reservation)
    return jsonify({"ok": True, "adjustment": adjustment})
