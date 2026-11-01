import { assert, assertEquals, assertRejects } from "@std/assert";

import type { Clock } from "../_shared/analyzeForm.ts";
import { CHALLENGE_LABELS, CHALLENGE_NUMBERS as N, CHALLENGE_PROMPTS } from "../_shared/challengeData.ts";
import { countReps, isChallengeExercise, parseResponse, RepCountFailure } from "../_shared/challengeClip.ts";
import { GeminiClient, GeminiError, GeminiFileRejected } from "../_shared/gemini.ts";
import { CLIP_BODY_LIMIT } from "../api/routes/social.ts";
import { MAX_UPLOAD_BYTES } from "../_shared/analyze.ts";
import { app, bearer, FakeDb, FakeGemini, fakeTransport, USER } from "./support.ts";

const REPLY = `Rep 1 (00:02): Check 1: YES, Check 2: YES. Verdict: VALID.
Rep 2 (00:05): Check 1: NO, Check 2: YES. Verdict: REJECTED.
REPS: 11
REJECTED: 2
NOTES: Check 1 (full bottom depth) failed most often.
`;

function clock() {
  const c = { t: 0, sleeps: [] as number[], now: () => c.t, sleep: (ms: number) => { c.sleeps.push(ms); c.t += ms; return Promise.resolve(); } };
  return c as Clock & typeof c;
}
const clip = () => new Uint8Array(9000);
const status = (code: number) => new GeminiError(`Gemini answered ${code}`, code);

// ---- the instructions and numbers ----------------------------------------------------------------------------------------------

Deno.test("the exercises, their instructions and the numbers are the website's", () => {
  assertEquals(Object.keys(CHALLENGE_LABELS), ["pushups", "situps", "pullups"]);
  assertEquals(CHALLENGE_LABELS, { pushups: "Push-ups", situps: "Sit-ups", pullups: "Pull-ups" });
  assertEquals([N.GEMINI_MODEL, N.SAMPLE_FPS, N.MAX_SAFETY_BLOCK_RETRIES, N.CHALLENGE_SECONDS], ["gemini-3.5-flash", 15, 2, 25]);
  for (const [key, label] of Object.entries(CHALLENGE_LABELS)) {
    assert(CHALLENGE_PROMPTS[key].includes(`${N.CHALLENGE_SECONDS}-second ${label} challenge`), key);
    assert(CHALLENGE_PROMPTS[key].endsWith("NOTES: <why>"), key);
  }
  assertEquals([isChallengeExercise("pushups"), isChallengeExercise("squats"), isChallengeExercise("constructor"), isChallengeExercise("__proto__")], [true, false, false, false]);
});

// ---- reading the answer --------------------------------------------------------------------------------------------------------

Deno.test("parseResponse: the LAST REPS / REJECTED / NOTES count, the digits of any script read, a missing REPS refused", () => {
  assertEquals(parseResponse(REPLY), { reps: 11, rejected: 2, notes: "Check 1 (full bottom depth) failed most often." });
  assertEquals(parseResponse("Rep 3 says REPS: 99 inside\nREPS: 4\nREJECTED: 1\nREJECTED: 0\nNOTES: first\nNOTES:   second  "), { reps: 4, rejected: 0, notes: "second" });
  assertEquals(parseResponse("REPS: ١٢"), { reps: 12, rejected: 0, notes: "" });
  assertEquals(parseResponse("REPS: 7\nNOTES:\nsomething on the next line"), { reps: 7, rejected: 0, notes: "something on the next line" });
  assertEquals(parseResponse("REPS: 0\nREJECTED: 0\nNOTES: not a push-up"), { reps: 0, rejected: 0, notes: "not a push-up" });
  for (const bad of ["", "no counts here", "reps: 5", "REPS: five", "REPS:"]) {
    let e: unknown;
    try { parseResponse(bad); } catch (x) { e = x; }
    assert(e instanceof RepCountFailure && e.message === "Couldn't count reps from the video. Please try a clearer recording.", bad);
  }
});

