"""Guards the removal of sugar/sodium tracking from food logging.

Sugar and sodium used to flow through every food-logging path (manual
food-library entries, barcode scans via Open Food Facts and its FatSecret
fallback, and Gemini AI photo scans) as `sugar_g`/`sodium_mg` fields,
rendered in a "Other nutrients" section on the scan-result donut chart
(micronutrientsHtml() in templates/nutrition.html). None of it was ever
persisted to the database -- it lived only in transient scan-result JSON
-- so removing it end-to-end meant touching five source files rather than
running a DB migration.

These tests pin two things that fail silently if someone partially
reverts the removal:

Round-trip correctness. Even if a source (Open Food Facts, FatSecret,
Gemini) still hands sodium/sugar data to the app, none of it should
survive into the app's own output shape -- the parsing/validation
functions must actively drop it, not just happen to not use it today.

No orphaned rendering path. The "Other nutrients" UI section
(micronutrientsHtml(), its CSS classes, and its two call sites) must be
gone entirely, not just fed undefined values (which would already hide
it, but leaves a dead function and dead CSS a future change could
accidentally wire back up).
"""

import re

import pytest

from app import app as flask_app
from analyze_food_gemini import _validate as gemini_validate
from barcode_scanner import _validate as barcode_validate
from food_library import FOOD_LIBRARY


# ---------- round-trip: sugar/sodium fed in, never comes out ----------


def test_gemini_response_parsing_drops_sodium_and_sugar_even_if_present():
    """Simulates Gemini still returning sodium_mg/sugar_g per ingredient
    (e.g. if a stale prompt/model version keeps estimating it) -- the
    app's own parsing must not carry it through regardless."""
    parsed = {
        "food_name": "Test Dish",
        "confidence": "high",
        "note": "test",
        "ingredients": [
            {"name": "Fish Sauce", "grams": 10, "calories": 35, "protein": 5, "fat": 0, "carbs": 3.6, "sodium_mg": 7850, "sugar_g": 0},
        ],
    }
    result = gemini_validate(parsed)
    assert "sodium_mg" not in result
    assert "sugar_g" not in result
    assert "sodium_mg" not in result["ingredients"][0]
    assert "sugar_g" not in result["ingredients"][0]
    # Sanity: the fields that ARE supposed to survive still do.
    assert result["ingredients"][0]["calories"] == 35


def test_barcode_lookup_drops_sodium_and_sugar_even_if_open_food_facts_has_it():
    """Simulates a real Open Food Facts product payload that still reports
    sodium_100g/sugars_100g -- the app's own barcode validation must not
    carry it through into the result the UI/log receives."""
    product = {
        "product_name": "Test Product",
        "brands": "Test Brand",
        "nutriments": {
            "energy-kcal_100g": 250,
            "proteins_100g": 10,
            "fat_100g": 8,
            "carbohydrates_100g": 30,
            "sodium_100g": 1.2,  # would be 1200mg if it survived
            "sugars_100g": 15,
        },
    }
    result = barcode_validate("0000000000000", product)
    assert "sodium_mg" not in result
    assert "sugar_g" not in result
    assert "sodium_mg" not in result["ingredients"][0]
    assert "sugar_g" not in result["ingredients"][0]
    # Sanity: the fields that ARE supposed to survive still do.
    assert result["calories"] > 0


def test_food_library_has_no_sugar_or_sodium_keys_anywhere():
    """Every raw ingredient and every derived composite dish -- the whole
    744-item library -- must be free of these keys, not just a sample."""
    offending = [item["name"] for item in FOOD_LIBRARY if "sodium_mg" in item or "sugar_g" in item]
    assert not offending, f"still carrying sodium_mg/sugar_g: {offending[:10]}"


def test_micronutrient_data_module_no_longer_exists():
    with pytest.raises(ModuleNotFoundError):
        import micronutrient_data  # noqa: F401


# ---------- no orphaned rendering path ----------


@pytest.fixture(scope="module")
def nutrition_html():
    with flask_app.test_request_context():
        from flask import render_template

        try:
            return render_template(
                "nutrition.html",
                food_library=FOOD_LIBRARY,
                nutrition_goals={},
                weight_unit="lbs",
            )
        except Exception:
            with open("templates/nutrition.html", encoding="utf-8") as f:
                return f.read()


def test_micronutrients_render_function_is_gone(nutrition_html):
    assert "micronutrientsHtml" not in nutrition_html


def test_micronutrient_css_classes_are_gone(nutrition_html):
    for cls in ("mn-micro-section", "mn-micro-title", "mn-micro-row", "mn-micro-label", "mn-micro-value"):
        assert cls not in nutrition_html, f"dead CSS class still present: {cls}"


def test_sodium_and_sugar_fields_are_gone_from_the_template(nutrition_html):
    """The field names, not the English word -- "Sugar, white" as an
    ingredient name and the emoji-icon heuristic that checks a food name
    for the substring "sugar" are legitimate and untouched by this
    removal, so this checks the specific field identifiers, not a blanket
    absence of the word."""
    assert not re.search(r"sugar_g|sugarG", nutrition_html)
    assert not re.search(r"sodium_mg|sodiumMg", nutrition_html)


def test_donut_chart_render_no_longer_appends_micronutrients(nutrition_html):
    """Both call sites (manual log-quantity donut and scan-result donut)
    used to concatenate `+ micronutrientsHtml(...)` onto donutChartHtml's
    output -- confirms neither one still does, rather than relying only
    on the function being undefined (which would just throw)."""
    assert "donutChartHtml(m.protein, m.fat, m.carbs, m.calories);" in nutrition_html
    assert "donutChartHtml(totals.protein, totals.fat, totals.carbs, totals.calories);" in nutrition_html
