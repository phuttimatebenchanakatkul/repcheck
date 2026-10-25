"""Food through the native API, against the REAL Supabase project: the AI photo scan, barcodes, online search, and a
person's own foods and exercises. The model and the barcode databases are fakes (no cost, no flakiness, no third-party
traffic). Every refusal is checked for its EFFECT: nothing created, nothing called, no use of the allowance spent.
Mutation-check any change here (CLAUDE.md)."""

import dataclasses
import io
import threading
import time
from collections import defaultdict

import pytest
from PIL import Image

from api import ai, consent, foods, photos
from api.app import create_app
from api_support import (  # noqa: F401 -- the fixtures are used by name
    bearer, client, db, forget, person, settings, storage)
from test_supabase_rls import Person, needs_api, needs_db

pytestmark = [needs_api, needs_db]


class FoodFake:
    def __init__(self):
        self.calls = defaultdict(list)
        self.raises, self.delay = {}, 0.0
        self.found = {"food_name": "Oat Bar", "confidence": "high", "note": "n", "ingredients": [], "calories": 200, "protein": 5, "fat": 6, "carbs": 30}

    def _go(self, name, args, result):
        self.calls[name].append(args)
        if self.delay:
            time.sleep(self.delay)
        if name in self.raises:
            raise self.raises[name]
        return result

    def analyze_food(self, data, mime_type, note):
        return self._go("analyze_food", (data, mime_type, note), {"food_name": "Chicken rice", "calories": 650, "ingredients": []})

    def decode_barcode(self, data):
        return self._go("decode_barcode", (data,), "5901234123457")

    def lookup_barcode(self, barcode):
        return self._go("lookup_barcode", (barcode,), dict(self.found))

    def search_foods(self, query):
        return self._go("search_foods", (query,), [{"name": "Oat milk"}])

    def count(self, name):
        return len(self.calls[name])


def app_with(settings, db, storage, fake, exempt=()):
    s = dataclasses.replace(settings, rate_limit_exempt=frozenset(e.lower() for e in exempt))
    return create_app(s, db=db, storage=storage, ai=fake, sweep=False).test_client()


@pytest.fixture
def fake():
    return FoodFake()


@pytest.fixture
def me(client, person):
    assert client.post("/api/profile", headers=bearer(person), json={"name": "Eater"}).status_code == 201
    assert client.post("/api/ai-consent", headers=bearer(person), json={"granted": True}).status_code == 200
    return person


def image(fmt="JPEG"):
    buf = io.BytesIO()
    Image.new("RGB", (6, 6), (20, 120, 20)).save(buf, format=fmt)
    return buf.getvalue()


def scan_post(c, who, data=None, *, filename="meal.jpg", mimetype="image/jpeg", note=None, field="image", path="/api/analyze-food", **form):
    fields = dict(form)
    if note is not None:
        fields["note"] = note
    if data is not None:
        fields[field] = (io.BytesIO(data), filename, mimetype)
    return c.post(path, headers=bearer(who), data=fields, content_type="multipart/form-data")


def allowance(db, uid, feature):
    with db.connection() as conn:
        r = conn.execute("select count from public.rate_limits where user_id = %s and feature = %s", (uid, feature)).fetchone()
    return r["count"] if r else 0


def usage(db, uid, event):
    with db.connection() as conn:
        r = conn.execute("select count from public.usage_events where user_id = %s and event = %s", (uid, event)).fetchone()
    return r["count"] if r else 0


def food_rows(db, uid):
    with db.connection() as conn:
        return conn.execute("select * from public.custom_foods where user_id = %s order by id", (uid,)).fetchall()


# -- the AI food photo ---------------------------------------------------------------------------------------------------

def test_a_meal_photo_is_analyzed_with_its_real_type_and_a_clean_note(settings, db, storage, fake, me):
    png = image("PNG")
    r = scan_post(app_with(settings, db, storage, fake), me, png, filename="blob", mimetype="image/jpeg", note="  no dressing\x00 \n please  ")
    assert r.status_code == 200 and r.get_json() == {"ok": True, "food_name": "Chicken rice", "calories": 650, "ingredients": []}
    (data, mime, note), = fake.calls["analyze_food"]
    assert data == png and mime == "image/png", "the type is read from the bytes, not taken from the client"
    assert note == "no dressing  please"
    assert allowance(db, me.id, "food_analysis") == 1 and usage(db, me.id, "feature:food_scan") == 1