// ---- counting ----------------------------------------------------------------------------------------------------------------------

Deno.test("countReps: the whole clip is stored with Gemini, the model is shown its first 25 s with the exercise's instructions, and the clip is removed after", async () => {
  const model = new FakeGemini(() => REPLY);
  const seen: string[] = [];
  const out = await countReps(model, clip(), ".mov", "pushups", { clock: clock(), onModel: (i) => seen.push(i.raw) });
  assertEquals(out, { reps: 11, rejected: 2, notes: "Check 1 (full bottom depth) failed most often." });
  assertEquals(model.uploads, [{ bytes: 9000, mimeType: "video/quicktime", timeoutMs: 45_000 }]);
  const request = model.requests[0];
  assertEquals([request.model, request.temperature, request.attempts, request.thinkingLevel], ["gemini-3.5-flash", 0, 1, undefined]);
  assert(request.timeoutMs! <= 75_000 && request.timeoutMs! >= 74_000);
  assertEquals(request.contents[0].videos, [{ fileUri: "https://files.example/f1", mimeType: "video/mp4", startOffset: "0s", endOffset: "25s", fps: 15 }]);
  assertEquals(request.contents[0].text, CHALLENGE_PROMPTS.pushups);
  assertEquals(model.deleted, ["files/f1"]);
  assertEquals(seen, [REPLY]);
  await countReps(model, clip(), ".mp4", "situps", { clock: clock(), model: "gemini-next" });
  assertEquals([model.requests[1].model, model.requests[1].contents[0].text], ["gemini-next", CHALLENGE_PROMPTS.situps]);
});

Deno.test("countReps: an overloaded answer (429, 500, 503) or a timeout is retried after 2 s then 4 s; after the third try the person is told it is busy", async () => {
  for (const code of [429, 500, 503]) {
    const c = clock();
    const model = new FakeGemini(() => status(code));
    await assertRejects(() => countReps(model, clip(), ".mp4", "pushups", { clock: c }), RepCountFailure, "The rep counter is busy right now (high demand). Please wait a moment and record again.");
    assertEquals([model.requests.length, c.sleeps, model.deleted], [3, [2000, 4000], ["files/f1"]], String(code));
  }
  const timeout = new FakeGemini(() => new GeminiError("TimeoutError"));
  await assertRejects(() => countReps(timeout, clip(), ".mp4", "pushups", { clock: clock() }), RepCountFailure, "busy right now");
  assertEquals(timeout.requests.length, 3);
  let n = 0;
  const recovers = new FakeGemini(() => (++n < 3 ? status(503) : REPLY));
  assertEquals((await countReps(recovers, clip(), ".mp4", "pushups", { clock: clock() })).reps, 11);
});

Deno.test("countReps: any other API error will not fix itself, so it is not retried and gets the plain message", async () => {
  for (const code of [400, 401, 403, 404, 502, 504]) {
    const model = new FakeGemini(() => status(code));
    const warn = console.warn;
    console.warn = () => {};
    try {
      await assertRejects(() => countReps(model, clip(), ".mp4", "pushups", { clock: clock() }), RepCountFailure, "An error has occurred. Please record again.");
    } finally {
      console.warn = warn;
    }
    assertEquals(model.requests.length, 1, String(code));
  }
});

Deno.test("countReps: an empty or blocked answer is tried again after 2 s, three tries in all, then the count cannot be read", async () => {
  const c = clock();
  const model = new FakeGemini(() => null);
  await assertRejects(() => countReps(model, clip(), ".mp4", "pullups", { clock: c }), RepCountFailure, "Couldn't count reps from the video. Please try a clearer recording.");
  assertEquals([model.requests.length, c.sleeps], [3, [2000, 2000]], "no pause after the last try");
  let n = 0;
  const second = new FakeGemini(() => (++n === 1 ? "" : REPLY));
  assertEquals((await countReps(second, clip(), ".mp4", "pullups", { clock: clock() })).reps, 11);
});

