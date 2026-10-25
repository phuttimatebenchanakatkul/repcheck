"""Custom foods and custom exercises: a person's own, never shared.

Writes live here (not in the app) because the website's rules do: a 500-row ceiling per person, calories derived from the
macros (never trusted from the client), a barcode reduced to digits, lengths clamped. The rules are the website's, with
these deliberate differences:
  * the ceiling is enforced under a per-person lock, so requests racing at 499 cannot both land;
  * every number is also bounded above (a macro of 1e308 or Infinity is not food, and JSON cannot carry Infinity);
  * control characters, which break lists and cannot be stored at all when NUL, are dropped from every text field, and a
    food's emoji is clipped to 8 characters like an exercise's (the website left it unbounded);
  * a barcode that races past the duplicate check is caught by the database's unique index and answered as the same 409.
"""

import math

from psycopg.errors import UniqueViolation

FOOD_LIMIT = 500                 # database.py PER_USER_LIMITS["custom_foods"]
EXERCISE_LIMIT = 500             # ... ["custom_exercises"]
MAX_NAME = 60
MAX_EMOJI = 8
MAX_LABEL = 40
MAX_BARCODE = 20
MAX_EXTRA_SERVINGS = 20
MAX_MACRO_GRAMS = 5000.0         # per serving
MAX_SERVING_GRAMS = 100_000.0
DEFAULT_FOOD_NAME = "Custom food"
DEFAULT_FOOD_EMOJI = chr(0x1F37D) + chr(0xFE0F)       # the plate-and-cutlery emoji the website defaults to
EXERCISE_MODES = ("both", "each", "either")


class Rejected(ValueError):
    """The message is safe to show the user; `status` is the HTTP status to answer with."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def over_limit_message(limit):
    return f"You've reached the maximum of {limit:,} saved items here. Delete some to add more."


def clean_text(value, limit):
    """`value` as text with control characters removed, trimmed and clipped to `limit`."""
    text = "" if value is None else str(value)
    return "".join(c for c in text if ord(c) >= 32 and ord(c) != 127).strip()[:limit]


def digits_only(value):
    """Barcode digits (ASCII 0-9 only; str.isdigit would also accept other scripts' digits)."""
    return "".join(c for c in str(value or "") if "0" <= c <= "9")


def _macro(value):
    """A non-negative, finite, bounded number of grams; anything else is 0, as on the website."""
    try:
        number = float(value if value is not None else 0)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number):
        return 0.0
    return min(max(0.0, number), MAX_MACRO_GRAMS)


def _grams(value, default):
    try:
        number = float(value or default)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) and 0 < number <= MAX_SERVING_GRAMS else default


def lock(conn, kind, user_id):
    """Serialise one person's writes of one kind (released at the end of the transaction, the only kind the pooler allows)."""
    conn.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"{kind}:{user_id}",))


def count(conn, table, user_id):
    # `table` is one of two constants of ours, never input.
    return conn.execute(f"select count(*) as n from public.{table} where user_id = %s", (user_id,)).fetchone()["n"]


# -- custom foods ----------------------------------------------------------------------------------------------------

def food_json(row, servings):
    return {"id": row["id"], "name": row["name"], "emoji": row["emoji"], "calories": row["calories"], "protein": row["protein"],
            "fat": row["fat"], "carbs": row["carbs"], "barcode": row["barcode"], "servingLabel": row["serving_label"],
            "servingGrams": row["serving_grams"], "servings": servings}


def attach_servings(conn, rows):
    ids = [r["id"] for r in rows]
    by_food = {i: [] for i in ids}
    if ids:
        for s in conn.execute("select custom_food_id, label, grams from public.custom_food_servings "
                              "where custom_food_id = any(%s) order by id", (ids,)).fetchall():
            by_food[s["custom_food_id"]].append({"label": s["label"], "grams": s["grams"]})
    return [food_json(r, by_food[r["id"]]) for r in rows]


def list_foods(conn, user_id):
    rows = conn.execute("select * from public.custom_foods where user_id = %s order by created_at desc, id desc", (user_id,)).fetchall()
    return attach_servings(conn, rows)


def food_by_barcode(conn, user_id, barcode):
    row = conn.execute("select * from public.custom_foods where user_id = %s and barcode = %s", (user_id, barcode)).fetchone()
    return attach_servings(conn, [row])[0] if row else None


