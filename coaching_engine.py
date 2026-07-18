"""Personalized nutrition coaching: turns a short questionnaire into a
calorie/macro target, then re-tunes that target week over week based on
actual logged weight and calorie adherence.

Deliberately rule-based / deterministic rather than calling an LLM for
the numbers themselves — calorie targets are basic, well-established
exercise-science math (Katch-McArdle for BMR, standard activity
multipliers, evidence-based protein-per-kg ranges), and a real formula
is more reliable and reproducible than asking a language model to guess.

Katch-McArdle is used instead of the more common Mifflin-St Jeor because
it needs body weight + body fat % (which this app already collects via
the body-type picker) instead of height, which nothing here asks for.
"""

# ---------- Body-fat range pickers (shown to the user as a body-type step) ----------
# Values are approximate visual categories, not diagnostic — the midpoint
# of whichever range the user picks is what feeds the BMR calculation.
#
# The female ranges sit noticeably higher than the male ones at each
# equivalent visual/fitness tier (e.g. "very lean" is 7-10% for men but
# 15-18% for women) — this is deliberate, not a placeholder to fix later.
# Essential (sex-specific) body fat is roughly 2-5% for men vs 10-13% for
# women, and that gap persists proportionally across every fitness tier
# (standard ACE body-fat category charts put "athletes" at ~6-13% for men
# vs ~14-20% for women, "fitness" at ~14-17% vs ~21-24%, and so on). Using
# the same numeric range for both genders at a matching visual description
# was wrong: it silently gave two people who picked the "same" category a
# lean_mass_kg (and therefore BMR/TDEE, via Katch-McArdle below) as if
# they were physiologically identical, when women — at the same weight and
# the same relative leanness — have less lean mass and a lower TDEE on
# average. Keep the two lists offset like this; don't "simplify" them back
# to matching numbers.
MALE_BODY_FAT_RANGES = [
    {"id": "m1", "label": "7-10%", "min": 7, "max": 10, "desc": "Very lean — visible six-pack, vascular"},
    {"id": "m2", "label": "11-14%", "min": 11, "max": 14, "desc": "Lean — visible abs"},
    {"id": "m3", "label": "15-20%", "min": 15, "max": 20, "desc": "Athletic — some ab definition"},
    {"id": "m4", "label": "21-25%", "min": 21, "max": 25, "desc": "Average build, little definition"},
    {"id": "m5", "label": "26-35%", "min": 26, "max": 35, "desc": "Above-average body fat"},
    {"id": "m6", "label": "36-45%", "min": 36, "max": 45, "desc": "High body fat"},
]
FEMALE_BODY_FAT_RANGES = [
    {"id": "f1", "label": "15-18%", "min": 15, "max": 18, "desc": "Very lean — minimal curves"},
    {"id": "f2", "label": "19-22%", "min": 19, "max": 22, "desc": "Lean — small waist, slight curves"},
    {"id": "f3", "label": "23-28%", "min": 23, "max": 28, "desc": "Athletic — toned curves"},
    {"id": "f4", "label": "29-34%", "min": 29, "max": 34, "desc": "Average — natural curves"},
    {"id": "f5", "label": "35-42%", "min": 35, "max": 42, "desc": "Above-average body fat"},
    {"id": "f6", "label": "43-50%", "min": 43, "max": 50, "desc": "High body fat"},
]

ACTIVITY_MULTIPLIERS = {
    "none": 1.20,           # sedentary — no structured training
    "cardio_only": 1.45,
    "lift_only": 1.375,
    "lift_and_cardio": 1.55,
}

# PROTEIN_G_PER_KG_LEAN below is calibrated for people actually training --
# resistance work (not cardio) is what drives elevated protein need, since
# it's the stimulus muscle protein synthesis responds to. Someone who
# selected "none" isn't creating that stimulus at all, so their target
# should sit meaningfully below an otherwise-identical lifter's, not match
# it -- and "cardio_only" sits between the two, since cardio alone still
# raises overall protein turnover somewhat but nowhere near what lifting
# does. "lift_only" gets the same multiplier as "lift_and_cardio" because
# it's the lifting, not the cardio, that raises the requirement.
ACTIVITY_PROTEIN_MULTIPLIER = {
    "none": 0.70,
    "cardio_only": 0.85,
    "lift_only": 1.0,
    "lift_and_cardio": 1.0,
}

