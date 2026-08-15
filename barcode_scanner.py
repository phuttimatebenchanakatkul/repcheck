"""Barcode-based nutrition lookup: decode a product barcode from a photo
with pyzbar, then look up that product's nutrition facts via the Open
Food Facts API, falling back to FatSecret (see fatsecret_lookup.py) for
Thai/regional products Open Food Facts doesn't have -- it's crowd-sourced
and much sparser outside western markets.

Separate from analyze_food_gemini.py (AI photo estimation of a plate of
food) — this is for packaged products with a real barcode, where exact
label nutrition is available instead of a visual estimate. Returns the
SAME result shape as analyze_food_gemini.analyze_food_photo() (food_name,
confidence, note, ingredients, calories/protein/fat/carbs totals) so the
web app's existing "scan a photo -> review -> add to log" UI can handle
both without any special-casing.

Usage:
    python barcode_scanner.py <image_path>

Requires:
    pip install pyzbar pillow requests
"""

import io
import re

import requests
from PIL import Image
from pyzbar.pyzbar import decode as zbar_decode

import fatsecret_lookup

OPEN_FOOD_FACTS_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
# The legacy cgi/search.pl and /api/v2/search endpoints were returning 503s
# as of this writing -- Open Food Facts' search now lives on this separate
# "search-a-licious" service instead.
OPEN_FOOD_FACTS_SEARCH_URL = "https://search.openfoodfacts.org/search"
REQUEST_TIMEOUT_SECONDS = 8


class BarcodeScanError(Exception):
    """Raised for any failure the web app should show to the user —
    no barcode found in the photo, or no matching product on Open Food
    Facts."""


class ProductNotFoundError(BarcodeScanError):
    """A barcode was read fine, but no source (Open Food Facts or
    FatSecret) has a product for it -- as opposed to a decode failure or a
    network/API error. app.py's scan/lookup routes catch this specifically
    to offer "create this as a custom food" instead of a generic retry."""


def _shorten_name(name, max_len=40):
    name = re.sub(r"\s+", " ", name).strip()
    if len(name) <= max_len:
        return name
    return name[: max_len - 1].rsplit(" ", 1)[0] + "…"


def _num(source, key):
    try:
        value = source.get(key)
        return max(0.0, float(value)) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def decode_barcode(image_bytes):
    """Return the first barcode string found in the photo, or raise
    BarcodeScanError if none is detected."""
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except Exception as exc:
        raise BarcodeScanError("Couldn't read that image.") from exc

    results = zbar_decode(image)
    if not results:
        raise BarcodeScanError(
            "No barcode found in that photo. Try getting closer, holding "
            "the camera steady, and making sure the barcode isn't blurry."
        )
    # Prefer standard retail barcode formats (product packaging) over other
    # symbologies (e.g. QR codes) the same photo might incidentally contain.
    preferred_types = {"EAN13", "EAN8", "UPCA", "UPCE"}
    preferred = [r for r in results if r.type in preferred_types]
    chosen = preferred[0] if preferred else results[0]
    return chosen.data.decode("utf-8").strip()


def _parse_serving_grams(product):
    """Open Food Facts' serving_size is a free-text field like "30 g",
    "1 bar (45g)", "355 ml", or "12 fl oz" -- pull a gram-equivalent
    amount out of it if present, otherwise fall back to a single 100g
    reference serving. Getting this wrong silently produces a badly-off
    logged total even when the underlying per-100g data is correct (e.g.
    a 355ml can defaulting to a 100g serving would under-report a full
    can's calories by more than half), so ml/oz are converted too, not
    just g."""
    serving_size = product.get("serving_size") or ""

    match = re.search(r"([\d.]+)\s*g\b", serving_size, flags=re.IGNORECASE)
    if match:
        grams = _positive_float(match.group(1))
        if grams:
            return round(grams)

    # "fl oz" (volume) before plain "oz" (weight) -- "12 fl oz" must not
    # be caught by the weight-ounce pattern first.
    match = re.search(r"([\d.]+)\s*fl\.?\s*oz\b", serving_size, flags=re.IGNORECASE)
    if match:
        fl_oz = _positive_float(match.group(1))
        if fl_oz:
            return round(fl_oz * 29.5735)  # ~1g per ml for typical (mostly-water) drinks

    match = re.search(r"([\d.]+)\s*ml\b", serving_size, flags=re.IGNORECASE)
    if match:
        ml = _positive_float(match.group(1))
        if ml:
            return round(ml)  # same ~1g-per-ml approximation

    match = re.search(r"([\d.]+)\s*oz\b", serving_size, flags=re.IGNORECASE)
    if match:
        oz = _positive_float(match.group(1))
        if oz:
            return round(oz * 28.3495)

    return 100


def _positive_float(raw):
    try:
        value = float(raw)
        return value if value > 0 else None
    except ValueError:
        return None


