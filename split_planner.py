"""Generates a full workout split plan: which day-types to train, which
exercises belong to each, and — using the same recovery/balance knowledge
as split_analyzer.py — which weekday each day-type should land on and why.

Tries Gemini first so the plan reads like a coach put it together, but
Gemini's JSON output can't be trusted blindly (it can hallucinate exercise
names, propose an unrecoverable schedule, or return malformed JSON), so
every exercise gets filtered against WORKOUT_EXERCISES and the proposed
weekly schedule gets checked against split_analyzer's recovery heuristic
before being trusted. Any failure falls back to build_fallback_plan(),
which is fully deterministic and always succeeds.
"""

import json
import os
import re

from dotenv import load_dotenv

from split_analyzer import longest_training_streak
from workout_library import EXERCISE_CATEGORIES, EXERCISE_LOCATIONS, WORKOUT_EXERCISES

load_dotenv()

GEMINI_MODEL = "gemini-3.1-flash-lite"

# The "Let AI build it" path picks the split type itself rather than being
# handed one, so it gets a slightly stronger lite model than the
# type-already-chosen path above -- it's making a real coaching decision,
# not just filling in exercises for a split the user already named.
SUGGEST_GEMINI_MODEL = "gemini-3.5-flash-lite"

VALID_EXERCISES = set(WORKOUT_EXERCISES)
WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

# A streak longer than this (consecutive training days, wrapping week to
# week) is treated as an AI mistake and triggers the deterministic fallback
# schedule instead — this is the same "roughly 1 rest day per 2 training
# days" principle split_analyzer.py critiques existing plans against.
MAX_ACCEPTABLE_STREAK = 3

# Pulled from workout_library.EXERCISE_CATEGORIES (single source of truth
# for exercise names) rather than re-listing exercises here.
CHEST = EXERCISE_CATEGORIES["Chest"]
BACK = EXERCISE_CATEGORIES["Back"]
SHOULDERS = EXERCISE_CATEGORIES["Shoulders"]
ARMS = EXERCISE_CATEGORIES["Arms"]
LEGS = EXERCISE_CATEGORIES["Legs"]
CORE = EXERCISE_CATEGORIES["Core"]
MOBILITY = EXERCISE_CATEGORIES["Mobility & Flexibility"]
ATHLETIC = EXERCISE_CATEGORIES["Athletic / Speed & Agility"]
FUNCTIONAL = EXERCISE_CATEGORIES["Functional / Real-World Strength"]
BALANCE = EXERCISE_CATEGORIES["Balance & Stability"]
PRENATAL = EXERCISE_CATEGORIES["Prenatal / Low-Impact"]
CONDITIONING = EXERCISE_CATEGORIES["Full Body / Conditioning"]

SPLIT_DAY_TYPES = {
    "ppl": ["Push", "Pull", "Legs"],
    "upper_lower": ["Upper", "Lower"],
    "full_body": ["Full Body"],
    "bro_split": ["Chest", "Back", "Legs", "Shoulders", "Arms"],
}

# A well-rounded leg pool (quads, hamstrings, glutes, calves) -- named
# explicitly rather than sliced by position, since a slice silently
# reshuffles which muscles are covered whenever workout_library.py's Legs
# list gets a new entry inserted anywhere but the very end (this bit us
# once already: adding "Dumbbell Squat" right after "Squat" turned
# LEGS[:6] into five squat variations and nothing else).
LEGS_BALANCED = [
    "Squat", "Leg Press", "Walking Lunge", "Bulgarian Split Squat",
    "Lying Leg Curl Machine", "Calf Raise", "Hip Thrust", "Leg Extension",
]

DAY_TYPE_POOLS = {
    # Named explicitly (not sliced by position) for the same reason as
    # LEGS_BALANCED above -- these need one exercise from a *specific*
    # muscle (a triceps finisher for Push, a biceps finisher for
    # Pull/Upper), and a positional slice into ARMS silently points at
    # whatever now happens to sit at that index instead.
    "Push": CHEST[:4] + SHOULDERS[:2] + ["Tricep Pushdown"],
    "Pull": BACK[:5] + ["Bicep Curl", "Hammer Curl"],
    "Legs": LEGS_BALANCED[:6],
    "Upper": CHEST[:2] + BACK[:2] + SHOULDERS[:1] + ["Bicep Curl"],
    "Lower": LEGS_BALANCED[:5] + CORE[:1],
    "Full Body": [CHEST[0], "Pull-Up", "Squat", SHOULDERS[0], "Bicep Curl", CORE[0]],
    "Chest": ["Flat Bench Press", "Incline Bench Press", "Dumbbell Bench Press", "Chest Fly", "Cable Crossover", "Push-Up"],
    "Back": BACK[:6],
    "Shoulders": SHOULDERS[:6],
    "Arms": ["Bicep Curl", "Hammer Curl", "Preacher Curl", "Tricep Pushdown", "Overhead Tricep Extension", "Skull Crusher"],
    "Mobility": MOBILITY[:8],
    "Athletic": ATHLETIC[:8],
    "Functional": FUNCTIONAL[:8],
    "Balance": BALANCE[:8],
    "Prenatal": PRENATAL[:8],
    # Hybrid-training day type -- HYROX-style strength+endurance work
    # (loaded carries, sled work, kettlebell/dumbbell complexes, wall
    # balls, machine intervals). Automatically blended into the plan for
    # anyone who says they train "hybrid" -- see build_fallback_plan.
    "Conditioning": CONDITIONING[:8],
}

_bad_pool_names = [
    name for pool in DAY_TYPE_POOLS.values() for name in pool if name not in VALID_EXERCISES
]
if _bad_pool_names:
    raise AssertionError(f"DAY_TYPE_POOLS references unknown exercise name(s): {_bad_pool_names}")

