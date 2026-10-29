"""Golden files for the Edge Functions: inputs run through the PYTHON code, with the answers written down.

The cross-language tests (tests/test_edge_functions.py) run the TypeScript beside the Python on seeded corpora, which proves they
agree today. These files let the TypeScript's own offline tests (`deno task test`, and the mutation runs built on it) check the same
answers without Python in the loop: supabase/functions/tests/fixtures/<name>_golden.json, each a list of [input, expected] pairs.
A test fails when a file is stale, so the golden answers can never drift from the Python they came from.

    python scripts/edge_golden.py            # rewrite the files
    python scripts/edge_golden.py --check    # exit 1 if one is stale
"""

import gzip
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "supabase" / "functions" / "tests" / "fixtures"


def coaching_payloads(rng):
    import coaching_engine as ce
    male = [r["id"] for r in ce.MALE_BODY_FAT_RANGES]
    female = [r["id"] for r in ce.FEMALE_BODY_FAT_RANGES]

    def valid_payload(**extra):
        gender = rng.choice(["male", "female"])
        payload = {"aspiration": rng.choice(["lose", "maintain", "gain"]), "gender": gender, "activity_level": rng.choice(["none", "cardio_only", "lift_only", "lift_and_cardio"]),
                   "protein_preference": rng.choice(["low_moderate", "moderate", "high", "highest"]), "diet_preference": rng.choice(["balanced", "low_fat", "low_carb", "keto", None, ""]),
                   "body_fat_range_id": rng.choice(male if gender == "male" else female), "weight_kg": round(rng.uniform(35, 300), rng.choice([0, 1, 2])), "height_cm": rng.choice([None, 150, 172.5, 200]),
                   "loss_rate_pct": rng.choice([None, 0.1, 0.27, 1.0, 1.5, 2.0]), "gain_rate_pct": rng.choice([None, 0.25, 0.35, 0.5, 0.8])}
        payload.update(extra)
        return payload

    payloads = [valid_payload() for _ in range(250)]
    breakers = [{"aspiration": "x"}, {"aspiration": ["lose"]}, {"gender": "other"}, {"activity_level": "much"}, {"protein_preference": 5}, {"diet_preference": "vegan"}, {"diet_preference": []}, {"diet_preference": {}},
                {"body_fat_range_id": "f1", "gender": "male"}, {"body_fat_range_id": "zz"}, {"weight_kg": 34.9}, {"weight_kg": 300.1}, {"weight_kg": "abc"}, {"weight_kg": None}, {"weight_kg": "80.5"}, {"weight_kg": " 80 "},
                {"weight_kg": True}, {"weight_kg": "1e2"}, {"weight_kg": "9_0"}, {"weight_kg": "inf"}, {"height_cm": 99}, {"height_cm": 251}, {"height_cm": "x"}, {"height_cm": "170"}, {"height_cm": 0},
                {"aspiration": "lose", "loss_rate_pct": 0.05}, {"aspiration": "lose", "loss_rate_pct": 2.02}, {"aspiration": "lose", "loss_rate_pct": 0.09}, {"aspiration": "lose", "loss_rate_pct": "x"},
                {"aspiration": "lose", "loss_rate_pct": "1.5"}, {"aspiration": "gain", "gain_rate_pct": 0.24}, {"aspiration": "gain", "gain_rate_pct": 0.81}, {"aspiration": "gain", "gain_rate_pct": 0.82},
                {"aspiration": "gain", "gain_rate_pct": "z"},
                {"aspiration": "lose", "loss_rate_pct": ce.LOSS_RATE_MIN_PCT - 0.01}, {"aspiration": "lose", "loss_rate_pct": ce.LOSS_RATE_MAX_PCT + 0.01},
                {"aspiration": "lose", "loss_rate_pct": ce.LOSS_RATE_MIN_PCT - 0.0100001}, {"aspiration": "lose", "loss_rate_pct": ce.LOSS_RATE_MAX_PCT + 0.0100001},
                {"aspiration": "gain", "gain_rate_pct": ce.GAIN_RATE_MIN_PCT - 0.01}, {"aspiration": "gain", "gain_rate_pct": ce.GAIN_RATE_MAX_PCT + 0.01},
                {"aspiration": "gain", "gain_rate_pct": ce.GAIN_RATE_MIN_PCT - 0.0100001}, {"aspiration": "gain", "gain_rate_pct": ce.GAIN_RATE_MAX_PCT + 0.0100001},
                {"weight_kg": 35}, {"weight_kg": 300}, {"height_cm": 100}, {"height_cm": 250}]
    for b in breakers:
        base = valid_payload(aspiration="lose", gender="male", body_fat_range_id="m2")
        base.update(b)
        payloads.append(base)
    payloads += [{}, {"aspiration": None}]
    return payloads


