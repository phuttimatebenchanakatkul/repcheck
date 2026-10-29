"""Golden cases for the food code of the Edge Functions (scripts/edge_golden.py calls build()).

The product lookups are run against a scripted "world" instead of the network: each case carries the answers Open Food Facts and FatSecret
would give (a status and a JSON body, or a dropped connection), the Python code runs with `requests` patched to serve them, and the outcome
(the result or the error, and which requests were made) is written down. The TypeScript is run against the same worlds.
"""

import contextlib
import json
import os
import random
import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def raise_for_status(self):
        import requests
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))

    def json(self):
        import requests
        if isinstance(self._body, str) and self._body.startswith("TEXT:"):
            raise requests.exceptions.JSONDecodeError("not json", "doc", 0)
        return self._body


def run_world(world, call):
    """Run `call()` with requests.get/post answering from `world`; returns (outcome, requests made)."""
    import barcode_scanner as bs
    import fatsecret_lookup as fs
    import requests
    calls = []

    def answer(entry):
        if entry is None:
            return FakeResponse(404, {"status": 0})
        if entry == "net":
            raise requests.ConnectionError("down")
        if entry == "timeout":
            raise requests.Timeout("slow")
        return FakeResponse(entry["status"], entry["body"])

    def fake_get(url, params=None, headers=None, timeout=None, **kw):
        params = params or {}
        if url.startswith("https://world.openfoodfacts.org/api/v2/product/"):
            code = url.rsplit("/", 1)[1][:-5]
            calls.append(f"off:{code}")
            return answer(world.get("off", {}).get(code))
        if url == bs.OPEN_FOOD_FACTS_SEARCH_URL:
            calls.append(f"search:{params['q']}:{params['page_size']}")
            return answer(world.get("search", {}).get(params["q"]))
        if url == fs.BARCODE_URL:
            calls.append(f"fs_barcode:{params['barcode']}:{params['region']}")
            return answer(world.get("fs_barcode", {}).get(params["barcode"]))
        if url == fs.FOOD_URL:
            calls.append(f"fs_food:{params['food_id']}:{params['region']}")
            return answer(world.get("fs_food", {}).get(params["food_id"]))
        raise AssertionError(url)

    def fake_post(url, auth=None, data=None, timeout=None, **kw):
        assert url == fs.TOKEN_URL
        calls.append("fs_token")
        return answer(world.get("fs_token"))

    env = {"FATSECRET_CLIENT_ID": "id", "FATSECRET_CLIENT_SECRET": "secret"} if world.get("creds") else {}
    if world.get("region"):
        env["FATSECRET_REGION"] = world["region"]
    fs._token_cache.update({"token": None, "expires_at": 0})
    with mock.patch("requests.get", fake_get), mock.patch("requests.post", fake_post), mock.patch.dict(os.environ, env):
        if not world.get("creds"):
            os.environ.pop("FATSECRET_CLIENT_ID", None)
            os.environ.pop("FATSECRET_CLIENT_SECRET", None)
        if not world.get("region"):
            os.environ.pop("FATSECRET_REGION", None)
        outcome = outcome_of(call)
    return outcome, calls


def outcome_of(call):
    import barcode_scanner as bs
    try:
        return ["ok", call()]
    except bs.ProductNotFoundError as exc:
        return ["notfound", str(exc)]
    except bs.BarcodeScanError as exc:
        return ["error", str(exc)]
    except Exception:
        return ["crash"]


