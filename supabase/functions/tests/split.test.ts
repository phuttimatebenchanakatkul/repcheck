import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import type { Gemini, GenerateRequest } from "../_shared/gemini.ts";
import { pyDumps, pyFixed, pyFloatRepr, pyStr } from "../_shared/pyText.ts";
import {
  buildFallbackPlan,
  filterByLocation,
  generateSplitPlan,
  normalizeLocation,
  SUGGEST_GEMINI_MODEL,
  SUGGEST_RESPONSE_SCHEMA,
  suggestSplitPlan,
  topUpExercises,
  validatePlan,
  WORKOUT_EXERCISES,
} from "../_shared/splitPlanner.ts";
import { app, bearer, FakeDb, FakeGemini } from "./support.ts";

// ---- Python's text -----------------------------------------------------------------------------------------------------------

Deno.test("repr() of a float, as Python prints it", () => {
  assertEquals(
    [80, 1e16, 1.5e-5, 0.0001, 123456789012345.6, -0, 1e21, 0.1 + 0.2, 99999999999999.9, 5e-324, 0.00001234, 250, 72.35].map(pyFloatRepr),
    ["80.0", "1e+16", "1.5e-05", "0.0001", "123456789012345.6", "-0.0", "1e+21", "0.30000000000000004", "99999999999999.9", "5e-324", "1.234e-05", "250.0", "72.35"],
  );
  assertEquals([NaN, Infinity, -Infinity].map(pyFloatRepr), ["nan", "inf", "-inf"]);
});

Deno.test("format(x, '.1f') rounds from the exact value and sends a tie to the even digit", () => {
  assertEquals(
    [0.25, 0.35, 0.75, 5.25, 0.05, 0.15, 0.45, 2.5, 0.5, 1234.5678, 0, 99.95, 0.95].map((x) => pyFixed(x, 1)),
    ["0.2", "0.3", "0.8", "5.2", "0.1", "0.1", "0.5", "2.5", "0.5", "1234.6", "0.0", "100.0", "0.9"],
  );
  assertEquals([pyFixed(2.5, 0), pyFixed(3.5, 0), pyFixed(-0.04, 1), pyFixed(1234.5678, 2), pyFixed(0.125, 2), pyFixed(0.375, 2)], ["2", "4", "-0.0", "1234.57", "0.12", "0.38"]);
  assertEquals([pyFixed(NaN, 1), pyFixed(Infinity, 1)], ["nan", "inf"]);
});

Deno.test("str() of a JSON value, as Python prints it", () => {
  const list = ["x", 1, null, true, "it's", 'say "hi"', "both ' and \"", "tab\t", "nl\n", "bs\\", "\x7f", "é", { a: [1.5, null] }, {}, []];
  assertEquals(
    pyStr(list),
    `['x', 1, None, True, "it's", 'say "hi"', 'both \\' and "', 'tab\\t', 'nl\\n', 'bs\\\\', '\\x7f', 'é', {'a': [1.5, None]}, {}, []]`,
  );
  assertEquals([pyStr("plain"), pyStr(null), pyStr(false), pyStr(5)], ["plain", "None", "False", "5"]);
});

Deno.test("json.dumps() with Python's separators and escapes", () => {
  assertEquals(
    pyDumps({ "é": ["a ", "\u{1F4AA}", "\x7f", "\x1f", 'q"b\\', "\n"], k: [] }),
    '{"\\u00e9": ["a\\u2028", "\\ud83d\\udcaa", "\\u007f", "\\u001f", "q\\"b\\\\", "\\n"], "k": []}',
  );
  assertEquals([pyDumps([]), pyDumps({}), pyDumps(null), pyDumps(true), pyDumps(3)], ["[]", "{}", "null", "true", "3"]);
  assertEquals(pyDumps(new Map([["b", ["x"]], ["a", ["y"]]])), '{"b": ["x"], "a": ["y"]}', "a map keeps its order");
});

// ---- the planner ---------------------------------------------------------------------------------------------------------------

Deno.test("a location nobody asked for is no location", () => {
  assertEquals([normalizeLocation("home"), normalizeLocation("gym"), normalizeLocation("hybrid"), normalizeLocation("Home"), normalizeLocation(""), normalizeLocation(null), normalizeLocation(5), normalizeLocation("constructor"), normalizeLocation("__proto__")], ["home", "gym", "hybrid", null, null, null, null, null, null]);
  assertEquals(filterByLocation(["Squat", "Flat Bench Press"], "weird"), ["Squat", "Flat Bench Press"]);
  assertEquals(filterByLocation(["Flat Bench Press"], "home"), ["Flat Bench Press"], "a pool that would be emptied is left whole");
});