_KEYWORD_POOL = [
    ("push", "Push"), ("pull", "Pull"), ("leg", "Legs"), ("upper", "Upper"), ("lower", "Lower"),
    ("chest", "Chest"), ("back", "Back"), ("shoulder", "Shoulders"), ("arm", "Arms"),
    ("core", "Chest"), ("ab", "Chest"), ("full", "Full Body"),
    ("mobility", "Mobility"), ("flexib", "Mobility"), ("stretch", "Mobility"),
    ("athletic", "Athletic"), ("speed", "Athletic"), ("agility", "Athletic"), ("sprint", "Athletic"),
    ("power", "Athletic"), ("plyo", "Athletic"),
    ("functional", "Functional"), ("carry", "Functional"), ("carrying", "Functional"),
    ("balance", "Balance"), ("stability", "Balance"),
    ("prenatal", "Prenatal"), ("pregnan", "Prenatal"),
    ("conditioning", "Conditioning"), ("hyrox", "Conditioning"), ("endurance", "Conditioning"),
]

# Free-text goal keywords that, in the no-AI fallback path, are enough
# reason to weave a matching day type into the split even though the user
# didn't explicitly pick that split type -- e.g. someone who picks
# "Push/Pull/Legs" but types "I also want to move faster for my sport"
# still gets an Athletic day worked in, and someone who mentions being
# pregnant gets steered toward the low-impact Prenatal pool instead.
# Checked in this order; a goal can match more than one category (e.g.
# "build muscle, improve mobility, and get faster for soccer" matches
# both Mobility and Athletic).
_GOAL_KEYWORD_MAP = {
    "Prenatal": ("pregnan", "prenatal", "expecting", "trimester"),
    "Athletic": (
        "faster", "speed", "agility", "sprint", "explosive", "vertical jump", "quicker",
        "athletic performance", "my sport", "for soccer", "for basketball", "for football",
        "for tennis", "for track", "power",
    ),
    "Functional": (
        "carry", "carrying", "lift my", "lift heavy things", "lift objects", "everyday strength",
        "functional strength", "real-world", "real life", "practical strength", "bed-ridden",
        "bedridden", "caregiv", "pick up my", "lift and carry",
    ),
    "Balance": ("balance", "stability", "fall risk", "falling", "elderly", "senior citizen"),
    "Mobility": ("mobility", "flexib", "stretch", "range of motion", "recovery", "injur"),
    "Conditioning": ("hyrox", "conditioning", "endurance", "cardio", "stamina", "engine", "metcon"),
}
# Cap on how many *extra* goal-driven day types get blended into a
# split beyond whatever the user's chosen split type already provides --
# past this, the plan stops reading as "their split with some goal work
# mixed in" and starts reading as an unrelated plan.
MAX_GOAL_DAY_TYPES = 2

# Deterministic weekday patterns (Monday-first) that keep training streaks
# to at most 2 in a row wherever the day count allows it, used both as the
# no-AI fallback and to validate/repair whatever Gemini proposes.
DEFAULT_TRAIN_PATTERNS = {
    1: [True, False, False, False, False, False, False],
    2: [True, False, False, True, False, False, False],
    3: [True, False, True, False, True, False, False],
    4: [True, True, False, True, True, False, False],
    5: [True, True, False, True, True, False, True],
    6: [True, True, False, True, True, True, False],
    7: [True, True, True, True, True, True, True],
}


# Which EXERCISE_LOCATIONS tags are acceptable for each training-location
# answer from the wizard's "Where do you usually train?" question --
# "home"/"gym" are exclusive (only exercises actually doable there),
# "hybrid" allows everything, matching the request that hybrid users see
# both home and gym exercises plus the strength/endurance conditioning
# pool (see the "Conditioning" day type above).
LOCATION_ALLOWED = {
    "home": {"home", "both"},
    "gym": {"gym", "both"},
    "hybrid": {"home", "gym", "both"},
}


def _filter_by_location(pool, location):
    """Restrict an exercise pool to what's actually doable at the user's
    stated training location. Falls back to the unfiltered pool if
    filtering would wipe it out entirely, so plan generation never breaks
    outright over a pool that happens to have nothing tagged for that
    location."""
    allowed = LOCATION_ALLOWED.get(location)
    if not allowed:
        return pool
    filtered = [name for name in pool if EXERCISE_LOCATIONS.get(name) in allowed]
    return filtered or pool


def _day_type_for_label(label):
    """Which DAY_TYPE_POOLS key a day label maps to -- exact match first,
    then keyword ("Chest Day" -> "Chest", and the AI's "Full Body A" ->
    "Full Body"), falling back to Full Body."""
    if label in DAY_TYPE_POOLS:
        return label
    lower = label.lower()
    for keyword, day_type in _KEYWORD_POOL:
        if keyword in lower:
            return day_type
    return "Full Body"


# The narrow DAY_TYPE_POOLS above are hand-curated shortlists, which is what
# makes them good defaults -- but they're too small to survive a location
# filter: only 2 of Push's 7 entries are doable at home. These are the full
# categories to draw MORE exercises from when a day comes up short (see
# _top_up_exercises), so a home-training beginner still gets a full session
# of on-topic work instead of a 2-exercise "Push" day.
DAY_TYPE_WIDE_POOLS = {
    "Push": CHEST + SHOULDERS + ARMS,
    "Pull": BACK + ARMS,
    "Legs": LEGS,
    "Upper": CHEST + BACK + SHOULDERS + ARMS,
    "Lower": LEGS + CORE,
    "Full Body": CHEST + BACK + LEGS + SHOULDERS + ARMS + CORE,
    "Chest": CHEST,
    "Back": BACK,
    "Shoulders": SHOULDERS,
    "Arms": ARMS,
    "Mobility": MOBILITY,
    "Athletic": ATHLETIC,
    "Functional": FUNCTIONAL,
    "Balance": BALANCE,
    "Prenatal": PRENATAL,
    "Conditioning": CONDITIONING,
}