def build():
    import analyze_food_gemini as afg
    import barcode_scanner as bs
    import fatsecret_lookup as fs
    from api import foods as ff
    rng = random.Random(48)
    out = {}

    # ---- products ----------------------------------------------------------------------------------------------------
    names = [None, "", "Nutella", "nutella", "  Hazelnut   Spread  ", "A very long product name that goes on and on past forty characters", "Ünï ☃ 食品", 5, ["x"], True, "x" * 41, "word " * 12, "　spaced　out　"]
    brands = [None, "", "Ferrero", "Ferrero, Nutella", ["Ferrero", "Other"], [], "nutella", ",", " , x", 7, "Brand A,Brand B", [None], ["  "]]
    servings = [None, "", "30 g", "1 bar (45g)", "355 ml", "12 fl oz", "2 oz", "1.5 oz", "٣٠ g", "30g", "30 grams", "g", ".g", "1.2.3 g", "0 g", "0.4 g", "12 fl. oz", "100 mL", "1 cup",
                "Serving: 45.5 g (2 pieces)", "250 GM", "8 FL OZ", "1 oz (28 g)", "g30", "30 g_x", "30 gx", "5.5.", "..", "1,5 g", "٣.٥ oz", "99.5 g", "100.5 g", "0.5 g", 30, ["x"], {"a": 1}]

    def nutrient(base=None):
        r = rng.random()
        if base is not None and r < .6:
            return base
        return rng.choice([0, 1, 5, 12.5, 100, 101, 250, 899, 901, 1500, "12.5", "7", "abc", "inf", "-5", "", None, [], True, False, -3, 1e9, "1e2", " 8 ", "٥", "nan", "Infinity"])

    def nutriments():
        r = rng.random()
        if r < .04:
            return rng.choice([None, [], "x", 5, {}])
        protein, fat, carbs = (rng.choice([0, 3, 5.5, 10, 20, 31.2, 55]) for _ in range(3))
        macro_kcal = protein * 4 + fat * 9 + carbs * 4
        calories = rng.choice([macro_kcal, macro_kcal * 4.184, macro_kcal * 4.2, macro_kcal * 2.9, macro_kcal * 3.1, 0, 120, 600])
        d = {"energy-kcal_100g": nutrient(round(calories, 1)), "proteins_100g": nutrient(protein), "fat_100g": nutrient(fat), "carbohydrates_100g": nutrient(carbs)}
        for k in list(d):
            if rng.random() < .06:
                d.pop(k)
        return d

    def product(code=None):
        p = {"product_name": rng.choice(names), "brands": rng.choice(brands), "serving_size": rng.choice(servings), "nutriments": nutriments()}
        if code is not None:
            p["code"] = code
        for k in list(p):
            if rng.random() < .05:
                p.pop(k)
        return p

    out["validate"] = []
    for i in range(500):
        p = product()
        barcode = rng.choice(["3017620422003", "12345678", "", "00"])
        source = rng.choice(["Open Food Facts", "FatSecret"])
        out["validate"].append([[barcode, p, source], outcome_of(lambda: bs._validate(barcode, p, source))])
    for bad in (None, [], "x", 5):
        out["validate"].append([["1", bad, "Open Food Facts"], outcome_of(lambda: bs._validate("1", bad))])

    def nutrition(calories, protein=0, fat=0, carbs=0, serving="100 g"):
        return {"product_name": "Edge", "serving_size": serving,
                "nutriments": {"energy-kcal_100g": calories, "proteins_100g": protein, "fat_100g": fat, "carbohydrates_100g": carbs}}

    edges = [nutrition(523, 25), nutrition(523.0001, 25), nutrition(522.9999, 25), nutrition(0.9, 0.1), nutrition(0.8, 0.1), nutrition(2.4, 0.1), nutrition(900, fat=100), nutrition(900.0001, fat=100),
             nutrition(899.9999, fat=100), nutrition(900, protein=100), nutrition(500, protein=100.0001), nutrition(500, fat=100.0001), nutrition(500, carbs=100.0001), nutrition(500, protein=100, fat=0, carbs=0),
             nutrition(1000, 5, 5, 5), nutrition(901, 5, 5, 5), nutrition(900.0, 5, 5, 5), nutrition(418.4, 20), nutrition(418.4001, 20), nutrition(418.3999, 20), nutrition(1673.6, 100), nutrition(1000, 2, 20, 5)]
    for macro in (25, 20, 12.5, 50, 5, 30):
        kcal = macro * 4
        threshold = max(kcal * 0.25, 20)
        for delta in (threshold, threshold + 1e-6, threshold - 1e-6, -threshold):
            edges.append(nutrition(round((kcal + delta) * 4.184, 6), macro))
    for item in edges:
        out["validate"].append([["99", item, "Open Food Facts"], outcome_of(lambda: bs._validate("99", item))])

    out["serving"] = [[p, outcome_of(lambda: bs._parse_serving_grams(p))] for p in [{"serving_size": s} for s in servings] + [{}, {"serving_size": None}]]
    out["brand"] = [[p, outcome_of(lambda: bs._brand_name(p))] for p in [{"brands": b} for b in brands] + [{}]]
    out["shorten"] = [[[s, m], outcome_of(lambda: bs._shorten_name(s, m))] for s in ["", "short", "a b c", "x" * 50, "word " * 20, "  many    spaces\there\nnow  ", "　wide　space　" * 5, "nospaceinthislongnamethatgoesonandonandon", "é" * 45, "\U0001f3cb " * 30, "ab cd ef gh ij kl mn op qr st uv wx yz 12 34 56"]
                      for m in (40, 30, 5, 1)]
    out["num"] = [[[{"k": v}, "k"], "inf" if bs._num({"k": v}, "k") == float("inf") else bs._num({"k": v}, "k")] for v in [0, 1, -1, 2.5, "3", " 4 ", "x", None, True, False, [], {}, "1e2", "٥", "inf", "-inf", "nan", "+inf", "Infinity", 1e308]]

    # ---- lookups and searches against a scripted world -----------------------------------------------------------------
    def reply(body, status=200):
        return {"status": status, "body": body}

    def off_entry(code):
        r = rng.random()
        if r < .55:
            return reply({"status": 1, "product": product(code)})
        if r < .62:
            return reply({"status": rng.choice([0, "1", 2, None]), "product": product(code)})
        if r < .68:
            return reply({"status": 1, "product": rng.choice([{}, None, [], "", 0])})
        if r < .74:
            return reply({"status": 0, "status_verbose": "product not found"}, 404)
        if r < .80:
            return reply({"status": 0}, 200)
        if r < .84:
            return reply("TEXT:<html>", 200)
        if r < .88:
            return reply({}, rng.choice([500, 503, 429]))
        if r < .91:
            return rng.choice(["net", "timeout"])
        if r < .94:
            return reply(rng.choice([[], "x", 5, None]))
        return None

    def food(rng_):
        def serving():
            return {"metric_serving_unit": rng_.choice(["g", "G", "ml", "oz", None, "", "serving"]), "metric_serving_amount": rng_.choice([100, 30, "45.5", 0, None, "x", 250, "inf"]),
                    "calories": rng_.choice([120, "250", None, "x", 0, 450]), "protein": rng_.choice([5, "3.3", None, 0]), "fat": rng_.choice([2, "1.1", None, 12]),
                    "carbohydrate": rng_.choice([20, "15", None, 0, 66])}
        shape = rng_.random()
        if shape < .25:
            container = {"serving": serving()}
        elif shape < .65:
            container = {"serving": [serving() for _ in range(rng_.randint(1, 3))]}
        elif shape < .75:
            container = {"serving": []}
        elif shape < .8:
            container = rng_.choice([{}, None, [], "x", {"serving": None}, {"serving": "abc"}, {"serving": [5]}])
        else:
            container = {"serving": [serving()]}
        f = {"food_name": rng_.choice(["Pad Thai Mix", "Mama Noodles", "", None, "x" * 50, "Thai Tea"]), "brand_name": rng_.choice(["Mama", "", None, "Thai Tea"]), "servings": container}
        return f

    def fatsecret_world(world, code):
        world["creds"] = rng.random() < .7
        world["region"] = rng.choice([None, "", "US", " th ", "TH"])
        token = rng.random()
        if token < .7:
            world["fs_token"] = reply({"access_token": "tok", "expires_in": rng.choice([3600, None, "7200", 0]), "token_type": "Bearer"})
        elif token < .75:
            world["fs_token"] = reply({"error": "invalid_client"}, 400)
        elif token < .8:
            world["fs_token"] = reply({"expires_in": 3600})
        elif token < .85:
            world["fs_token"] = reply("TEXT:oops")
        elif token < .9:
            world["fs_token"] = rng.choice(["net", "timeout"])
        else:
            world["fs_token"] = reply(rng.choice([[], "x", 5, None]))
        gtin = code.zfill(13)
        found = rng.random()
        if found < .65:
            world["fs_barcode"] = {gtin: reply({"food_id": {"value": rng.choice(["4455", "4455", 4455, "0", 0, None, ""])}})}
        elif found < .75:
            world["fs_barcode"] = {gtin: reply({"food_id": rng.choice([None, {}, "x", 5, {"v": 1}])})}
        elif found < .8:
            world["fs_barcode"] = {gtin: reply({})}
        elif found < .85:
            world["fs_barcode"] = {gtin: reply(rng.choice([[], "x", None]))}
        elif found < .9:
            world["fs_barcode"] = {gtin: rng.choice(["net", "timeout", reply({}, 500), reply("TEXT:x")])}
        else:
            world["fs_barcode"] = {}
        shape = rng.random()
        if shape < .8:
            world["fs_food"] = {"4455": reply({"food": food(rng)})}
        elif shape < .85:
            world["fs_food"] = {"4455": reply({"food": None})}
        elif shape < .9:
            world["fs_food"] = {"4455": reply(rng.choice([{}, [], None, "x"]))}
        elif shape < .95:
            world["fs_food"] = {"4455": rng.choice(["net", reply({}, 500), reply("TEXT:x")])}
        else:
            world["fs_food"] = {}

    out["lookups"] = []
    for _ in range(600):
        code = rng.choice(["3017620422003", "8850987000014", "5000112637922", "12345678", "0123456789012", "7"])
        raw = rng.choice([code, f" {code} ", f"{code}-x", "ab" + code, int(code) if rng.random() < .1 else code, "", "   ", "abc", None, "٣٤٥", code + "\n"])
        world = {"off": {}}
        digits = "".join(c for c in str(raw).strip() if c.isdigit()) if raw is not None else "None"
        key = digits or code
        world["off"][key] = off_entry(key)
        fatsecret_world(world, key)
        out["lookups"].append([[raw, world], run_world(world, lambda: bs.lookup_by_barcode(raw))])

    out["searches"] = []
    for _ in range(250):
        query = rng.choice(["nutella", "  nutella  ", "pad thai", "ข้าวผัด", "", "   ", None, "q&a +x", "a" * 30])
        hits = [product(rng.choice(["3017620422003", "8850987000014", "", None, 7, "55"])) for _ in range(rng.randint(0, 8))]
        if hits and rng.random() < .3:
            hits.append(dict(hits[0], code="9999999999999"))          # a duplicate name under another barcode
        if rng.random() < .3 and hits:
            hits.insert(rng.randrange(len(hits)), rng.choice([{}, {"code": "1"}, {"code": "2", "product_name": "No Food", "nutriments": {}}]))
        body = {"hits": hits, "count": len(hits)}
        r = rng.random()
        if r < .06:
            body = rng.choice([{}, {"hits": None}, {"hits": ""}, {"hits": {}}, {"hits": {"a": 1}}, {"hits": 5}, [], "x"])
        entry = reply(body)
        r = rng.random()
        if r < .06:
            entry = reply({}, rng.choice([500, 503]))
        elif r < .09:
            entry = rng.choice(["net", "timeout", reply("TEXT:oops")])
        q = (query or "").strip() if isinstance(query, str) or query is None else query
        world = {"search": {q: entry}}
        limit = rng.choice([12, 15, 3, 1])
        out["searches"].append([[query, limit, world], run_world(world, lambda: bs.search_open_food_facts(query, limit=limit))])

    # ---- the photo estimate -------------------------------------------------------------------------------------------
    def ingredient():
        return {"name": rng.choice(["Chicken", "", "Thai Chilies", "A very long ingredient name that goes past thirty", None, 5, "  Rice  ", "Fish\nSauce", "abcd " * 5 + "abcd", "abcd " * 6 + "e", "abcd " * 6, "abcd " * 5 + "abcde", "x" * 30, "x" * 31, "xx " * 10 + "y", "Ünï ☃"]),
                "grams": rng.choice([100, 0, 5.5, "120", None, -3, "x", 2.5, 3.5, 0.5, 1e6, "inf", True]), "calories": rng.choice([100, 0, 130.5, "x", None, 884, 2.5, 3.5]),
                "protein": rng.choice([0, 2.25, 2.35, 9.95, "3.3", None, 0.05, 0.15, 1.25]), "fat": rng.choice([0, 0.35, 12.5, None, "x", 0.25]), "carbs": rng.choice([0, 28, 0.45, None, 33.333, 0.75])}

    out["photo"] = []
    for _ in range(500):
        parsed = {"food_name": rng.choice(["Pad Thai", "", None, "x" * 60, "  Spaced   Name  ", 5, ["a"], "Unknown"]), "confidence": rng.choice(["low", "MEDIUM", " High ", "certain", None, "", 5]),
                  "note": rng.choice(["Estimated.", "", None, "  padded  ", 5]), "ingredients": [ingredient() for _ in range(rng.randint(0, 15))]}
        if rng.random() < .15:
            parsed["ingredients"][:0] = [rng.choice([None, "x", 5, [], {}, {"name": "X"}])] if parsed["ingredients"] is not None else []
        if rng.random() < .08:
            parsed["ingredients"] = rng.choice([None, "x", {}, 5, {"a": 1}])
        for k in list(parsed):
            if rng.random() < .05:
                parsed.pop(k)
        out["photo"].append([parsed, outcome_photo(afg, parsed)])
    for bad in (None, [], "x", 5, []):
        out["photo"].append([bad, outcome_photo(afg, bad)])

    # ---- a person's own foods and exercises ----------------------------------------------------------------------------
    values = [None, 0, 1, -1, 2.5, 5000, 5000.5, 1e308, "12", " 12.5 ", "abc", "", "inf", "nan", "-inf", True, False, [], {}, "1e3", "1_0", "٥", 0.1, 4999.999, "5001", "0", "0.0", " 0 ", "-0", "+5", "5e0", "100000", "100000.5"]
    out["macro"] = [[v, ff._macro(v)] for v in values]
    out["grams"] = [[[v, d], ff._grams(v, d)] for v in values + [100000, 100001, 0.0001, 99999.9] for d in (100.0, 0)]
    texts = [None, "", "  hi  ", "a\x00b\x07c\x7fd", "\n\ttabbed", "x" * 100, "\U0001f3cb" * 20, "　x　", 5, True, False, 2.5, ["a", "b"], {"k": "v"}, "é" * 70, "a​b", "\x85x\x85", "\x1fx"]
    out["clean"] = [[[t, n], ff.clean_text(t, n)] for t in texts for n in (60, 8, 40, 300, 1, 0)]
    out["digits"] = [[v, ff.digits_only(v)] for v in [None, "", "123-456", "  12 34 ", "١٢٣", "abc", 123, 0, 12.5, True, False, ["1", "2"], {"a": 1}, "0012", "１２３", "1\n2"]]

    class Cursor:
        def __init__(self, row=None):
            self.row = row

        def fetchone(self):
            return self.row

        def fetchall(self):
            return []

    class Conn:
        def __init__(self, count=0, existing=False):
            self.count, self.existing, self.extra = count, existing, []

        def execute(self, sql, params=None):
            s = " ".join(sql.split())
            if "pg_advisory_xact_lock" in s:
                return Cursor()
            if "count(*)" in s:
                return Cursor({"n": self.count})
            if s.startswith("select 1"):
                return Cursor({"x": 1} if self.existing else None)
            if s.startswith("insert into public.custom_foods "):
                return Cursor({"id": 7})
            if s.startswith("insert into public.custom_food_servings"):
                self.extra.append(params)
                return Cursor()
            if s.startswith("insert into public.custom_exercises"):
                return Cursor({"id": 3, "name": params[1], "emoji": params[2], "mode": params[3]})
            raise AssertionError(s)

        @contextlib.contextmanager
        def transaction(self):
            yield

    def made(fn, payload, **kw):
        try:
            return ["ok", fn(Conn(**kw), "user", payload)]
        except ff.Rejected as exc:
            return ["rejected", exc.status, str(exc)]

    payloads = []
    for _ in range(300):
        p = {"name": rng.choice(texts), "emoji": rng.choice(texts), "protein": rng.choice(values), "fat": rng.choice(values), "carbs": rng.choice(values), "barcode": rng.choice(texts + ["3017620422003", "12-34", 12345]),
             "servingLabel": rng.choice(texts), "servingGrams": rng.choice(values), "calories": 99999,
             "servings": rng.choice([None, [], [{"label": "1 cup", "grams": 240}], [{"label": "", "grams": 5}, {"label": "x", "grams": 0}, {"label": "y", "grams": "12"}, 5, None, "z"],
                                     [{"label": f"s{i}", "grams": i + 1} for i in range(25)], "x", {"a": 1}])}
        for k in list(p):
            if rng.random() < .1:
                p.pop(k)
        payloads.append(p)
    payloads += [{}, {"name": "Cake", "protein": 5, "fat": 10, "carbs": 20.5}]
    out["createFood"] = [[[p, kw], made(ff.create_food, p, **kw)] for p, kw in [(p, {}) for p in payloads] + [(payloads[3], {"count": 500}), (payloads[3], {"count": 499}), ({"barcode": "123"}, {"existing": True}), ({"name": "x"}, {"existing": True})]]
    ex = [{"name": rng.choice(texts), "emoji": rng.choice(texts), "mode": rng.choice(["both", "each", "either", "other", None, "", "EACH", 5, " each ", ["both"]])} for _ in range(150)] + [{}, {"name": "Row"}, {"name": "x" * 70, "emoji": "\U0001f3cb" * 9}]
    out["createExercise"] = [[[p, kw], made(ff.create_exercise, p, **kw)] for p, kw in [(p, {}) for p in ex] + [({"name": "ok"}, {"count": 500}), ({"name": "ok"}, {"count": 499})]]
    foods_ = [{"id": 1, "name": "Cake", "servingGrams": 80.0, "calories": 300, "protein": 3.0, "fat": 10.0, "carbs": 50.0, "servingLabel": "1 slice", "servings": [{"label": "1 cup", "grams": 240.0}]},
              {"id": 2, "name": "Plain", "servingGrams": 100.0, "calories": 0, "protein": 0.0, "fat": 0.0, "carbs": 0.0, "servingLabel": "1 serving", "servings": []}]
    out["asScan"] = [[f, ff.food_as_scan_result(f)] for f in foods_]
    out["constants"] = [[None, {"food": [ff.FOOD_LIMIT, ff.EXERCISE_LIMIT, ff.MAX_NAME, ff.MAX_EMOJI, ff.MAX_LABEL, ff.MAX_BARCODE, ff.MAX_EXTRA_SERVINGS, ff.MAX_MACRO_GRAMS, ff.MAX_SERVING_GRAMS],
                                 "defaults": [ff.DEFAULT_FOOD_NAME, ff.DEFAULT_FOOD_EMOJI, list(ff.EXERCISE_MODES)], "overLimit": ff.over_limit_message(500), "ingredients": afg.MAX_INGREDIENTS,
                                 "token": [fs.TOKEN_URL, fs.BARCODE_URL, fs.FOOD_URL]}]]
    return out


def outcome_photo(afg, parsed):
    try:
        return ["ok", afg._validate(parsed)]
    except Exception:
        return ["crash"]