Deno.test("a short day is filled from its own day type, then trimmed", () => {
  assertEquals(topUpExercises(["Flat Bench Press", "Nonsense"], "Push", null, 3, 8).length, 3);
  assertEquals(topUpExercises(["a", "b", "c", "d", "e"], "Push", null, 3, 4), ["a", "b", "c", "d"], "long enough: only trimmed");
  const filled = topUpExercises([], "Chest Day", "home", 5, 6);
  assertEquals(filled.length, 5);
  assert(filled.every((n) => WORKOUT_EXERCISES.includes(n)));
});

Deno.test("the plan without the model: days, a week that never runs longer than two in a row where it can, and a reason", () => {
  const plan = buildFallbackPlan("ppl", 5);
  assertEquals(plan.days.map((d) => d.label), ["Push", "Pull", "Legs", "Push", "Pull"]);
  assertEquals(Object.values(plan.schedule), ["Push", "Pull", "Rest", "Legs", "Push", "Rest", "Pull"]);
  assertStringIncludes(plan.rationale, "short pairs");
  assertEquals(buildFallbackPlan("nonsense", 2).days.map((d) => d.label), ["Full Body", "Full Body"]);
  assertEquals(buildFallbackPlan("custom", 3, ["Chest Day", "Arm Day"]).days.map((d) => d.label), ["Chest Day", "Arm Day", "Chest Day"]);
  assertEquals(buildFallbackPlan("custom", 2, []).days.map((d) => d.label), ["Full Body", "Full Body"], "no names: a full-body split");
});

Deno.test("a goal that calls for a day type gets one, never at the cost of the whole split; pregnancy changes every day", () => {
  assertEquals(buildFallbackPlan("ppl", 4, null, "I want to be faster for my sport").days.map((d) => d.label), ["Push", "Pull", "Legs", "Athletic"]);
  assertEquals(buildFallbackPlan("ppl", 1, null, "faster").days.map((d) => d.label), ["Push"], "one day: it stays their split");
  assertEquals(buildFallbackPlan("ppl", 3, null, "I'm pregnant").days.map((d) => d.label), ["Prenatal", "Prenatal", "Prenatal"]);
  assertEquals(buildFallbackPlan("full_body", 3, null, null, null, "hybrid").days.map((d) => d.label), ["Full Body", "Full Body", "Conditioning"]);
  const picked = new Map([["Push", ["Squat"]], ["Pull", ["Pull-Up"]], ["Legs", ["Leg Press"]]]);
  // every day picked by hand: the pick wins over "everything low-impact", but the goal still gets its one reserved day
  assertEquals(buildFallbackPlan("ppl", 3, null, "I'm pregnant", picked).days.map((d) => d.label), ["Push", "Pull", "Prenatal"]);
  assertEquals(buildFallbackPlan("ppl", 3, null, "I'm pregnant", picked).days.slice(0, 2).map((d) => d.exercises), [["Squat"], ["Pull-Up"]]);
});

// ---- the route -------------------------------------------------------------------------------------------------------------------

const planDays = (dpw: number) => Array.from({ length: dpw }, (_, i) => ({ label: `Day ${i + 1}`, exercises: ["Squat", "Bicep Curl", "Plank", "Pull-Up", "Push-Up", "Leg Press"] }));
const weekFor = (dpw: number) => {
  const pattern = [[1, 0, 0, 0, 0, 0, 0], [1, 0, 0, 1, 0, 0, 0], [1, 0, 1, 0, 1, 0, 0]][dpw - 1];
  let n = 0;
  return Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d, i) => [d, pattern[i] ? `Day ${++n}` : "Rest"]));
};
const modelPlan = (dpw: number, extra: Record<string, unknown> = {}) => JSON.stringify({ days: planDays(dpw), schedule: weekFor(dpw), rationale: "Rest between sessions.", ...extra });