Deno.test("countReps: the tries share one 75 s budget; one that cannot get 12 s is not started", async () => {
  const c = clock();
  const slow = new FakeGemini(() => { c.t += 70_000; return status(503); });
  await assertRejects(() => countReps(slow, clip(), ".mp4", "pushups", { clock: c }), RepCountFailure, "busy right now");
  assertEquals(slow.requests.length, 1, "5 s are left after the pause: no second try");
  const c2 = clock();
  let n = 0;
  const exact = new FakeGemini(() => { c2.t += 63_000; return ++n === 1 ? null : REPLY; });
  assertEquals((await countReps(exact, clip(), ".mp4", "pushups", { clock: c2, budgetSeconds: 77 })).reps, 11);
  assertEquals(exact.requests.map((r) => r.timeoutMs), [77_000, 12_000]);
});

Deno.test("countReps: a clip Gemini cannot read, a store that is down, an unknown exercise and a missing key are each a plain message", async () => {
  const rejected = new FakeGemini(() => REPLY);
  rejected.fileAnswer = () => new GeminiFileRejected("bad");
  await assertRejects(() => countReps(rejected, clip(), ".mp4", "pushups", { clock: clock() }), RepCountFailure, "That recording couldn't be processed — it may have been too short. Please record for at least a few seconds and try again.");
  const down = new FakeGemini(() => REPLY);
  down.fileAnswer = () => new GeminiError("503", 503);
  await assertRejects(() => countReps(down, clip(), ".mp4", "pushups", { clock: clock() }), RepCountFailure, "busy right now");
  await assertRejects(() => countReps(new FakeGemini(() => REPLY), clip(), ".mp4", "squats"), RepCountFailure, "Unknown challenge exercise: squats");
  const noKey = new FakeGemini(() => REPLY, false);
  await assertRejects(() => countReps(noKey, clip(), ".mp4", "pushups"), RepCountFailure, "The rep counter isn't available right now. Please try again later.");
  for (const m of [rejected, down, noKey]) assertEquals([m.requests.length, m.deleted], [0, []]);
  const bug = new FakeGemini(() => new TypeError("a bug"));
  await assertRejects(() => countReps(bug, clip(), ".mp4", "pushups", { clock: clock() }), TypeError);
  assertEquals(bug.deleted, ["files/f1"], "the stored clip goes even then");
});

// ---- the route --------------------------------------------------------------------------------------------------------------------

const challenge = { id: 7, creator_id: USER, exercise: "pushups", duration_seconds: 25, created_at: new Date() };
const profileRow = { id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, deleted_at: null, created_at: new Date() };

interface World {
  profile?: boolean;
  consent?: boolean;
  challenge?: Record<string, unknown> | null;
  done?: boolean;
  allowed?: boolean;
  saveError?: Error;
  model?: FakeGemini;
  env?: Record<string, string>;
}

function world(options: World = {}) {
  const db = new FakeDb((sql) => {
    if (sql.includes("select id, name, friend_code")) return options.profile === false ? [] : [{ ...profileRow, ai_consent_at: options.consent === false ? null : new Date() }];
    if (sql.includes("select * from public.challenges where id")) return options.challenge === null ? [] : [options.challenge ?? challenge];
    if (sql.includes("from public.challenge_submissions s join")) return options.done ? [{ one: 1 }] : [];
    if (sql.includes("insert into public.rate_limits")) return options.allowed === false ? [] : [{ window_start: 1000 }];
    if (sql.includes("select window_start from public.rate_limits")) return [{ window_start: Math.floor(Date.now() / 1000) - 60 }];
    if (sql.includes("insert into public.challenge_submissions")) return options.saveError ?? 1;
    return 1;
  });
  const model = options.model ?? new FakeGemini(() => REPLY);
  const t = fakeTransport();
  return { db, model, t, call: app(db, options.env ?? {}, undefined, t.transport, model) };
}