def test_the_note_is_clipped_to_300_characters_and_may_be_absent(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake, exempt=[me.email])
    scan_post(c, me, image(), note="n" * 500)
    scan_post(c, me, image())
    scan_post(c, me, image(), note="   ")
    assert [call[2] for call in fake.calls["analyze_food"]] == ["n" * 300, None, None]


def test_the_second_scan_in_a_day_is_a_429_with_the_websites_wording_and_the_wait(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    assert scan_post(c, me, image()).status_code == 200
    r = scan_post(c, me, image())
    assert r.status_code == 429 and r.get_json() == {"ok": False, "error": "You've used your 1 food scans for today — try again in about 24 hours."}
    assert 86000 <= int(r.headers["Retry-After"]) <= 86400 and fake.count("analyze_food") == 1


def test_a_scan_that_could_not_be_analyzed_is_a_502_and_does_not_cost_the_days_scan(settings, db, storage, fake, me):
    fake.raises["analyze_food"] = ai.AnalysisFailed("the model said no")
    c = app_with(settings, db, storage, fake)
    r = scan_post(c, me, image())
    assert r.status_code == 502 and r.get_json() == {"ok": False, "error": "Couldn't analyze that photo. Please try again."}
    assert allowance(db, me.id, "food_analysis") == 0 and usage(db, me.id, "feature:food_scan") == 0
    del fake.raises["analyze_food"]
    assert scan_post(c, me, image()).status_code == 200


def test_a_crash_is_a_generic_500_that_leaks_nothing_and_refunds(settings, db, storage, fake, me):
    fake.raises["analyze_food"] = RuntimeError("secret detail")
    r = scan_post(app_with(settings, db, storage, fake), me, image())
    assert r.status_code == 500 and "secret" not in r.get_data(as_text=True) and allowance(db, me.id, "food_analysis") == 0


def test_the_owner_is_never_limited_on_scans(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake, exempt=[me.email])
    assert all(scan_post(c, me, image()).status_code == 200 for _ in range(3)) and allowance(db, me.id, "food_analysis") == 0


def test_a_scan_needs_a_profile_and_consent_and_nothing_is_called_without_them(settings, db, storage, fake, client, person):
    c = app_with(settings, db, storage, fake)
    assert scan_post(c, person, image()).status_code == 404
    client.post("/api/profile", headers=bearer(person), json={"name": "No Consent"})
    r = scan_post(c, person, image())
    assert r.status_code == 403 and r.get_json() == {"ok": False, "needs_ai_consent": True, "error": consent.CONSENT_ERROR}
    assert fake.count("analyze_food") == 0 and allowance(db, person.id, "food_analysis") == 0


@pytest.mark.parametrize("make,status,message", [
    (lambda: dict(data=None), 400, "Please provide a photo."),
    (lambda: dict(data=image(), filename=""), 400, "Please provide a photo."),
    (lambda: dict(data=b"not an image at all"), 400, "That file isn't a readable image."),
    (lambda: dict(data=image("GIF")), 400, "Unsupported image format."),
    (lambda: dict(data=image("PNG")[:30]), 400, "That file isn't a readable image."),
])
def test_a_bad_photo_is_refused_before_it_costs_anything(settings, db, storage, fake, me, make, status, message):
    r = scan_post(app_with(settings, db, storage, fake), me, **make())
    assert r.status_code == status and r.get_json() == {"ok": False, "error": message}
    assert fake.count("analyze_food") == 0 and allowance(db, me.id, "food_analysis") == 0


def test_a_photo_over_twelve_mib_is_a_413(settings, db, storage, fake, me):
    base = image("PNG")
    r = scan_post(app_with(settings, db, storage, fake), me, base + b"\x00" * (photos.MAX_PHOTO_BYTES + 1 - len(base)))
    assert r.status_code == 413 and fake.count("analyze_food") == 0 and allowance(db, me.id, "food_analysis") == 0


def test_simultaneous_scans_cannot_get_around_the_one_a_day(settings, db, storage, me):
    fake = FoodFake()
    fake.delay = 1.2
    results, gate = [], threading.Barrier(4)

    def go():
        c = app_with(settings, db, storage, fake)
        gate.wait()
        results.append(scan_post(c, me, image()).status_code)
    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join(120) for t in threads]
    assert sorted(results) == [200, 429, 429, 429] and fake.count("analyze_food") == 1