ASPIRATION_ADJUSTMENT = {
    # Fraction of TDEE to add/subtract for goals that aren't rate-driven.
    # "lose" is handled separately via the user-chosen weekly loss rate
    # (see LOSS_RATE_* below) instead of a flat fraction.
    "maintain": 0.0,
    "gain": 0.12,
}

# User-facing slider range for "how fast do you want to lose weight",
# expressed as % of bodyweight per week — a widely-used, sustainable
# range in sports nutrition guidance (roughly 0.5-1%/week is conservative,
# up to ~1%/week is standard, and 2%/week is an aggressive-but-still-safe
# upper bound for people with more to lose).
LOSS_RATE_MIN_PCT = 1.0
LOSS_RATE_MAX_PCT = 2.0
LOSS_RATE_DEFAULT_PCT = 1.5

# The naive "% bodyweight/week x 7700 kcal/kg" conversion produces a daily
# deficit that scales with total bodyweight, not with the person's actual
# energy budget — for a heavier or less active person it can easily blow
# past 1000-1400 kcal/day, which then gets clamped hard by the
# MIN_CALORIES_* floor and silently hands back a much lower number than
# the slider position implies (this was a real bug: default 1.5%/week
# routinely produced deficits over 1300 kcal/day). Instead, the slider
# maps to a deficit as a bounded fraction of TDEE, so it can never exceed
# a sane, sustainable cut regardless of bodyweight. The midpoint (1.5%)
# is anchored to a 20% TDEE cut to match the previously-tuned default.
LOSS_RATE_DEFICIT_FRACTION_MIN = 0.12  # at LOSS_RATE_MIN_PCT (gentler cut)
LOSS_RATE_DEFICIT_FRACTION_MAX = 0.28  # at LOSS_RATE_MAX_PCT (aggressive but still sane)

# Grams of protein per kg of LEAN body mass (not total body weight).
# Protein need tracks the amount of tissue actually doing metabolic/
# muscular work, not total scale weight -- a 100kg person at 10% body fat
# (90kg lean) needs meaningfully more protein than a 100kg person at 40%
# body fat (60kg lean), even though they'd get the exact same target under
# a flat g-per-total-kg rule. Calibrated against the old bodyweight-based
# ranges (1.2/1.6/2.0/2.4 g/kg total weight) at a ~20% body fat reference
# point (lean mass = 0.8x weight), i.e. old_value / 0.8, which lines up
# with standard lean-mass-based sports nutrition ranges (roughly
# 1.5-3.0 g/kg LBM depending on training goal).
PROTEIN_G_PER_KG_LEAN = {
    "low_moderate": 1.5,
    "moderate": 2.0,
    "high": 2.5,
    "highest": 3.0,
}

# Extra grams of protein layered on top of the bodyweight-based target
# above when the goal is weight loss -- a calorie deficit puts muscle at
# risk, and higher protein intake is the single most effective lever for
# preserving it while cutting. The bump is deliberately inverse to the
# preference tier: someone already eating at "highest" (2.4 g/kg) is
# close to the point of diminishing returns, so a small nudge is enough,
# while someone at "low_moderate" (1.2 g/kg) has much more headroom and
# benefits from a bigger increase to actually blunt muscle loss.
LOSE_WEIGHT_PROTEIN_BUMP_G = {
    "highest": 13,       # ~10-15g range
    "high": 20,
    "moderate": 25,      # "standard" intake
    "low_moderate": 30,
}

# Floors so a deficit can never be calculated as unsafely low. Different
# by gender per standard clinical minimum-safe-intake guidance (e.g. NHS/
# NIH low-calorie-diet cautions) rather than one flat number for everyone.
MIN_CALORIES_MALE = 1400
MIN_CALORIES_FEMALE = 1000
FAT_PERCENT_OF_CALORIES = 0.25  # "balanced" default, also the fallback for an unrecognized diet_preference
WEEKLY_ADJUSTMENT_LIMIT = 150  # the +/- 1-150 kcal/week cap the coaching loop is allowed

