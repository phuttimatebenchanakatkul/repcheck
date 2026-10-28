import { assert, assertEquals } from "@std/assert";

import { analyzeCheckin, buildPrompt, CHECKIN_MODEL, CheckinAnalysisError, extractJson } from "../_shared/checkin.ts";
import { boundedList, MAX_CHECKIN_PHOTOS, MAX_LOG_ENTRIES, mimeFor, ownPhotos, trainingDays, validateProfile } from "../_shared/coaching.ts";
import { WEEKLY_ADJUSTMENT_LIMIT } from "../_shared/coachingData.ts";
import { applyCalorieDelta, BadCheckin, calculateTargets, distributeWeeklyCalories, type Profile, type Targets, weeklyAdjustment } from "../_shared/coachingEngine.ts";
import { pyFloat, pyInt, pyRound, pyRound2, pyTruthy } from "../_shared/pyNumbers.ts";
import { GeminiError, toBase64 } from "../_shared/gemini.ts";
import { app, bearer, FakeDb, FakeGemini, fakeTransport, USER } from "./support.ts";

const BASE: Profile = {
  aspiration: "maintain", gender: "male", activity_level: "lift_and_cardio", protein_preference: "high", diet_preference: "balanced",
  body_fat_range_id: "m3", weight_kg: 80, height_cm: null, loss_rate_pct: null, gain_rate_pct: null,
};
const tx = (db: FakeDb) => db.transaction((t) => Promise.resolve(t));

// ---- Python's numbers ---------------------------------------------------------------------------------------------------------

Deno.test("round() goes to the even number on a tie, as Python's does", () => {
  assertEquals([0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5, 2.4, 2.6, -2.6].map(pyRound), [0, 2, 2, 4, -0, -2, -2, 2, 3, -3]);
  assertEquals(pyRound(0.49999999999999994), 0);
  assertEquals([pyRound(Infinity), pyRound(NaN)].map(String), ["Infinity", "NaN"]);
});

Deno.test("round(x, 2) is exact: a tie goes to the even digit, anything else by its true value", () => {
  assertEquals([0.125, 0.375, 0.625, -0.125, 2.675, 1.005, 0.045, 9.995, 1.234, 1.235, 1.2351, -1.2351, 0].map(pyRound2), [0.12, 0.38, 0.62, -0.12, 2.67, 1, 0.04, 9.99, 1.23, 1.24, 1.24, -1.24, 0]);
  assertEquals(pyRound2(Infinity), Infinity);
});

Deno.test("float() and int() read what Python's do", () => {
  assertEquals(["3600.5", " 3600 ", "1e3", "3_600", ".5", "5.", "+5", "-5", true, 7].map(pyFloat), [3600.5, 3600, 1000, 3600, 0.5, 5, 5, -5, 1, 7]);
  for (const bad of ["", "abc", "1__0", "_1", "0x10", "inf", "nan", "1e", null, undefined, [], {}]) assert(Number.isNaN(pyFloat(bad)), String(bad));
  assertEquals([5, -5, 3.7, -3.7, "5", " 5 ", "+5", "1_000", true, false, 1e20].map(pyInt), [5, -5, 3, -3, 5, 5, 5, 1000, 1, 0, 1e20]);
  for (const bad of ["5.0", "5.5", "x", "", "1__0", "_1", null, undefined, [], {}, Infinity, NaN]) assert(Number.isNaN(pyInt(bad)), String(bad));
  assertEquals([null, undefined, false, 0, "", [], {}, "0", [0], { a: 1 }, 1, "x", true].map(pyTruthy), [false, false, false, false, false, false, false, true, true, true, true, true, true]);
});

// ---- the profile -----------------------------------------------------------------------------------------------------------------

const payload = (extra: Record<string, unknown> = {}) => ({
  aspiration: "maintain", gender: "male", activity_level: "lift_and_cardio", protein_preference: "high", body_fat_range_id: "m3", weight_kg: 80, ...extra,
});
const refused = (extra: Record<string, unknown>) => validateProfile(payload(extra))[1];

Deno.test("a good profile is accepted and filled in", () => {
  const [profile, error] = validateProfile(payload());
  assertEquals(error, null);
  assertEquals(profile, { ...BASE });
  assertEquals(validateProfile(payload({ diet_preference: "keto", height_cm: "172.5", aspiration: "lose", loss_rate_pct: "1.5" }))[0], { ...BASE, diet_preference: "keto", height_cm: 172.5, aspiration: "lose", loss_rate_pct: 1.5 });
  assertEquals(validateProfile(payload({ diet_preference: [] }))[0]!.diet_preference, "balanced", "an empty list is as good as none");
  assertEquals(validateProfile(payload({ diet_preference: "" }))[0]!.diet_preference, "balanced");
});