const profileRow = { id: "u", name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, deleted_at: null, created_at: new Date() };
function splitDb(options: { profile?: boolean; consent?: boolean; allowed?: boolean } = {}) {
  return new FakeDb((sql) => {
    if (sql.includes("select id, name, friend_code")) return options.profile === false ? [] : [{ ...profileRow, ai_consent_at: options.consent === false ? null : new Date() }];
    if (sql.includes("insert into public.rate_limits")) return options.allowed === false ? [] : [{ window_start: 1000 }];
    if (sql.includes("select window_start from public.rate_limits")) return [{ window_start: Math.floor(Date.now() / 1000) - 600 }];
    return 1;
  });
}
const post = (db: FakeDb, body: unknown, model: Gemini = new FakeGemini(), env: Record<string, string> = {}) =>
  bearer().then((headers) => app(db, env, undefined, undefined, model)("/api/generate-split", { method: "POST", headers, json: body }));
const spent = (db: FakeDb) => db.calls.some((c) => c.sql.includes("insert into public.rate_limits"));
const refunded = (db: FakeDb) => db.calls.some((c) => c.sql.includes("greatest(count - 1, 0)"));
const counted = (db: FakeDb, event: string) => db.calls.some((c) => c.params[1] === `feature:${event}`);

Deno.test("generate-split demands a token", async () => {
  assertEquals((await app()("/api/generate-split", { method: "POST" })).status, 401);
});

Deno.test("generate-split: each kind of bad request has its own refusal, before anything is spent", async () => {
  const refuse = async (body: unknown) => {
    const db = splitDb();
    const r = await post(db, body);
    assert(!spent(db));
    return [r.status, (await r.json()).error];
  };
  assertEquals(await refuse({ split_type: "x", days_per_week: 3 }), [400, "Unknown split type."]);
  assertEquals(await refuse({ days_per_week: 3 }), [400, "Unknown split type."]);
  assertEquals(await refuse({ split_type: ["ppl"], days_per_week: 3 }), [400, "Unknown split type."]);
  for (const bad of [undefined, null, true, "x", "", [], {}, "3.5"]) assertEquals(await refuse({ split_type: "ppl", days_per_week: bad }), [400, "days_per_week must be a number."], String(bad));
  for (const bad of [0, 8, -1, 100, "0", "9"]) assertEquals(await refuse({ split_type: "ppl", days_per_week: bad }), [400, "days_per_week must be between 1 and 7."], String(bad));
  assertEquals(await refuse({ split_type: "ppl", days_per_week: 3, custom_days: "Chest" }), [400, "Invalid custom days."]);
  assertEquals(await refuse({ split_type: "ppl", days_per_week: 3, custom_days: [1] }), [400, "Invalid custom days."]);
  assertEquals(await refuse({ split_type: "ppl", days_per_week: 3, custom_days: Array(15).fill("a") }), [400, "Invalid custom days."]);
  assertEquals(await refuse({ split_type: "custom", days_per_week: 3 }), [400, "Please name at least one custom day."]);
  assertEquals(await refuse({ split_type: "custom", days_per_week: 3, custom_days: ["  ", ""] }), [400, "Please name at least one custom day."]);
  assertEquals(await refuse({ split_type: "custom", days_per_week: 3, custom_days: "Chest" }), [400, "Please name at least one custom day."]);
});

Deno.test("generate-split: a whole number of days is read as Python reads one", async () => {
  for (const ok of [3, 3.9, "3", " 3 ", 7, "7", 1]) {
    const r = await post(splitDb(), { split_type: "ppl", days_per_week: ok }, new FakeGemini(() => null));
    assertEquals(r.status, 200, String(ok));
    assertEquals((await r.json()).days.length, Math.trunc(Number(String(ok).trim())), String(ok));
  }
});

Deno.test("generate-split: no profile is a 404; consent matters only for the model-built path", async () => {
  const none = await post(splitDb({ profile: false }), { split_type: "ppl", days_per_week: 3 });
  assertEquals([none.status, (await none.json()).error], [404, "No profile yet. Create it first."]);
  const model = new FakeGemini(() => modelPlan(3));
  const noConsentDb = splitDb({ consent: false });
  const refused = await post(noConsentDb, { split_type: "ai_suggest", days_per_week: 3 }, model);
  assertEquals(refused.status, 403);
  assertEquals((await refused.json()).needs_ai_consent, true);
  assert(!spent(noConsentDb) && model.requests.length === 0);
  const fine = await post(splitDb({ consent: false }), { split_type: "ppl", days_per_week: 3 }, model);
  assertEquals(fine.status, 200, "a split type the person picked works without the consent");
});