# -- barcodes ----------------------------------------------------------------------------------------------------------

def test_a_scanned_barcode_is_decoded_looked_up_and_counted(settings, db, storage, fake, me):
    r = scan_post(app_with(settings, db, storage, fake), me, b"frame", filename="f.jpg", path="/api/scan-barcode")
    assert r.status_code == 200 and r.get_json() == {"ok": True, **fake.found}
    assert fake.calls["decode_barcode"] == [(b"frame",)] and fake.calls["lookup_barcode"] == [("5901234123457",)]
    assert usage(db, me.id, "feature:barcode_scan") == 1


def test_a_barcode_the_person_saved_wins_over_every_external_lookup(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    c.post("/api/custom-foods", headers=bearer(me), json={"name": "My Bar", "protein": 20, "fat": 7, "carbs": 22,
                                                          "barcode": "5901234123457", "servingLabel": "1 bar", "servingGrams": 45})
    r = scan_post(c, me, b"frame", path="/api/scan-barcode")
    body = r.get_json()
    assert body["ok"] is True and body["food_name"] == "My Bar" and body["confidence"] == "custom" and body["servings"][0] == {"label": "1 bar", "grams": 45.0}
    assert fake.count("lookup_barcode") == 0, "the external databases must not be asked"


def test_a_barcode_nobody_knows_is_a_normal_200_that_lets_the_app_offer_to_create_it(settings, db, storage, fake, me):
    fake.raises["lookup_barcode"] = ai.ProductNotFound("We couldn't find that product.")
    r = scan_post(app_with(settings, db, storage, fake), me, b"frame", path="/api/scan-barcode")
    assert r.status_code == 200 and r.get_json() == {"ok": False, "not_found": True, "barcode": "5901234123457", "error": "We couldn't find that product."}


def test_a_lookup_outage_is_a_502_that_still_carries_the_barcode_that_was_read(settings, db, storage, fake, me):
    fake.raises["lookup_barcode"] = ai.LookupFailed("lookup is down")
    r = scan_post(app_with(settings, db, storage, fake), me, b"frame", path="/api/scan-barcode", live="1")
    assert r.status_code == 502 and r.get_json() == {"ok": False, "barcode": "5901234123457", "error": "lookup is down"}


def test_a_frame_with_no_barcode_in_it_is_a_502_without_a_barcode(settings, db, storage, fake, me):
    fake.raises["decode_barcode"] = ai.LookupFailed("No barcode found in that photo.")
    r = scan_post(app_with(settings, db, storage, fake), me, b"frame", path="/api/scan-barcode")
    assert r.status_code == 502 and r.get_json() == {"ok": False, "error": "No barcode found in that photo."} and fake.count("lookup_barcode") == 0


def test_a_barcode_photo_needs_a_file_and_is_size_bounded(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    r = scan_post(c, me, None, path="/api/scan-barcode")
    assert r.status_code == 400 and r.get_json()["error"] == "Please provide a photo of the barcode."
    r = scan_post(c, me, b"\x00" * (7 * 1024 * 1024), path="/api/scan-barcode")
    assert r.status_code == 413 and fake.count("decode_barcode") == 0


def test_a_typed_barcode_is_reduced_to_digits_and_matched_against_the_persons_own_foods(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    c.post("/api/custom-foods", headers=bearer(me), json={"name": "Mine", "barcode": "012345678"})
    body = c.post("/api/lookup-barcode", headers=bearer(me), json={"barcode": "  0123-456 78  "}).get_json()
    assert body["ok"] is True and body["food_name"] == "Mine" and fake.count("lookup_barcode") == 0
    c.post("/api/lookup-barcode", headers=bearer(me), json={"barcode": "9" * 30})
    assert fake.calls["lookup_barcode"] == [("9" * 20,)], "a barcode is at most 20 digits"


@pytest.mark.parametrize("payload", [{}, {"barcode": ""}, {"barcode": "abc"}, {"barcode": None}, {"barcode": "١٢٣"}])
def test_a_lookup_without_digits_is_a_400(settings, db, storage, fake, me, payload):
    r = app_with(settings, db, storage, fake).post("/api/lookup-barcode", headers=bearer(me), json=payload)
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "No barcode value given."} and fake.count("lookup_barcode") == 0


def test_lookup_outcomes_not_found_and_failure(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    fake.raises["lookup_barcode"] = ai.ProductNotFound("not here")
    assert c.post("/api/lookup-barcode", headers=bearer(me), json={"barcode": "1"}).get_json() == {"ok": False, "not_found": True, "barcode": "1", "error": "not here"}
    fake.raises["lookup_barcode"] = ai.LookupFailed("down")
    r = c.post("/api/lookup-barcode", headers=bearer(me), json={"barcode": "1"})
    assert r.status_code == 502 and r.get_json() == {"ok": False, "error": "down"}


def test_online_search_passes_a_clean_bounded_query_and_reports_outages(settings, db, storage, fake, me):
    c = app_with(settings, db, storage, fake)
    assert c.get("/api/search-food-online?q=%20oat%0Amilk%20" + "x" * 300, headers=bearer(me)).get_json() == {"ok": True, "results": [{"name": "Oat milk"}]}
    assert fake.calls["search_foods"][0][0] == "oatmilk " + "x" * 92
    fake.raises["search_foods"] = ai.LookupFailed("search is down")
    r = c.get("/api/search-food-online?q=oat", headers=bearer(me))
    assert r.status_code == 502 and r.get_json() == {"ok": False, "error": "search is down"}


# -- a person's own foods -------------------------------------------------------------------------------------------------

def make_food(c, who, **fields):
    return c.post("/api/custom-foods", headers=bearer(who), json=fields)


def test_a_food_with_nothing_filled_in_gets_the_websites_defaults(client, me):
    body = make_food(client, me).get_json()
    assert body["ok"] is True
    food = body["food"]
    assert (food["name"], food["emoji"], food["calories"], food["protein"], food["fat"], food["carbs"]) == \
        ("Custom food", foods.DEFAULT_FOOD_EMOJI, 0, 0.0, 0.0, 0.0)
    assert (food["barcode"], food["servingLabel"], food["servingGrams"], food["servings"]) == (None, "1 serving", 100.0, [])


def test_calories_are_always_derived_from_the_macros_never_taken_from_the_client(client, me):
    food = make_food(client, me, name="Bar", protein=20, fat=7, carbs=22.5, calories=99999).get_json()["food"]
    assert food["calories"] == round(20 * 4 + 22.5 * 4 + 7 * 9) == 233


@pytest.mark.parametrize("fields,expected", [
    ({"protein": -5, "fat": "x", "carbs": None}, (0.0, 0.0, 0.0)),
    ({"protein": 1e308, "fat": float("inf"), "carbs": "1e999"}, (5000.0, 0.0, 0.0)),
    ({"protein": "12.5", "fat": True, "carbs": [1]}, (12.5, 1.0, 0.0)),
])
def test_odd_macros_become_safe_numbers(client, me, fields, expected):
    food = make_food(client, me, **fields).get_json()["food"]
    assert (food["protein"], food["fat"], food["carbs"]) == expected and food["calories"] == round(expected[0] * 4 + expected[2] * 4 + expected[1] * 9)


def test_text_fields_are_clipped_and_cleaned(client, me):
    food = make_food(client, me, name="  " + "N" * 100 + "\x00  ", emoji="E" * 20, servingLabel="L" * 90, barcode="00-12 34" + "9" * 40).get_json()["food"]
    assert food["name"] == "N" * 60 and food["emoji"] == "E" * 8 and food["servingLabel"] == "L" * 40
    assert food["barcode"] == ("0012349" + "9" * 40)[:20]


@pytest.mark.parametrize("grams,expected", [(45, 45.0), (0, 100.0), (-1, 100.0), ("x", 100.0), (None, 100.0), (float("inf"), 100.0), (1e9, 100.0)])
def test_the_serving_weight_must_be_sensible_else_100(client, me, grams, expected):
    assert make_food(client, me, servingGrams=grams).get_json()["food"]["servingGrams"] == expected


def test_extra_servings_keep_only_the_first_twenty_valid_ones(client, me):
    servings = [{"label": f"S{i}", "grams": i + 1} for i in range(25)] + []
    servings.insert(1, {"label": "", "grams": 5})
    servings.insert(2, {"label": "bad", "grams": 0})
    servings.insert(3, "not an object")
    servings.insert(4, {"label": "L" * 90, "grams": "12.5"})
    food = make_food(client, me, servings=servings).get_json()["food"]
    labels = [s["label"] for s in food["servings"]]
    assert len(labels) <= 20 and "" not in labels and "bad" not in labels and ("L" * 40) in labels
    assert make_food(client, me, servings="nope").get_json()["food"]["servings"] == []


def test_exactly_twenty_extra_servings_are_kept_when_more_are_valid(client, me):
    servings = [{"label": f"S{i}", "grams": i + 1} for i in range(21)]
    kept = make_food(client, me, servings=servings).get_json()["food"]["servings"]
    assert [s["label"] for s in kept] == [f"S{i}" for i in range(20)]


def test_a_saved_food_is_listed_with_its_servings_newest_first_and_only_for_its_owner(client, me, db):
    other = Person("pantry")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Pantry"})
        make_food(client, me, name="First")
        second = make_food(client, me, name="Second", servings=[{"label": "box", "grams": 300}, {"label": "half", "grams": 150}]).get_json()["food"]
        make_food(client, other, name="Theirs")
        listed = client.get("/api/custom-foods", headers=bearer(me)).get_json()["foods"]
        assert [f["name"] for f in listed] == ["Second", "First"] and listed[0] == second
        assert [s["label"] for s in listed[0]["servings"]] == ["box", "half"]
        assert [f["name"] for f in client.get("/api/custom-foods", headers=bearer(other)).get_json()["foods"]] == ["Theirs"]
    finally:
        forget(other)


def test_a_barcode_can_be_saved_once_per_person_and_the_same_code_is_fine_for_someone_else(client, me):
    other = Person("twin")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Twin"})
        assert make_food(client, me, barcode="5901234123457").status_code == 200
        r = make_food(client, me, barcode="59-01234123457")
        assert r.status_code == 409 and r.get_json() == {"ok": False, "error": "You already have a custom food saved for this barcode."}
        assert make_food(client, other, barcode="5901234123457").status_code == 200
    finally:
        forget(other)


def test_two_requests_racing_to_save_the_same_barcode_end_with_exactly_one_food(settings, db, storage, fake, me):
    results, gate = [], threading.Barrier(4)

    def go():
        c = app_with(settings, db, storage, fake)
        gate.wait()
        results.append(make_food(c, me, barcode="777").status_code)
    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join(120) for t in threads]
    assert sorted(results) == [200, 409, 409, 409] and len(food_rows(db, me.id)) == 1


def seed_foods(db, uid, n):
    with db.connection() as conn:
        conn.execute("insert into public.custom_foods (user_id, name, emoji, calories, protein, fat, carbs) "
                     "select %s, 'seed ' || g, 'x', 0, 0, 0, 0 from generate_series(1, %s) g", (uid, n))


def test_at_500_foods_a_new_one_is_a_429_with_the_websites_message(client, me, db):
    seed_foods(db, me.id, foods.FOOD_LIMIT)
    r = make_food(client, me, name="One too many")
    assert r.status_code == 429 and r.get_json()["error"] == "You've reached the maximum of 500 saved items here. Delete some to add more."
    assert len(food_rows(db, me.id)) == 500


def test_requests_racing_for_the_last_place_cannot_both_win(settings, db, storage, fake, me):
    seed_foods(db, me.id, foods.FOOD_LIMIT - 1)
    results, gate = [], threading.Barrier(4)

    def go():
        c = app_with(settings, db, storage, fake)
        gate.wait()
        results.append(make_food(c, me, name="racer").status_code)
    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join(120) for t in threads]
    assert sorted(results) == [200, 429, 429, 429] and len(food_rows(db, me.id)) == 500


def test_one_persons_full_pantry_does_not_block_another(client, me, db):
    other = Person("hungry")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Hungry"})
        seed_foods(db, other.id, foods.FOOD_LIMIT)
        assert make_food(client, me, name="mine").status_code == 200 and make_food(client, other, name="theirs").status_code == 429
    finally:
        forget(other)


def test_deleting_a_food_removes_it_and_its_servings_and_only_the_callers(client, me, db):
    other = Person("deleter")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Deleter"})
        mine = make_food(client, me, name="Mine", servings=[{"label": "box", "grams": 5}]).get_json()["food"]["id"]
        theirs = make_food(client, other, name="Theirs").get_json()["food"]["id"]
        assert client.delete(f"/api/custom-foods/{theirs}", headers=bearer(me)).get_json() == {"ok": True}
        assert len(food_rows(db, other.id)) == 1, "someone else's food must survive"
        assert client.delete(f"/api/custom-foods/{mine}", headers=bearer(me)).get_json() == {"ok": True}
        assert food_rows(db, me.id) == []
        with db.connection() as conn:
            assert conn.execute("select count(*) as n from public.custom_food_servings where custom_food_id = %s", (mine,)).fetchone()["n"] == 0
        assert client.delete(f"/api/custom-foods/{mine}", headers=bearer(me)).get_json() == {"ok": True}, "deleting twice is harmless"
        assert client.delete("/api/custom-foods/987654321", headers=bearer(me)).status_code == 200
    finally:
        forget(other)


def test_saving_needs_a_profile_but_listing_without_one_is_just_empty(client, person):
    assert make_food(client, person, name="x").status_code == 404
    assert client.get("/api/custom-foods", headers=bearer(person)).get_json() == {"ok": True, "foods": []}


# -- a person's own exercises --------------------------------------------------------------------------------------------

def make_exercise(c, who, **fields):
    return c.post("/api/custom-exercises", headers=bearer(who), json=fields)


def exercise_rows(db, uid):
    with db.connection() as conn:
        return conn.execute("select * from public.custom_exercises where user_id = %s order by id", (uid,)).fetchall()


def test_an_exercise_is_saved_clipped_and_defaults_its_mode(client, me):
    body = make_exercise(client, me, name="  " + "E" * 90 + "\x00 ", emoji="  \U0001F3CB️" + "z" * 20).get_json()
    ex = body["exercise"]
    assert body["ok"] is True and ex["name"] == "E" * 60 and len(ex["emoji"]) == 8 and ex["mode"] == "both"
    assert make_exercise(client, me, name="Plain").get_json()["exercise"]["emoji"] is None


@pytest.mark.parametrize("mode,expected", [("each", "each"), ("either", "either"), ("both", "both"), ("weird", "both"), (None, "both"), (5, "both"), ("", "both")])
def test_an_unknown_mode_becomes_both(client, me, mode, expected):
    assert make_exercise(client, me, name="X", mode=mode).get_json()["exercise"]["mode"] == expected


@pytest.mark.parametrize("name", [None, "", "   ", "\x00\x01"])
def test_an_exercise_needs_a_name(client, me, db, name):
    r = make_exercise(client, me, name=name)
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "Enter a name for the exercise."} and exercise_rows(db, me.id) == []