def build_coaching():
    """{name: [[input, expected], ...]} for the coaching engine, the profile check, the check-in prompt and the number readers."""
    import checkin_analyzer
    import coaching_engine as ce
    from api import coaching as flask_coaching
    rng = random.Random(45)
    out = {}

    payloads = coaching_payloads(random.Random(44))
    out["profiles"] = []
    valid = []
    for payload in payloads:
        profile, error = flask_coaching.validate_profile(payload)
        out["profiles"].append([payload, [profile, error]])
        if profile:
            valid.append(profile)

    weekdays = list(flask_coaching.WEEKDAYS)
    out["targets"] = [[p, ce.calculate_targets(p)] for p in valid[:150]]
    out["distributions"] = []
    for _, t in out["targets"][:60]:
        days = rng.sample(weekdays, rng.randint(0, 7))
        out["distributions"].append([[t, days], ce.distribute_weekly_calories(t["calories"], t["protein"], t["fat"], t["carbs"], set(days))])

    def kg(base):
        return rng.choice([lambda: int(base), lambda: round(base + rng.uniform(-3, 3), 1) + 0.05])()

    unknown = []
    for extra in ({"aspiration": "other"}, {"activity_level": "x"}, {"protein_preference": "x", "aspiration": "lose"}, {"body_fat_range_id": "zzz"}, {"diet_preference": "weird"}, {"aspiration": "lose", "protein_preference": "nope", "activity_level": "none"},
                  {"aspiration": "lose", "loss_rate_pct": None}, {"aspiration": "gain", "gain_rate_pct": None}, {"aspiration": "lose", "loss_rate_pct": 0}, {"aspiration": "gain", "gain_rate_pct": 0},
                  {"aspiration": "lose", "loss_rate_pct": 9}, {"aspiration": "gain", "gain_rate_pct": 9}, {"aspiration": "lose", "loss_rate_pct": -1}, {"gender": "female", "diet_preference": "keto", "aspiration": "lose"},
                  {"weight_kg": 300.0, "body_fat_range_id": "m1", "diet_preference": "keto"}, {"weight_kg": 36.0, "gender": "female", "body_fat_range_id": "f6", "diet_preference": "keto", "aspiration": "lose", "loss_rate_pct": 2.0}):
        base = {"aspiration": "maintain", "gender": "male", "activity_level": "lift_and_cardio", "protein_preference": "high", "diet_preference": "balanced", "body_fat_range_id": "m3",
                "weight_kg": 80.0, "height_cm": None, "loss_rate_pct": None, "gain_rate_pct": None}
        base.update(extra)
        unknown.append(base)
    out["targets"] += [[p, ce.calculate_targets(p)] for p in unknown]

    out["weekly"] = []
    for p in valid[:220]:
        cur = ce.calculate_targets(p)
        base = p["weight_kg"]
        n = rng.randint(0, 8)
        dates = [f"2026-10-{d:02d}" for d in rng.sample(range(1, 29), n)]
        weights = [{"date": d, "kg": kg(base + rng.uniform(-2, 2))} for d in dates]
        days = [{"date": f"2026-10-{d:02d}", "calories": rng.choice([int(cur["calories"] + rng.randint(-600, 600)), cur["calories"] + rng.randint(-3, 3) * 50, 1000 + rng.randint(0, 3000)])}
                for d in range(1, rng.randint(1, 9))]
        if rng.random() < .05:
            cur = {k: v for k, v in cur.items() if k != "protein"}
        if rng.random() < .03:
            weights = [{"date": "2026-10-01"}] + weights
        try:
            expected = ce.weekly_adjustment(p, cur, weights, days)
        except (KeyError, TypeError, ValueError, AttributeError):
            expected = "ERR"
        out["weekly"].append([[p, cur, weights, days], expected])

    edge_profiles = []
    for aspiration in ("lose", "gain", "maintain"):
        for gender, diet in (("male", "balanced"), ("female", "keto")):
            base = {"aspiration": aspiration, "gender": gender, "activity_level": "lift_only", "protein_preference": "moderate", "diet_preference": diet,
                    "body_fat_range_id": "m3" if gender == "male" else "f3", "weight_kg": 70.0, "height_cm": None, "loss_rate_pct": None, "gain_rate_pct": None}
            edge_profiles.append(base)
    bands = {"lose": (-1.0, -0.3), "gain": (0.15, 0.5), "maintain": (-0.3, 0.3)}
    for profile in edge_profiles:
        low, high = bands[profile["aspiration"]]
        cur = ce.calculate_targets(profile)
        found = []
        for first in range(60, 130):
            for edge in (low, high):
                for tenth in range(-8, 9):
                    last = round(first * (1 + edge / 100) + tenth * 0.05, 3)
                    pct = (last - first) / first * 100
                    if abs(pct - edge) < 0.12:
                        found.append((first, last, pct == edge))
        rng2 = random.Random(len(found))
        picks = [f for f in found if f[2]] + rng2.sample(found, min(14, len(found)))
        for first, last, _ in picks[:24]:
            for gap in (rng2.choice([-99, -100, 99, 100, 101, 250, -250, 1000, -1000, 0, 3, -3]),):
                avg = cur["calories"] + gap
                days = [{"date": f"2026-10-{d:02d}", "calories": avg} for d in (2, 3, 4)]
                weights = [{"date": "2026-10-01", "kg": first}, {"date": "2026-10-08", "kg": last}]
                try:
                    expected = ce.weekly_adjustment(profile, cur, weights, days)
                except (KeyError, TypeError, ValueError, AttributeError):
                    expected = "ERR"
                out["weekly"].append([[profile, cur, weights, days], expected])
        for gap in (-100, -99, 99, 100, 101, 102, 1000):
            days = [{"date": f"2026-10-{d:02d}", "calories": cur["calories"] + gap} for d in (2, 3, 4)]
            for weights in ([{"date": "2026-10-01", "kg": 70}, {"date": "2026-10-08", "kg": 70.2}], [{"date": "2026-10-01", "kg": 0}, {"date": "2026-10-08", "kg": 0}], [{"date": "2026-10-01", "kg": 70}, {"date": "2026-10-08", "kg": 70.6}]):
                out["weekly"].append([[profile, cur, weights, days], ce.weekly_adjustment(profile, cur, weights, days)])
        for bad_cur in ({"calories": cur["calories"], "protein": "165"}, {"calories": cur["calories"]}, {"protein": 165}, {"calories": "2000", "protein": 165}):
            weights = [{"date": "2026-10-01", "kg": 70}, {"date": "2026-10-08", "kg": 90}]
            days = [{"date": f"2026-10-{d:02d}", "calories": 2000} for d in (2, 3, 4)]
            try:
                expected = ce.weekly_adjustment(profile, bad_cur, weights, days)
            except (KeyError, TypeError, ValueError, AttributeError):
                expected = "ERR"
            out["weekly"].append([[profile, bad_cur, weights, days], expected])
        for dates in (["b", "a"], [5, 3], ["2026-10-02", "2026-10-02"], [5, "a"]):
            weights = [{"date": dates[0], "kg": 70}, {"date": dates[1], "kg": 69}]
            days = [{"date": f"2026-10-{d:02d}", "calories": cur["calories"] + 300} for d in (2, 3, 4)]
            try:
                expected = ce.weekly_adjustment(profile, cur, weights, days)
            except (KeyError, TypeError, ValueError, AttributeError):
                expected = "ERR"
            out["weekly"].append([[profile, cur, weights, days], expected])

    out["applied"] = []
    for p in valid[:120]:
        cur = ce.calculate_targets(p)
        delta = rng.choice([0, 1, -1, 150, -150, 151, -151, 40.5, 41.5, -40.5, 99.9, rng.randint(-400, 400)])
        out["applied"].append([[p, cur, delta, "because"], ce.apply_calorie_delta(p, cur, delta, "because")])

    out["prompts"] = []
    for (case, outcome) in out["weekly"][:150]:
        p, cur, weights, days = case
        if outcome == "ERR" or "protein" not in cur or len(out["prompts"]) >= 20:
            continue
        baseline = outcome if isinstance(outcome, dict) else None
        front, back = rng.choice([(True, True), (True, False), (False, True), (False, False)])
        p2 = dict(p, weight_kg=round(p["weight_kg"] + 0.37, 2))
        if rng.random() < .1:
            weights, days = [], []
        # the Python prompt reads a key the profile never has ("weightKg") and so printed "None kg"; the port fixed that, so the comparison gives it the key
        out["prompts"].append([[p2, cur, weights, days, baseline, front, back], checkin_analyzer._build_prompt(dict(p2, weightKg=p2["weight_kg"]), cur, weights, days, baseline, front, back)])
    odd = dict(out["prompts"][0][0][0])
    for weights, days in ([{"date": 5, "kg": None}], [{"date": "x", "calories": 2000.5}]), ([{"date": "d", "kg": True}], []), ([{"date": "d", "kg": "70"}], [{"date": "e", "calories": 2500.5}, {"date": "f", "calories": 1999.5}]):
        out["prompts"].append([[odd, {"calories": 2100.5, "protein": 150}, weights, days, None, False, False], checkin_analyzer._build_prompt(dict(odd, weightKg=odd["weight_kg"]), {"calories": 2100.5, "protein": 150}, weights, days, None, False, False)])
    first = out["prompts"][0][0][0]
    out["prompts"].append([[first, None, [], [], None, False, False], checkin_analyzer._build_prompt(dict(first, weightKg=first["weight_kg"]), None, [], [], None, False, False)])

    out["extracted"] = []
    for r in ['{"delta": -100, "reason": "ok"}', '```json\n{"delta": 20, "reason": "x"}\n```', 'Here:\n```\n{"delta": 5}\n```\nbye', '  {"delta": "30", "reason": "r"}  ', "not json", "", "```json\n```", '{"delta": 1.9}',
              '[1, 2]', '"a string"', 'null', '```json\n{"a":\n```', '{"delta": 3, "reason": null}', '{"nested": {"delta": 3}}', '```JSON\n{"delta": 4}\n```']:
        try:
            out["extracted"].append([r, {"ok": checkin_analyzer._extract_json(r)}])
        except ValueError:
            out["extracted"].append([r, "ERR"])

    round_values = ([0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5, 0.49999999999999994, 2.675, 1.005, 0.125, 0.375, 0.625, 2.5000000000000004, 1e15 + 0.5, 12345.5, 9.995, 0.045, -0.125, -2.675]
                    + [round(rng.uniform(-50, 50), rng.choice([1, 2, 3])) for _ in range(300)] + [k + 0.5 for k in range(-20, 20)] + [k / 8 for k in range(-40, 40)])
    out["rounds"] = [[x, [round(x), round(x, 2)]] for x in round_values]

    out["ints"] = []
    for v in [5, -5, 3.7, -3.7, "5", " 5 ", "+5", "-5", "5.0", "5.5", "1_000", "1__0", "_1", "1_", True, False, None, [], {}, "x", "", 1e20, 0, -0.0, "0", "00", " 5", "\x855", "29", " 987 ", "-4567", "+12", "10", "1e2", "\u0663", "\U0001d7d9\U0001d7da", "\U0001d7ec\U0001d7ed\U0001d7ee", "\u0966\u0967"]:
        try:
            out["ints"].append([v, int(v)])
        except (ValueError, TypeError, OverflowError):
            out["ints"].append([v, "ERR"])
    return out


