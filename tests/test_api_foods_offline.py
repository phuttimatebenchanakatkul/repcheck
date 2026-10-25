"""The food slice's pure parts: text and number cleaning, the saved-food JSON shapes (compared with the website's), the
translation of the website modules' errors, and constants shared with the website. No network, no database."""

import ast
import re
from pathlib import Path

import pytest

import app as website
import barcode_scanner
from api import ai, foods

NAN, INF = float("nan"), float("inf")


# -- text -----------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,limit,expected", [
    ("  Oats  ", 60, "Oats"), (None, 60, ""), ("", 60, ""), ("a" * 100, 60, "a" * 60), ("  a" + "b" * 100, 10, "a" + "b" * 9),
    ("a\x00b", 60, "ab"), ("line\nbreak\ttab", 60, "linebreaktab"), ("bell\x07x\x7fy", 60, "bellxy"),
    (12345, 60, "12345"), ([1], 60, "[1]"), ("\U0001F37D️", 8, "\U0001F37D️"), ("  \n  ", 60, ""),
])
def test_text_is_stripped_of_control_characters_trimmed_and_clipped(raw, limit, expected):
    assert foods.clean_text(raw, limit) == expected


@pytest.mark.parametrize("raw", ["0123456789", "  0123-456 78 ", "ab12cd", "", None, 5901234123457, "٠١٢", "12٣", "١٢٣"])
def test_a_barcode_keeps_only_ascii_digits_like_the_websites(raw):
    ours = foods.digits_only(raw)
    assert ours == "".join(c for c in str(raw or "") if c in "0123456789")
    if raw is not None and str(raw).isascii():
        assert ours == barcode_scanner.digits_only(str(raw))


# -- numbers --------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    (12.5, 12.5), (0, 0.0), (-3, 0.0), ("7", 7.0), ("x", 0.0), (None, 0.0), ([], 0.0), (NAN, 0.0), (INF, 0.0), (-INF, 0.0),
    (1e308, foods.MAX_MACRO_GRAMS), (5000, 5000.0), (5000.01, 5000.0), (True, 1.0), ("1e999", 0.0),
])
def test_a_macro_is_a_finite_non_negative_bounded_number_and_anything_else_is_zero(raw, expected):
    assert foods._macro(raw) == expected


@pytest.mark.parametrize("raw,default,expected", [
    (45, 100.0, 45.0), ("250.5", 100.0, 250.5), (0, 100.0, 100.0), (-5, 100.0, 100.0), (None, 100.0, 100.0), ("x", 100.0, 100.0),
    (NAN, 100.0, 100.0), (INF, 100.0, 100.0), (foods.MAX_SERVING_GRAMS, 100.0, foods.MAX_SERVING_GRAMS),
    (foods.MAX_SERVING_GRAMS + 1, 100.0, 100.0), (30, 0, 30.0), (0, 0, 0), ("x", 0, 0),
])
def test_serving_grams_must_be_positive_finite_and_bounded_else_the_default(raw, default, expected):
    assert foods._grams(raw, default) == expected


# -- shapes are the website's -----------------------------------------------------------------------------------------------

ROW = {"id": 7, "name": "Protein Bar", "emoji": "x", "calories": 210.0, "protein": 20.0, "fat": 7.0, "carbs": 22.0,
       "barcode": "5901234123457", "serving_label": "1 bar", "serving_grams": 45.0}
EXTRA = [{"label": "1 box", "grams": 270.0}, {"label": "half", "grams": 22.5}]


def test_a_saved_food_has_the_websites_json_shape():
    assert foods.food_json(ROW, EXTRA) == website._custom_food_to_json(dict(ROW, servings=EXTRA))
    assert foods.food_json(dict(ROW, barcode=None), []) == website._custom_food_to_json(dict(ROW, barcode=None, servings=[]))


def test_a_scan_that_matches_a_saved_food_has_the_websites_result_shape():
    ours = foods.food_as_scan_result(foods.food_json(ROW, EXTRA))
    assert ours == website._custom_food_to_scan_result(dict(ROW, servings=EXTRA))
    assert ours["servings"][0] == {"label": "1 bar", "grams": 45.0} and ours["servings"][1:] == EXTRA
    assert ours["ingredients"][0]["grams"] == 45.0 and ours["confidence"] == "custom"


