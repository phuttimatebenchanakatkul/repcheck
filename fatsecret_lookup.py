"""FatSecret Platform API lookup -- a fallback barcode source for
barcode_scanner.py, specifically for Thai (and other non-US) products that
Open Food Facts doesn't have. Open Food Facts is crowd-sourced and much
richer for western retail brands than Thai ones; FatSecret is a commercial
database with real regional/UPC coverage, but requires your own API
credentials (see the .env keys below) -- this whole module is a silent
no-op if they aren't set, so barcode_scanner.py's existing behavior is
unchanged until you configure them.

Setup:
    1. Create a free developer account at https://platform.fatsecret.com
       (Basic tier is instant, but its product data is US-only; getting
       real Thai coverage needs "Premier" access, which FatSecret grants
       free to small startups/students/nonprofits -- apply for it from
       your account's "Upgrade" page after signing up. Basic's US data
       still works fine in the meantime, it just won't help with Thai
       barcodes specifically.)
    2. Put the Client ID/Secret it gives you in .env:
        FATSECRET_CLIENT_ID=...
        FATSECRET_CLIENT_SECRET=...
    3. Optionally set FATSECRET_REGION (defaults to "TH") to change which
       country's product data/pricing this looks up.

Converts FatSecret's response into the same shape barcode_scanner.py
already parses from Open Food Facts (product_name/brands/serving_size/
nutriments), so _validate() there handles either source identically
without needing to know which one answered.
"""

import os
import time

import requests

REQUEST_TIMEOUT_SECONDS = 8
TOKEN_URL = "https://oauth.fatsecret.com/connect/token"
BARCODE_URL = "https://platform.fatsecret.com/rest/food/barcode/find-by-id/v1"
FOOD_URL = "https://platform.fatsecret.com/rest/food/v4"

# Cached in-process; the token is valid ~24h (FatSecret returns the exact
# lifetime in expires_in) so there's no need to fetch a fresh one per
# request -- just per server run, refreshed a minute before it'd expire.
_token_cache = {"token": None, "expires_at": 0}


def _credentials():
    client_id = os.environ.get("FATSECRET_CLIENT_ID", "").strip()
    client_secret = os.environ.get("FATSECRET_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        return None
    return client_id, client_secret


def _get_access_token():
    creds = _credentials()
    if not creds:
        return None

    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    client_id, client_secret = creds
    try:
        response = requests.post(
            TOKEN_URL,
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials", "scope": "basic barcode"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
        token = data["access_token"]
    except (requests.RequestException, ValueError, KeyError):
        return None

    _token_cache["token"] = token
    _token_cache["expires_at"] = now + float(data.get("expires_in") or 86400)
    return token


def _region():
    return os.environ.get("FATSECRET_REGION", "TH").strip() or "TH"


def _find_food_id(barcode, token):
    # FatSecret wants a GTIN-13: a 13-digit string, zero-padded on the
    # left. UPC-A/EAN-13/EAN-8 (everything decode_barcode() prefers) all
    # fit this by simple left-padding.
    gtin13 = barcode.zfill(13)
    response = requests.get(
        BARCODE_URL,
        params={"barcode": gtin13, "region": _region(), "format": "json"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()
    # "0" is FatSecret's documented sentinel for "no match", not a real id.
    food_id = str((data.get("food_id") or {}).get("value") or "0")
    return food_id if food_id != "0" else None


def _get_food(food_id, token):
    response = requests.get(
        FOOD_URL,
        params={"food_id": food_id, "region": _region(), "format": "json"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return (response.json() or {}).get("food")


def _num(source, key):
    try:
        value = source.get(key)
        return max(0.0, float(value)) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _to_open_food_facts_shape(food):
    """Reshape a FatSecret food.get.v4 result into the same product dict
    barcode_scanner.py's _validate() already knows how to read from Open
    Food Facts, normalized to per-100g nutriments like OFF provides."""
    servings = (food.get("servings") or {}).get("serving") or []
    if isinstance(servings, dict):  # a single serving isn't wrapped in a list
        servings = [servings]
    if not servings:
        return None

    # Prefer a serving given in grams (a real weight, not "1 bar"/"1 cup")
    # so the per-100g scaling below is meaningful.
    metric = [s for s in servings if str(s.get("metric_serving_unit", "")).lower() == "g"]
    serving = metric[0] if metric else servings[0]

    grams = _num(serving, "metric_serving_amount") or 100
    scale = 100 / grams

    return {
        "product_name": str(food.get("food_name") or "").strip(),
        "brands": str(food.get("brand_name") or "").strip(),
        "serving_size": f"{round(grams)} g",
        "nutriments": {
            "energy-kcal_100g": _num(serving, "calories") * scale,
            "proteins_100g": _num(serving, "protein") * scale,
            "fat_100g": _num(serving, "fat") * scale,
            "carbohydrates_100g": _num(serving, "carbohydrate") * scale,
        },
    }


def find_product_by_barcode(barcode):
    """Look up a barcode via FatSecret, returning an Open-Food-Facts-shaped
    product dict on a match, or None if there's no match, credentials
    aren't configured, or any request fails -- always a soft fallback,
    never raises, so callers can silently fall through to their existing
    error message when this doesn't help."""
    token = _get_access_token()
    if not token:
        return None
    try:
        food_id = _find_food_id(barcode, token)
        if not food_id:
            return None
        food = _get_food(food_id, token)
        if not food:
            return None
        return _to_open_food_facts_shape(food)
    except requests.RequestException:
        return None