def build_split():
    """{name: [[input, expected], ...]} for the split generator: the fallback plan, the prompts, the validation of a model's plan, the lifter text, the route's input cleaning.
    Inputs that hold a dict whose ORDER matters are written with their keys sorted (the file is written with sorted keys), and a picked-exercises map travels as [[label, names], ...]."""
    import split_planner as sp
    from api.routes import planning as rp
    rng = random.Random(46)
    out = {}
    all_names = list(sp.WORKOUT_EXERCISES)

    def digest(index, text):
        """A prompt carries the whole 735-name exercise list, so most are kept as a hash (and a length); every 40th keeps its text, so a failure can show a difference."""
        import hashlib
        entry = {"sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "chars": len(text)}
        if index % 40 == 0:
            entry["text"] = text
        return entry

    def err(fn, *args):
        try:
            return fn(*args)
        except (ValueError, TypeError, AttributeError):
            return "ERR"

    phrases = [None, "", "  ", "build muscle", "I'm pregnant", "get faster for my sport", "improve mobility and flexibility", "lift and carry my toddler", "better balance, I'm elderly",
               "hyrox race", "mobility + faster + balance", "cardio and stamina", "FASTER AND MORE FLEXIBLE", "pregnant, want to stay flexible", "Ünïcödé goal ☃ 💪", 'say "hi" and \\ go', "  padded goal  "]
    for day_type, keywords in sp._GOAL_KEYWORD_MAP.items():
        phrases += [f"I want {kw} please" for kw in keywords]
    split_types = ["ppl", "upper_lower", "full_body", "bro_split", "custom", "weird", ""]
    custom_pool = ["Chest Day", "Back & Biceps", "Rest-ish", "Mobility", "Push", "legs", "Arm Day", "Core", "Zebra", "Hyrox Day", "Stretch", "Plyo", "Prenatal", "ÜBER", "Full Body A", "Conditioning",
                   "Brüst-Tag", "胸 Day", "Day 💪", "Shoulders", "Abs", "Carry", "Balance", "Speed"]
    locations = [None, "home", "gym", "hybrid", "weird", ""]

    def picked_pairs(labels):
        if rng.random() < .5:
            return None
        chosen = rng.sample(labels, rng.randint(0, len(labels)))
        return [[label, rng.sample(all_names, rng.randint(1, 9))] for label in chosen]

    def case():
        split = rng.choice(split_types)
        dpw = rng.randint(1, 7)
        custom = rng.sample(custom_pool, rng.randint(1, 6)) if split == "custom" or rng.random() < .1 else None
        labels = custom or list(sp.SPLIT_DAY_TYPES.get(split, ["Full Body"]))
        if rng.random() < .3:
            labels = labels + rng.sample(custom_pool, 2)
        return [split, dpw, custom, rng.choice(phrases), picked_pairs(labels), rng.choice(locations)]

    sweep = [[s, d, None, None, None, loc] for s in ("ppl", "upper_lower", "full_body", "bro_split", "custom", "weird") for d in range(1, 8) for loc in locations]
    sweep += [["custom", d, ["Chest Day", "Mobility", "Zebra"], None, None, loc] for d in range(1, 8) for loc in locations]
    sweep += [["ppl", d, None, goal, None, loc] for goal in phrases for d in (2, 5) for loc in (None, "hybrid")]
    cases = sweep + [case() for _ in range(300)]
    # a picked-for-every-day case (the whole-plan pregnancy rule is skipped) and a partly picked one
    cases += [["ppl", 4, None, "pregnant", [["Push", ["Squat"]], ["Pull", ["Pull-Up"]], ["Legs", ["Leg Press"]]], None], ["ppl", 4, None, "pregnant", [["Push", ["Squat"]]], None],
              ["custom", 3, ["A", "B"], "pregnant", [["A", ["Squat"]], ["B", ["Pull-Up"]]], "home"], ["custom", 3, ["A", "B"], "pregnant", [], "home"]]

    def to_dict(pairs):
        return None if pairs is None else dict((k, v) for k, v in pairs)

    out["fallback"] = [[c, sp.build_fallback_plan(c[0], c[1], c[2], c[3], to_dict(c[4]), c[5])] for c in cases]
    prompt_cases = cases[: len(sweep) // 3] + cases[len(sweep):]
    out["prompts"] = [[c, digest(i, sp._build_prompt(c[0], c[1], c[2], c[3], to_dict(c[4]), c[5]))] for i, c in enumerate(prompt_cases)]

    suggest_cases = []
    weights = [(None, None), (80.0, 70.0), (70.0, 75.5), (70.0, 70.75), (70.0, 75.25), (70.0, 70.5), (70.0, 70.4), (70.0, 69.5), (70.0, 69.4), (70.0, 64.75), (100.0, 94.75), (60.0, 60.0), (20.0, 500.0), (500.0, 20.0),
               (72.35, 68.15), (33.3, 31.1), (None, 65.5), (65.5, None), (70.1, 70.65), (80.0, 79.95), (123.456, 100.001)]
    for dpw in range(1, 8):
        for goal in (None, "", "get stronger", "I'm pregnant and want mobility", 'tricky "quote"'):
            for gender in (None, "male", "female"):
                for loc in (None, "home", "gym", "hybrid"):
                    suggest_cases.append([dpw, goal, gender, *rng.choice(weights), loc])
    for dpw in range(1, 8):
        for gw, cw in weights:
            suggest_cases.append([dpw, "go", "female", gw, cw, "gym"])
    out["suggestPrompts"] = [[c, digest(i, sp._build_suggest_prompt(c[0], c[1], c[2], c[3], c[4], c[5]))] for i, c in enumerate(suggest_cases)]
    out["lifters"] = [[[g, gw, cw], sp._describe_lifter(g, gw, cw)] for g in (None, "male", "female", "other") for gw, cw in weights]

    out["beginner"] = []
    for dpw in range(1, 8):
        for goal in (None, "pregnant", "faster and more flexible", "hyrox and balance"):
            for loc in locations:
                out["beginner"].append([[sp.BEGINNER_SPLIT_BY_DAYS[dpw], dpw, goal, loc], sp._beginner_fallback(sp.BEGINNER_SPLIT_BY_DAYS[dpw], dpw, goal, loc)])
                for split in ("ppl", "bro_split"):
                    out["beginner"].append([[split, dpw, goal, loc], sp._beginner_fallback(split, dpw, goal, loc)])

    # what a model might send back: a plausible plan, then broken in assorted ways
    def ai_plan(dpw, loc):
        labels = [rng.choice(["Push", "Pull", "Legs", "Upper", "Lower", "Full Body", "Chest Day", "Mobility", "Athletic"]) for _ in range(dpw)]
        pool = [n for n in all_names if loc in (None, "weird") or sp.EXERCISE_LOCATIONS.get(n) in sp.LOCATION_ALLOWED.get(loc, {"home", "gym", "both"})]
        days = [{"label": label, "exercises": rng.sample(pool, rng.randint(2, 9))} for label in labels]
        slots = [i for i, on in enumerate(sp.DEFAULT_TRAIN_PATTERNS[dpw]) if on]
        schedule = {d: "Rest" for d in sp.WEEKDAY_ORDER}
        for n, i in enumerate(slots):
            schedule[sp.WEEKDAY_ORDER[i]] = labels[n]
        return {"days": days, "schedule": schedule, "rationale": rng.choice(["Because rest.", "  padded  ", "", None, 5, ["x"], "ünï"])}

    def sorted_dict(d):
        return dict(sorted(d.items()))

    def break_it(plan, dpw):
        plan = json.loads(json.dumps(plan))
        before = json.loads(json.dumps(plan))
        try:
            return break_once(plan)
        except (TypeError, KeyError, IndexError, AttributeError, ValueError):  # an earlier break left nothing to break again
            return before

    def break_once(plan):
        kind = rng.randint(0, 22)
        day = rng.choice(plan["days"])
        if kind == 1:
            day["exercises"][0] = "Totally Invented Lift"
        elif kind == 2:
            day["exercises"] = day["exercises"][:rng.randint(0, 2)]
        elif kind == 3:
            day["label"] = rng.choice(["", "  ", "  Push  ", None, 5, ["Push"], True, "　Legs　"])
        elif kind == 4:
            plan["schedule"][rng.choice(sp.WEEKDAY_ORDER)] = rng.choice(["Unknown", " Push ", None, 5, "rest", "Rest "])
        elif kind == 5:
            plan["schedule"] = {d: ("Rest" if i % 2 else plan["days"][0]["label"]) for i, d in enumerate(sp.WEEKDAY_ORDER)}
        elif kind == 6:
            plan["schedule"] = {d: plan["days"][0]["label"] for d in sp.WEEKDAY_ORDER}
        elif kind == 7:
            plan["schedule"].pop(rng.choice(sp.WEEKDAY_ORDER))
        elif kind == 8:
            plan["schedule"]["funday"] = "Rest"
        elif kind == 9:
            plan["schedule"] = rng.choice([[], "x", None, 5])
        elif kind == 10:
            plan["days"] = plan["days"][:-1]
        elif kind == 11:
            plan["days"] = rng.choice([None, {}, "x", 5, plan["days"] + plan["days"][:1]])
        elif kind == 12:
            plan["days"][0] = rng.choice([None, "x", ["a"], 5])
        elif kind == 13:
            plan.pop(rng.choice(["rationale", "schedule", "days"]))
        elif kind == 14:
            day["exercises"] = rng.choice(["Squat", "S", "", None, 5, {"Squat": 1, "Bench Press": 2}, sorted_dict({"Pull-Up": 1, "Squat": 2, "x": 3}), {}, True])
        elif kind == 15:
            day["exercises"][rng.randrange(len(day["exercises"]))] = rng.choice([["Squat"], {"a": 1}, None, 5, True, 1.5])
        elif kind == 16:
            day["exercises"] = day["exercises"] * 3
        elif kind == 17:
            day["exercises"] = [n for n in all_names[:40]]
        elif kind == 18:
            plan["rationale"] = rng.choice([None, "", "  ", "  fine  ", 0, False, ["a", "b"], {"k": 1}, 2.5, True])
        elif kind == 19:
            day.pop("label", None)
        elif kind == 20:
            day.pop("exercises", None)
        elif kind == 21:
            plan = rng.choice([[], "x", None, 5, {"days": 5}])
        return plan

    out["validate"] = []
    for _ in range(900):
        dpw = rng.randint(1, 7)
        loc = rng.choice(locations)
        plan = ai_plan(dpw, loc)
        for _ in range(rng.choice([0, 0, 1, 1, 2])):
            plan = break_it(plan, dpw)
        picked = None
        if isinstance(plan, dict) and isinstance(plan.get("days"), list) and rng.random() < .3:
            labels = [d.get("label") for d in plan["days"] if isinstance(d, dict) and isinstance(d.get("label"), str)]
            if labels:
                lab = rng.choice(labels)
                chosen = [d for d in plan["days"] if isinstance(d, dict) and d.get("label") == lab][0]
                names = [e for e in chosen.get("exercises", []) if isinstance(e, str) and e in sp.VALID_EXERCISES] if isinstance(chosen.get("exercises"), list) else []
                if names and rng.random() < .6:
                    picked = [[lab.strip(), names]]
                else:
                    picked = [[lab.strip(), rng.sample(all_names, 3)]]
        opts = rng.choice([None, None, {"min_exercises": 3, "max_exercises": 8}, {"min_exercises": rng.randint(3, 5), "max_exercises": rng.randint(5, 7), "top_up_short_days": True},
                           {"min_exercises": 5, "max_exercises": 6, "top_up_short_days": True}, {"top_up_short_days": True}])
        args = [plan, dpw, picked, loc, opts]
        out["validate"].append([args, err(lambda a: sp._validate_plan(a[0], a[1], to_dict(a[2]), a[3], **(a[4] or {})), args)])
    # every AI plan that is already fine, to prove the accepting side as well
    for _ in range(150):
        dpw = rng.randint(1, 7)
        loc = rng.choice(locations)
        lab = ["Push", "Pull", "Legs", "Upper", "Lower", "Chest Day", "Mobility"][:dpw]
        pool = [n for n in all_names if loc in (None, "weird") or sp.EXERCISE_LOCATIONS.get(n) in sp.LOCATION_ALLOWED.get(loc, {"home", "gym", "both"})]
        labels = [lab[i % len(lab)] for i in range(dpw)]
        plan = {"days": [{"label": x, "exercises": rng.sample(pool, rng.randint(3, 10))} for x in labels], "schedule": {d: "Rest" for d in sp.WEEKDAY_ORDER}, "rationale": "ok"}
        for n, i in enumerate([i for i, on in enumerate(sp.DEFAULT_TRAIN_PATTERNS[dpw]) if on]):
            plan["schedule"][sp.WEEKDAY_ORDER[i]] = labels[n]
        args = [plan, dpw, None, loc, rng.choice([None, {"min_exercises": 4, "max_exercises": 5, "top_up_short_days": True}])]
        out["validate"].append([args, err(lambda a: sp._validate_plan(a[0], a[1], None, a[3], **(a[4] or {})), args)])

    out["streaks"] = []
    for mask in range(128):
        schedule = {d: ("X" if mask >> i & 1 else "Rest") for i, d in enumerate(sp.WEEKDAY_ORDER)}
        out["streaks"].append([schedule, sp.longest_training_streak(schedule)])
    out["streaks"].append([{}, sp.longest_training_streak({})])
    out["streaks"].append([{"monday": "X"}, sp.longest_training_streak({"monday": "X"})])
    out["streaks"].append([{d: "X" for d in sp.WEEKDAY_ORDER}, sp.longest_training_streak({d: "X" for d in sp.WEEKDAY_ORDER})])

    out["extracted"] = []
    for r in ['{"days": []}', '```json\n{"a": 1}\n```', 'Here:\n```\n{"a": 2}\n```\nbye', "  [1]  ", "nope", "", "```json\n```", "```JSON\n{}\n```", "null", '{"a":', "```\n```\n{}", '{"split_type": "ppl"}']:
        out["extracted"].append([r, err(lambda t: {"ok": sp._extract_json(t)}, r)])  # json.loads raises ValueError (JSONDecodeError)

    out["floats"] = [[v, rp._optional_positive_float(v)] for v in [None, True, False, 0, 20, 19.99, 20.0, 500, 500.01, "80", "80.5", " 80 ", "abc", "1e2", "1_0", "inf", "nan", [], {}, 33.3, 250, -5, "٣٠", "30", "+30", "3e1", "20_0", 1e308, "1e400"]]
    long_names = ["x" * 100, "é" * 70, "　a　", "\U0001f4aa" * 61, "  b  "]
    out["customDays"] = [[v, rp._custom_days(v)] for v in [None, [], "", "abc", {"a": 1}, ["a", "b"], [" a ", "", "  "], [str(i) for i in range(14)], [str(i) for i in range(15)], [1, "a"], long_names, ["x"], 0, False, 5, [None]]]
    picks = [None, [], "x", {}, {"A": ["Squat", "nope", 5, ["Squat"]]}, {"A": "Squat"}, {"x" * 61: ["Squat"]}, {"\U0001f4aa" * 61: ["Squat"]}, {"A": []}, {"A": ["nope"]},
             {"A": ["Squat", "Pull-Up"], "B": ["Leg Press"], "C": ["nope"], "D": 5}, {"Brüst-Tag": ["Squat"]}, {"y" * 59 + "é" + "z": ["Squat"]}]
    out["handPicked"] = [[v, None if (r := rp._hand_picked_exercises(v)) is None else list(r.items())] for v in picks]

    out["constants"] = [[None, {
        "dayTypePools": sp.DAY_TYPE_POOLS, "wide": sp.DAY_TYPE_WIDE_POOLS, "splitDayTypes": sp.SPLIT_DAY_TYPES, "keywordPool": [list(p) for p in sp._KEYWORD_POOL],
        "goalKeywords": [[k, list(v)] for k, v in sp._GOAL_KEYWORD_MAP.items()], "patterns": {str(k): v for k, v in sp.DEFAULT_TRAIN_PATTERNS.items()},
        "locationAllowed": {k: sorted(v) for k, v in sp.LOCATION_ALLOWED.items()}, "beginnerRanges": {str(k): list(sp._beginner_exercise_range(k)) for k in range(1, 8)},
        "beginnerSplits": {str(k): v for k, v in sp.BEGINNER_SPLIT_BY_DAYS.items()}, "suggestible": list(sp.SUGGESTIBLE_SPLIT_TYPES), "maxGoal": sp.MAX_GOAL_DAY_TYPES,
        "maxStreak": sp.MAX_ACCEPTABLE_STREAK, "suggestModel": sp.SUGGEST_GEMINI_MODEL, "model": sp.GEMINI_MODEL, "schema": sp.SUGGEST_RESPONSE_SCHEMA, "weekdays": sp.WEEKDAY_ORDER,
        "beginnerMin": sp.BEGINNER_MIN_EXERCISES, "beginnerMax": sp.BEGINNER_MAX_EXERCISES,
        "routeLimits": {"customDays": rp.MAX_CUSTOM_DAYS, "goalChars": rp.MAX_GOAL_CHARS, "splitTypes": sorted(rp.SPLIT_TYPES)}}]]
    return out


def build_hyrox():
    """{name: [[input, expected], ...]} for the HYROX race analysis: the prompt, the reading of the model's answer, the clock, str.title()."""
    import hyrox_coach as hc
    rng = random.Random(47)
    out = {}

    def err(fn, *args):
        try:
            return fn(*args)
        except (ValueError, TypeError, AttributeError, OverflowError):
            return "ERR"

    words = [None, "", "open", "pro", "Pro Doubles", "doubles", "élite", "o'brien", "ǆ", "ß", "ΑΣ", "ΑΣ ΑΣ", "3rd place", "hello-world", "MIXED", "elite 15", "i\u0307", "\u0130", "ﬁne", "x" * 3, 5, True, ["a"], {"k": 1}, "  padded  ", "\U0001f3cb gym"]
    seconds = [0, 1, 59.5, 60, 61.5, 90.5, 3599.5, 3600.5, 3601.5, 5400.4999, 12.5, 7.5, 100, 4000.25, -5, -0.5, True, False, 1e30, 86399, 2.5, 3.5, 1e15 + 0.5, "x", "90", None, [], {}]
    titles = [None, "", "SkiErg", "Run 1", "  Sled Push ", "Wall Balls", 7, "é" * 3, "\U0001f3cb"]

    def segment():
        kind = rng.choice(["run", "station", "station", "other", None])
        seg = {"type": kind, "key": rng.choice(list(hc.STATION_KEYS) + ["run1", "", None, "  skierg ", 5]), "title": rng.choice(titles), "seconds": rng.choice(seconds)}
        if rng.random() < .1:
            seg.pop(rng.choice(["type", "key", "title", "seconds"]))
        return seg

    races = []
    for _ in range(300):
        race = {"category": rng.choice(words), "format": rng.choice(words), "gender": rng.choice(words), "total_seconds": rng.choice(seconds),
                "segments": [segment() if rng.random() > .08 else rng.choice([None, "x", 5, [], ["a"]]) for _ in range(rng.randint(0, 20))]}
        if rng.random() < .1:
            race.pop(rng.choice(["category", "format", "gender", "total_seconds", "segments"]))
        races.append(race)
    races += [{"segments": []}, {}, {"segments": None}, {"segments": [{"type": "run", "title": "Run 1", "seconds": 270}] * 8 + [{"type": "station", "key": k, "title": k, "seconds": 200 + i * 7} for i, k in enumerate(hc.STATION_KEYS)],
                                                 "category": "pro", "format": "doubles", "gender": "female", "total_seconds": 4321}]
    out["prompts"] = [[r, err(hc._build_prompt, r)] for r in races]

    texts = ['{"overall": "Fix wall balls.", "overall_detail": ["a", "b"], "tips": [{"key": "skierg", "rating": "Strong", "tip": " Pull longer ", "detail": ["x", "", null, 5, "y"]}]}',
             '{"overall": 5, "overall_detail": "no", "tips": {"key": "row"}}', '{"tips": 5}', '{"tips": true, "overall": "kept"}', '{"overall": "before", "tips": [{"key": "row", "tip": "t"}, 5, null, "x", {"key": "nope"}, {"key": "row", "rating": "bad", "tip": "second"}]}',
             "not json", "", "null", "[]", "[1, 2]", '"text"', "{}", '{"overall": null, "overall_detail": [1,2,3,4,5,6,7], "tips": []}', '{"overall": "  spaced  ", "overall_detail": ["  a  ", "   ", "b", "c", "d", "e", "f"]}',
             '{"tips": [{"key": "lunges", "rating": "FOCUS", "tip": "t", "detail": {"a": 1}}, {"key": " wallBalls ", "rating": "  solid ", "tip": ["l"], "detail": [["n"], {"k": 1}, true]}]}',
             '{"overall": ["a"], "overall_detail": [[1, 2], {"a": 1}, 0, false, "z"]}', '{"tips": "abc", "overall": "o"}', '{"tips": {"a": 1}, "overall": "o"}', '{"tips": 0, "overall": "o"}', '{"tips": 1.5}']
    for key in hc.STATION_KEYS:
        texts.append('{"tips": [{"key": "%s", "rating": "strong", "tip": "tip for %s", "detail": ["d1", "d2"]}]}' % (key, key))
    out["coerced"] = [[t, [list(hc._coerce_result(t)[:2]) + [hc._coerce_result(t)[2]]][0]] for t in texts]
    out["bullets"] = [[v, hc._coerce_bullets(v)] for v in [None, "x", [], ["a"], ["a", "", " b "], [1, 2, 3, 4, 5, 6, 7, 8], [None, 0, "", "z"], [["q"], {"r": 1}], {"a": 1}, 5, True]]
    out["clocks"] = [[v, err(hc._clock, v)] for v in seconds + [0.5, 1.5, -1.5, 59.4, 59.5, 59.6, 1e20, 123456789.5, float("1e308")]]
    out["titles"] = [[w, w.title()] for w in [w for w in words if isinstance(w, str)] + ["a1b", "ab-cd ef_gh", "ΣΑΣ", "ΑΣ.", "ǅ", "ǆx", "ŉ", "ꭰ", "ª", "ⅷ", "Ⓐb", "ǈ", "A\u0345b", "\u1e9e", "ß ß", "ﬃ", "x\u00ady", "\u02b0a"]]
    out["constants"] = [[None, {"stations": hc.STATION_KEYS, "ratings": sorted(hc.VALID_RATINGS), "bullets": hc.MAX_DETAIL_BULLETS, "model": hc.GEMINI_MODEL, "limit": hc.SESSION_ANALYSIS_LIMIT,
                                "window": hc.SESSION_WINDOW_SECONDS, "neutral": hc._neutral_tips(), "titles": hc.STATION_TITLES}]]
    return out


def build_food():
    """{name: [[input, expected], ...]} for the food code: see edge_golden_food.py."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import edge_golden_food
    return edge_golden_food.build()


GOLDEN = {"coaching": build_coaching, "split": build_split, "hyrox": build_hyrox, "food": build_food}
# a big file is kept compressed (the split generator's is several MB of prompts and plans); the tests decompress it
COMPRESSED = {"split", "hyrox", "food"}


def render(name):
    return json.dumps(GOLDEN[name](), sort_keys=True, separators=(",", ":"))


def path_of(name):
    return FIXTURES / (f"{name}_golden.json.gz" if name in COMPRESSED else f"{name}_golden.json")


def read_back(target, name):
    if not target.exists():
        return ""
    if name in COMPRESSED:
        return gzip.decompress(target.read_bytes()).decode("utf-8")
    return target.read_text(encoding="utf-8").replace("\r\n", "\n")


if __name__ == "__main__":
    stale = False
    for name in GOLDEN:
        target = path_of(name)
        text = render(name)
        if "--check" in sys.argv:
            stale |= read_back(target, name) != text
        else:
            FIXTURES.mkdir(parents=True, exist_ok=True)
            if name in COMPRESSED:
                target.write_bytes(gzip.compress(text.encode("utf-8"), 9, mtime=0))
            else:
                target.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {target.relative_to(ROOT)} ({len(text) // 1024} KB of JSON, {target.stat().st_size // 1024} KB on disk)")
    sys.exit(1 if stale else 0)
