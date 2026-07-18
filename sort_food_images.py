"""Sorts loose food/ingredient photos dropped into incoming_images/ into
static/food_images/<slug>.<ext>, matched against every name in
food_library.FOOD_LIBRARY (both raw ingredients and dishes).

Usage:
    1. Drop image files into incoming_images/ (create it next to this
       script if it doesn't exist yet). Filenames don't need to be exact —
       "chicken breast.jpg", "chicken_breast.jpg", and "Chicken-Breast.JPG"
       all match the food "Chicken Breast, cooked".
    2. Run: python sort_food_images.py
    3. Matched files are moved into static/food_images/, renamed to a safe
       slug of the official food name (e.g. beef_stew_meat_cooked.jpg).
       Anything the script can't confidently match is left in place and
       reported so it can be renamed and re-run.

app.py calls build_food_image_map() on every /nutrition request to build a
food name -> image URL lookup from whatever is currently in
static/food_images/, so newly sorted images show up without a restart.
"""

import difflib
import re
import shutil
from pathlib import Path

from food_library import FOOD_LIBRARY

INCOMING_DIR = Path(__file__).parent / "incoming_images"
IMAGES_DIR = Path(__file__).parent / "static" / "food_images"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# How similar an incoming filename must be to a food name (after slugifying
# both) to auto-match without an exact hit. Tuned to catch small typos/
# formatting differences without pairing up unrelated foods.
FUZZY_MATCH_CUTOFF = 0.72


def slugify(name):
    """Lowercase, filesystem/URL-safe version of a name: letters/digits
    only, everything else collapsed to a single underscore."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "_", slug)
    return slug.strip("_")


def strip_leading_index(stem):
    """Icon packs are commonly numbered, e.g. "001-al-pastor-pork-cooked" —
    drop that counter before matching so it doesn't get compared as if it
    were part of the food name."""
    return re.sub(r"^\d+[-_\s]+", "", stem)


def build_slug_lookup():
    """slug -> canonical food name, for every entry in FOOD_LIBRARY."""
    return {slugify(item["name"]): item["name"] for item in FOOD_LIBRARY}


def find_best_match(file_slug, slug_lookup):
    """Returns (food_name, matched_slug) or (None, None)."""
    if file_slug in slug_lookup:
        return slug_lookup[file_slug], file_slug

    candidates = difflib.get_close_matches(file_slug, slug_lookup.keys(), n=1, cutoff=FUZZY_MATCH_CUTOFF)
    if candidates:
        return slug_lookup[candidates[0]], candidates[0]
    return None, None


def sort_images():
    INCOMING_DIR.mkdir(exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    slug_lookup = build_slug_lookup()

    matched = []
    unmatched = []

    for file_path in sorted(INCOMING_DIR.iterdir()):
        if not file_path.is_file() or file_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        file_slug = slugify(strip_leading_index(file_path.stem))
        food_name, matched_slug = find_best_match(file_slug, slug_lookup)

        if not food_name:
            unmatched.append(file_path.name)
            continue

        dest_path = IMAGES_DIR / f"{matched_slug}{file_path.suffix.lower()}"
        shutil.move(str(file_path), str(dest_path))
        matched.append((file_path.name, food_name, dest_path.name))

    return matched, unmatched


def build_food_image_map():
    """name -> "/static/food_images/<slug>.<ext>" for every food that
    currently has a matching image file sitting in static/food_images/."""
    if not IMAGES_DIR.exists():
        return {}

    existing = {p.stem: p.name for p in IMAGES_DIR.iterdir() if p.is_file()}
    image_map = {}
    for item in FOOD_LIBRARY:
        slug = slugify(item["name"])
        if slug in existing:
            image_map[item["name"]] = f"/static/food_images/{existing[slug]}"
    return image_map


def main():
    matched, unmatched = sort_images()

    print(f"Sorted {len(matched)} image(s) into {IMAGES_DIR}:")
    for original, food_name, new_name in matched:
        print(f"  {original} -> {new_name}  ({food_name})")

    if unmatched:
        print(f"\n{len(unmatched)} file(s) couldn't be matched to a food name and were left in {INCOMING_DIR}:")
        for name in unmatched:
            print(f"  {name}")
        print("\nRename them to match the food more closely (e.g. 'chicken_breast.jpg') and run this again.")

    image_map = build_food_image_map()
    print(f"\n{len(image_map)} / {len(FOOD_LIBRARY)} foods now have an image.")


if __name__ == "__main__":
    main()