Deno.test("generate-split: the daily allowance answers 429 with how long to wait", async () => {
  const model = new FakeGemini();
  const r = await post(splitDb({ allowed: false }), { split_type: "ppl", days_per_week: 3 }, model);
  assertEquals(r.status, 429);
  const body = await r.json();
  assert(body.retry_after_seconds >= 24 * 3600 - 610 && body.retry_after_seconds <= 24 * 3600 - 600, "a day, less the ten minutes already gone (give or take a clock tick)");
  assertEquals(r.headers.get("Retry-After"), String(body.retry_after_seconds));
  assertEquals(body, { ok: false, error: "You've built 1 plans today. Please check back in about 24 hours.", limited: true, retry_after_seconds: body.retry_after_seconds });
  assertEquals(model.requests.length, 0);
  const exemptDb = splitDb({ allowed: false });
  assertEquals((await post(exemptDb, { split_type: "ppl", days_per_week: 3 }, new FakeGemini(() => null), { REVIEW_ACCOUNT_EMAILS: "lifter@example.com" })).status, 200);
  assert(!spent(exemptDb), "an exempt account spends nothing");
});

Deno.test("generate-split: a picked split asks the model and takes its plan, cleaned", async () => {
  const model = new FakeGemini(() => modelPlan(3, { rationale: "  Because.  " }));
  const db = splitDb();
  const out = await (await post(db, { split_type: "full_body", days_per_week: 3, goal: "  stay fit  ", location: " HOME " }, model)).json();
  assertEquals([out.ok, out.days.length, out.rationale, out.split_type], [true, 3, "Because.", undefined]);
  assertEquals(out.schedule, weekFor(3));
  const request = model.requests[0] as GenerateRequest;
  assertEquals([request.model, request.responseSchema, request.system, request.safe], [undefined, undefined, undefined, undefined]);
  const prompt = request.contents[0].text;
  assertStringIncludes(prompt, "a Full Body split");
  assertStringIncludes(prompt, '"stay fit"');
  assertStringIncludes(prompt, "usually train at home");
  assert(spent(db) && !counted(db, "split_ai_suggested"));
});

Deno.test("generate-split: the model's answer is checked; anything wrong gives the plan without the model, and the use stays spent", async () => {
  for (const reply of ["not json", null, '{"days": []}', modelPlan(3, { schedule: { monday: "Day 1" } }), JSON.stringify({ days: planDays(2), schedule: weekFor(2) })]) {
    const db = splitDb();
    const out = await (await post(db, { split_type: "ppl", days_per_week: 3 }, new FakeGemini(() => reply))).json();
    assertEquals(out.days.map((d: { label: string }) => d.label), ["Push", "Pull", "Legs"], String(reply));
    assert(spent(db) && !refunded(db));
  }
  const down = await (await post(splitDb(), { split_type: "ppl", days_per_week: 3 }, new FakeGemini(() => new Error("down")))).json();
  assertEquals(down.days.length, 3);
  const noKey = new FakeGemini(() => modelPlan(3), false);
  assertEquals((await (await post(splitDb(), { split_type: "ppl", days_per_week: 3 }, noKey)).json()).days.length, 3);
  assertEquals(noKey.requests.length, 0);
});

Deno.test("generate-split: a custom split is the person's own and never asks the model", async () => {
  const model = new FakeGemini(() => modelPlan(3));
  const db = splitDb();
  const out = await (await post(db, { split_type: "custom", days_per_week: 2, custom_days: [" Chest Day ", "Arm Day"], goal: "x", custom_days_exercises: { "Chest Day": ["Squat", "Nope"], Other: [], Bad: "Squat" } }, model)).json();
  assertEquals(out.days.map((d: { label: string }) => d.label), ["Chest Day", "Arm Day"]);
  assertEquals(out.days[0].exercises, ["Squat"], "the person's pick, only what is in the library");
  assertEquals(model.requests.length, 0);
  assert(spent(db), "it still counts against the day's allowance, as before");
});