def _pool_for_label(label, custom_days_exercises=None, location=None):
    """Best-effort pool lookup for a day label, including custom user
    labels like "Chest Day" by matching on keywords. If the user manually
    picked exercises for this exact day label (via the "plan your own
    split" categorized exercise picker), those take priority over any
    guessing -- including over the location filter, since a hand-picked
    exercise is an explicit choice, not a guess that needs correcting."""
    if custom_days_exercises and custom_days_exercises.get(label):
        return custom_days_exercises[label]
    return _filter_by_location(DAY_TYPE_POOLS[_day_type_for_label(label)], location)


def _top_up_exercises(exercises, label, location, min_exercises, max_exercises):
    """Backfill a day that came up short of min_exercises, drawing from the
    same day type's exercises so the additions stay on topic.

    Needed on both paths for the same underlying reason -- a day's candidate
    exercises can thin out below the minimum after filtering:
      - AI path: it returns names that aren't in the library verbatim, or
        aren't doable at the user's location, and _validate_plan drops them.
      - fallback path: the curated pool itself filters down to 2 entries for
        some day types at home.
    Topping up beats rejecting: the user keeps the split and the exercises
    that WERE valid, instead of silently losing the whole AI plan over one
    bad name."""
    out = list(exercises)
    if len(out) >= min_exercises:
        return out[:max_exercises]
    seen = set(out)
    day_type = _day_type_for_label(label)
    candidate_sources = (
        _filter_by_location(DAY_TYPE_POOLS[day_type], location),
        _filter_by_location(DAY_TYPE_WIDE_POOLS.get(day_type, []), location),
    )
    for source in candidate_sources:
        for candidate in source:
            if len(out) >= min_exercises:
                break
            if candidate not in seen:
                out.append(candidate)
                seen.add(candidate)
    return out[:max_exercises]


def _default_schedule(days, days_per_week):
    pattern = DEFAULT_TRAIN_PATTERNS[days_per_week]
    schedule = {}
    day_iter = iter(days)
    current = None
    for weekday, is_training in zip(WEEKDAY_ORDER, pattern):
        if is_training:
            current = next(day_iter, days[0])
            schedule[weekday] = current["label"]
        else:
            schedule[weekday] = "Rest"
    return schedule


_GOAL_RATIONALE_PHRASES = {
    "Mobility": "flexibility work gets dedicated time instead of being squeezed into the end of a lifting session",
    "Athletic": "sprint mechanics, jumps, and change-of-direction work get dedicated practice, since those skills need their own session rather than a lifting-day add-on",
    "Functional": "real-world carrying and lifting strength gets trained directly, not just assumed as a side effect of machine work",
    "Balance": "balance and stability get deliberate, focused practice",
    "Prenatal": "the plan leans on a low-impact, joint-friendly pool suited to pregnancy instead of the higher-impact default exercises",
    "Conditioning": "hybrid-style strength-and-endurance work (carries, sled/kettlebell/dumbbell conditioning) gets its own session instead of being left out of a pure-strength rotation",
}


def _detect_goal_day_types(goal, existing_labels):
    """Which extra day types (if any) a free-text goal calls for, in
    priority order, excluding any already covered by the chosen split
    type and capped at MAX_GOAL_DAY_TYPES so the result still reads as
    "their split plus goal work" rather than a different plan."""
    if not goal:
        return []
    lower = goal.lower()
    matched = []
    for day_type, keywords in _GOAL_KEYWORD_MAP.items():
        if day_type in existing_labels or day_type in matched:
            continue
        if any(kw in lower for kw in keywords):
            matched.append(day_type)
        if len(matched) >= MAX_GOAL_DAY_TYPES:
            break
    return matched


def _default_rationale(days_per_week, goal_day_types=(), prenatal_whole_plan=False):
    if prenatal_whole_plan:
        return (
            "Since you mentioned being pregnant, every day in this plan draws from a low-impact, "
            "joint-friendly exercise pool instead of the usual higher-impact defaults, rather than just "
            "one day of the week — always confirm any exercise routine with your doctor or midwife first."
        )
    if days_per_week <= 3:
        base = (
            f"Training {days_per_week} day(s) a week with rest spread between them gives full recovery "
            "between sessions, which favors strength and consistent progress."
        )
    elif days_per_week <= 5:
        base = (
            "Training days are grouped in short pairs with rest in between so no muscle group goes "
            "consecutive days without recovery, balancing growth stimulus with recovery time."
        )
    else:
        base = (
            "At this frequency, consecutive training days are unavoidable — the split rotates muscle "
            "groups so the same tissue isn't stressed two days running, but keep an eye on fatigue and "
            "insert an extra rest day if recovery starts to suffer."
        )
    for day_type in goal_day_types:
        phrase = _GOAL_RATIONALE_PHRASES.get(day_type)
        if phrase:
            article = "An" if day_type[0] in "AEIOU" else "A"
            # Deliberately doesn't claim a specific source ("based on the
            # goal you described") -- this day type can come from the
            # free-text goal OR from picking "hybrid" as a training
            # location, and this sentence needs to read true either way.
            base += f" {article} {day_type} day is worked into the rotation, so {phrase}."
    return base