Deno.test("each part of a profile has its own refusal", () => {
  assertEquals(refused({ aspiration: "x" }), "Please choose a goal: lose, maintain, or gain weight.");
  assertEquals(refused({ aspiration: ["lose"] }), "Please choose a goal: lose, maintain, or gain weight.");
  assertEquals(refused({ gender: "other" }), "Please choose a gender.");
  assertEquals(refused({ activity_level: "much" }), "Please choose an activity level.");
  assertEquals(refused({ protein_preference: 5 }), "Please choose a protein intake level.");
  assertEquals(refused({ diet_preference: "vegan" }), "Please choose a diet type.");
  assertEquals(refused({ body_fat_range_id: "f1" }), "Please choose a body type.");
  assertEquals(refused({ body_fat_range_id: "zz" }), "Please choose a body type.");
  assertEquals(validateProfile(payload({ gender: "female", body_fat_range_id: "f1" }))[1], null);
  for (const bad of [34.9, 300.1, "abc", null, undefined, "inf", true, NaN, "0x50"]) assertEquals(refused({ weight_kg: bad }), "Please enter a realistic weight of at least 35 kg.", String(bad));
  for (const ok of [35, 300, "80.5", " 80 ", "1e2"]) assertEquals(refused({ weight_kg: ok }), null, String(ok));
  for (const bad of [99, 251, "x", 0, true]) assertEquals(refused({ height_cm: bad }), "Please choose a realistic height.", String(bad));
  for (const ok of [100, 250, null, undefined, "170"]) assertEquals(refused({ height_cm: ok }), null, String(ok));
});

Deno.test("the weekly rate only matters for the goal that uses it, with 0.01 of slack at each end", () => {
  const loss = (v: unknown) => refused({ aspiration: "lose", loss_rate_pct: v });
  const gain = (v: unknown) => refused({ aspiration: "gain", gain_rate_pct: v });
  for (const bad of [0.08, 2.02, "x", -1]) assertEquals(loss(bad), "Please choose a realistic weekly weight loss rate.", String(bad));
  for (const ok of [0.095, 0.1, 2, 2.01, null, undefined, "1.5"]) assertEquals(loss(ok), null, String(ok));
  assertEquals(loss(0.09), "Please choose a realistic weekly weight loss rate.", "0.1 - 0.01 is 0.09000000000000001 in floating point, so 0.09 is just under");
  for (const bad of [0.23, 0.82, "z", 0]) assertEquals(gain(bad), "Please choose a realistic weekly weight gain rate.", String(bad));
  for (const ok of [0.24, 0.25, 0.8, 0.81, null, undefined]) assertEquals(gain(ok), null, String(ok));
  assertEquals(refused({ aspiration: "maintain", loss_rate_pct: 99, gain_rate_pct: "zzz" }), null, "an unused rate is never looked at");
  assertEquals(validateProfile(payload({ aspiration: "maintain", loss_rate_pct: 1 }))[0]!.loss_rate_pct, null);
});

Deno.test("training days are lower-cased weekday names and nothing else; a log is at most 31 objects", () => {
  assertEquals([...trainingDays(["Monday", "SUNDAY", "funday", 5, null, ["monday"], "friday"])].sort(), ["friday", "monday", "sunday"]);
  assertEquals(trainingDays("monday").size + trainingDays(null).size + trainingDays({}).size, 0);
  assertEquals([MAX_LOG_ENTRIES, MAX_CHECKIN_PHOTOS], [31, 2]);
  assertEquals(boundedList(undefined), []);
  assertEquals(boundedList(null), []);
  assertEquals(boundedList([{ a: 1 }]), [{ a: 1 }]);
  assertEquals(boundedList(Array.from({ length: 31 }, () => ({}))) !== null, true);
  for (const bad of [Array.from({ length: 32 }, () => ({})), "x", 5, {}, [1], [null], [[]], [{}, "a"]]) assertEquals(boundedList(bad), null, JSON.stringify(bad)?.slice(0, 30));
});

Deno.test("a stored picture's type comes from its name", () => {
  assertEquals(mimeFor(".png"), "image/jpeg", "a leading dot is part of the name, as in Python: no extension");
  assertEquals(["x/.webp", "..png", "dir.d/file", "dir.d/.png"].map(mimeFor), ["image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg"]);
  assertEquals(["a..png", "x/a.PNG", "dir.d/a.gif"].map(mimeFor), ["image/png", "image/png", "image/gif"]);
  assertEquals(["a.jpg", "a.JPEG", "a.png", "a.webp", "a.gif", "a.bmp", "a.txt", "noext", "a."].map(mimeFor), ["image/jpeg", "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/jpeg", "image/jpeg", "image/jpeg"]);
});

