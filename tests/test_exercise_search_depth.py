"""The exercise picker on the analyze page (and the workout logger's, which
shares the library) is a substring search over WORKOUT_EXERCISES, so the
number of suggestions a lifter sees for a movement is simply how many names
contain that word. These guard the depth added in exercise_variations.py --
if someone prunes the catalog, a common search silently drops back to two or
three results and the app starts looking like it doesn't know the exercise.
"""

import pytest

from exercise_details import EXERCISE_DETAILS
from exercise_variations import VARIATION_EXERCISES
from exercise_variations import BODYWEIGHT_VARIATIONS
from workout_library import (
    BODYWEIGHT_EXERCISES,
    EXERCISE_CATEGORIES,
    EXERCISE_LOCATIONS,
    UNILATERAL_EXERCISES,
    WORKOUT_EXERCISES,
)

# Movements common enough that a search for them should fill the sheet.
WELL_STOCKED = [
    "squat", "bench", "curl", "row", "press", "raise", "deadlift", "lunge",
    "pulldown", "pull-up", "dip", "calf", "shrug", "crunch", "extension",
    "plank", "fly", "push-up", "upright", "jump", "chest",
]

# Narrower movements: fewer real named variants exist, but a search still
# has to come back with a usable list rather than a single row.
MODEST = [
    "chin-up", "hip thrust", "glute", "leg press", "step-up", "skull",
    "kickback", "pullover", "leg raise", "sit-up", "twist", "face pull",
    "hamstring", "shoulder", "carry", "swing", "bridge",
]


def _matches(query):
    return [name for name in WORKOUT_EXERCISES if query in name.lower()]


@pytest.mark.parametrize("query", WELL_STOCKED)
def test_common_movements_return_a_full_sheet(query):
    assert len(_matches(query)) >= 15, f"only {len(_matches(query))} results for {query!r}"


@pytest.mark.parametrize("query", MODEST)
def test_narrower_movements_still_return_several(query):
    assert len(_matches(query)) >= 7, f"only {len(_matches(query))} results for {query!r}"


def test_variations_merge_cleanly_into_the_library():
    names = [entry["name"] for entry in VARIATION_EXERCISES]
    assert len(names) == len(set(names)), "duplicate names inside exercise_variations.py"
    assert len(WORKOUT_EXERCISES) == len(set(WORKOUT_EXERCISES)), (
        "a variation name collides with an existing library entry"
    )
    for name in names:
        assert name in WORKOUT_EXERCISES
        # Every library name needs a location tag and a how-to, or it falls
        # out of the home/gym filter and shows a generic description.
        assert name in EXERCISE_LOCATIONS
        assert EXERCISE_DETAILS[name]["description"]
        assert EXERCISE_DETAILS[name]["emoji"]


def test_variations_only_use_existing_categories():
    for entry in VARIATION_EXERCISES:
        assert entry["category"] in EXERCISE_CATEGORIES


def test_bodyweight_variations_match_their_siblings():
    """A variation of a bodyweight movement has to log the same way its
    sibling does -- reps only, no weight field -- or the same exercise
    behaves two different ways depending on which name you picked."""
    assert BODYWEIGHT_VARIATIONS <= BODYWEIGHT_EXERCISES
    for name in BODYWEIGHT_VARIATIONS:
        assert name in WORKOUT_EXERCISES, f"{name!r} is not a real exercise"
    # Assisted and weighted variants carry a load value, so they must stay
    # out -- that is the line the pre-existing catalog already draws.
    for name in ("Band-Assisted Chin-Up", "Assisted Chin-Up (Machine)",
                 "Weighted Ring Dip", "Weighted Sit-Up", "Weighted Hanging Leg Raise"):
        assert name in WORKOUT_EXERCISES
        assert name not in BODYWEIGHT_EXERCISES


def test_unilateral_flag_reaches_the_log_ui():
    """The per-side weight/reps toggle in the workout log keys off
    UNILATERAL_EXERCISES, so a variation flagged unilateral in the catalog has
    to actually land in that set -- and a both-sides one must stay out of it."""
    flagged = {e["name"] for e in VARIATION_EXERCISES if e["unilateral"]}
    both_sides = {e["name"] for e in VARIATION_EXERCISES if not e["unilateral"]}
    assert flagged, "no unilateral variations to check -- the fixture went stale"
    assert flagged <= UNILATERAL_EXERCISES
    assert not (both_sides & UNILATERAL_EXERCISES)