const spent = (db: FakeDb) => db.calls.some((c) => c.sql.includes("insert into public.rate_limits"));
const refunded = (db: FakeDb) => db.calls.some((c) => c.sql.includes("greatest(count - 1, 0)"));
const saved = (db: FakeDb) => db.calls.find((c) => c.sql.includes("insert into public.challenge_submissions"));

function form(fields: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.set("video", new File([clip()], "attempt.mp4", { type: "video/mp4" }));
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const post = async (w: ReturnType<typeof world>, body: BodyInit | null, headers: Record<string, string> = {}, id = 7) =>
  w.call(`/api/challenges/${id}/submit`, { method: "POST", body, headers: { ...(await bearer()), ...headers } });

Deno.test("POST submit: needs a token, a profile, AI consent and a challenge the caller can see, all before the clip is read", async () => {
  assertEquals((await app()("/api/challenges/7/submit", { method: "POST" })).status, 401);
  const none = world({ profile: false });
  const r1 = await post(none, form());
  assertEquals([r1.status, (await r1.json()).error], [404, "No profile yet. Create it first."]);
  const refused = world({ consent: false });
  const r2 = await post(refused, form());
  assertEquals([r2.status, (await r2.json()).needs_ai_consent], [403, true]);
  const missing = world({ challenge: null });
  const r3 = await post(missing, form());
  assertEquals([r3.status, (await r3.json()).error], [404, "Challenge not found."]);
  const strangers = world({ challenge: { ...challenge, creator_id: "11111111-2222-4333-8444-555555555555" } });
  assertEquals((await post(strangers, form())).status, 404, "a stranger's challenge is not found, not forbidden");
  assertEquals((await post(world(), form(), {}, 0)).status, 200, "an id of zero is just an id");
  for (const w of [none, refused, missing, strangers]) assertEquals([spent(w.db), w.model.uploads.length, w.t.requests.length], [false, 0, 0]);
});

Deno.test("POST submit: an attempt already recorded today is a 429 limitReached before the clip is read or the model asked", async () => {
  const w = world({ done: true });
  const r = await post(w, form());
  assertEquals([r.status, await r.json()], [429, { ok: false, limitReached: true, error: "You've already recorded an attempt for this exercise today — try again tomorrow." }]);
  assertEquals([spent(w.db), w.model.uploads.length], [false, 0]);
  const racing = world({ allowed: false });
  const r2 = await post(racing, form());
  assertEquals([r2.status, (await r2.json()).limitReached], [429, true]);
  assertEquals(racing.model.uploads.length, 0, "the daily attempt is held, so a simultaneous second one never reaches the model");
});

Deno.test("POST submit: bad uploads are 400 with the website's words, a huge one 413, and nothing is spent", async () => {
  const cases: [string, BodyInit | null, string][] = [
    ["no body", null, "No video uploaded."],
    ["only text", (() => { const f = new FormData(); f.set("video", "text"); return f; })(), "No video uploaded."],
    ["a file with no name", form({ video: new File([clip()], "") }), "No video uploaded."],
    ["a gif", form({ video: new File([clip()], "a.gif") }), "Unsupported video format."],
    ["no extension", form({ video: new File([clip()], "attempt") }), "Unsupported video format."],
  ];
  for (const [what, body, message] of cases) {
    const w = world();
    const r = await post(w, body);
    assertEquals([r.status, (await r.json()).error], [400, message], what);
    assertEquals([spent(w.db), w.model.uploads.length], [false, 0], what);
  }
  const declared = world();
  assertEquals((await post(declared, form(), { "content-length": String(CLIP_BODY_LIMIT + 1) })).status, 413);
  const big = world();
  assertEquals((await post(big, form({ video: new File([new Uint8Array(MAX_UPLOAD_BYTES + 100)], "a.mp4") }))).status, 413);
  for (const w of [declared, big]) assertEquals([spent(w.db), w.model.uploads.length], [false, 0]);
  for (const ext of ["mp4", "MOV", "m4v", "avi", "mkv", "webm"]) assertEquals((await post(world(), form({ video: new File([clip()], `a.${ext}`) }))).status, 200, ext);
});

Deno.test("POST submit: a counted attempt is saved (a retake keeps the higher count), the day's attempt stays spent, and the answer has the totals", async () => {
  const w = world();
  const r = await post(w, form());
  assertEquals([r.status, await r.json()], [200, { ok: true, exercise: "pushups", reps: 11, rejected: 2, total: 13, notes: "Check 1 (full bottom depth) failed most often." }]);
  const insert = saved(w.db)!;
  assertEquals(insert.params, [7, USER, 11, "Check 1 (full bottom depth) failed most often."]);
  assert(insert.sql.includes("where excluded.reps > challenge_submissions.reps"));
  assert(spent(w.db) && !refunded(w.db));
  assert(w.db.calls.some((c) => c.sql.includes("usage_events") && c.params[1] === "feature:challenge_submission"));
  assertEquals(w.model.deleted, ["files/f1"]);
  const attempt = w.db.calls.find((c) => c.sql.includes("insert into public.rate_limits"))!;
  assert(String(attempt.params[1]).startsWith("challenge:pushups:"), String(attempt.params[1]));
  const sit = world({ challenge: { ...challenge, exercise: "situps" } });
  await post(sit, form());
  assertEquals(sit.model.requests[0].contents[0].text, CHALLENGE_PROMPTS.situps, "the instructions follow the challenge's own exercise");
});

Deno.test("POST submit: a clip that cannot be counted says why and gives the day's attempt back; so does a crash and a failed save", async () => {
  for (const reply of ["no counts here", null]) {
    const w = world({ model: new FakeGemini(() => reply) });
    const r = await post(w, form());
    assertEquals([r.status, typeof (await r.json()).error], [400, "string"]);
    assert(spent(w.db) && refunded(w.db) && !saved(w.db), String(reply));
  }
  const warn = console.warn;
  console.warn = () => {};
  const broken = world({ model: new FakeGemini(() => status(400)) });
  const r = await post(broken, form());
  console.warn = warn;
  assertEquals([r.status, (await r.json()).error], [400, "An error has occurred. Please record again."]);
  assert(refunded(broken.db));
  const error = console.error;
  console.error = () => {};
  try {
    const crash = new FakeGemini(() => REPLY);
    crash.fileAnswer = () => new TypeError("a bug");
    const w1 = world({ model: crash });
    assertEquals((await post(w1, form())).status, 500);
    assert(refunded(w1.db) && !saved(w1.db));
    const w2 = world({ saveError: new Error("db down") });
    assertEquals((await post(w2, form())).status, 500);
    assert(refunded(w2.db));
  } finally {
    console.error = error;
  }
});

Deno.test("GeminiClient: an error carries the HTTP status Gemini answered with, and none when it never answered", async () => {
  const answer = (status: number) => new GeminiClient("KEY", () => Promise.resolve(new Response("{}", { status })), () => Promise.resolve());
  for (const code of [400, 429, 503]) {
    const e = await assertRejects(() => answer(code).generate({ contents: [{ role: "user", text: "x" }], attempts: 1 }), GeminiError);
    assertEquals(e.status, code);
  }
  const dropped = await assertRejects(() => new GeminiClient("KEY", () => Promise.reject(new Error("offline"))).generate({ contents: [{ role: "user", text: "x" }] }), GeminiError);
  assertEquals(dropped.status, undefined);
  const upload = await assertRejects(() => answer(503).upload(new Uint8Array(1), "video/mp4", 1000), GeminiError);
  assertEquals(upload.status, 503);
});

Deno.test("countReps: with 10 s left (after the pause) a try is not started", async () => {
  const c = clock();
  const eleven = new FakeGemini(() => { c.t += 63_000; return null; });
  await assertRejects(() => countReps(eleven, clip(), ".mp4", "pushups", { clock: c }), RepCountFailure, "busy right now");
  assertEquals(eleven.requests.length, 1, "one try, then 10 s are not enough for another");
});