def _lookup_product(barcode):
    try:
        response = requests.get(
            OPEN_FOOD_FACTS_URL.format(barcode=barcode),
            params={
                "fields": (
                    "product_name,brands,serving_size,"
                    "nutriments"
                )
            },
            headers={"User-Agent": "RepCheck-App/1.0 (nutrition barcode lookup)"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        raise BarcodeScanError("Couldn't reach the product database. Please try again.") from exc
    except ValueError as exc:
        raise BarcodeScanError("Got an unexpected response looking up that product.") from exc

    if data.get("status") != 1 or not data.get("product"):
        raise ProductNotFoundError(
            f"No product found for barcode {barcode}. It may not be in the "
            "Open Food Facts database yet."
        )
    return data["product"]


def _brand_name(product):
    """The classic single-product API returns "brands" as a comma-string
    ("Ferrero, Nutella"); the newer search API returns it as a list
    (["Ferrero", "Nutella"]) -- handle either."""
    brands = product.get("brands")
    if isinstance(brands, list):
        return str(brands[0]).strip() if brands else ""
    return str(brands or "").strip().split(",")[0].strip()


KJ_PER_KCAL = 4.184
# Physically impossible/implausible per-100g bounds -- a real product can
# never report more than 100g of a macro per 100g of itself, and even
# pure fat/oil tops out around 884 kcal/100g, so anything past this is a
# corrupted entry (a common Open Food Facts data-quality problem, being
# crowd-sourced), not a real product worth showing the user as fact.
MAX_PLAUSIBLE_MACRO_G = 100
MAX_PLAUSIBLE_KCAL = 900


def _sanitize_per_100g(per_100g, food_name, source):
    """Catches the two most common Open Food Facts data-entry problems
    instead of quietly handing the user a wrong number: a calorie value
    that's actually in kJ (not kcal -- OFF stores both, and the two get
    mixed up on entry more often than you'd hope), and flatly impossible
    values (e.g. "1043"g of protein per 100g, a typo for "10.43"). The kJ
    mix-up is corrected in place since it's specific and mechanically
    verifiable against the macros; anything past the plausible bounds is
    rejected outright rather than guessed at."""
    macro_kcal = per_100g["protein"] * 4 + per_100g["fat"] * 9 + per_100g["carbs"] * 4
    reported = per_100g["calories"]
    if macro_kcal > 0 and reported > macro_kcal * 3:
        corrected = reported / KJ_PER_KCAL
        if abs(corrected - macro_kcal) <= max(macro_kcal * 0.25, 20):
            per_100g["calories"] = corrected

    for key in ("protein", "fat", "carbs"):
        if per_100g[key] > MAX_PLAUSIBLE_MACRO_G:
            raise BarcodeScanError(
                f"The nutrition data for \"{food_name}\" on {source} looks incorrect "
                "(an implausible amount per 100g) -- try searching for it manually instead."
            )
    if per_100g["calories"] > MAX_PLAUSIBLE_KCAL:
        raise BarcodeScanError(
            f"The nutrition data for \"{food_name}\" on {source} looks incorrect "
            "(an implausible calorie count) -- try searching for it manually instead."
        )
    return per_100g


def _validate(barcode, product, source="Open Food Facts"):
    name = str(product.get("product_name") or "").strip()
    brand = _brand_name(product)
    if name and brand and brand.lower() not in name.lower():
        food_name = _shorten_name(f"{brand} {name}")
    else:
        food_name = _shorten_name(name or brand or f"Product {barcode}")

    nutriments = product.get("nutriments") or {}
    # Per-100g values, same convention as analyze_food_gemini.py's
    # ingredients, so this can slot into the exact same {ingredients: [...]}
    # shape the web app already knows how to render and log.
    per_100g = {
        "calories": _num(nutriments, "energy-kcal_100g"),
        "protein": _num(nutriments, "proteins_100g"),
        "fat": _num(nutriments, "fat_100g"),
        "carbs": _num(nutriments, "carbohydrates_100g"),
        # Open Food Facts reports sodium in grams; the app shows it in mg
        # (the standard unit on nutrition labels).
        "sodium_mg": _num(nutriments, "sodium_100g") * 1000,
        "sugar_g": _num(nutriments, "sugars_100g"),
    }
    if not any([per_100g["calories"], per_100g["protein"], per_100g["fat"], per_100g["carbs"]]):
        # Treated the same as a total miss (ProductNotFoundError, not the
        # base BarcodeScanError) -- the product exists on {source} but
        # there's nothing usable to show, so the app's redirect into
        # "create this food yourself" applies here too.
        raise ProductNotFoundError(
            f"Found \"{food_name}\" but it has no nutrition data on {source}."
        )
    per_100g = _sanitize_per_100g(per_100g, food_name, source)

    grams = _parse_serving_grams(product)
    scale = grams / 100
    totals = {k: round(v * scale, 1) for k, v in per_100g.items()}
    totals["calories"] = round(totals["calories"])
    totals["sodium_mg"] = round(totals["sodium_mg"])

    return {
        "food_name": food_name,
        "confidence": "high",  # exact barcode match, not a visual estimate
        "note": f"Nutrition from the product label ({source}), for a {grams}g serving.",
        "ingredients": [{
            "name": food_name,
            "grams": grams,
            "calories": round(per_100g["calories"]),
            "protein": round(per_100g["protein"], 1),
            "fat": round(per_100g["fat"], 1),
            "carbs": round(per_100g["carbs"], 1),
            "sodium_mg": round(per_100g["sodium_mg"]),
            "sugar_g": round(per_100g["sugar_g"], 1),
        }],
        "calories": totals["calories"],
        "protein": totals["protein"],
        "fat": totals["fat"],
        "carbs": totals["carbs"],
        "sodium_mg": totals["sodium_mg"],
        "sugar_g": totals["sugar_g"],
    }


def scan_and_lookup(image_bytes):
    """Decode a barcode from a photo and look up its nutrition facts.

    Returns the same dict shape as analyze_food_gemini.analyze_food_photo():
    food_name, confidence, note, ingredients (list of one item here, per-100g
    macros), plus calories/protein/fat/carbs totals for the matched serving.

    Raises BarcodeScanError on failure (no barcode found, no matching
    product, or a network/API problem) -- callers should catch this and
    show the user a friendly retry message.
    """
    barcode = decode_barcode(image_bytes)
    return lookup_by_barcode(barcode)


def lookup_by_barcode(barcode):
    """Same as scan_and_lookup(), but skips the photo/pyzbar step -- for
    browsers that can decode the barcode client-side in real time (the
    BarcodeDetector API) and just need the nutrition lookup for a barcode
    they've already read. Keeps pyzbar as the fallback path for browsers
    without BarcodeDetector (photo upload -> scan_and_lookup()).

    Tries Open Food Facts first (unlimited, no account needed); if that
    has no match, falls back to FatSecret (see fatsecret_lookup.py) --
    silently a no-op if FATSECRET_CLIENT_ID/SECRET aren't configured, so
    this behaves exactly as before until those are set up."""
    barcode = str(barcode).strip()
    if not barcode:
        raise BarcodeScanError("No barcode value given.")
    try:
        product = _lookup_product(barcode)
        return _validate(barcode, product)
    except BarcodeScanError as off_error:
        fatsecret_product = fatsecret_lookup.find_product_by_barcode(barcode)
        if fatsecret_product is None:
            raise off_error
        return _validate(barcode, fatsecret_product, source="FatSecret")


def search_open_food_facts(query, limit=15):
    """Search Open Food Facts by name/keywords (not a barcode) -- lets the
    web app's food-log search reach the same huge product database the
    barcode scanner uses, for anything with a name match instead of
    requiring the physical package in hand.

    Returns a list of results in the exact same shape as a single
    lookup_by_barcode() result, so the app's existing "review -> adjust
    amount -> add to log" screen can handle a search result exactly like
    a scanned one. Products with no usable nutrition data are silently
    skipped rather than failing the whole search. Returns [] for an empty
    query or if nothing on Open Food Facts matched -- neither is an
    error. Raises BarcodeScanError only for a genuine network/API failure.
    """
    query = (query or "").strip()
    if not query:
        return []

    try:
        response = requests.get(
            OPEN_FOOD_FACTS_SEARCH_URL,
            params={
                "q": query,
                "page_size": limit,
                "fields": "code,product_name,brands,serving_size,nutriments",
            },
            headers={"User-Agent": "RepCheck-App/1.0 (nutrition food search)"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        raise BarcodeScanError("Couldn't reach the product database. Please try again.") from exc
    except ValueError as exc:
        raise BarcodeScanError("Got an unexpected response searching for that food.") from exc

    results = []
    seen_names = set()
    for product in data.get("hits", []):
        barcode = str(product.get("code") or "")
        try:
            validated = _validate(barcode, product)
        except BarcodeScanError:
            continue  # no usable nutrition data on this one -- skip, don't fail the whole search
        # Open Food Facts is crowd-sourced, so the same product is often
        # duplicated under several barcodes with near-identical data (e.g.
        # searching "nutella" can turn up half a dozen "Nutella" entries)
        # -- keep just the first (best-ranked) one per name so results
        # read as distinct choices, not noise.
        dedupe_key = validated["food_name"].strip().lower()
        if dedupe_key in seen_names:
            continue
        seen_names.add(dedupe_key)
        results.append(validated)
        if len(results) >= limit:
            break
    return results


def main():
    import sys

    if len(sys.argv) < 2:
        sys.exit("Usage: python barcode_scanner.py <image_path>")
    with open(sys.argv[1], "rb") as f:
        image_bytes = f.read()
    result = scan_and_lookup(image_bytes)
    print(f"{result['food_name']} — {result['calories']} kcal, "
          f"P {result['protein']}g / F {result['fat']}g / C {result['carbs']}g")
    print(result["note"])


if __name__ == "__main__":
    main()
