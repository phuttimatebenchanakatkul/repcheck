import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { analyzeRace, buildPrompt, clock, coerceResult, neutralTips, STATION_KEYS } from "../_shared/hyrox.ts";
import type { Gemini } from "../_shared/gemini.ts";
import { pyJsonLength } from "../_shared/chats.ts";
import { GeminiClient } from "../_shared/gemini.ts";
import { pyTitle } from "../_shared/pyText.ts";
import { app, bearer, FakeDb, FakeGemini } from "./support.ts";

const RACE = {
  category: "pro", format: "doubles", gender: "female", total_seconds: 4321,
  segments: [
    { type: "run", title: "Run 1", seconds: 270 },
    { type: "station", key: "skierg", title: "SkiErg", seconds: 215 },
    { type: "station", key: "wallBalls", title: "Wall Balls", seconds: 305.5 },
  ],
};
const GOOD = JSON.stringify({
  overall: " Wall balls cost you the most. ",
  overall_detail: ["Break them early", "", "Hold the pace on runs"],
  tips: [{ key: "wallBalls", rating: "FOCUS", tip: "Set smaller sets.", detail: ["Squat deeper"] }, { key: "nope", tip: "ignored" }],
});

const profileRow = { id: "u", name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, deleted_at: null, created_at: new Date() };
function hyroxDb(options: { profile?: boolean; consent?: boolean; allowed?: boolean } = {}) {
  return new FakeDb((sql) => {
    if (sql.includes("select id, name, friend_code")) return options.profile === false ? [] : [{ ...profileRow, ai_consent_at: options.consent === false ? null : new Date() }];
    if (sql.includes("insert into public.rate_limits")) return options.allowed === false ? [] : [{ window_start: 1000 }];
    if (sql.includes("select window_start from public.rate_limits")) return [{ window_start: Math.floor(Date.now() / 1000) - 600 }];
    return 1;
  });
}
const post = (db: FakeDb, body: unknown, model: Gemini = new FakeGemini(() => GOOD), env: Record<string, string> = {}) =>
  bearer().then((headers) => app(db, env, undefined, undefined, model)("/api/hyrox/analyze", { method: "POST", headers, json: body }));
const spent = (db: FakeDb) => db.calls.some((c) => c.sql.includes("insert into public.rate_limits"));
const refunded = (db: FakeDb) => db.calls.some((c) => c.sql.includes("greatest(count - 1, 0)"));
const counted = (db: FakeDb) => db.calls.some((c) => c.params[1] === "feature:hyrox_ai_analysis");

Deno.test("hyrox analyze demands a token", async () => {
  assertEquals((await app()("/api/hyrox/analyze", { method: "POST" })).status, 401);
});

Deno.test("hyrox analyze: no profile is a 404 and no consent the usual 403, before the race is even looked at", async () => {
  const none = await post(hyroxDb({ profile: false }), { race: RACE });
  assertEquals([none.status, (await none.json()).error], [404, "No profile yet. Create it first."]);
  const model = new FakeGemini(() => GOOD);
  const db = hyroxDb({ consent: false });
  const refused = await post(db, { race: RACE }, model);
  assertEquals([refused.status, (await refused.json()).needs_ai_consent], [403, true]);
  assert(!spent(db) && model.requests.length === 0);
  assertEquals((await post(hyroxDb({ consent: false }), { race: "not a race" })).status, 403);
});

Deno.test("hyrox analyze: the race is checked before anything is spent", async () => {
  const refuse = async (body: unknown) => {
    const db = hyroxDb();
    const r = await post(db, body);
    assert(!spent(db));
    return [r.status, (await r.json()).error];
  };
  assertEquals(await refuse({}), [400, "Race has no segments to analyze."]);
  for (const falsy of [null, 0, "", [], false]) assertEquals(await refuse({ race: falsy }), [400, "Race has no segments to analyze."], String(falsy));
  for (const bad of ["a race", 5, ["x"], true]) assertEquals(await refuse({ race: bad }), [400, "Invalid race."], String(bad));
  for (const bad of [{ segments: [] }, { segments: null }, { segments: "abc" }, { segments: { a: 1 } }, { category: "pro" }]) assertEquals(await refuse({ race: bad }), [400, "Race has no segments to analyze."], JSON.stringify(bad));
  const seg = { type: "run", title: "r", seconds: 1 };
  assertEquals((await refuse({ race: { segments: Array(41).fill(seg) } }))[1], "Invalid race.");
  assertEquals((await post(hyroxDb(), { race: { segments: Array(40).fill(seg) } })).status, 200);
  // the size is what Python's json.dumps would write: 20,000 characters is allowed, one more is not
  const sized = (chars: number) => {
    const base = { segments: [seg], note: "" };
    return { segments: [seg], note: "x".repeat(chars - pyJsonLength(base)) };
  };
  assertEquals(pyJsonLength(sized(20_000)), 20_000);
  assertEquals((await post(hyroxDb(), { race: sized(20_000) })).status, 200);
  assertEquals(await refuse({ race: sized(20_001) }), [400, "Invalid race."]);
});