def test_exercises_are_listed_newest_first_for_their_owner_only(client, me):
    other = Person("lifter")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Lifter"})
        make_exercise(client, me, name="First")
        make_exercise(client, me, name="Second")
        make_exercise(client, other, name="Theirs")
        assert [e["name"] for e in client.get("/api/custom-exercises", headers=bearer(me)).get_json()["exercises"]] == ["Second", "First"]
        assert [e["name"] for e in client.get("/api/custom-exercises", headers=bearer(other)).get_json()["exercises"]] == ["Theirs"]
    finally:
        forget(other)


def test_the_exercise_ceiling_is_500_and_atomic(settings, db, storage, fake, me):
    with db.connection() as conn:
        conn.execute("insert into public.custom_exercises (user_id, name) select %s, 'seed ' || g from generate_series(1, %s) g", (me.id, foods.EXERCISE_LIMIT - 1))
    results, gate = [], threading.Barrier(4)

    def go():
        c = app_with(settings, db, storage, fake)
        gate.wait()
        results.append(make_exercise(c, me, name="racer").status_code)
    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join(120) for t in threads]
    assert sorted(results) == [200, 429, 429, 429] and len(exercise_rows(db, me.id)) == 500


def test_deleting_an_exercise_is_scoped_to_its_owner(client, me, db):
    other = Person("trainer")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Trainer"})
        mine = make_exercise(client, me, name="Mine").get_json()["exercise"]["id"]
        theirs = make_exercise(client, other, name="Theirs").get_json()["exercise"]["id"]
        client.delete(f"/api/custom-exercises/{theirs}", headers=bearer(me))
        assert len(exercise_rows(db, other.id)) == 1
        assert client.delete(f"/api/custom-exercises/{mine}", headers=bearer(me)).get_json() == {"ok": True} and exercise_rows(db, me.id) == []
    finally:
        forget(other)