# How the user's chosen diet style (the wizard's "What kind of diet do you
# want?" question) reshapes the calorie target into fat/carbs. This is
# deliberately NOT applied to BMR/TDEE itself -- resting + activity energy
# expenditure doesn't meaningfully change based on macro composition, only
# on lean mass and activity (any "metabolic advantage" claimed for one
# macro split over another at equal calories is marginal and contested in
# the literature, not something to hard-code as a multiplier). What a diet
# style actually determines is how the same calorie/protein target gets
# split between fat and carbs -- protein is untouched here since it's
# already driven by lean mass (see PROTEIN_G_PER_KG_LEAN above), not diet
# style.
#
# Every style but keto is expressed as "fat's share of total calories" and
# carbs absorb whatever's left after protein + fat, same shape as the
# original flat FAT_PERCENT_OF_CALORIES this replaces.
DIET_FAT_PERCENT_OF_CALORIES = {
    "balanced": 0.25,
    "low_fat": 0.15,
    "low_carb": 0.40,
}

# Keto isn't defined by a fat *percentage* the way the others are -- it's
# defined by staying under a hard, roughly-constant carb ceiling regardless
# of total calories (going much over ~50g/day of carbs is what actually
# breaks ketosis). So carbs are set first as a flat gram target here, and
# fat absorbs whatever's left after protein + carbs, not the other way
# around.
KETO_CARBS_G = 30


def _split_fat_carbs(calories, protein_calories, diet_preference):
    """Returns (fat_g, carbs_g) for the given total calories and protein
    calories already spent, shaped by the user's diet_preference. Shared
    by calculate_targets() and weekly_adjustment() so a weekly auto-tune
    can never silently revert a keto/low-fat user back to the default
    25%-fat split."""
    if diet_preference == "keto":
        carbs_g = KETO_CARBS_G
        carb_calories = carbs_g * 4
        fat_calories = max(0, calories - protein_calories - carb_calories)
        fat_g = round(fat_calories / 9)
        return fat_g, carbs_g

    fat_percent = DIET_FAT_PERCENT_OF_CALORIES.get(diet_preference, FAT_PERCENT_OF_CALORIES)
    fat_calories = calories * fat_percent
    fat_g = round(fat_calories / 9)
    remaining_calories = max(0, calories - protein_calories - fat_g * 9)
    carbs_g = round(remaining_calories / 4)
    return fat_g, carbs_g


def min_calories_for(gender):
    return MIN_CALORIES_MALE if gender == "male" else MIN_CALORIES_FEMALE


def body_fat_ranges_for(gender):
    return MALE_BODY_FAT_RANGES if gender == "male" else FEMALE_BODY_FAT_RANGES


def _range_midpoint(gender, body_fat_range_id):
    for r in body_fat_ranges_for(gender):
        if r["id"] == body_fat_range_id:
            return (r["min"] + r["max"]) / 2
    return 20.0  # sane fallback if an unknown id ever slips through