def create_food(conn, user_id, payload):
    """Create the food and return it as the website's JSON. Raises Rejected (429 at the ceiling, 409 for a barcode already saved)."""
    lock(conn, "custom_foods", user_id)
    if count(conn, "custom_foods", user_id) >= FOOD_LIMIT:
        raise Rejected(over_limit_message(FOOD_LIMIT), 429)
    protein, fat, carbs = _macro(payload.get("protein")), _macro(payload.get("fat")), _macro(payload.get("carbs"))
    name = clean_text(payload.get("name"), MAX_NAME) or DEFAULT_FOOD_NAME
    emoji = clean_text(payload.get("emoji"), MAX_EMOJI) or DEFAULT_FOOD_EMOJI
    barcode = digits_only(payload.get("barcode"))[:MAX_BARCODE] or None
    if barcode and conn.execute("select 1 from public.custom_foods where user_id = %s and barcode = %s", (user_id, barcode)).fetchone():
        raise Rejected("You already have a custom food saved for this barcode.", 409)
    serving_label = clean_text(payload.get("servingLabel"), MAX_LABEL) or "1 serving"
    serving_grams = _grams(payload.get("servingGrams"), 100.0)
    extra = []
    raw_servings = payload.get("servings")
    for raw in (raw_servings if isinstance(raw_servings, list) else [])[:MAX_EXTRA_SERVINGS]:
        if not isinstance(raw, dict):
            continue
        label, grams = clean_text(raw.get("label"), MAX_LABEL), _grams(raw.get("grams"), 0)
        if label and grams > 0:
            extra.append({"label": label, "grams": grams})
    calories = round(protein * 4 + carbs * 4 + fat * 9)          # always derived, never trusted from the client
    try:
        with conn.transaction():
            food_id = conn.execute(
                "insert into public.custom_foods (user_id, name, emoji, calories, protein, fat, carbs, barcode, serving_label, serving_grams) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
                (user_id, name, emoji, calories, protein, fat, carbs, barcode, serving_label, serving_grams)).fetchone()["id"]
            for serving in extra:
                conn.execute("insert into public.custom_food_servings (custom_food_id, label, grams) values (%s, %s, %s)",
                             (food_id, serving["label"], serving["grams"]))
    except UniqueViolation:
        raise Rejected("You already have a custom food saved for this barcode.", 409) from None
    return {"id": food_id, "name": name, "emoji": emoji, "calories": calories, "protein": protein, "fat": fat, "carbs": carbs,
            "barcode": barcode, "servingLabel": serving_label, "servingGrams": serving_grams, "servings": extra}


def delete_food(conn, user_id, food_id):
    conn.execute("delete from public.custom_foods where user_id = %s and id = %s", (user_id, food_id))


def food_as_scan_result(food):
    """A saved food in the shape a fresh barcode lookup answers with, so a scan that matches the person's own food renders
    through the same result screen. ingredients[0].grams is the food's own serving size; `servings` lists every option."""
    servings = [{"label": food["servingLabel"], "grams": food["servingGrams"]}] + list(food["servings"])
    return {
        "food_name": food["name"], "confidence": "custom", "note": "Your own saved food entry.", "custom_food_id": food["id"],
        "ingredients": [{"name": food["name"], "grams": food["servingGrams"], "calories": food["calories"],
                         "protein": food["protein"], "fat": food["fat"], "carbs": food["carbs"]}],
        "calories": food["calories"], "protein": food["protein"], "fat": food["fat"], "carbs": food["carbs"], "servings": servings,
    }


# -- custom exercises ------------------------------------------------------------------------------------------------

def exercise_json(row):
    return {"id": row["id"], "name": row["name"], "emoji": row["emoji"], "mode": row["mode"]}


def list_exercises(conn, user_id):
    rows = conn.execute("select id, name, emoji, mode, created_at from public.custom_exercises where user_id = %s "
                        "order by created_at desc, id desc", (user_id,)).fetchall()
    return [{"id": r["id"], "name": r["name"], "emoji": r["emoji"], "mode": r["mode"], "created_at": r["created_at"].isoformat()} for r in rows]


def create_exercise(conn, user_id, payload):
    lock(conn, "custom_exercises", user_id)
    if count(conn, "custom_exercises", user_id) >= EXERCISE_LIMIT:
        raise Rejected(over_limit_message(EXERCISE_LIMIT), 429)
    name = clean_text(payload.get("name"), MAX_NAME)
    if not name:
        raise Rejected("Enter a name for the exercise.", 400)
    emoji = clean_text(payload.get("emoji"), MAX_EMOJI) or None
    mode = clean_text(payload.get("mode") or "both", 20)
    if mode not in EXERCISE_MODES:
        mode = "both"
    row = conn.execute("insert into public.custom_exercises (user_id, name, emoji, mode) values (%s, %s, %s, %s) returning id, name, emoji, mode",
                       (user_id, name, emoji, mode)).fetchone()
    return exercise_json(row)


def delete_exercise(conn, user_id, exercise_id):
    conn.execute("delete from public.custom_exercises where user_id = %s and id = %s", (user_id, exercise_id))
