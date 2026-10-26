"""Exports the food and exercise libraries to the native app as JSON, so the app ships the same ~740 foods and ~735 exercises the
website serves (app.py LIBRARY_ASSETS). Generated, never hand-edited: the Python modules stay the source of truth until the website
is retired.

    python scripts/export_libraries.py            # rewrite mobile/src/data/foods.json and exercises.json
    python scripts/export_libraries.py --check    # exit 1 if they are out of date (tests/test_mobile_libraries.py does the same)

No network and no database: it only imports food_library, workout_library and the exercise_details and exercise_videos modules.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

OUT = ROOT / "mobile" / "src" / "data"


def foods():
    """[{name, calories, carbs, fat, protein, ingredients?}]: per 100 g (or 100 mL); a dish also lists its recipe."""
    from food_library import FOOD_LIBRARY
    return [dict(food) for food in FOOD_LIBRARY]


def exercises():
    """One record per exercise, in the website's order, plus the category order."""
    from exercise_details import EXERCISE_DETAILS
    from exercise_videos import EXERCISE_VIDEOS
    from workout_library import (BODYWEIGHT_EXERCISES, EXERCISE_CATEGORIES, EXERCISE_LOCATIONS, UNILATERAL_EXERCISES, WORKOUT_EXERCISES)

    category_of = {}
    for category, names in EXERCISE_CATEGORIES.items():
        for name in names:
            category_of.setdefault(name, category)
    records = []
    for name in WORKOUT_EXERCISES:
        detail = EXERCISE_DETAILS.get(name) or {}
        record = {
            "name": name,
            "category": category_of[name],
            "location": EXERCISE_LOCATIONS.get(name, "both"),
            "unilateral": name in UNILATERAL_EXERCISES,
            "bodyweight": name in BODYWEIGHT_EXERCISES,
        }
        if detail.get("emoji"):
            record["emoji"] = detail["emoji"]
        if detail.get("description"):
            record["steps"] = list(detail["description"])
        if name in EXERCISE_VIDEOS:
            record["video"] = EXERCISE_VIDEOS[name]
        records.append(record)
    return {"categories": list(EXERCISE_CATEGORIES), "exercises": records}


def render(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"


def expected():
    return {OUT / "foods.json": render(foods()), OUT / "exercises.json": render(exercises())}


def main(argv):
    files = expected()
    if "--check" in argv:
        stale = [p.name for p, text in files.items() if not p.exists() or p.read_text(encoding="utf-8").replace("\r\n", "\n") != text]
        if stale:
            print(f"out of date: {', '.join(stale)} (run: python scripts/export_libraries.py)", file=sys.stderr)
            return 1
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for path, text in files.items():
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(ROOT)} ({len(text) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