Deno.test("hyrox analyze: the daily allowance answers 200 with a message the app already shows", async () => {
  const model = new FakeGemini(() => GOOD);
  const r = await post(hyroxDb({ allowed: false }), { race: RACE }, model);
  assertEquals(r.status, 200);
  const body = await r.json();
  assert(body.retry_after_seconds >= 5 * 3600 - 610 && body.retry_after_seconds <= 5 * 3600 - 600, String(body.retry_after_seconds));
  assertEquals(body, {
    ok: true, overall: "You've analyzed 8 races today. Please check back in about 5 hours.", overall_detail: [], tips: [], limited: true, retry_after_seconds: body.retry_after_seconds,
  });
  assertEquals(model.requests.length, 0);
  const exemptDb = hyroxDb({ allowed: false });
  assertEquals((await (await post(exemptDb, { race: RACE }, new FakeGemini(() => GOOD), { REVIEW_ACCOUNT_EMAILS: "lifter@example.com" })).json()).limited, false);
  assert(!spent(exemptDb), "an exempt account spends nothing");
});

Deno.test("hyrox analyze: a good answer is cleaned into one tip per station in race order, and counted", async () => {
  const model = new FakeGemini(() => GOOD);
  const db = hyroxDb();
  const out = await (await post(db, { race: RACE }, model)).json();
  assertEquals([out.ok, out.limited, out.retry_after_seconds, out.overall, out.overall_detail], [true, false, 0, "Wall balls cost you the most.", ["Break them early", "Hold the pace on runs"]]);
  assertEquals(out.tips.map((t: { key: string }) => t.key), [...STATION_KEYS]);
  assertEquals(out.tips.find((t: { key: string }) => t.key === "wallBalls"), { key: "wallBalls", rating: "focus", tip: "Set smaller sets.", detail: ["Squat deeper"] });
  assertEquals(out.tips.find((t: { key: string }) => t.key === "row"), { key: "row", rating: "solid", tip: "", detail: [] });
  assert(!("failed" in out), "the app is not told about the internal flag");
  assert(spent(db) && counted(db) && !refunded(db));
  const request = model.requests[0];
  assertEquals([request.temperature, request.json, request.model, request.responseSchema, request.safe], [0.4, true, undefined, undefined, undefined]);
  assertStringIncludes(request.contents[0].text, "Race: Female Pro Doubles · total 72:01");
  assertStringIncludes(request.contents[0].text, "- SkiErg (key: skierg): 3:35");
  assertStringIncludes(request.contents[0].text, "- Run 1: 4:30");
});

Deno.test("hyrox analyze: when the model cannot help, the neutral tips come back and the use is given back", async () => {
  for (const reply of [null, "not json", "{}", '{"overall": "", "tips": []}', new Error("down")]) {
    const db = hyroxDb();
    const out = await (await post(db, { race: RACE }, new FakeGemini(() => reply))).json();
    assertEquals([out.ok, out.overall, out.overall_detail, out.tips, out.limited], [true, "", [], neutralTips(), false], String(reply));
    assert(spent(db) && refunded(db) && !counted(db), String(reply));
  }
  const noKey = new FakeGemini(() => GOOD, false);
  const db = hyroxDb();
  assertEquals((await (await post(db, { race: RACE }, noKey)).json()).tips, neutralTips());
  assert(noKey.requests.length === 0 && refunded(db));
  // a time that is not a number makes the prompt impossible: the same neutral answer
  const odd = hyroxDb();
  const oddOut = await (await post(odd, { race: { ...RACE, total_seconds: "an hour" } })).json();
  assertEquals(oddOut.tips, neutralTips());
  assert(refunded(odd));
});

Deno.test("hyrox analyze: an answer with only an overall still counts as an analysis", async () => {
  const db = hyroxDb();
  const out = await (await post(db, { race: RACE }, new FakeGemini(() => '{"overall": "Run steadier."}'))).json();
  assertEquals(out.overall, "Run steadier.");
  assert(counted(db) && !refunded(db));
  const tipsOnly = hyroxDb();
  await post(tipsOnly, { race: RACE }, new FakeGemini(() => '{"tips": [{"key": "row", "tip": "Long pulls."}]}'));
  assert(counted(tipsOnly) && !refunded(tipsOnly));
});

