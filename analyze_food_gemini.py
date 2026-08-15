"""AI-powered food photo analysis: identify what's in a single photo and
break it down into its raw ingredients, each with standard per-100g
nutrition values plus an estimated portion size.

Separate from analyze_form_gemini.py (workout video form analysis) and
split_planner.py/split_analyzer.py (workout splits) — this module is a
single-image nutrition estimator, wired into the Nutrition page's camera/
upload flow rather than the Analyze page's video pipeline.

Ingredients are returned as per-100g values (not per-portion totals) so
they slot directly into the same {baseCalories, baseCarbs, baseFat,
baseProtein, grams} shape every other logged food/ingredient already
uses on the Nutrition page — the total macros shown to the user are
computed here by summing each ingredient's own (grams / 100) * per-100g
contribution, exactly like food_library.py's composite dishes.
"""

import json
import os
import re

from dotenv import load_dotenv

load_dotenv()

GEMINI_MODEL = "gemini-3.1-flash-lite"

MAX_INGREDIENTS = 12

SYSTEM_PROMPT = (
    "You are a nutrition estimation assistant inside a fitness app. You will be "
    "shown a single photo of a plate of food, a packaged item, or a food container.\n\n"
    "Step 1 — Identify the specific dish, not just a generic description. If it's "
    "a recognizable dish (e.g. \"Pad Kra Pao Moo Krob\", \"Chicken Tikka Masala\", "
    "\"Pad Thai\"), name it specifically rather than describing it vaguely (e.g. not "
    "just \"stir fry\" or \"noodles\").\n\n"
    "Step 2 — List EVERY ingredient that standard recipe actually uses, not just "
    "what's visually distinguishable on the plate. For a specific, recognizable "
    "dish, use your knowledge of how it's actually cooked: include the cooking "
    "oil, aromatics (garlic, chilies, shallots), sauces and condiments (fish "
    "sauce, soy sauce, oyster sauce, curry paste, etc.), sugar, and seasoning "
    "that go into it even though they're fully absorbed into the dish and not "
    "separately visible — a bowl of Pad Kra Pao is never just \"rice, pork, "
    "basil\"; it also has garlic, Thai chilies, fish sauce, oyster sauce, soy "
    "sauce, sugar, and the oil it was fried in, and those should all be listed "
    "too. Only fall back to listing just the visibly separable components if "
    "the dish is too generic/unclear to identify specifically (e.g. an "
    "unfamiliar mixed plate) — don't invent ingredients for a dish you can't "
    "actually identify.\n\n"
    f"List at most {MAX_INGREDIENTS} ingredients (merge minor seasonings only if "
    "you'd otherwise exceed that), and for each one estimate:\n"
    "- name: a short ingredient name (2-3 words), e.g. \"Grilled Chicken Breast\", "
    "\"Fish Sauce\", \"Thai Chilies\" — not a full sentence.\n"
    "- grams: your best estimate of how many grams of that ingredient are actually "
    "in the portion shown — small for a splash of sauce or a clove of garlic (a "
    "few grams), larger for the main components. Never use 0.\n"
    "- calories, protein, fat, carbs: standard nutrition database values PER 100g "
    "of that ingredient (not for the portion shown) — the typical values anyone "
    "would look up for that food.\n\n"
    "Also give the overall dish a short name (2-5 words, like a restaurant menu "
    "item, e.g. \"Pad Kra Pao Moo Krob\" — never a full descriptive sentence).\n\n"
    "Respond with ONLY raw JSON (no markdown fences, no commentary) matching "
    "exactly this shape:\n"
    '{"food_name": "Pad Kra Pao Moo Krob", "confidence": "medium", '
    '"note": "Estimated from a standard rice-plate portion, including typical '
    'stir-fry oil, sauces, and seasoning for this dish.", '
    '"ingredients": [{"name": "Crispy Pork Belly", "grams": 120, "calories": 397, '
    '"protein": 9, "fat": 39, "carbs": 0}, '
    '{"name": "White Rice", "grams": 200, '
    '"calories": 130, "protein": 2.7, "fat": 0.3, "carbs": 28}, '
    '{"name": "Thai '
    'Basil", "grams": 10, "calories": 22, "protein": 3.2, "fat": 0.6, "carbs": '
    '2.6}, {"name": "Garlic", "grams": 8, "calories": 149, "protein": 6.4, '
    '"fat": 0.5, "carbs": 33}, '
    '{"name": "Thai Chilies", "grams": 5, "calories": '
    '40, "protein": 1.9, "fat": 0.4, "carbs": 9}, '
    '{"name": "Fish Sauce", '
    '"grams": 10, "calories": 35, "protein": 5, "fat": 0, "carbs": 3.6}, '
    '{"name": "Oyster Sauce", "grams": 8, "calories": 51, "protein": 1.4, '
    '"fat": 0.3, "carbs": 11}, '
    '{"name": "Soy Sauce", "grams": 5, "calories": 8, '
    '"protein": 1.3, "fat": 0, "carbs": 0.8}, '
    '{"name": "Sugar", "grams": 5, '
    '"calories": 387, "protein": 0, "fat": 0, "carbs": 100}, {"name": "Cooking '
    'Oil", "grams": 10, "calories": 884, "protein": 0, "fat": 100, "carbs": 0}]}\n\n'
    "confidence is exactly \"low\", \"medium\", or \"high\", based on how clearly you "
    "could identify the food and judge portion sizes — identifying the dish "
    "correctly doesn't require lowering confidence just because some ingredients "
    "aren't visible; that's expected. note is one short sentence explaining the "
    "estimate — keep it plain and brief. If the photo doesn't show food at all, "
    "set food_name to \"Unknown\" and ingredients to an empty list."
)