def test_the_limits_and_defaults_are_the_websites():
    assert foods.FOOD_LIMIT == website.PER_USER_LIMITS["custom_foods"] and foods.EXERCISE_LIMIT == website.PER_USER_LIMITS["custom_exercises"]
    source = Path(website.__file__).read_text(encoding="utf-8")
    default = re.search(r'emoji = emoji or "(.*?)"', source).group(1)
    assert foods.DEFAULT_FOOD_EMOJI == ast.literal_eval('"' + default + '"')       # the source spells part of it as an escape
    assert foods.over_limit_message(500) == "You've reached the maximum of 500 saved items here. Delete some to add more."
    assert foods.EXERCISE_MODES == ("both", "each", "either")
    for literal in ('[:60]', "[:8]", "[:40]", "[:20]", "[:300]"):
        assert literal in source


def test_the_allowed_photo_types_are_the_websites():
    from api.routes import foods as route
    assert route.ALLOWED_IMAGE_MIME_TYPES == website.ALLOWED_IMAGE_MIME_TYPES


# -- the website modules' errors are translated -----------------------------------------------------------------------------

def test_a_food_photo_failure_becomes_analysis_failed(monkeypatch):
    import analyze_food_gemini as mod

    def boom(*a, **k):
        raise mod.FoodAnalysisError("the model was unreachable")
    monkeypatch.setattr(mod, "analyze_food_photo", boom)
    with pytest.raises(ai.AnalysisFailed, match="the model was unreachable"):
        ai._analyze_food(b"x", "image/jpeg", None)
    monkeypatch.setattr(mod, "analyze_food_photo", lambda image_bytes, mime_type, note: {"food_name": "Rice", "m": mime_type, "n": note})
    assert ai._analyze_food(b"x", "image/png", "no sauce") == {"food_name": "Rice", "m": "image/png", "n": "no sauce"}


def test_a_barcode_that_is_not_in_any_database_is_product_not_found_not_a_lookup_failure(monkeypatch):
    monkeypatch.setattr(barcode_scanner, "lookup_by_barcode", lambda b: (_ for _ in ()).throw(barcode_scanner.ProductNotFoundError("nothing for that")))
    with pytest.raises(ai.ProductNotFound, match="nothing for that"):
        ai._lookup_barcode("123")
    monkeypatch.setattr(barcode_scanner, "lookup_by_barcode", lambda b: (_ for _ in ()).throw(barcode_scanner.BarcodeScanError("service down")))
    with pytest.raises(ai.LookupFailed, match="service down") as exc:
        ai._lookup_barcode("123")
    assert not isinstance(exc.value, ai.ProductNotFound)
    monkeypatch.setattr(barcode_scanner, "lookup_by_barcode", lambda b: {"food_name": b})
    assert ai._lookup_barcode("123") == {"food_name": "123"}


def test_decode_and_search_failures_become_lookup_failed_and_search_asks_for_twelve(monkeypatch):
    monkeypatch.setattr(barcode_scanner, "decode_barcode", lambda b: (_ for _ in ()).throw(barcode_scanner.BarcodeScanError("no barcode in frame")))
    with pytest.raises(ai.LookupFailed, match="no barcode in frame"):
        ai._decode_barcode(b"x")
    seen = {}

    def search(query, limit):
        seen.update(query=query, limit=limit)
        return [{"name": "x"}]
    monkeypatch.setattr(barcode_scanner, "search_open_food_facts", search)
    assert ai._search_foods("oat milk") == [{"name": "x"}] and seen == {"query": "oat milk", "limit": 12}
    monkeypatch.setattr(barcode_scanner, "search_open_food_facts", lambda q, limit: (_ for _ in ()).throw(barcode_scanner.BarcodeScanError("off down")))
    with pytest.raises(ai.LookupFailed, match="off down"):
        ai._search_foods("x")