def test_saving_an_exercise_needs_a_profile(client, person):
    assert make_exercise(client, person, name="x").status_code == 404


# -- the locks and the scoping, proven deterministically ----------------------------------------------------------------

def _blocked_while_locked(db, kind, uid, work):
    """True when `work` (run on its own connection) cannot finish while another connection holds this person's `kind` lock."""
    outcome = {}

    def second():
        with db.connection() as conn:
            outcome["value"] = work(conn)

    with db.connection() as first:
        foods.lock(first, kind, uid)
        worker = threading.Thread(target=second)
        worker.start()
        worker.join(2.5)
        waited = worker.is_alive() and "value" not in outcome
    worker.join(30)
    assert "value" in outcome and not worker.is_alive()
    return waited


def test_saving_a_food_waits_for_the_persons_other_saves_so_the_ceiling_cannot_be_raced(db, me):
    assert _blocked_while_locked(db, "custom_foods", me.id, lambda conn: foods.create_food(conn, me.id, {"name": "waiter"}))


def test_saving_an_exercise_waits_for_the_persons_other_saves(db, me):
    assert _blocked_while_locked(db, "custom_exercises", me.id, lambda conn: foods.create_exercise(conn, me.id, {"name": "waiter"}))


def test_another_persons_lock_does_not_hold_a_save_up(db, me):
    other = Person("unlocked")
    try:
        done = threading.Event()

        def mine():
            with db.connection() as conn:
                foods.create_food(conn, me.id, {"name": "free"})
            done.set()
        with db.connection() as theirs:
            foods.lock(theirs, "custom_foods", other.id)
            threading.Thread(target=mine).start()
            assert done.wait(20), "one person's lock blocked a different person"
    finally:
        forget(other)


def test_a_barcode_someone_else_saved_is_not_mine_to_find(settings, db, storage, fake, me):
    other = Person("shelf")
    try:
        c = app_with(settings, db, storage, fake)
        c.post("/api/profile", headers=bearer(other), json={"name": "Shelf"})
        make_food(c, other, name="Their Bar", barcode="5901234123457")
        body = c.post("/api/lookup-barcode", headers=bearer(me), json={"barcode": "5901234123457"}).get_json()
        assert body["ok"] is True and body["food_name"] == "Oat Bar" and fake.calls["lookup_barcode"] == [("5901234123457",)]
    finally:
        forget(other)


def test_a_scan_without_a_profile_still_works_but_is_not_counted(settings, db, storage, fake, person):
    r = scan_post(app_with(settings, db, storage, fake), person, b"frame", path="/api/scan-barcode")
    assert r.status_code == 200 and usage(db, person.id, "feature:barcode_scan") == 0