def calculate_targets(profile):
    """profile: {aspiration, weight_kg, gender, body_fat_range_id,
    activity_level, protein_preference, loss_rate_pct (only used when
    aspiration == "lose")}. Returns calories/protein/fat/carbs (grams)
    plus the intermediate bmr/tdee for transparency."""
    weight_kg = float(profile["weight_kg"])
    gender = profile["gender"]
    body_fat_pct = _range_midpoint(gender, profile["body_fat_range_id"])

    lean_mass_kg = weight_kg * (1 - body_fat_pct / 100)
    bmr = 370 + 21.6 * lean_mass_kg  # Katch-McArdle

    activity_multiplier = ACTIVITY_MULTIPLIERS.get(profile["activity_level"], 1.2)
    tdee = bmr * activity_multiplier

    if profile["aspiration"] == "lose":
        loss_rate_pct = float(profile.get("loss_rate_pct") or LOSS_RATE_DEFAULT_PCT)
        loss_rate_pct = max(LOSS_RATE_MIN_PCT, min(LOSS_RATE_MAX_PCT, loss_rate_pct))
        rate_span = LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT
        rate_t = (loss_rate_pct - LOSS_RATE_MIN_PCT) / rate_span if rate_span else 0.5
        deficit_fraction = LOSS_RATE_DEFICIT_FRACTION_MIN + rate_t * (
            LOSS_RATE_DEFICIT_FRACTION_MAX - LOSS_RATE_DEFICIT_FRACTION_MIN
        )
        raw_calories = tdee * (1 - deficit_fraction)
    else:
        adjustment = ASPIRATION_ADJUSTMENT.get(profile["aspiration"], 0.0)
        raw_calories = tdee * (1 + adjustment)

    calories = max(min_calories_for(gender), round(raw_calories))

    activity_protein_multiplier = ACTIVITY_PROTEIN_MULTIPLIER.get(profile["activity_level"], 1.0)
    protein_g_per_kg_lean = PROTEIN_G_PER_KG_LEAN.get(profile["protein_preference"], 2.0) * activity_protein_multiplier
    protein_g = round(protein_g_per_kg_lean * lean_mass_kg)
    if profile["aspiration"] == "lose":
        protein_g += round(LOSE_WEIGHT_PROTEIN_BUMP_G.get(profile["protein_preference"], 25) * activity_protein_multiplier)
    protein_calories = protein_g * 4

    fat_g, carbs_g = _split_fat_carbs(calories, protein_calories, profile.get("diet_preference", "balanced"))

    return {
        "bmr": round(bmr),
        "tdee": round(tdee),
        "calories": calories,
        "protein": protein_g,
        "fat": fat_g,
        "carbs": carbs_g,
    }


def distribute_weekly_calories(daily_calories, protein, fat, carbs, training_days):
    """Splits a flat daily target across a Mon-Sun week: +10% on days the
    user's split plan has training, -10% on rest days, so the week still
    averages out to the same total. training_days is a set of lowercase
    weekday keys ("monday", ...) considered training days; if empty,
    falls back to a fixed alternating pattern (still averaging correctly)
    so distribution still means something without a split plan configured.
    """
    weekday_order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    if not training_days:
        training_days = {"monday", "wednesday", "friday", "saturday"}

    result = {}
    for day in weekday_order:
        is_training = day in training_days
        factor = 1.10 if is_training else 0.90
        result[day] = {
            "calories": round(daily_calories * factor),
            "protein": protein,  # protein target stays constant — it's a
                                  # muscle-preservation floor, not something
                                  # that should dip on rest days
            "fat": round(fat * factor),
            "carbs": round(carbs * factor),
        }
    return result


def _average(values):
    return sum(values) / len(values) if values else None