Deno.test("generate-split: hand-picked exercises are copied to the model, and an answer that changes them is refused", async () => {
  const picked = { "Chest Day": ["Squat", "Pull-Up", "Plank"] };
  const week = { monday: "Chest Day", tuesday: "Rest", wednesday: "Rest", thursday: "Back Day", friday: "Rest", saturday: "Rest", sunday: "Rest" };
  const ok = new FakeGemini(() => JSON.stringify({ days: [{ label: "Chest Day", exercises: picked["Chest Day"] }, { label: "Back Day", exercises: ["Squat", "Bicep Curl", "Plank"] }], schedule: week, rationale: "r" }));
  const out = await (await post(splitDb(), { split_type: "ppl", days_per_week: 2, custom_days_exercises: picked }, ok)).json();
  assertEquals(out.days[0].exercises, picked["Chest Day"]);
  assertStringIncludes(ok.requests[0].contents[0].text, '{"Chest Day": ["Squat", "Pull-Up", "Plank"]}');
  const changed = new FakeGemini(() => JSON.stringify({ days: [{ label: "Chest Day", exercises: ["Squat", "Plank", "Pull-Up"] }, { label: "Back Day", exercises: ["Squat", "Bicep Curl", "Plank"] }], schedule: week, rationale: "r" }));
  const fallback = await (await post(splitDb(), { split_type: "ppl", days_per_week: 2, custom_days_exercises: picked }, changed)).json();
  assertEquals(fallback.days.map((d: { label: string }) => d.label), ["Push", "Pull"]);
});

Deno.test("generate-split ai_suggest: the model picks the split type, its answer is held to the beginner window, and the suggestion is counted", async () => {
  const reply = JSON.stringify({ split_type: "Upper_Lower ", days: planDays(3), schedule: weekFor(3), rationale: "For a beginner." });
  const model = new FakeGemini(() => reply);
  const db = splitDb();
  const out = await (await post(db, {
    split_type: "ai_suggest", days_per_week: 3, goal: "get strong", gender: " Female ", current_weight_kg: "80.5", goal_weight_kg: 75, location: "gym",
  }, model)).json();
  assertEquals([out.ok, out.split_type, out.days.length], [true, "upper_lower", 3]);
  assert(out.days.every((d: { exercises: string[] }) => d.exercises.length >= 4 && d.exercises.length <= 6), "inside the window for three days a week");
  const request = model.requests[0];
  assertEquals([request.model, request.responseSchema], [SUGGEST_GEMINI_MODEL, SUGGEST_RESPONSE_SCHEMA]);
  const prompt = request.contents[0].text;
  for (const line of ["- Gender: female", "- Current weight: 80.5 kg", "- Goal weight: 75.0 kg", "- They are trying to LOSE about 5.5 kg", "exactly 3 day(s) per week", "They train at the gym"]) assertStringIncludes(prompt, line);
  assert(spent(db) && counted(db, "split_ai_suggested"));
});

Deno.test("generate-split ai_suggest: weights that make no sense are left out of the prompt, not the plan", async () => {
  const model = new FakeGemini(() => null);
  for (const [current, goal] of [[19, 400], [true, "x"], ["abc", 501], [null, undefined]]) {
    const out = await (await post(splitDb(), { split_type: "ai_suggest", days_per_week: 4, current_weight_kg: current, goal_weight_kg: goal, gender: "robot" }, model)).json();
    assertEquals([out.ok, out.split_type, out.days.length], [true, "upper_lower", 4]);
  }
  assertEquals(model.requests.length, 4);
  const texts = model.requests.map((r) => r.contents[0].text);
  assertStringIncludes(texts[0], "- Goal weight: 400.0 kg");
  assert(!texts[0].includes("Current weight") && !texts[0].includes("trying to"), "19 kg is not a weight; without a current one there is no direction");
  for (const t of texts.slice(1)) assert(!t.includes("About this person") && !t.includes("Gender"), "nothing usable: no paragraph about them at all");
});

Deno.test("generate-split ai_suggest: a split type outside the list, or no answer at all, gives the beginner default for that many days", async () => {
  const wrong = new FakeGemini(() => JSON.stringify({ split_type: "crossfit", days: planDays(2), schedule: weekFor(2), rationale: "r" }));
  const a = await (await post(splitDb(), { split_type: "ai_suggest", days_per_week: 2 }, wrong)).json();
  assertEquals([a.split_type, a.days.length], ["full_body", 2]);
  for (const days of [1, 4, 5, 7]) {
    const db = splitDb();
    const b = await (await post(db, { split_type: "ai_suggest", days_per_week: days }, new FakeGemini(() => "nonsense"))).json();
    assertEquals(b.split_type, { 1: "full_body", 4: "upper_lower", 5: "ppl", 7: "ppl" }[days]);
    assert(counted(db, "split_ai_suggested"), "a fallback is still a suggestion made");
  }
});