Deno.test("only the caller's own photos among the first two entries are looked up; junk and booleans are skipped", async () => {
  const mine = new FakeDb((_sql, params) => ([7, 8].includes(params[0] as number) ? [{ id: params[0], filename: `${params[0]}.png` }] : []));
  assertEquals((await ownPhotos(await tx(mine), USER, [7, 8, 9])).map((r) => r.id), [7, 8]);
  assertEquals(mine.calls.map((c) => c.params), [[7, USER], [8, USER]]);
  assertEquals(mine.calls[0].sql, "select id, filename from public.progress_photos where id = $1 and user_id = $2");

  const skipped = new FakeDb((_s, p) => [{ id: p[0] as number, filename: "f.png" }]);
  assertEquals(await ownPhotos(await tx(skipped), USER, [true, "abc", 7]), [], "the first two entries were a boolean and junk; the third is out of reach");
  assertEquals(skipped.calls.length, 0);
  assertEquals((await ownPhotos(await tx(skipped), USER, [true, 7])).map((r) => r.id), [7], "a boolean is skipped but still uses up a place");
  await ownPhotos(await tx(skipped), USER, ["3", 4.9]);
  assertEquals(skipped.calls.map((c) => c.params), [[7, USER], [3, USER], [4, USER]], "numbers as text and fractions are read as Python's int() reads them");
  assertEquals(await ownPhotos(await tx(new FakeDb(() => [])), USER, [7, 8]), [], "someone else's are never returned");
  for (const notAList of ["7", 7, null, undefined, { a: 1 }]) assertEquals(await ownPhotos(await tx(skipped), USER, notAList), []);
});

// ---- the targets ------------------------------------------------------------------------------------------------------------------

Deno.test("targets are Katch-McArdle, the activity multiplier, a goal rate, protein by lean mass and the diet's split", () => {
  const t = (extra: Partial<Profile>) => calculateTargets({ ...BASE, ...extra });
  assertEquals(t({}), { bmr: 1796, tdee: 2783, calories: 2783, protein: 165, fat: 77, carbs: 358 });
  assertEquals(t({ aspiration: "lose", loss_rate_pct: 1 }), { bmr: 1796, tdee: 2783, calories: 2238, protein: 185, fat: 62, carbs: 235 });
  assertEquals(t({ aspiration: "lose" }), { bmr: 1796, tdee: 2783, calories: 2410, protein: 185, fat: 67, carbs: 267 });
  assertEquals(t({ aspiration: "gain", gain_rate_pct: 0.5 }), { bmr: 1796, tdee: 2783, calories: 3158, protein: 165, fat: 88, carbs: 426 });
  assertEquals(t({ diet_preference: "keto" }), { bmr: 1796, tdee: 2783, calories: 2783, protein: 165, fat: 223, carbs: 30 });
  assertEquals(t({ diet_preference: "low_fat" }), { bmr: 1796, tdee: 2783, calories: 2783, protein: 165, fat: 46, carbs: 427 });
  assertEquals(t({ diet_preference: "low_carb" }), { bmr: 1796, tdee: 2783, calories: 2783, protein: 165, fat: 124, carbs: 252 });
});

Deno.test("a deficit can never go below the safe floor for the gender", () => {
  assertEquals(calculateTargets({ ...BASE, gender: "female", body_fat_range_id: "f3", weight_kg: 40, aspiration: "lose", loss_rate_pct: 2, activity_level: "none" }), { bmr: 1014, tdee: 1216, calories: 1200, protein: 66, fat: 33, carbs: 160 });
  assertEquals(calculateTargets({ ...BASE, weight_kg: 36, aspiration: "lose", loss_rate_pct: 2, activity_level: "none", body_fat_range_id: "m6" }).calories, 1500);
});

