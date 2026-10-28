"""Golden files for the Edge Functions: inputs run through the PYTHON code, with the answers written down.

The cross-language tests (tests/test_edge_functions.py) run the TypeScript beside the Python on seeded corpora, which proves they
agree today. These files let the TypeScript's own offline tests (`deno task test`, and the mutation runs built on it) check the same
answers without Python in the loop: supabase/functions/tests/fixtures/<name>_golden.json, each a list of [input, expected] pairs.
A test fails when a file is stale, so the golden answers can never drift from the Python they came from.

    python scripts/edge_golden.py            # rewrite the files
    python scripts/edge_golden.py --check    # exit 1 if one is stale
"""

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


GOLDEN = {"coaching": build_coaching}


def render(name):
    return json.dumps(GOLDEN[name](), sort_keys=True, separators=(",", ":"))


if __name__ == "__main__":
    stale = False
    for name in GOLDEN:
        target = FIXTURES / f"{name}_golden.json"
        text = render(name)
        if "--check" in sys.argv:
            current = target.read_text(encoding="utf-8").replace("\r\n", "\n") if target.exists() else ""
            stale |= current != text
        else:
            FIXTURES.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {target.relative_to(ROOT)} ({len(text) // 1024} KB)")
    sys.exit(1 if stale else 0)