Deno.test("hyrox analyze: a failure the analysis cannot handle gives the use back and says so", async () => {
  const broken: Gemini = { get configured(): boolean { throw new Error("boom"); }, generate: () => Promise.resolve(null) };
  const db = hyroxDb();
  const warned = console.error;
  console.error = () => {};
  try {
    assertEquals((await post(db, { race: RACE }, broken)).status, 500);
  } finally {
    console.error = warned;
  }
  assert(spent(db) && refunded(db));
});

Deno.test("the clock rounds to the even second, never goes below zero, and refuses what is not a number", () => {
  assertEquals([0, 59.5, 60.5, 61.5, 90, 3599.5, 3600.5, -5, -0.5, true, 1e30].map(clock), ["0:00", "1:00", "1:00", "1:02", "1:30", "60:00", "60:00", "0:00", "0:00", "0:01", "16666666666666666998077080644:16"]);
  for (const bad of ["90", null, undefined, [], {}, NaN, Infinity]) {
    let thrown = false;
    try {
      clock(bad);
    } catch {
      thrown = true;
    }
    assert(thrown, String(bad));
  }
});

Deno.test("the prompt: unspecified athletes, empty races and entries that are not splits", () => {
  const empty = buildPrompt({});
  assertStringIncludes(empty, "Race: unspecified Open Singles · total 0:00");
  assertStringIncludes(empty, "Runs:\n(no run splits recorded)");
  assertStringIncludes(empty, "Stations:\n(no station splits recorded)");
  const text = buildPrompt({ segments: [null, "x", { type: "run", seconds: "slow" }, { type: "run", key: "r2", seconds: 61 }, { key: "  row  ", seconds: false }] });
  assertStringIncludes(text, "- r2: 1:01");
  assertStringIncludes(text, "- row (key: row): 0:00");
  assert(!text.includes("- : "), "a split whose time is not a number is left out");
  assertStringIncludes(text, "EACH of these 8 station keys: skierg, sledPush, sledPull, burpeeBroadJump, row, farmersCarry, lunges, wallBalls.");
});

Deno.test("a tip's rating is one of three; the answer is read even when it is partly nonsense", () => {
  const [overall, detail, tips] = coerceResult('{"overall": ["a"], "overall_detail": [1, null, "x"], "tips": [{"key": "row", "rating": "Amazing", "tip": 5}]}');
  assertEquals([overall, detail], ["['a']", ["1", "x"]]);
  assertEquals(tips.find((t) => t.key === "row"), { key: "row", rating: "solid", tip: "5", detail: [] });
  assertEquals(coerceResult("nope")[2], neutralTips());
  assertEquals(coerceResult('{"tips": true, "overall": "kept"}')[0], "kept", "what was read before a bad value stays");
});

Deno.test("analyzeRace on its own", async () => {
  const off = await analyzeRace(new FakeGemini(() => GOOD, false), RACE);
  assertEquals([off.failed, off.limited, off.tips.length], [true, false, 8]);
  const on = await analyzeRace(new FakeGemini(() => GOOD), RACE);
  assertEquals([on.failed, on.overall], [false, "Wall balls cost you the most."]);
  assertEquals(pyTitle("o'brien ΑΣ ǆ"), "O'Brien Ας ǅ");
});

Deno.test("the model is asked for JSON, at the temperature given, only when the request says so", async () => {
  const bodies: Record<string, unknown>[] = [];
  const send = ((_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })));
  }) as unknown as typeof fetch;
  const client = new GeminiClient("key", send);
  const contents = [{ role: "user" as const, text: "hi" }];
  await client.generate({ contents });
  await client.generate({ contents, json: true });
  await client.generate({ contents, temperature: 0.4 });
  await client.generate({ contents, temperature: 0 });
  await client.generate({ contents, json: true, temperature: 0.4 });
  await client.generate({ contents, responseSchema: { type: "OBJECT" } });
  assertEquals(bodies.map((b) => b.generationConfig), [
    undefined,
    { responseMimeType: "application/json" },
    { temperature: 0.4 },
    { temperature: 0 },
    { temperature: 0.4, responseMimeType: "application/json" },
    { responseMimeType: "application/json", responseSchema: { type: "OBJECT" } },
  ]);
});
