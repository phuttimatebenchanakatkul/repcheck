"""Coaching calculations: the profile check, and the inputs to the weekly check-in.

validate_profile is a port of app.py's _validate_coaching_profile (which cannot be imported); the offline tests run both on
the same inputs and require identical output. The arithmetic itself is coaching_engine's, used unchanged.
"""

import mimetypes

from coaching_engine import (
    FEMALE_BODY_FAT_RANGES, GAIN_RATE_DEFAULT_PCT, GAIN_RATE_MAX_PCT, GAIN_RATE_MIN_PCT, LOSS_RATE_DEFAULT_PCT,
    LOSS_RATE_MAX_PCT, LOSS_RATE_MIN_PCT, MALE_BODY_FAT_RANGES)

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
MAX_LOG_ENTRIES = 31              # a week's weigh-ins and calorie days; a month is generous
MAX_CHECKIN_PHOTOS = 2            # front + back


def _one_of(value, options):
    """`value in options`, but a list or dict (unhashable) is simply 'not one of them' instead of a TypeError. The website's
    check raises there, so a request body like {"aspiration": [1]} is a 500 on the website and a 400 here."""
    return isinstance(value, str) and value in options


def validate_profile(payload):
    """(profile, None) or (None, message). The goal, gender, activity, protein and diet choices, a body-fat range that
    exists for that gender, a weight of 35-300 kg (below that the Katch-McArdle maths stops producing safe targets and
    the app is not built for that population), an optional height, and the weekly rate the goal needs (an explicit null
    means 'not supplied', exactly like an absent key)."""
    aspiration = payload.get("aspiration")
    gender = payload.get("gender")
    activity_level = payload.get("activity_level")
    protein_preference = payload.get("protein_preference")
    body_fat_range_id = payload.get("body_fat_range_id")
    diet_preference = payload.get("diet_preference") or "balanced"      # older profiles predate the question

    if not _one_of(aspiration, {"lose", "maintain", "gain"}):
        return None, "Please choose a goal: lose, maintain, or gain weight."
    if not _one_of(gender, {"male", "female"}):
        return None, "Please choose a gender."
    if not _one_of(activity_level, {"none", "cardio_only", "lift_only", "lift_and_cardio"}):
        return None, "Please choose an activity level."
    if not _one_of(protein_preference, {"low_moderate", "moderate", "high", "highest"}):
        return None, "Please choose a protein intake level."
    if not _one_of(diet_preference, {"balanced", "low_fat", "low_carb", "keto"}):
        return None, "Please choose a diet type."
    valid_range_ids = {r["id"] for r in (FEMALE_BODY_FAT_RANGES if gender == "female" else MALE_BODY_FAT_RANGES)}
    if not _one_of(body_fat_range_id, valid_range_ids):
        return None, "Please choose a body type."
    try:
        weight_kg = float(payload.get("weight_kg"))
        if not 35 <= weight_kg <= 300:
            raise ValueError
    except (TypeError, ValueError):
        return None, "Please enter a realistic weight of at least 35 kg."

    height_cm = None
    if payload.get("height_cm") is not None:
        try:
            height_cm = float(payload.get("height_cm"))
            if not 100 <= height_cm <= 250:
                raise ValueError
        except (TypeError, ValueError):
            return None, "Please choose a realistic height."

    loss_rate_pct = None
    if aspiration == "lose":
        try:
            raw = payload.get("loss_rate_pct")
            loss_rate_pct = float(LOSS_RATE_DEFAULT_PCT if raw is None else raw)
            if not LOSS_RATE_MIN_PCT - 0.01 <= loss_rate_pct <= LOSS_RATE_MAX_PCT + 0.01:
                raise ValueError
        except (TypeError, ValueError):
            return None, "Please choose a realistic weekly weight loss rate."

    gain_rate_pct = None
    if aspiration == "gain":
        try:
            raw = payload.get("gain_rate_pct")
            gain_rate_pct = float(GAIN_RATE_DEFAULT_PCT if raw is None else raw)
            if not GAIN_RATE_MIN_PCT - 0.01 <= gain_rate_pct <= GAIN_RATE_MAX_PCT + 0.01:
                raise ValueError
        except (TypeError, ValueError):
            return None, "Please choose a realistic weekly weight gain rate."

    return {
        "aspiration": aspiration, "gender": gender, "activity_level": activity_level,
        "protein_preference": protein_preference, "diet_preference": diet_preference,
        "body_fat_range_id": body_fat_range_id, "weight_kg": weight_kg, "height_cm": height_cm,
        "loss_rate_pct": loss_rate_pct, "gain_rate_pct": gain_rate_pct,
    }, None


def training_days(raw):
    """The lower-case weekday names in `raw`, ignoring anything else (a set cannot hold an unhashable value, and a
    name that is not a weekday would never match one)."""
    if not isinstance(raw, list):
        return set()
    return {d.lower() for d in raw if isinstance(d, str) and d.lower() in WEEKDAYS}


def bounded_list(raw):
    """`raw` if it is a list of at most MAX_LOG_ENTRIES objects, else None."""
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_LOG_ENTRIES or not all(isinstance(x, dict) for x in raw):
        return None
    return raw


def own_photos(conn, user_id, photo_ids):
    """The caller's own progress-photo rows for the first MAX_CHECKIN_PHOTOS usable ids, in order. An id that is not a
    number, or not theirs, is skipped (never an error, never someone else's photo)."""
    rows = []
    for raw in (photo_ids if isinstance(photo_ids, list) else [])[:MAX_CHECKIN_PHOTOS]:
        if isinstance(raw, bool):
            continue
        try:
            photo_id = int(raw)
        except (TypeError, ValueError):
            continue
        row = conn.execute("select id, filename from public.progress_photos where id = %s and user_id = %s",
                           (photo_id, user_id)).fetchone()
        if row:
            rows.append(row)
    return rows


def mime_for(filename):
    return mimetypes.guess_type(filename)[0] or "image/jpeg"