def _reserve_goal_day_types(goal_day_types, days_per_week):
    """Which of the detected goal day types actually get a guaranteed
    slot in the output. Always keeps at least one day for the split the
    user actually chose (blending goal work in, not replacing their split
    entirely), and never reserves more than fit -- this is the exact list
    the rationale should describe, since claiming a day type was added
    when it didn't make the cut would be describing a plan that doesn't
    match what's actually returned."""
    if days_per_week <= 1:
        return []
    return goal_day_types[:days_per_week - 1]


def _build_label_sequence(base_labels, reserved_goal_types, days_per_week):
    """The label for each of the days_per_week training days: reserved
    goal-driven types each get a guaranteed slot, the rest cycle through
    base_labels."""
    remaining = days_per_week - len(reserved_goal_types)
    base_fill = [base_labels[i % len(base_labels)] for i in range(remaining)]
    return base_fill + reserved_goal_types


def build_fallback_plan(split_type, days_per_week, custom_days=None, goal=None, custom_days_exercises=None, location=None):
    if split_type == "custom" and custom_days:
        base_labels = list(custom_days)
    else:
        types = SPLIT_DAY_TYPES.get(split_type, SPLIT_DAY_TYPES["full_body"])
        base_labels = list(types)

    # Blend in dedicated day types the user's free-text goal calls for
    # (mobility, athletic/speed, functional/carrying strength, balance,
    # prenatal/low-impact), even if the split type they picked doesn't
    # otherwise include one -- this is the deterministic (no-AI)
    # equivalent of what generate_split_plan() asks Gemini to do more
    # flexibly.
    goal_day_types = _detect_goal_day_types(goal, base_labels)

    # "Hybrid" training (see the wizard's "Where do you usually train?"
    # question) means both gym+home exercises AND dedicated
    # strength/endurance conditioning work -- blended in the exact same
    # way a matching free-text goal would be, through the same reserved-
    # day-type mechanism (and the same MAX_GOAL_DAY_TYPES cap), so it
    # doesn't crowd out the split the user actually chose.
    if (
        location == "hybrid"
        and "Conditioning" not in goal_day_types
        and "Conditioning" not in base_labels
        and len(goal_day_types) < MAX_GOAL_DAY_TYPES
    ):
        goal_day_types = goal_day_types + ["Conditioning"]

    # Pregnancy safety isn't a "blend into one day" concern the way
    # mobility/athletic work is -- every day should draw from the
    # low-impact pool, not just one slot in an otherwise-unchanged
    # rotation (matches the instruction given to the AI path in
    # _build_prompt for the same goal). Skipped if the user already
    # hand-picked their own exercises for every day -- that's an explicit
    # choice that overrides the goal-text inference.
    all_days_manually_picked = bool(custom_days_exercises) and all(
        custom_days_exercises.get(label) for label in base_labels
    )
    if "Prenatal" in goal_day_types and not all_days_manually_picked:
        label_sequence = ["Prenatal"] * days_per_week
        days = [
            {"label": label, "exercises": _pool_for_label(label, custom_days_exercises, location)}
            for label in label_sequence
        ]
        return {
            "days": days,
            "schedule": _default_schedule(days, days_per_week),
            "rationale": _default_rationale(days_per_week, prenatal_whole_plan=True),
        }

    reserved_goal_types = _reserve_goal_day_types(goal_day_types, days_per_week)
    label_sequence = _build_label_sequence(base_labels, reserved_goal_types, days_per_week)

    days = [
        {"label": label, "exercises": _pool_for_label(label, custom_days_exercises, location)}
        for label in label_sequence
    ]

    return {
        "days": days,
        "schedule": _default_schedule(days, days_per_week),
        "rationale": _default_rationale(days_per_week, reserved_goal_types),
    }


def _extract_json(text):
    text = text.strip()
    match = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def _validate_plan(parsed, days_per_week, custom_days_exercises=None, location=None,
                   min_exercises=3, max_exercises=8, top_up_short_days=False):
    days = parsed.get("days")
    if not isinstance(days, list) or len(days) != days_per_week:
        raise ValueError("wrong number of days")

    # Same "user-picked exercises are exempt from the location filter"
    # rule as _pool_for_label -- everything else the AI proposed gets
    # held to the location the user actually said they train at, same as
    # the deterministic fallback path.
    allowed_tags = LOCATION_ALLOWED.get(location)

    cleaned_days = []
    for day in days:
        label = str(day.get("label", "")).strip()
        picked = custom_days_exercises.get(label) if custom_days_exercises else None
        if picked or not allowed_tags:
            exercises = [e for e in day.get("exercises", []) if e in VALID_EXERCISES]
        else:
            exercises = [
                e for e in day.get("exercises", [])
                if e in VALID_EXERCISES and EXERCISE_LOCATIONS.get(e) in allowed_tags
            ]
        if label and top_up_short_days and not picked and len(exercises) < min_exercises:
            exercises = _top_up_exercises(exercises, label, location, min_exercises, max_exercises)
        if not label or len(exercises) < min_exercises:
            raise ValueError("invalid day entry")
        # If the user hand-picked exercises for this exact day label, the
        # AI was told to copy them verbatim -- anything else means it
        # didn't follow that instruction and this whole response can't be
        # trusted (triggers the deterministic fallback instead, which
        # honors the user's picks directly).
        if picked:
            if exercises != picked:
                raise ValueError("AI did not preserve user-picked exercises")
            cleaned_days.append({"label": label, "exercises": exercises})
        else:
            cleaned_days.append({"label": label, "exercises": exercises[:max_exercises]})

    valid_labels = {d["label"] for d in cleaned_days} | {"Rest"}
    schedule = parsed.get("schedule")
    if not isinstance(schedule, dict) or set(schedule.keys()) != set(WEEKDAY_ORDER):
        raise ValueError("invalid schedule shape")
    cleaned_schedule = {}
    for weekday in WEEKDAY_ORDER:
        value = str(schedule.get(weekday, "Rest")).strip()
        cleaned_schedule[weekday] = value if value in valid_labels else "Rest"

    # Reject (and let the caller fall back) if the AI ignored the recovery
    # principle it was given — this is the split_analyzer heuristic applied
    # at generation time instead of after the fact.
    if longest_training_streak(cleaned_schedule) > max(MAX_ACCEPTABLE_STREAK, days_per_week):
        raise ValueError("schedule violates recovery cadence")

    rationale = str(parsed.get("rationale", "")).strip() or _default_rationale(days_per_week)

    return {"days": cleaned_days, "schedule": cleaned_schedule, "rationale": rationale}