Deno.test("generate-split: a failure the planner cannot handle gives the use back and says so", async () => {
  const broken: Gemini = { get configured(): boolean { throw new Error("boom"); }, generate: () => Promise.resolve(null) };
  const db = splitDb();
  const warned = console.error;
  console.error = () => {};
  try {
    const r = await post(db, { split_type: "ppl", days_per_week: 3 }, broken);
    assertEquals(r.status, 500);
  } finally {
    console.error = warned;
  }
  assert(spent(db) && refunded(db));
});

Deno.test("the planner on its own: an unconfigured model means the plan without it", async () => {
  const off = new FakeGemini(() => modelPlan(3), false);
  assertEquals((await generateSplitPlan(off, { splitType: "ppl", daysPerWeek: 99 })).days.length, 7, "days are held to 1 to 7");
  assertEquals((await suggestSplitPlan(off, { daysPerWeek: -4 })).days.length, 1);
  assertEquals((await suggestSplitPlan(off, { daysPerWeek: 3 })).split_type, "full_body");
  assertEquals(off.requests.length, 0);
});

// ---- boundaries the mutation run found nobody was holding ----------------------------------------------------------------------

Deno.test("the edges of the text helpers: zero, minus zero, the largest number that can be written out", () => {
  assertEquals([pyFloatRepr(0), pyFloatRepr(-0), pyFixed(-0, 1), pyFixed(0, 1)], ["0.0", "-0.0", "-0.0", "0.0"]);
  let thrown = false;
  try {
    pyFixed(1e21, 1);
  } catch {
    thrown = true;
  }
  assert(thrown, "a number too big to print exactly is refused, not printed wrongly");
  assertEquals(pyFixed(1e20, 1), "100000000000000000000.0");
});

Deno.test("when every day of a one-day-type split was picked by hand, the pregnancy rule steps aside", () => {
  const picked = new Map([["Full Body", ["Squat", "Pull-Up", "Plank"]]]);
  assertEquals(buildFallbackPlan("full_body", 3, null, "I'm pregnant", picked).days.map((d) => d.label), ["Full Body", "Full Body", "Prenatal"]);
  assertEquals(buildFallbackPlan("full_body", 3, null, "I'm pregnant", new Map()).days.map((d) => d.label), ["Prenatal", "Prenatal", "Prenatal"]);
});

Deno.test("a week is refused only when it runs longer than the days asked for allow (and never fewer than three)", () => {
  const run = (labels: string[], dpw: number) => {
    const days = Array.from({ length: dpw }, (_, i) => ({ label: `D${i}`, exercises: ["Squat", "Plank", "Pull-Up"] }));
    const week: Record<string, string> = {};
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].forEach((d, i) => (week[d] = labels[i] ?? "Rest"));
    try {
      validatePlan({ days, schedule: week, rationale: "r" }, dpw);
      return "ok";
    } catch {
      return "refused";
    }
  };
  assertEquals(run(["D0", "D1", "D2"], 3), "ok", "three in a row, three days a week: as long as it can be");
  assertEquals(run(["D0", "D0", "D0", "D0"], 2), "refused", "four in a row on two days a week");
  assertEquals(run(["D0", "D1", "D2", "D3", "D4"], 5), "ok");
  assertEquals(run(["D0", "D1", "D2", "D3", "D4", "D0"], 5), "refused");
});

Deno.test("generate-split ai_suggest: a day the model left short is filled up, so its split type is kept", async () => {
  const short = JSON.stringify({
    split_type: "ppl",
    days: [{ label: "Push", exercises: ["Squat", "Plank"] }, { label: "Pull", exercises: ["Pull-Up", "Plank"] }, { label: "Legs", exercises: ["Squat", "Plank"] }],
    schedule: { monday: "Push", tuesday: "Rest", wednesday: "Pull", thursday: "Rest", friday: "Legs", saturday: "Rest", sunday: "Rest" },
    rationale: "r",
  });
  const out = await (await post(splitDb(), { split_type: "ai_suggest", days_per_week: 3 }, new FakeGemini(() => short))).json();
  assertEquals(out.split_type, "ppl", "the model's plan was used, not the three-day default (full body)");
  assertEquals(out.days.map((d: { label: string }) => d.label), ["Push", "Pull", "Legs"]);
  assert(out.days.every((d: { exercises: string[] }) => d.exercises.length >= 4 && d.exercises.length <= 6));
});