def weekly_adjustment(profile, current_targets, week_weight_entries, week_calorie_days):
    """Looks at one week of real data and proposes a calorie tweak.

    week_weight_entries: list of {date, kg} for the week, any order.
    week_calorie_days: list of {date, calories} for days that were
        actually logged as "logged" (fasting/incomplete/unlogged days
        should already be filtered out by the caller).

    Returns None if there isn't enough data to say anything meaningful
    (per the "if the user doesn't log at all, don't count it" rule) —
    otherwise a dict with the new targets and a short human-readable
    reason.
    """
    if len(week_weight_entries) < 2 or len(week_calorie_days) < 3:
        return None

    weight_kg = float(profile["weight_kg"])
    sorted_weights = sorted(week_weight_entries, key=lambda e: e["date"])
    weight_change = sorted_weights[-1]["kg"] - sorted_weights[0]["kg"]
    weight_change_pct = (weight_change / sorted_weights[0]["kg"]) * 100 if sorted_weights[0]["kg"] else 0

    avg_calories = _average([d["calories"] for d in week_calorie_days])
    target_calories = current_targets["calories"]
    adherence_gap = avg_calories - target_calories  # positive = eating over target

    aspiration = profile["aspiration"]

    # Expected weekly weight-change bands per goal, roughly what's
    # considered sustainable/typical in the sports nutrition literature.
    if aspiration == "lose":
        expected_low, expected_high = -1.0, -0.3   # % of bodyweight/week
    elif aspiration == "gain":
        expected_low, expected_high = 0.15, 0.5
    else:
        expected_low, expected_high = -0.3, 0.3

    if expected_low <= weight_change_pct <= expected_high:
        # On track — only nudge for a clear, sustained adherence gap so a
        # single big cheat day/great day doesn't whipsaw the target.
        if abs(adherence_gap) < 100:
            return None
        step = min(WEEKLY_ADJUSTMENT_LIMIT, round(abs(adherence_gap) * 0.3))
        delta = -step if adherence_gap > 0 else step
        reason = (
            "Your weight trend looks on track, but you've been eating "
            f"{'more' if adherence_gap > 0 else 'less'} than your target most days, "
            "so the target's been nudged to match reality."
        )
    else:
        too_slow = (
            (aspiration == "lose" and weight_change_pct > expected_high)
            or (aspiration == "gain" and weight_change_pct < expected_low)
            or (aspiration == "maintain" and weight_change_pct > expected_high)
        )
        too_fast = (
            (aspiration == "lose" and weight_change_pct < expected_low)
            or (aspiration == "gain" and weight_change_pct > expected_high)
            or (aspiration == "maintain" and weight_change_pct < expected_low)
        )

        # Bigger miss -> bigger (but still capped) correction.
        magnitude = min(WEEKLY_ADJUSTMENT_LIMIT, max(1, round(abs(weight_change_pct - (
            expected_high if too_slow else expected_low
        )) * weight_kg * 33)))

        if aspiration == "lose":
            delta = -magnitude if too_slow else magnitude
        elif aspiration == "gain":
            delta = magnitude if too_slow else -magnitude
        else:  # maintain: pull back toward baseline regardless of direction
            delta = -magnitude if weight_change_pct > 0 else magnitude

        if too_slow:
            reason = {
                "lose": "Weight loss has stalled this week, so calories have been trimmed slightly.",
                "gain": "Weight gain has stalled this week, so calories have been increased slightly.",
                "maintain": "Weight drifted up this week, so calories have been trimmed slightly.",
            }[aspiration]
        else:
            reason = {
                "lose": "You're losing faster than the sustainable range, so calories have been raised slightly.",
                "gain": "You're gaining faster than intended, so calories have been trimmed slightly.",
                "maintain": "Weight drifted down this week, so calories have been raised slightly.",
            }[aspiration]

    delta = max(-WEEKLY_ADJUSTMENT_LIMIT, min(WEEKLY_ADJUSTMENT_LIMIT, delta))
    if delta == 0:
        return None

    new_calories = max(min_calories_for(profile["gender"]), current_targets["calories"] + delta)
    # Keep protein fixed (it's set from lean mass, not from calorie
    # balance) and absorb the whole adjustment into fat/carbs, using the
    # same diet-style split (keto/low-fat/low-carb/balanced) as the
    # initial calculation -- otherwise a weekly auto-tune would silently
    # revert a keto/low-fat user back to the default 25%-fat split.
    protein_calories = current_targets["protein"] * 4
    fat_g, carbs_g = _split_fat_carbs(new_calories, protein_calories, profile.get("diet_preference", "balanced"))

    return {
        "calories": new_calories,
        "protein": current_targets["protein"],
        "fat": fat_g,
        "carbs": carbs_g,
        "delta": delta,
        "reason": reason,
        "weight_change_kg": round(weight_change, 2),
        "avg_calories_logged": round(avg_calories),
    }


def apply_calorie_delta(profile, current_targets, delta, reason):
    """Builds the same {calories, protein, fat, carbs, delta, reason} shape
    weekly_adjustment() returns, but from an already-decided delta instead
    of computing one from scratch -- used when an outside source (e.g.
    checkin_analyzer.py's AI-assisted photo review) has decided the delta
    itself. Runs it through the same safety floor and diet-aware fat/carb
    split so every path that ever adjusts calories goes through identical,
    safe math -- an AI-suggested delta is never applied raw."""
    delta = max(-WEEKLY_ADJUSTMENT_LIMIT, min(WEEKLY_ADJUSTMENT_LIMIT, round(delta)))
    if delta == 0:
        return None
    new_calories = max(min_calories_for(profile["gender"]), current_targets["calories"] + delta)
    protein_calories = current_targets["protein"] * 4
    fat_g, carbs_g = _split_fat_carbs(new_calories, protein_calories, profile.get("diet_preference", "balanced"))
    return {
        "calories": new_calories,
        "protein": current_targets["protein"],
        "fat": fat_g,
        "carbs": carbs_g,
        "delta": delta,
        "reason": reason,
    }