def _build_prompt(split_type, days_per_week, custom_days, goal=None, custom_days_exercises=None, location=None):
    split_desc = {
        "ppl": "a Push/Pull/Legs (PPL) split",
        "upper_lower": "an Upper/Lower split",
        "full_body": "a Full Body split (every session trains the whole body)",
        "bro_split": "a bro split (one muscle group per day: Chest, Back, Legs, Shoulders, Arms)",
        "custom": f"a custom split with these day names: {', '.join(custom_days or [])}",
    }.get(split_type, "a general strength split")

    picked_instruction = ""
    if custom_days_exercises:
        # The user hand-picked their own exercises for these day(s) from
        # the app's categorized exercise picker -- your job for those
        # specific days is scheduling and rationale only, not exercise
        # selection.
        picked_instruction = (
            "\nThe user has already hand-picked their own exercises for these specific day(s) using the "
            f"app's exercise picker: {json.dumps(custom_days_exercises)}\n"
            "For any day whose label appears in that mapping, copy its \"exercises\" list into your "
            "output EXACTLY as given (same exercises, same order, do not add, remove, or substitute "
            "any) -- your only job for those days is choosing where they land in the weekly schedule. "
            "For any other day (not in that mapping), choose exercises yourself as normal.\n"
        )

    goal = (goal or "").strip()
    goal_instruction = ""
    if goal:
        # Free text, typed by the user themselves -- treat it as a steer on
        # day-type selection and exercise choice, not as something to trust
        # blindly for exercise names (those still get filtered against
        # WORKOUT_EXERCISES / VALID_EXERCISES down in _validate_plan). The
        # allowed exercise list below now includes dedicated Athletic /
        # Speed & Agility, Functional / Real-World Strength, Balance &
        # Stability, Prenatal / Low-Impact, and Mobility & Flexibility
        # pools alongside the usual muscle-group ones, specifically so
        # goals outside plain hypertrophy/strength have real exercises to
        # draw from instead of being ignored or crammed into a lifting day.
        goal_instruction = (
            f'\nThe user also typed in their own words what they\'re personally trying to achieve: '
            f'"{goal}"\n'
            "Blend this into the split rather than ignoring it or overriding the split type/day count "
            "they picked: keep the same total number of training days, but let some of those days' "
            "labels and exercise selection shift to actually address the stated goal. Examples of how "
            "to interpret different goals:\n"
            "- Mobility/flexibility alongside building muscle -> dedicate a day (or days) to a "
            "\"Mobility\" focus using stretching/mobility-drill exercises, on its own day rather than "
            "squeezed onto the end of a lifting day — e.g. Tuesday: Mobility, Wednesday: Push.\n"
            "- Wanting to move faster / be more explosive for a specific sport -> dedicate a day to an "
            "\"Athletic\" or sport-specific-sounding focus using sprint, jump, agility-ladder, and "
            "medicine-ball throw exercises.\n"
            "- Pregnancy (mentions being pregnant/expecting/prenatal) -> this changes the WHOLE plan, "
            "not just one day: use only low-impact, joint-friendly exercises (the Prenatal/Low-Impact "
            "pool and light Mobility work) across all days, skip anything high-impact, maximal-effort, "
            "or that involves lying flat on the back for long periods, and lower the exercises-per-day "
            "count if that reads as more appropriate than a packed session.\n"
            "- Everyday/real-world strength goals (e.g. wanting to be able to lift and carry a family "
            "member, or general \"functional strength\") -> dedicate a day to a \"Functional\" focus "
            "using carrying, ground-to-standing, and loaded-carry exercises rather than machine "
            "isolation work.\n"
            "- Balance, fall-risk, or general stability concerns -> dedicate a day (or work exercises "
            "in) using the Balance & Stability pool.\n"
            "Only introduce a day type the goal actually calls for; don't invent extra focuses the user "
            "didn't ask for.\n"
        )

    # Restricts the exercise list the AI is even allowed to choose from,
    # rather than generating freely and filtering after the fact -- keeps
    # the prompt and _validate_plan's location check (which independently
    # re-checks every non-picked exercise) in agreement about what's
    # actually allowed.
    location_instruction = ""
    if location in ("home", "gym"):
        allowed_exercises = _filter_by_location(WORKOUT_EXERCISES, location)
        if custom_days_exercises:
            # picked_instruction above tells the AI to copy these exact
            # names verbatim regardless of location -- they must stay in
            # the "only use names from this list" list too, or the two
            # instructions contradict each other.
            picked_names = {name for names in custom_days_exercises.values() for name in names}
            allowed_exercises = allowed_exercises + [n for n in picked_names if n not in allowed_exercises]
        location_instruction = (
            f"\nThe user said they usually train at {'home' if location == 'home' else 'the gym'}. "
            f"Only choose exercises doable there — see the restricted exercise list below.\n"
        )
    elif location == "hybrid":
        allowed_exercises = WORKOUT_EXERCISES
        location_instruction = (
            "\nThe user said they train hybrid-style (a mix of gym and home, including HYROX-style "
            "strength-and-endurance/conditioning work). Feel free to draw from both gym and home "
            "exercises, and make sure at least one day leans on strength-and-endurance conditioning "
            "work (loaded carries, kettlebell/dumbbell complexes, sled work, wall balls, machine "
            "intervals) rather than only pure muscle-isolation lifting.\n"
        )
    else:
        allowed_exercises = WORKOUT_EXERCISES

    return (
        f"You are a strength coach designing {split_desc}, adjusted to exactly {days_per_week} "
        "training day(s) per week, optimized for muscle growth, strength, and recovery."
        f"{picked_instruction}{goal_instruction}{location_instruction}\n"
        "Cycle through the split's day types as needed to fill that many days "
        "(e.g. a 3-day-type split done 5 days/week repeats types like Day1, Day2, Day3, Day1, Day2).\n\n"
        "You MUST only use exercise names from this exact list (copy them verbatim, do not invent, "
        f"rename, or modify any): {json.dumps(allowed_exercises)}\n\n"
        "Pick 6-8 well-rounded exercises per day from that list, appropriate for that day's focus.\n\n"
        "Then place the training days onto an actual weekly schedule (Monday through Sunday). "
        "Apply this recovery principle: as a rule of thumb, plan roughly one rest day for every "
        "two consecutive training days, to support recovery and long-term growth — though back-to-"
        "back days are more acceptable when they hit different muscle groups (e.g. Push then Legs) "
        "than when they repeat the same one (e.g. Push then Push). At higher frequencies "
        f"({days_per_week} days/week) some consecutive training days are unavoidable; rotate muscle "
        "groups across those days to manage it.\n\n"
        "Respond with ONLY raw JSON (no markdown fences, no commentary) matching exactly this shape:\n"
        '{"days": [{"label": "Push", "exercises": ["Flat Bench Press", "Overhead Press", "..."]}], '
        '"schedule": {"monday": "Push", "tuesday": "Rest", "wednesday": "Pull", "thursday": "Rest", '
        '"friday": "Legs", "saturday": "Rest", "sunday": "Rest"}, '
        '"rationale": "one or two sentences explaining why this weekly placement supports recovery '
        'and growth"}\n'
        f'The "days" array must have exactly {days_per_week} entries. The "schedule" object must have '
        'all seven lowercase weekday keys, each set to one of the day labels used in "days" or "Rest", '
        f'with exactly {days_per_week} non-Rest entries.'
    )