class FoodAnalysisError(Exception):
    """Raised when the photo can't be turned into a usable nutrition estimate."""


def _extract_json(text):
    text = text.strip()
    match = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def _num(source, key):
    try:
        return max(0.0, float(source.get(key, 0) or 0))
    except (TypeError, ValueError):
        return 0.0


def _shorten_name(name, max_len=40):
    name = re.sub(r"\s+", " ", name).strip()
    if len(name) <= max_len:
        return name
    return name[: max_len - 1].rsplit(" ", 1)[0] + "…"


def _validate(parsed):
    food_name = _shorten_name(str(parsed.get("food_name", "")).strip() or "Unknown food")

    confidence = str(parsed.get("confidence", "medium")).strip().lower()
    if confidence not in {"low", "medium", "high"}:
        confidence = "medium"

    raw_ingredients = parsed.get("ingredients")
    ingredients = []
    if isinstance(raw_ingredients, list):
        for item in raw_ingredients[:MAX_INGREDIENTS]:
            if not isinstance(item, dict):
                continue
            name = _shorten_name(str(item.get("name", "")).strip(), max_len=30)
            grams = _num(item, "grams")
            if not name or grams <= 0:
                continue
            ingredients.append({
                "name": name,
                "grams": round(grams),
                "calories": round(_num(item, "calories")),
                "protein": round(_num(item, "protein"), 1),
                "fat": round(_num(item, "fat"), 1),
                "carbs": round(_num(item, "carbs"), 1),
            })

    totals = {"calories": 0.0, "protein": 0.0, "fat": 0.0, "carbs": 0.0}
    for ing in ingredients:
        scale = ing["grams"] / 100
        totals["calories"] += ing["calories"] * scale
        totals["protein"] += ing["protein"] * scale
        totals["fat"] += ing["fat"] * scale
        totals["carbs"] += ing["carbs"] * scale

    return {
        "food_name": food_name,
        "confidence": confidence,
        "note": str(parsed.get("note", "")).strip(),
        "ingredients": ingredients,
        "calories": round(totals["calories"]),
        "protein": round(totals["protein"], 1),
        "fat": round(totals["fat"], 1),
        "carbs": round(totals["carbs"], 1),
    }


def analyze_food_photo(image_bytes, mime_type="image/jpeg", note=None):
    """Returns a dict: food_name, confidence, note, ingredients (list of
    {name, grams, calories, protein, fat, carbs} where the macros are
    per-100g), plus calories/protein/fat/carbs summed totals for display.

    `note` is optional free text the user typed after picking the photo
    but before it was sent here (see nutrition.html's renderAfNotePrompt())
    -- a correction or detail the photo alone can't convey, e.g. an actual
    weighed amount or a swapped/omitted ingredient. Told to Gemini as an
    instruction to defer to over its own visual guess, not just contextual
    flavor text, since a visual portion/ingredient estimate is often the
    least accurate part of this whole flow.

    Raises FoodAnalysisError if the photo can't be analyzed (missing API
    key, Gemini error, or an unparseable response) — callers should catch
    this and show the user a friendly retry message rather than letting it
    propagate as a 500.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise FoodAnalysisError("GEMINI_API_KEY environment variable is not set.")

    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:
        raise FoodAnalysisError("google-genai package not installed.") from exc

    try:
        client = genai.Client(api_key=api_key)
        contents = [
            SYSTEM_PROMPT,
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        ]
        note = str(note or "").strip()
        if note:
            contents.append(
                "The user who took this photo added the following note about it -- "
                "treat it as more reliable than your own visual read and use it to "
                "correct or refine your estimate (e.g. an actual amount in grams, an "
                "ingredient that's missing/extra/swapped, how it was cooked): "
                f'"{note}"'
            )
        response = client.models.generate_content(model=GEMINI_MODEL, contents=contents)
        parsed = _extract_json(response.text)
        return _validate(parsed)
    except FoodAnalysisError:
        raise
    except Exception as exc:
        raise FoodAnalysisError(f"Couldn't analyze that photo: {exc}") from exc
