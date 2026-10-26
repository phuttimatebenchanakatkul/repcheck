"""The food and exercise libraries the native app ships (mobile/src/data/*.json) are generated from the website's Python modules.
These tests fail when they drift, and check the integrity the app relies on."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "mobile" / "src" / "data"


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def test_the_shipped_libraries_are_what_the_exporter_produces_now():
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "export_libraries.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_the_food_library_is_the_websites_in_the_websites_order():
    from food_library import FOOD_LIBRARY
    foods = load("foods.json")
    assert [f["name"] for f in foods] == [f["name"] for f in FOOD_LIBRARY] and len(foods) > 700


def test_food_names_are_unique_except_the_one_known_duplicate_because_the_app_finds_a_food_by_name():
    """Macarons is in the website's library twice (a raw entry and a dish) with the same macros; the first one wins in the website
    (`find`) and in the app. Any other duplicate would silently hide a food, so a new one fails here."""
    foods = load("foods.json")
    names = [f["name"] for f in foods]
    duplicates = sorted({n for n in names if names.count(n) > 1})
    assert duplicates == ["Macarons"]
    twins = [f for f in foods if f["name"] == "Macarons"]
    assert len({(f["calories"], f["carbs"], f["fat"], f["protein"]) for f in twins}) == 1


def test_every_food_has_finite_non_negative_macros():
    for food in load("foods.json"):
        for key in ("calories", "carbs", "fat", "protein"):
            assert isinstance(food[key], (int, float)) and 0 <= food[key] < 1000, (food["name"], key)


def test_every_ingredient_of_every_dish_is_itself_a_food_so_a_logged_dish_never_has_a_zero_ingredient():
    foods = load("foods.json")
    names = {f["name"] for f in foods}
    dishes = [f for f in foods if f.get("ingredients")]
    assert len(dishes) > 300
    for dish in dishes:
        for ingredient in dish["ingredients"]:
            assert ingredient["name"] in names, (dish["name"], ingredient["name"])
            assert ingredient["grams"] > 0


def test_a_dishs_own_macros_are_its_ingredients_summed_per_100_g():
    foods = load("foods.json")
    by_name = {f["name"]: f for f in foods}
    for dish in (f for f in foods if f.get("ingredients")):
        total = sum(i["grams"] for i in dish["ingredients"])
        calories = sum(by_name[i["name"]]["calories"] * i["grams"] for i in dish["ingredients"]) / total
        assert abs(calories - dish["calories"]) <= 1.0, dish["name"]


def test_the_exercise_library_is_the_websites():
    from workout_library import BODYWEIGHT_EXERCISES, EXERCISE_CATEGORIES, UNILATERAL_EXERCISES, WORKOUT_EXERCISES
    library = load("exercises.json")
    assert [e["name"] for e in library["exercises"]] == list(WORKOUT_EXERCISES)
    assert library["categories"] == list(EXERCISE_CATEGORIES)
    assert {e["name"] for e in library["exercises"] if e["unilateral"]} == set(UNILATERAL_EXERCISES)
    assert {e["name"] for e in library["exercises"] if e["bodyweight"]} == set(BODYWEIGHT_EXERCISES)


def test_every_exercise_has_a_known_category_and_location():
    library = load("exercises.json")
    for exercise in library["exercises"]:
        assert exercise["category"] in library["categories"], exercise["name"]
        assert exercise["location"] in ("gym", "home", "both"), exercise["name"]
    assert len({e["name"] for e in library["exercises"]}) == len(library["exercises"])