# ---------- AI-suggested split (the wizard's "Let AI build it" path) ----------
# The user never picks a split type here: they answer how many days they can
# train and what they're going for, and the AI picks the split type *for*
# them. Everyone coming through this path is treated as a complete beginner
# (see _build_suggest_prompt), so the plans stay simple and learnable rather
# than assuming gym experience the user may not have.

# Deliberately lighter sessions than the type-picked path's 6-8: a complete
# beginner finishing their workout is a session they'll actually repeat,
# where an 8-exercise session is where beginners start skipping days.
#
# These are the outer bounds across ALL frequencies -- the actual per-day
# window SHRINKS as days_per_week rises (see _beginner_exercise_range).
# A flat 4-6 regardless of frequency was the bug: a raw beginner training
# 6 days/week at 6 exercises/day is >30 exercises across the week, which
# reads fine as one number but is not a program anyone new to training
# finishes for more than a few days. Real coaching scales session length
# DOWN as frequency goes UP so weekly effort stays roughly constant instead
# of multiplying -- more, shorter sessions, not more of the same session.
BEGINNER_MIN_EXERCISES = 3
BEGINNER_MAX_EXERCISES = 6

# (min, max) exercises per day at each weekly frequency. Full-body sessions
# at low frequency can afford to be fuller (5-6) since one session has to
# cover the whole body and a missed day costs more. Split-style sessions at
# higher frequency only need to cover ONE region (Push, or Legs, or half
# the body), so a shorter, focused session (down to 3 at 6-7 days/week) is
# both more accurate to what that day trains and more realistic for a
# beginner to actually complete every day of the week.
_BEGINNER_EXERCISE_RANGE_BY_DAYS = {
    1: (5, 6),
    2: (5, 6),
    3: (4, 6),
    4: (4, 5),
    5: (4, 5),
    6: (3, 4),
    7: (3, 4),
}


def _beginner_exercise_range(days_per_week):
    return _BEGINNER_EXERCISE_RANGE_BY_DAYS[days_per_week]

# What a complete beginner should run at each weekly frequency when the AI
# is unavailable or returns something unusable. Full body at low frequency
# (every session hits everything, so a missed day costs less), upper/lower
# at 4, and PPL only once there are enough days for each muscle group to
# come around often enough to be worth splitting out.
BEGINNER_SPLIT_BY_DAYS = {
    1: "full_body",
    2: "full_body",
    3: "full_body",
    4: "upper_lower",
    5: "ppl",
    6: "ppl",
    7: "ppl",
}

SUGGESTIBLE_SPLIT_TYPES = ("ppl", "upper_lower", "full_body", "bro_split")