Deno.test("the week is spread +10% on training days and -10% on rest days, protein constant; with no plan, four fixed days", () => {
  const spread = distributeWeeklyCalories(2783, 165, 77, 358, new Set(["monday", "thursday"]));
  assertEquals(spread.monday, { calories: 3061, protein: 165, fat: 85, carbs: 394 });
  assertEquals(spread.tuesday, { calories: 2505, protein: 165, fat: 69, carbs: 322 });
  assertEquals(Object.keys(spread), ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
  const fallback = distributeWeeklyCalories(2000, 150, 60, 200, new Set());
  assertEquals(Object.entries(fallback).filter(([, v]) => v.calories === 2200).map(([k]) => k), ["monday", "wednesday", "friday", "saturday"]);
});

// ---- the weekly tune ----------------------------------------------------------------------------------------------------------------

const CUR: Targets = { calories: 2783, protein: 165, fat: 77, carbs: 358 };
const weights = (...rows: [number, number][]) => rows.map(([d, kg]) => ({ date: `2026-10-${String(d).padStart(2, "0")}`, kg }));
const days = (...rows: [number, number][]) => rows.map(([d, calories]) => ({ date: `2026-10-${String(d).padStart(2, "0")}`, calories }));
const week = (profile: Partial<Profile>, w: [number, number][], c: [number, number][], current = CUR) => weeklyAdjustment({ ...BASE, ...profile }, current, weights(...w), days(...c));
const ate = (n: number): [number, number][] => [[2, n], [3, n], [4, n]];

Deno.test("too little data says nothing: fewer than two weigh-ins or three logged days", () => {
  assertEquals(week({}, [[1, 80]], ate(2000)), null);
  assertEquals(week({}, [[1, 80], [8, 80]], [[2, 2000], [3, 2000]]), null);
  assertEquals(week({}, [], []), null);
});

Deno.test("the weekly tune matches Python's reference numbers and reasons", () => {
  assertEquals(week({ aspiration: "lose" }, [[1, 80], [8, 79.9]], ate(2600)), {
    calories: 2633, protein: 165, fat: 73, carbs: 329, delta: -150, reason: "Weight loss has stalled this week, so calories have been trimmed slightly.", weight_change_kg: -0.1, avg_calories_logged: 2600,
  });
  assertEquals(week({ aspiration: "lose" }, [[1, 80], [8, 77]], ate(2783)), {
    calories: 2933, protein: 165, fat: 81, carbs: 386, delta: 150, reason: "You're losing faster than the sustainable range, so calories have been raised slightly.", weight_change_kg: -3, avg_calories_logged: 2783,
  });
  assertEquals(week({ aspiration: "gain" }, [[1, 80], [8, 80]], ate(2783)), {
    calories: 2933, protein: 165, fat: 81, carbs: 386, delta: 150, reason: "Weight gain has stalled this week, so calories have been increased slightly.", weight_change_kg: 0, avg_calories_logged: 2783,
  });
  assertEquals(week({}, [[1, 80], [8, 80.2]], ate(2000)), {
    calories: 2633, protein: 165, fat: 73, carbs: 329, delta: -150,
    reason: "Your weight trend looks on track, but you've been eating less than your target most days, so the target's been lowered toward what's actually working.", weight_change_kg: 0.2, avg_calories_logged: 2000,
  });
});

Deno.test("on track with a small gap changes nothing; the nudge follows the sign of the gap and is a third of it, capped", () => {
  assertEquals(week({}, [[1, 80], [8, 80.1]], ate(2783 - 99)), null);
  assertEquals(week({}, [[1, 80], [8, 80.1]], ate(2783 + 99)), null);
  const over = week({}, [[1, 80], [8, 80.1]], ate(2783 + 200))!;
  assertEquals([over.delta, over.calories], [60, 2843]);
  assert(over.reason.includes("eating more than your target most days, so the target's been raised"));
  const under = week({}, [[1, 80], [8, 80.1]], ate(2783 - 200))!;
  assertEquals([under.delta, under.calories], [-60, 2723]);
  assertEquals(week({}, [[1, 80], [8, 80.1]], ate(2783 + 1000))!.delta, WEEKLY_ADJUSTMENT_LIMIT);
  assertEquals(week({}, [[1, 80], [8, 80.1]], ate(2783 + 100))!.delta, 30);
});

Deno.test("maintaining pulls back toward the baseline either way; the floor holds; weigh-ins are put in date order", () => {
  assertEquals(week({}, [[1, 80], [8, 82]], ate(2783))!.delta, -150);
  assertEquals(week({}, [[1, 80], [8, 78]], ate(2783))!.delta, 150);
  const floor = week({ gender: "female" }, [[1, 80], [8, 82]], ate(1300), { calories: 1250, protein: 100, fat: 30, carbs: 100 })!;
  assertEquals(floor.calories, 1200, "1250 - 150 is under the 1200 floor");
  const shuffled = weeklyAdjustment({ ...BASE, aspiration: "lose" }, CUR, [{ date: "2026-10-08", kg: 79.9 }, { date: "2026-10-01", kg: 80 }, { date: "2026-10-04", kg: 99 }], days(...ate(2600)));
  assertEquals(shuffled!.weight_change_kg, -0.1, "the first and last by date, not by position");
});

Deno.test("entries that are not what a check-in sends are refused, not guessed at", () => {
  const bad = (w: unknown[], c: unknown[], current: unknown = CUR) => {
    try {
      weeklyAdjustment({ ...BASE, aspiration: "lose" }, current as Targets, w as never, c as never);
    } catch (e) {
      assert(e instanceof BadCheckin);
      return;
    }
    throw new Error("accepted");
  };
  bad([{ date: "a", kg: 80 }, { kg: 79 }], days(...ate(2000)));
  bad([{ date: "a", kg: "80" }, { date: "b", kg: 79 }], days(...ate(2000)));
  bad([{ date: "a" }, { date: "b", kg: 79 }], days(...ate(2000)));
  bad([{ date: "a", kg: 80 }, { date: 5, kg: 79 }], days(...ate(2000)));
  bad([{ date: null, kg: 80 }, { date: null, kg: 79 }], days(...ate(2000)));
  bad(weights([1, 80], [8, 80]), [{ date: "a", calories: "2000" }, { date: "b", calories: 1 }, { date: "c", calories: 2 }]);
  bad(weights([1, 80], [8, 80]), [{ date: "a" }, { date: "b" }, { date: "c" }]);
  bad(weights([1, 80], [8, 80]), days(...ate(2000)), { calories: "x", protein: 1 });
  bad(weights([1, 80], [8, 80.1]), days(...ate(2000)), { calories: 2000 });
  bad(weights([1, 80], [8, 80.1]), days(...ate(2000)), { protein: 100 });
});

Deno.test("a delta decided elsewhere goes through the same floor and split, and zero is nothing", () => {
  const p = { ...BASE, diet_preference: "keto" };
  assertEquals(applyCalorieDelta(p, CUR, 40.5, "r"), { calories: 2823, protein: 165, fat: 227, carbs: 30, delta: 40, reason: "r" });
  assertEquals(applyCalorieDelta(BASE, CUR, 41.5, "r")!.delta, 42);
  assertEquals(applyCalorieDelta(BASE, CUR, 0.4, "r"), null);
  assertEquals(applyCalorieDelta(BASE, CUR, 500, "r")!.delta, 150);
  assertEquals(applyCalorieDelta(BASE, CUR, -500, "r")!.delta, -150);
  assertEquals(applyCalorieDelta({ ...BASE, gender: "female" }, { calories: 1250, protein: 100 }, -150, "r")!.calories, 1200);
  try {
    applyCalorieDelta(BASE, { calories: 2000 } as Targets, 10, "r");
    throw new Error("accepted");
  } catch (e) {
    assert(e instanceof BadCheckin);
  }
});

// ---- the model's part -----------------------------------------------------------------------------------------------------------------

Deno.test("the model's answer is JSON, bare or inside a fence", () => {
  assertEquals(extractJson('{"delta": -100, "reason": "ok"}'), { delta: -100, reason: "ok" });
  assertEquals(extractJson('```json\n{"delta": 20}\n```'), { delta: 20 });
  assertEquals(extractJson('Here:\n```\n{"delta": 5}\n```\nbye'), { delta: 5 });
  assertEquals(extractJson('  {"delta": 1}  '), { delta: 1 });
  for (const bad of ["not json", "", "```json\n```", '```json\n{"a":\n```']) {
    try {
      extractJson(bad);
      throw new Error("accepted " + bad);
    } catch (e) {
      assert(e instanceof SyntaxError, bad);
    }
  }
});

const BASELINE = week({ aspiration: "lose" }, [[1, 80], [8, 79.9]], ate(2600));

Deno.test("the check-in prompt tells the model the goal, the weight, the target, the gap, the numbers and the photos", () => {
  const p = buildPrompt({ ...BASE, aspiration: "lose", weight_kg: 82.5 }, CUR, weights([1, 80.5], [8, 79]), days([2, 2600.4], [3, 2900]), BASELINE, true, false);
  assert(p.includes("Goal: lose weight. Gender: male. Current bodyweight: 82.5 kg.\n"));
  assert(p.includes("Their CURRENT daily calorie target is 2783 kcal. They actually averaged 2750 kcal/day across the days they logged, which is 33 kcal below that target.\n\n"));
  assert(p.includes("Weigh-ins logged this week:\n  - 2026-10-01: 80.5 kg\n  - 2026-10-08: 79 kg\n\n"));
  assert(p.includes("Calories logged this week:\n  - 2026-10-02: 2600 kcal\n  - 2026-10-03: 2900 kcal\n\n"));
  assert(p.includes('already suggests a -150 kcal/day change, reasoning: "Weight loss has stalled this week, so calories have been trimmed slightly.".'));
  assert(p.includes("The user has also provided a front progress photo for today."));
  assert(p.includes("Look at the photo(s) for visible week-over-week"));
  assert(p.endsWith('mentioning the photo(s) if they influenced the call."}'));
  const both = buildPrompt(BASE, CUR, [], [], null, true, true);
  assert(both.includes("front AND back progress photos") && both.includes("  (none logged)\n\nCalories logged this week:\n  (none logged)"));
  assert(both.includes("The deterministic trend calculation didn't suggest a specific number this week"));
  assert(!both.includes("They actually averaged"), "no days, no average");
  const none = buildPrompt(BASE, null, [], [], null, false, false);
  assert(!none.includes("CURRENT daily calorie target") && !none.includes("progress photo") && !none.includes("Look at the photo(s)"));
  assert(buildPrompt(BASE, CUR, [], [], null, false, true).includes("a back progress photo"));
  const gain = buildPrompt(BASE, CUR, [], days([2, 3000], [3, 3000], [4, 3000]), { ...BASELINE!, delta: 20 }, false, false);
  assert(gain.includes("which is 217 kcal above that target") && gain.includes("already suggests a +20 kcal/day change"));
  assert(p.includes("-150 to +150 kcal/day"));
});

const PHOTO = { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
const reviewed = (reply: string | null | Error, photos = [PHOTO], configured = true) => {
  const model = new FakeGemini(() => reply, configured);
  return { model, run: () => analyzeCheckin(model, { ...BASE, aspiration: "lose" }, CUR, weights([1, 80], [8, 79.9]), days(...ate(2600)), BASELINE, photos) };
};

Deno.test("the model's review: sent as one message with its photos, with its own model, time limit, no retries and no safety filter", async () => {
  const { model, run } = reviewed('{"delta": -40, "reason": "Looks good."}', [PHOTO, { data: new Uint8Array([9]), mimeType: "image/jpeg" }]);
  assertEquals(await run(), { delta: -40, reason: "Looks good." });
  const [req] = model.requests;
  assertEquals([req.model, req.timeoutMs, req.attempts, req.safe, req.system], [CHECKIN_MODEL, 30000, 1, undefined, undefined]);
  assertEquals(req.contents.length, 1);
  assertEquals(req.contents[0].role, "user");
  assertEquals(req.contents[0].images!.map((i) => i.mimeType), ["image/png", "image/jpeg"]);
  assert(req.contents[0].text.includes("front AND back"));
  assertEquals(toBase64(new Uint8Array([1, 2, 3])), "AQID");
  assertEquals(toBase64(new Uint8Array(100_000).fill(65)).length, Math.ceil(100_000 / 3) * 4);
});

Deno.test("the delta is clamped to 150 and cut toward zero; the reason is trimmed and clipped to 400; any problem is one error", async () => {
  assertEquals((await reviewed('{"delta": 900, "reason": "x"}').run()).delta, 150);
  assertEquals((await reviewed('{"delta": -900, "reason": "x"}').run()).delta, -150);
  assertEquals((await reviewed('{"delta": 1.9, "reason": "x"}').run()).delta, 1);
  assertEquals((await reviewed('{"delta": -1.9, "reason": "x"}').run()).delta, -1);
  assertEquals((await reviewed('{"delta": "30", "reason": "x"}').run()).delta, 30);
  assertEquals((await reviewed('{"delta": 0, "reason": "x"}').run()).delta, 0);
  assertEquals((await reviewed('{"delta": 5, "reason": "  padded  "}').run()).reason, "padded");
  assertEquals((await reviewed(JSON.stringify({ delta: 5, reason: "y".repeat(500) })).run()).reason.length, 400);
  assertEquals((await reviewed(JSON.stringify({ delta: 5, reason: "\u{1F3CB}".repeat(500) })).run()).reason, "\u{1F3CB}".repeat(400));
  assertEquals((await reviewed('{"delta": 5, "reason": 42}').run()).reason, "42");
  for (
    const bad of [
      '{"delta": 5}', '{"delta": 5, "reason": ""}', '{"delta": 5, "reason": "   "}', '{"delta": 5, "reason": null}', '{"reason": "x"}', '{"delta": "abc", "reason": "x"}', '{"delta": null, "reason": "x"}',
      "[1]", '"s"', "null", "not json", "", null, new GeminiError("down"),
    ]
  ) {
    const e = await reviewed(bad as never).run().catch((x) => x);
    assert(e instanceof CheckinAnalysisError, String(bad));
  }
  assert((await reviewed("x", [], false).run().catch((x) => x)) instanceof CheckinAnalysisError, "no key");
  assertEquals((await reviewed('{"delta": 5, "reason": "x"}', []).run()).delta, 5, "and no photos is fine");
});

// ---- the routes ------------------------------------------------------------------------------------------------------------------------

const row = { id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, ai_consent_at: new Date(), deleted_at: null, created_at: new Date() };
const checkinBody = (extra: Record<string, unknown> = {}) => ({
  ...payload({ aspiration: "lose" }),
  current_targets: CUR,
  week_weight_entries: weights([1, 80], [8, 79.9]),
  week_calorie_days: days(...ate(2600)),
  ...extra,
});

function checkinDb(options: { consent?: boolean; allowed?: boolean; photo?: boolean } = {}) {
  return new FakeDb((sql) => {
    if (sql.includes("select id, name, friend_code")) return [{ ...row, ai_consent_at: options.consent === false ? null : new Date() }];
    if (sql.includes("from public.progress_photos")) return options.photo === false ? [] : [{ id: 3, filename: "a.png" }];
    if (sql.includes("insert into public.rate_limits")) return options.allowed === false ? [] : [{ window_start: 1000 }];
    return 1;
  });
}

const post = (db: FakeDb, path: string, body: unknown, model = new FakeGemini(), transport = fakeTransport(() => new Response(new Uint8Array([7, 7, 7]))).transport) =>
  bearer().then((headers) => app(db, {}, undefined, transport, model)(path, { method: "POST", headers, json: body }));

Deno.test("every coaching route demands a token", async () => {
  for (const [method, path] of [["GET", "/api/coaching/body-fat-ranges"], ["POST", "/api/coaching/calculate"], ["POST", "/api/coaching/weekly-adjustment"]]) {
    assertEquals((await app()(path, { method })).status, 401, path);
  }
});

Deno.test("GET /api/coaching/body-fat-ranges: the man's list unless asked for the woman's", async () => {
  assertEquals((await (await app()("/api/coaching/body-fat-ranges", { headers: await bearer() })).json()).ok, true);
  const get = async (q: string) => (await (await app()(`/api/coaching/body-fat-ranges${q}`, { headers: await bearer() })).json()).ranges.map((r: { id: string }) => r.id);
  assertEquals(await get(""), ["m1", "m2", "m3", "m4", "m5", "m6"]);
  assertEquals(await get("?gender=female"), ["f1", "f2", "f3", "f4", "f5", "f6"]);
  assertEquals(await get("?gender=anything"), ["m1", "m2", "m3", "m4", "m5", "m6"]);
});

Deno.test("POST /api/coaching/calculate: targets, a weekly spread when asked, a 400 with the reason otherwise", async () => {
  const ok = await (await post(new FakeDb(), "/api/coaching/calculate", payload())).json();
  assertEquals([ok.ok, ok.targets.calories, ok.distribution], [true, 2783, null]);
  const weekly = await (await post(new FakeDb(), "/api/coaching/calculate", payload({ distribution: "weekly", training_days: ["Monday", "thursday", 5] }))).json();
  assertEquals([weekly.distribution.monday.calories, weekly.distribution.tuesday.calories], [3061, 2505]);
  const bad = await post(new FakeDb(), "/api/coaching/calculate", payload({ gender: "x" }));
  assertEquals([bad.status, (await bad.json()).error], [400, "Please choose a gender."]);
});

Deno.test("POST /api/coaching/weekly-adjustment: the checks on what was sent", async () => {
  const db = checkinDb();
  const err = async (body: unknown) => {
    const r = await post(db, "/api/coaching/weekly-adjustment", body);
    return [r.status, (await r.json()).error];
  };
  assertEquals(await err(checkinBody({ aspiration: "x" })), [400, "Please choose a goal: lose, maintain, or gain weight."]);
  for (const bad of [undefined, null, [], "x", { protein: 1 }]) assertEquals(await err(checkinBody({ current_targets: bad })), [400, "Missing current_targets."], String(bad));
  assertEquals(await err(checkinBody({ week_weight_entries: "x" })), [400, "Invalid check-in data."]);
  assertEquals(await err(checkinBody({ week_calorie_days: [1] })), [400, "Invalid check-in data."]);
  assertEquals(await err(checkinBody({ week_weight_entries: [{ date: "a", kg: "80" }, { date: "b", kg: 79 }] })), [400, "Invalid check-in data."]);
});

Deno.test("the weekly check-in without consent is the deterministic number, and the model is never asked", async () => {
  const model = new FakeGemini();
  const db = checkinDb({ consent: false });
  const out = await (await post(db, "/api/coaching/weekly-adjustment", checkinBody(), model)).json();
  assertEquals([out.ok, out.adjustment.delta, out.adjustment.calories], [true, -150, 2633]);
  assertEquals(model.requests.length, 0);
  assert(!db.calls.some((c) => c.sql.includes("insert into public.rate_limits")));
  const noData = await (await post(db, "/api/coaching/weekly-adjustment", checkinBody({ week_weight_entries: [] }), model)).json();
  assertEquals(noData.adjustment, null);
});

Deno.test("with consent the model's delta replaces the number, through the same floor and split, and the photos go with it", async () => {
  const model = new FakeGemini(() => '{"delta": 60, "reason": "Photos look lean."}');
  const t = fakeTransport(() => new Response(new Uint8Array([7, 7, 7])));
  const db = checkinDb();
  const out = await (await post(db, "/api/coaching/weekly-adjustment", checkinBody({ photo_ids: [3, 3] }), model, t.transport)).json();
  assertEquals(out.adjustment, { calories: 2843, protein: 165, fat: 79, carbs: 368, delta: 60, reason: "Photos look lean." });
  assertEquals(db.calls.find((c) => c.sql.includes("insert into public.rate_limits"))!.params.slice(0, 2), [USER, "checkin_analysis"]);
  assert(db.calls.some((c) => c.params[1] === "feature:checkin_ai_analysis"));
  assertEquals(t.requests.map((r) => r.url), [`https://abcdefgh.supabase.co/storage/v1/object/authenticated/progress-photos/${USER}/a.png`, `https://abcdefgh.supabase.co/storage/v1/object/authenticated/progress-photos/${USER}/a.png`]);
  assertEquals(model.requests[0].contents[0].images!.map((i) => [i.mimeType, [...i.data]]), [["image/png", [7, 7, 7]], ["image/png", [7, 7, 7]]]);
});

Deno.test("if the model fails, the deterministic number stands and the use is given back; at the limit it is simply not asked", async () => {
  for (const reply of [new GeminiError("down"), "garbage", '{"delta": "x", "reason": "r"}']) {
    const db = checkinDb();
    const warned = console.warn;
    console.warn = () => {};
    try {
      const out = await (await post(db, "/api/coaching/weekly-adjustment", checkinBody(), new FakeGemini(() => reply))).json();
      assertEquals([out.adjustment.delta, out.adjustment.calories], [-150, 2633], String(reply));
    } finally {
      console.warn = warned;
    }
    assert(db.calls.some((c) => c.sql.includes("greatest(count - 1, 0)")), "refunded");
    assert(!db.calls.some((c) => c.params[1] === "feature:checkin_ai_analysis"));
  }
  const model = new FakeGemini();
  const limited = await (await post(checkinDb({ allowed: false }), "/api/coaching/weekly-adjustment", checkinBody(), model)).json();
  assertEquals(limited.adjustment.delta, -150);
  assertEquals(model.requests.length, 0);
});

Deno.test("a model delta of zero means no change at all; photos that are missing or not the caller's are just left out", async () => {
  const zero = await (await post(checkinDb(), "/api/coaching/weekly-adjustment", checkinBody(), new FakeGemini(() => '{"delta": 0, "reason": "All good."}'))).json();
  assertEquals(zero.adjustment, null);
  const model = new FakeGemini(() => '{"delta": 10, "reason": "r"}');
  await post(checkinDb({ photo: false }), "/api/coaching/weekly-adjustment", checkinBody({ photo_ids: [99] }), model);
  assertEquals(model.requests[0].contents[0].images, []);
  const gone = fakeTransport(() => new Response("{}", { status: 404 }));
  const m2 = new FakeGemini(() => '{"delta": 10, "reason": "r"}');
  await post(checkinDb(), "/api/coaching/weekly-adjustment", checkinBody({ photo_ids: [3] }), m2, gone.transport);
  assertEquals(m2.requests[0].contents[0].images, [], "a file that cannot be fetched is skipped");
});

Deno.test("an exempt account is never limited on the check-in review", async () => {
  const model = new FakeGemini(() => '{"delta": 10, "reason": "r"}');
  const db = checkinDb({ allowed: false });
  const r = await bearer().then((headers) => app(db, { REVIEW_ACCOUNT_EMAILS: "lifter@example.com" }, undefined, undefined, model)("/api/coaching/weekly-adjustment", { method: "POST", headers, json: checkinBody() }));
  assertEquals((await r.json()).adjustment.delta, 10);
  assertEquals(model.requests.length, 1);
});

Deno.test("the review asks about exactly the photos it was given: none, the front only, front and back", async () => {
  const asked = async (photos: typeof PHOTO[]) => {
    const { model, run } = reviewed('{"delta": 5, "reason": "r"}', photos);
    await run();
    return model.requests[0].contents[0];
  };
  const none = await asked([]);
  assert(!none.text.includes("progress photo") && none.images!.length === 0);
  const one = await asked([PHOTO]);
  assert(one.text.includes("a front progress photo") && !one.text.includes("AND back") && one.images!.length === 1);
  const two = await asked([PHOTO, PHOTO]);
  assert(two.text.includes("front AND back") && two.images!.length === 2);
});

Deno.test("a calorie count that is not a number stops the prompt, so the review falls back instead of asking the model about NaN", async () => {
  const model = new FakeGemini();
  const bad = analyzeCheckin(model, { ...BASE, aspiration: "lose" }, CUR, weights([1, 80]), [{ date: "a", calories: "2000" }], null, []);
  assert(await bad.catch((e) => e) instanceof CheckinAnalysisError);
  assertEquals(model.requests.length, 0);
});

Deno.test("a photo that cannot be fetched because storage is down is left out, and the check-in still completes", async () => {
  const model = new FakeGemini(() => '{"delta": 10, "reason": "r"}');
  const down = fakeTransport(() => new Response("", { status: 500 }));
  const out = await (await post(checkinDb(), "/api/coaching/weekly-adjustment", checkinBody({ photo_ids: [3] }), model, down.transport)).json();
  assertEquals([out.ok, out.adjustment.delta], [true, 10]);
  assertEquals(model.requests[0].contents[0].images, []);
});

Deno.test("a stored target whose protein is text is a refusal in the deterministic path and a fallback in the model's", async () => {
  const text = await post(checkinDb({ consent: false }), "/api/coaching/weekly-adjustment", checkinBody({ current_targets: { ...CUR, protein: "165" } }));
  assertEquals([text.status, (await text.json()).error], [400, "Invalid check-in data."]);
});