# Forces Gemini to emit JSON matching this shape instead of asking for JSON
# in the prompt and hoping. Measured necessary, not precautionary: asking in
# the prompt alone, roughly 1 in 8 responses came back with a stray closing
# brace after the "days" array ('...]}]}, "schedule":'), which json.loads
# rejects outright -- and since every failure here falls back to the
# deterministic plan, that silently robbed ~12% of users of the AI
# suggestion this whole path exists to provide. With the schema attached,
# 6/6 sample responses parsed. _validate_plan still re-checks everything:
# the schema constrains the SHAPE, not whether the exercise names are real.
SUGGEST_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "split_type": {"type": "string", "enum": list(SUGGESTIBLE_SPLIT_TYPES)},
        "days": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "exercises": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["label", "exercises"],
            },
        },
        "schedule": {
            "type": "object",
            "properties": {day: {"type": "string"} for day in WEEKDAY_ORDER},
            "required": list(WEEKDAY_ORDER),
        },
        "rationale": {"type": "string"},
    },
    "required": ["split_type", "days", "schedule", "rationale"],
}


def _fit_plan_exercise_counts(plan, location, min_exercises, max_exercises):
    """Hold the deterministic fallback to the same per-day exercise window
    the AI path is held to. Both ends matter: DAY_TYPE_POOLS entries run up
    to 8 deep (longer than a beginner session should be), while a location
    filter can thin one down to 2 -- e.g. only 2 of Push's 7 entries are
    doable at home, which would otherwise ship a 2-exercise "Push" day."""
    for day in plan["days"]:
        day["exercises"] = _top_up_exercises(
            day["exercises"], day["label"], location, min_exercises, max_exercises
        )
    return plan


def _beginner_fallback(split_type, days_per_week, goal, location):
    min_exercises, max_exercises = _beginner_exercise_range(days_per_week)
    plan = build_fallback_plan(split_type, days_per_week, None, goal, None, location)
    plan = _fit_plan_exercise_counts(plan, location, min_exercises, max_exercises)
    plan["split_type"] = split_type
    return plan


def _describe_lifter(gender, goal_weight_kg, current_weight_kg):
    """The 'who this plan is for' lines of the suggest prompt. Every field is
    optional -- the coaching profile these come from is filled in separately
    from the split wizard, so a user can reach this having never opened it."""
    bits = []
    if gender in ("male", "female"):
        bits.append(f"- Gender: {gender}")
    if current_weight_kg:
        bits.append(f"- Current weight: {current_weight_kg} kg")
    if goal_weight_kg:
        bits.append(f"- Goal weight: {goal_weight_kg} kg")
        if current_weight_kg:
            try:
                delta = float(goal_weight_kg) - float(current_weight_kg)
                if delta < -0.5:
                    bits.append(f"- They are trying to LOSE about {abs(delta):.1f} kg")
                elif delta > 0.5:
                    bits.append(f"- They are trying to GAIN about {delta:.1f} kg")
                else:
                    bits.append("- They are trying to MAINTAIN their current weight")
            except (TypeError, ValueError):
                pass
    return "\n".join(bits)


def _build_suggest_prompt(days_per_week, goal, gender, goal_weight_kg, current_weight_kg, location):
    min_exercises, max_exercises = _beginner_exercise_range(days_per_week)
    lifter = _describe_lifter(gender, goal_weight_kg, current_weight_kg)
    lifter_block = f"\nAbout this person:\n{lifter}\n" if lifter else ""

    goal = (goal or "").strip()
    goal_block = ""
    if goal:
        # Free text the user typed themselves. Same rule as the type-picked
        # path: it steers day-type and exercise selection, but any exercise
        # NAME it happens to contain still gets filtered against
        # VALID_EXERCISES in _validate_plan rather than trusted from here.
        goal_block = (
            f'\nIn their own words, what they want out of training: "{goal}"\n'
            "Let this steer which split you choose and which exercises you pick. If the goal calls for "
            "work outside plain muscle-building (mobility/flexibility, speed and agility for a sport, "
            "real-world carrying strength, balance, pregnancy-safe low-impact training, or "
            "strength-and-endurance conditioning), give it a dedicated day rather than tacking it onto "
            "the end of a lifting day.\n"
        )

    if location in ("home", "gym"):
        allowed_exercises = _filter_by_location(WORKOUT_EXERCISES, location)
        location_block = (
            f"\nThey train at {'home' if location == 'home' else 'the gym'}, so only choose exercises "
            "doable there — the list below is already restricted to those.\n"
        )
    elif location == "hybrid":
        allowed_exercises = WORKOUT_EXERCISES
        location_block = (
            "\nThey train hybrid-style (a mix of gym and home, including HYROX-style "
            "strength-and-endurance work), so both gym and home exercises are fair game.\n"
        )
    else:
        allowed_exercises = WORKOUT_EXERCISES
        location_block = ""

    return (
        "You are a strength coach building a weekly training split for a COMPLETE BEGINNER — someone "
        "who has essentially never trained before and does not know any exercises yet. Choose the "
        "split type FOR them; they have not picked one and would not know which to pick.\n"
        f"{lifter_block}"
        f"- They can train exactly {days_per_week} day(s) per week.\n"
        f"{goal_block}{location_block}\n"
        "Because they are a complete beginner:\n"
        "- Favor simple, foundational, low-skill-ceiling movements over advanced or highly technical "
        "lifts. Machines, dumbbells, and bodyweight beat barbell max-effort work here.\n"
        "- Prefer a split where each session is easy to understand and hard to get wrong.\n"
        "- At low weekly frequency, full-body sessions usually beat body-part splits, because every "
        "session still trains everything and a missed day costs less.\n"
        "- Do NOT overload the session. A beginner who finishes their workout comes back; one who is "
        "buried in volume quits. This matters MORE the more days they train: at higher weekly "
        "frequency, each individual session must be shorter and more focused so the WEEKLY total stays "
        "sustainable, not the same full session repeated on every training day. Never design a plan "
        "where the exercise count per day is the same regardless of how often they train.\n\n"
        f'Choose exactly one split type from this list: {json.dumps(list(SUGGESTIBLE_SPLIT_TYPES))}\n'
        '("ppl" = Push/Pull/Legs, "upper_lower" = Upper/Lower, "full_body" = every session trains the '
        'whole body, "bro_split" = one muscle group per day.)\n\n'
        "You MUST only use exercise names from this exact list (copy them verbatim, do not invent, "
        f"rename, or modify any): {json.dumps(allowed_exercises)}\n\n"
        f"Give each day exactly {max_exercises} exercises from that list (never more than "
        f"{max_exercises}, and never fewer than {min_exercises} -- {days_per_week} day(s)/week gets "
        f"SHORTER sessions than a lower frequency would, on purpose, so the week as a whole stays "
        f"realistic for someone brand new to training). Aim for {max_exercises} rather than the "
        "minimum — any name that isn't copied exactly from the list gets discarded, so a day built at "
        "the minimum can end up short.\n\n"
        "Then place the training days onto an actual weekly schedule (Monday through Sunday). Apply "
        "this recovery principle: roughly one rest day for every two consecutive training days. "
        "Back-to-back days are more acceptable when they hit different muscle groups (e.g. Push then "
        f"Legs) than the same one. At {days_per_week} day(s)/week, rotate muscle groups across any "
        "consecutive days.\n\n"
        "Respond with ONLY raw JSON (no markdown fences, no commentary) matching exactly this shape:\n"
        '{"split_type": "full_body", '
        '"days": [{"label": "Full Body", "exercises": ["Goblet Squat", "Dumbbell Bench Press", "..."]}], '
        '"schedule": {"monday": "Full Body", "tuesday": "Rest", "wednesday": "Full Body", '
        '"thursday": "Rest", "friday": "Full Body", "saturday": "Rest", "sunday": "Rest"}, '
        '"rationale": "one or two sentences, addressed to the beginner, explaining why you chose this '
        'split and this weekly placement"}\n'
        f'The "days" array must have exactly {days_per_week} entries. The "schedule" object must have '
        'all seven lowercase weekday keys, each set to one of the day labels used in "days" or "Rest", '
        f'with exactly {days_per_week} non-Rest entries.'
    )


def suggest_split_plan(days_per_week, goal=None, gender=None, goal_weight_kg=None,
                       current_weight_kg=None, location=None):
    """Builds a split for someone who did NOT pick a split type -- the AI
    chooses the split type as well as the exercises and the weekly placement,
    treating the user as a complete beginner.

    Returns the same shape as generate_split_plan() plus "split_type" (which
    split the AI actually chose, so the UI can tell the user what they got
    and the saved plan records it like any other split).
    """
    days_per_week = max(1, min(7, int(days_per_week)))
    location = location if location in LOCATION_ALLOWED else None
    fallback_type = BEGINNER_SPLIT_BY_DAYS[days_per_week]

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return _beginner_fallback(fallback_type, days_per_week, goal, location)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        prompt = _build_suggest_prompt(
            days_per_week, goal, gender, goal_weight_kg, current_weight_kg, location
        )
        response = client.models.generate_content(
            model=SUGGEST_GEMINI_MODEL,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=SUGGEST_RESPONSE_SCHEMA,
            ),
        )
        parsed = _extract_json(response.text)
        min_exercises, max_exercises = _beginner_exercise_range(days_per_week)
        plan = _validate_plan(
            parsed, days_per_week, None, location,
            min_exercises=min_exercises,
            max_exercises=max_exercises,
            top_up_short_days=True,
        )
        # The AI picking a split type outside the list it was given is the
        # same class of mistake as hallucinating an exercise name -- fall
        # back to the frequency-appropriate beginner default rather than
        # recording a split type the rest of the app doesn't know about.
        suggested = str(parsed.get("split_type", "")).strip().lower()
        plan["split_type"] = suggested if suggested in SUGGESTIBLE_SPLIT_TYPES else fallback_type
        return plan
    except Exception:
        return _beginner_fallback(fallback_type, days_per_week, goal, location)


def generate_split_plan(split_type, days_per_week, custom_days=None, goal=None, custom_days_exercises=None, location=None):
    days_per_week = max(1, min(7, int(days_per_week)))
    # "home" / "gym" / "hybrid" from the wizard's "Where do you usually
    # train?" question -- anything else (unset, unrecognized) is treated
    # as no preference, same as before this question existed.
    location = location if location in LOCATION_ALLOWED else None

    # A custom split is already entirely the user's own design -- their
    # own day names, and any exercises they hand-picked (the rest just
    # get a sensible keyword-guessed pool, same as the AI would guess).
    # There's nothing left for the AI to meaningfully "figure out" beyond
    # what build_fallback_plan already computes deterministically
    # (weekly placement via the same recovery heuristic, plus a
    # rationale), so skip the Gemini round-trip entirely for this split
    # type rather than spending an API call analyzing a plan that's
    # already fully specified.
    if split_type == "custom":
        return build_fallback_plan(split_type, days_per_week, custom_days, goal, custom_days_exercises, location)

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return build_fallback_plan(split_type, days_per_week, custom_days, goal, custom_days_exercises, location)

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        prompt = _build_prompt(split_type, days_per_week, custom_days, goal, custom_days_exercises, location)
        response = client.models.generate_content(model=GEMINI_MODEL, contents=[prompt])
        parsed = _extract_json(response.text)
        return _validate_plan(parsed, days_per_week, custom_days_exercises, location)
    except Exception:
        return build_fallback_plan(split_type, days_per_week, custom_days, goal, custom_days_exercises, location)
