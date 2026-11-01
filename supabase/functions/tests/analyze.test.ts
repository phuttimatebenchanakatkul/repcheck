import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import * as analyze from "../_shared/analyze.ts";
import { FORM_NUMBERS as N } from "../_shared/analyzeData.ts";
import { buildPrompt, clipWindow, FormFailure, gradeClip, parseScores, resolveExercise, stripScoreLines, type Clock } from "../_shared/analyzeForm.ts";
import { GeminiClient, GeminiError, GeminiFileRejected } from "../_shared/gemini.ts";
import { app, bearer, FakeDb, FakeGemini, fakeTransport, PROJECT, USER } from "./support.ts";

// ---- a graded reply, a clock, and a way to ask the grader ------------------------------------------------------------------------

const REPLY = `STRETCH_SCORE: 72
SQUEEZE_SCORE: 64
OVERALL_SCORE: 68
FAVORED: stretch
REPS: 9

## Movement Summary
- 9 reps, mostly full range
- Tempo speeds up late in the set

## Positives
- Elbows stay pinned

## Negatives
- Swing on the last 3 reps
- Wrists curl at the top
`;

/** Time that only moves when the test moves it (the grader asks it the time and for pauses). */
function clock(start = 0) {
  const c = { t: start, sleeps: [] as number[], now: () => c.t, sleep: (ms: number) => { c.sleeps.push(ms); c.t += ms; return Promise.resolve(); } };
  return c as Clock & typeof c;
}

const clip = (bytes = 9000) => new Uint8Array(bytes);

// ---- the clip window: what trim_video kept -----------------------------------------------------------------------------------------

Deno.test("clipWindow: skip the first 5 s unless that leaves under 3 s, keep at most 60, refuse what is too short", () => {
  const w = (d: number | null, size = 9000) => { const x = clipWindow(d, size); return [x.start, x.end, x.length]; };
  assertEquals(w(30), [5, 30, 25]);
  assertEquals(w(100), [5, 65, 60]);
  assertEquals(w(65), [5, 65, 60]);
  assertEquals(w(8), [5, 8, 3], "exactly 3 s left after the lead-in is usable");
  assertEquals(w(7.9), [0, 7.9, 7.9], "under 8 s: no lead-in is skipped");
  assertEquals(w(3), [0, 3, 3]);
  assertEquals(w(23.46), [5, 23.46, 18.5], "the length the model is told is rounded to a tenth");
  assertEquals(w(null), [5, 65, 60], "no measured length: the website's full window");
  for (const d of [2.9, 0, 0.5]) {
    let e: unknown;
    try { clipWindow(d, 9000); } catch (x) { e = x; }
    assert(e instanceof FormFailure && e.message === "That clip is too short to analyze. Please upload a video of at least 3 seconds showing your full set.", String(d));
  }
  let small: unknown;
  try { clipWindow(null, N.MIN_USABLE_BYTES - 1); } catch (x) { small = x; }
  assert(small instanceof FormFailure && small.message === "Couldn't read that video. Please upload a clear clip of your full set.");
  assertEquals(clipWindow(null, N.MIN_USABLE_BYTES).length, 60);
});

// ---- grading ---------------------------------------------------------------------------------------------------------------------

Deno.test("gradeClip: the clip is stored with Gemini, the model is shown the stretch that counts, and the stored clip is removed again", async () => {
  const model = new FakeGemini(() => REPLY);
  const seen: unknown[] = [];
  const graded = await gradeClip(model, clip(), ".mov", "Bicep Curl", { clock: clock(), onModel: (i) => seen.push(i.window) });
  assertEquals(graded, {
    feedback: REPLY.split("\n").slice(6).join("\n"), exercise_label: "Bicep Curl", stretch_score: 72, squeeze_score: 64, overall_score: 68, favored: "stretch", reps: 9,
  });
  assertEquals(model.uploads, [{ bytes: 9000, mimeType: "video/quicktime", timeoutMs: 45_000 }]);
  const request = model.requests[0];
  assertEquals([request.model, request.temperature, request.thinkingLevel, request.attempts], [N.GEMINI_MODEL, 0, "LOW", 1]);
  assert(request.timeoutMs! <= 60_000 && request.timeoutMs! >= 59_000);
  assertEquals(request.contents.length, 1);
  assertEquals(request.contents[0].role, "user");
  assertEquals(request.contents[0].videos, [{ fileUri: "https://files.example/f1", mimeType: "video/mp4", startOffset: "5s", endOffset: "30s", fps: 15 }]);
  assertEquals(request.contents[0].text, buildPrompt(resolveExercise("Bicep Curl"), 25));
  assertStringIncludes(request.contents[0].text, "25.0 seconds");
  assertEquals(model.deleted, ["files/f1"]);
  assertEquals(seen, [{ start: 5, end: 30, length: 25 }]);
});

Deno.test("gradeClip: every container is sent under its own type, and an unknown one as mp4", async () => {
  for (const [suffix, type] of [[".mp4", "video/mp4"], [".m4v", "video/mp4"], [".mov", "video/quicktime"], [".avi", "video/x-msvideo"], [".mkv", "video/x-matroska"], [".webm", "video/webm"], [".xyz", "video/mp4"]]) {
    const model = new FakeGemini(() => REPLY);
    await gradeClip(model, clip(), suffix, "Bicep Curl", { clock: clock() });
    assertEquals(model.uploads[0].mimeType, type, suffix);
  }
});

Deno.test("gradeClip: a curated exercise is found by key or label, anything else is graded under the name given", async () => {
  const labelled = async (name: string) => (await gradeClip(new FakeGemini(() => REPLY), clip(), ".mp4", name, { clock: clock() })).exercise_label;
  assertEquals([await labelled("bicep_curl"), await labelled("  BICEP curl "), await labelled("Cable Pullover")], ["Bicep Curl", "Bicep Curl", "Cable Pullover"]);
});

Deno.test("gradeClip: the model's UNSCORABLE, a reply with no score, and a clip too short are the person's own plain messages", async () => {
  const say = async (reply: string) => {
    try {
      await gradeClip(new FakeGemini(() => reply), clip(), ".mp4", "Bicep Curl", { clock: clock() });
    } catch (e) {
      return (e as Error).message;
    }
    return "graded";
  };
  assertEquals(await say("UNSCORABLE: The video is black."), "We couldn't analyze that video — The video is black. Please upload a clear clip of your full set and try again.");
  assertEquals(await say("  \nUNSCORABLE:"), "We couldn't analyze that video. Please upload a clear clip of your full set and try again.");
  assertEquals(await say("UNSCORABLE: nothing\nsecond line"), "We couldn't analyze that video — nothing Please upload a clear clip of your full set and try again.");
  assertEquals(await say("Looks fine to me."), "We couldn't score that video. Please try uploading it again.");
  assertEquals(await say("Note: not UNSCORABLE: really\nOVERALL_SCORE: 80\n## Positives\n- ok"), "graded", "the word later in a graded reply changes nothing");
  assertEquals(await say("UNSCORABLE: but\nOVERALL_SCORE: 80"), "graded", "a score that parsed wins over the word at the start");
  const short = new FakeGemini(() => REPLY);
  short.fileAnswer = () => ({ name: "files/s", uri: "u", mimeType: "video/mp4", durationSeconds: 2 });
  await assertRejects(() => gradeClip(short, clip(), ".mp4", "Bicep Curl", { clock: clock() }), FormFailure, "too short");
  assertEquals([short.requests.length, short.deleted], [0, ["files/s"]], "the model is never asked, and the stored clip still goes");
});

Deno.test("gradeClip: a clip Gemini cannot read, and a store that is down, are two different plain messages; nothing is left behind", async () => {
  const rejected = new FakeGemini(() => REPLY);
  rejected.fileAnswer = () => new GeminiFileRejected("bad");
  await assertRejects(() => gradeClip(rejected, clip(), ".mp4", "Bicep Curl", { clock: clock() }), FormFailure, "Couldn't read that video. Please upload a clear clip of your full set.");
  const down = new FakeGemini(() => REPLY);
  down.fileAnswer = () => new GeminiError("503");
  await assertRejects(() => gradeClip(down, clip(), ".mp4", "Bicep Curl", { clock: clock() }), FormFailure, "Couldn't process that video. Please try uploading it again.");
  for (const m of [rejected, down]) assertEquals([m.requests.length, m.deleted], [0, []]);
  const bug = new FakeGemini(() => REPLY);
  bug.fileAnswer = () => new TypeError("a bug, not Gemini");
  await assertRejects(() => gradeClip(bug, clip(), ".mp4", "Bicep Curl", { clock: clock() }), TypeError);
  const noKey = new FakeGemini(() => REPLY, false);
  await assertRejects(() => gradeClip(noKey, clip(), ".mp4", "Bicep Curl", { clock: clock() }), FormFailure, "Form analysis isn't available right now. Please try again later.");
  assertEquals(noKey.uploads.length, 0);
});

Deno.test("gradeClip: an empty or blocked answer is tried again at once, up to three tries, then the plain message; the stored clip goes either way", async () => {
  const c = clock();
  const model = new FakeGemini(() => null);
  await assertRejects(() => gradeClip(model, clip(), ".mp4", "Bicep Curl", { clock: c }), FormFailure, "Gemini didn't return a usable response for this video. Please try again.");
  assertEquals([model.requests.length, c.sleeps, model.deleted], [3, [], ["files/f1"]]);
  const second = new FakeGemini((() => { let n = 0; return () => (++n < 3 ? "" : REPLY); })());
  assertEquals((await gradeClip(second, clip(), ".mp4", "Bicep Curl", { clock: clock() })).overall_score, 68);
  assertEquals(second.requests.length, 3);
});

Deno.test("gradeClip: an error is retried after a 2 s pause (not after the last try), and the final error is named", async () => {
  const c = clock();
  const model = new FakeGemini(() => new GeminiError("Gemini answered 503"));
  await assertRejects(() => gradeClip(model, clip(), ".mp4", "Bicep Curl", { clock: c }), FormFailure, "Gemini request failed after retries: Gemini answered 503");
  assertEquals([model.requests.length, c.sleeps], [3, [2000, 2000]]);
  const once = new FakeGemini((() => { let n = 0; return () => (++n === 1 ? new GeminiError("Gemini answered 503") : REPLY); })());
  assertEquals((await gradeClip(once, clip(), ".mp4", "Bicep Curl", { clock: clock() })).reps, 9);
});

Deno.test("gradeClip: the whole thing is held to one 60 s budget, with the wait said plainly, and an attempt that cannot finish is never started", async () => {
  // a model that takes 50 s to fail: the second try would have only 10 s (< 12), so it is not started
  const c = clock();
  const slow = new FakeGemini(() => { c.t += 50_000; return new GeminiError("Gemini answered 503"); });
  await assertRejects(() => gradeClip(slow, clip(), ".mp4", "Bicep Curl", { clock: c }), FormFailure, "That analysis took longer than 60 seconds, so we stopped waiting. This is usually a busy moment on our end, not a problem with your video -- please try again.");
  assertEquals([slow.requests.length, c.sleeps], [1, []], "no pause either: 10 s left is under the 14 s a pause needs");
  // each try is given only what is left
  const c2 = clock();
  const shrinking = new FakeGemini(() => { c2.t += 20_000; return null; });
  await assertRejects(() => gradeClip(shrinking, clip(), ".mp4", "Bicep Curl", { clock: c2 }), FormFailure);
  assertEquals(shrinking.requests.map((r) => r.timeoutMs), [60_000, 40_000, 20_000]);
  // a timeout from the transport reads as the budget's message
  const timeout = new FakeGemini(() => new GeminiError("TimeoutError"));
  await assertRejects(() => gradeClip(timeout, clip(), ".mp4", "Bicep Curl", { clock: clock() }), FormFailure, "took longer than 60 seconds");
  // an explicit smaller budget
  const small = new FakeGemini(() => null);
  await assertRejects(() => gradeClip(small, clip(), ".mp4", "Bicep Curl", { clock: clock(), budgetSeconds: 11 }), FormFailure, "took longer than 11 seconds");
  assertEquals(small.requests.length, 0);
});

Deno.test("gradeClip: a different model can be asked for", async () => {
  const model = new FakeGemini(() => REPLY);
  await gradeClip(model, clip(), ".mp4", "Bicep Curl", { clock: clock(), model: "gemini-next" });
  assertEquals(model.requests[0].model, "gemini-next");
});

Deno.test("parseScores and stripScoreLines: scores are clamped to 0-100, reps are not, the favoured side is lower-cased, and only whole score lines are removed", () => {
  assertEquals(parseScores("STRETCH_SCORE: 140\nSQUEEZE_SCORE:  -5\nOVERALL_SCORE:0\nFAVORED: SQUEEZE\nREPS: 250"), { stretch: 100, squeeze: null, overall: 0, favored: "squeeze", reps: 250 });
  assertEquals(parseScores("nothing"), { stretch: null, squeeze: null, overall: null, favored: null, reps: null });
  assertEquals(parseScores("OVERALL_SCORE: ٨٠ REPS: ٣").overall, 80, "Python reads the digits of any script");
  assertEquals(parseScores("FAVORED: balanced").favored, "balanced");
  const text = "STRETCH_SCORE: 1\r\nOVERALL_SCORE: 2  \nFAVORED: stretch\nREPS: 3\nkeep REPS: 4 here\n## A\n- x";
  assertEquals(stripScoreLines(text), "keep REPS: 4 here\n## A\n- x");
});

// ---- the Gemini client's side of it ------------------------------------------------------------------------------------------------

function fileStore(options: { states?: string[]; startStatus?: number; putStatus?: number; duration?: string | null } = {}) {
  const states = [...(options.states ?? ["ACTIVE"])];
  const seen: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const send: typeof fetch = (input, init = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    seen.push({ url, method: String(init.method), headers, body: init.body });
    const meta = (state: string) => ({ name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "video/mp4", state, ...(options.duration === null ? {} : { videoMetadata: { videoDuration: options.duration ?? "23.5s" } }) });
    if (url.endsWith("/upload/v1beta/files")) return Promise.resolve(options.startStatus ? new Response("", { status: options.startStatus }) : new Response("", { headers: { "x-goog-upload-url": "https://upload.example/session" } }));
    if (url === "https://upload.example/session") return Promise.resolve(options.putStatus ? new Response("", { status: options.putStatus }) : Response.json({ file: meta(states.shift() ?? "ACTIVE") }));
    if (url.endsWith("/v1beta/files/abc")) return Promise.resolve(Response.json(meta(states.shift() ?? "ACTIVE")));
    return Promise.resolve(new Response("{}"));
  };
  const sleeps: number[] = [];
  return { client: new GeminiClient("KEY", send, (ms) => { sleeps.push(ms); return Promise.resolve(); }), seen, sleeps };
}

Deno.test("GeminiClient.upload: a resumable upload in two requests, then one check a second until the file can be read", async () => {
  const s = fileStore({ states: ["PROCESSING", "PROCESSING", "ACTIVE"] });
  const file = await s.client.upload(new Uint8Array(5), "video/quicktime", 30_000);
  assertEquals(file, { name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "video/mp4", durationSeconds: 23.5 });
  const [start, put, ...polls] = s.seen;
  assertEquals([start.method, start.url], ["POST", "https://generativelanguage.googleapis.com/upload/v1beta/files"]);
  assertEquals([start.headers["x-goog-api-key"], start.headers["x-goog-upload-protocol"], start.headers["x-goog-upload-command"], start.headers["x-goog-upload-header-content-length"], start.headers["x-goog-upload-header-content-type"]], ["KEY", "resumable", "start", "5", "video/quicktime"]);
  assertEquals([put.url, put.headers["x-goog-upload-command"], put.headers["x-goog-upload-offset"], (put.body as Uint8Array).length], ["https://upload.example/session", "upload, finalize", "0", 5]);
  assertEquals(polls.map((p) => [p.method, p.url]), [["GET", "https://generativelanguage.googleapis.com/v1beta/files/abc"], ["GET", "https://generativelanguage.googleapis.com/v1beta/files/abc"]]);
  assertEquals(s.sleeps, [1000, 1000]);
});

Deno.test("GeminiClient.upload: a file Gemini cannot read is a rejection, one that never finishes is a plain error, and a busy answer is tried once more", async () => {
  await assertRejects(() => fileStore({ states: ["PROCESSING", "FAILED"] }).client.upload(new Uint8Array(1), "video/mp4", 30_000), GeminiFileRejected);
  await assertRejects(() => fileStore({ states: Array(50).fill("PROCESSING") }).client.upload(new Uint8Array(1), "video/mp4", 3000), GeminiError, "in time");
  const busy = fileStore({ startStatus: 503 });
  await assertRejects(() => busy.client.upload(new Uint8Array(1), "video/mp4", 30_000), GeminiError, "503");
  assertEquals([busy.seen.length, busy.sleeps], [2, [1000]]);
  await assertRejects(() => fileStore({ putStatus: 400 }).client.upload(new Uint8Array(1), "video/mp4", 30_000), GeminiError, "400");
  assertEquals((await fileStore({ duration: null }).client.upload(new Uint8Array(1), "video/mp4", 30_000)).durationSeconds, null);
  await assertRejects(() => new GeminiClient(undefined).upload(new Uint8Array(1), "video/mp4", 1000), GeminiError, "no Gemini key");
});

Deno.test("GeminiClient.deleteFile never throws; generate puts the video, its window and the thinking level where the REST API wants them", async () => {
  const gone = fileStore();
  await gone.client.deleteFile("files/abc");
  assertEquals([gone.seen[0].method, gone.seen[0].url], ["DELETE", "https://generativelanguage.googleapis.com/v1beta/files/abc"]);
  await new GeminiClient("KEY", () => Promise.reject(new Error("offline"))).deleteFile("files/abc");
  let body: Record<string, unknown> = {};
  const client = new GeminiClient("KEY", (_u, init) => { body = JSON.parse(String(init?.body)); return Promise.resolve(Response.json({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })); });
  await client.generate({
    model: "m", temperature: 0, thinkingLevel: "LOW",
    contents: [{ role: "user", text: "Rate it", videos: [{ fileUri: "https://f/1", mimeType: "video/mp4", startOffset: "5s", endOffset: "35s", fps: 15 }] }],
  });
  assertEquals(body.contents, [{ role: "user", parts: [{ fileData: { fileUri: "https://f/1", mimeType: "video/mp4" }, videoMetadata: { startOffset: "5s", endOffset: "35s", fps: 15 } }, { text: "Rate it" }] }]);
  assertEquals(body.generationConfig, { temperature: 0, thinkingConfig: { thinkingLevel: "LOW" } });
});

// ---- the rules around a set --------------------------------------------------------------------------------------------------------

Deno.test("cleanExercise and checkSuffix: the website's checks, with the words it used", () => {
  const bad = (f: () => unknown) => { try { f(); } catch (e) { return (e as Error).message; } return "ok"; };
  assertEquals(analyze.cleanExercise("  Bicep Curl "), "Bicep Curl");
  for (const x of [undefined, null, 5, "", "   ", "a\tb", "a\x00b", "a\x7fb", "line\nbreak"]) assertEquals(bad(() => analyze.cleanExercise(x)), "Please choose an exercise.", String(x));
  assertEquals(bad(() => analyze.cleanExercise("x".repeat(101))), "That exercise name is too long.");
  assertEquals(bad(() => analyze.cleanExercise("x".repeat(100))), "ok");
  assertEquals(bad(() => analyze.cleanExercise("\u{1F3CB}".repeat(100))), "ok", "length is in characters, not bytes");
  assertEquals(analyze.checkSuffix("Set.MOV"), ".mov");
  assertEquals(analyze.checkSuffix("a/b\\c.webm"), ".webm");
  assertEquals(bad(() => analyze.checkSuffix("clip.gif")), "Unsupported file type '.gif'. Allowed: .avi, .m4v, .mkv, .mov, .mp4");
  assertEquals(bad(() => analyze.checkSuffix("noextension")), "Unsupported file type ''. Allowed: .avi, .m4v, .mkv, .mov, .mp4");
  assertEquals(bad(() => analyze.checkSuffix(".mp4")), "Unsupported file type ''. Allowed: .avi, .m4v, .mkv, .mov, .mp4", "a dot-file has no extension");
  assertEquals(bad(() => analyze.checkSuffix("x.möv\x01zzzzzzzzzzzzzzzzzz")), "Unsupported file type '.m?v?zzzzzzzzzzz'. Allowed: .avi, .m4v, .mkv, .mov, .mp4");
  assertEquals(analyze.createdMs("2026-11-01T10:20:30.123456"), Date.UTC(2026, 10, 1, 10, 20, 30, 123));
  assertEquals(analyze.createdMs("2026-11-01T10:20:30.000000"), Date.UTC(2026, 10, 1, 10, 20, 30));
});

// ---- the routes --------------------------------------------------------------------------------------------------------------------

const profileRow = { id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, deleted_at: null, created_at: new Date() };
const CREATED = "2026-11-01T10:20:30.123456";
const storedRow = (extra: Record<string, unknown> = {}) => ({
  id: 7, user_id: USER, exercise_label: "Bicep Curl", overall_score: 68, stretch_score: 72, squeeze_score: 64, favored: "stretch", reps: 9,
  feedback_text: "## Positives\n- Elbows stay pinned\n- Slow lowering", video_filename: "abc.mp4", created_text: CREATED, ...extra,
});

interface World {
  profile?: boolean;
  consent?: boolean;
  allowed?: boolean;
  saveError?: Error;
  rows?: Record<string, unknown>[];
  stale?: { id: number; video_filename: string | null }[];
  storage?: (url: string, init: RequestInit) => Response | Error;
  model?: FakeGemini;
  env?: Record<string, string>;
}

function world(options: World = {}) {
  const db = new FakeDb((sql, params) => {
    if (sql.includes("select id, name, friend_code")) return options.profile === false ? [] : [{ ...profileRow, ai_consent_at: options.consent === false ? null : new Date() }];
    if (sql.includes("insert into public.rate_limits")) return options.allowed === false ? [] : [{ window_start: 1000 }];
    if (sql.includes("select window_start from public.rate_limits")) return [{ window_start: Math.floor(Date.now() / 1000) - 600 }];
    if (sql.includes("insert into public.analyze_results")) return options.saveError ?? [{ id: 11, created_text: CREATED }];
    if (sql.includes("offset $2")) return options.stale ?? [];
    if (sql.includes("from public.analyze_results")) return (options.rows ?? []).filter((r) => r.user_id === undefined || params[0] === r.user_id);
    return 1;
  });
  const t = fakeTransport(options.storage ?? ((url) => (url.includes("/object/sign/") ? Response.json({ signedURL: "/object/sign/analyze-videos/x?token=t" }) : new Response("{}"))));
  const model = options.model ?? new FakeGemini(() => REPLY);
  return { db, t, model, call: app(db, options.env ?? {}, undefined, t.transport, model) };
}

const spent = (db: FakeDb) => db.calls.some((c) => c.sql.includes("insert into public.rate_limits"));
const refunded = (db: FakeDb) => db.calls.some((c) => c.sql.includes("greatest(count - 1, 0)"));
const saved = (db: FakeDb) => db.calls.some((c) => c.sql.includes("insert into public.analyze_results"));

function form(fields: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.set("exercise", "Bicep Curl");
  f.set("video", new File([clip()], "set.mp4", { type: "video/mp4" }));
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const post = async (w: ReturnType<typeof world>, body: BodyInit | null, headers: Record<string, string> = {}) =>
  w.call("/api/analyze", { method: "POST", body, headers: { ...(await bearer()), ...headers } });

Deno.test("every analyze route demands a token", async () => {
  for (const [method, path] of [["POST", "/api/analyze"], ["GET", "/api/analyze/history"], ["GET", "/api/analyze/history/1"], ["GET", "/api/analyze/latest"], ["GET", "/api/analyze/video/1"]]) {
    assertEquals((await app()(path, { method })).status, 401, path);
  }
});

Deno.test("POST analyze: no profile is a 404 and no consent the usual 403, before the clip is read, stored or graded", async () => {
  const none = world({ profile: false });
  const r1 = await post(none, form());
  assertEquals([r1.status, (await r1.json()).error], [404, "No profile yet. Create it first."]);
  const refused = world({ consent: false });
  const r2 = await post(refused, form());
  assertEquals([r2.status, (await r2.json()).needs_ai_consent], [403, true]);
  for (const w of [none, refused]) assertEquals([spent(w.db), w.model.uploads.length, w.t.requests.length], [false, 0, 0]);
});

Deno.test("POST analyze: bad input is a 400 with the website's words before anything is spent", async () => {
  const f = (fields: Record<string, string | Blob>) => form(fields);
  const cases: [string, BodyInit | null, string][] = [
    ["no body", null, "Please choose a video file."],
    ["no video", (() => { const x = new FormData(); x.set("exercise", "Curl"); return x; })(), "Please choose a video file."],
    ["a video that is only text", f({ video: "not a file" }), "Please choose a video file."],
    ["a file with no name", f({ video: new File([clip()], "", { type: "video/mp4" }) }), "Please choose a video file."],
    ["no exercise", (() => { const x = new FormData(); x.set("video", new File([clip()], "a.mp4")); return x; })(), "Please choose an exercise."],
    ["a blank exercise", f({ exercise: "   " }), "Please choose an exercise."],
    ["a control character in the exercise", f({ exercise: "Curl\x07" }), "Please choose an exercise."],
    ["a long exercise", f({ exercise: "x".repeat(101) }), "That exercise name is too long."],
    ["a gif", f({ video: new File([clip()], "set.gif") }), "Unsupported file type '.gif'. Allowed: .avi, .m4v, .mkv, .mov, .mp4"],
  ];
  for (const [what, body, message] of cases) {
    const w = world();
    const r = await post(w, body);
    assertEquals([r.status, (await r.json()).error], [400, message], what);
    assertEquals([spent(w.db), w.model.uploads.length], [false, 0], what);
  }
  const first = world();
  assertEquals((await (await post(first, form({ exercise: "", video: new File([clip()], "a.gif") }))).json()).error, "Please choose an exercise.", "the exercise is checked before the file type");
});

Deno.test("POST analyze: a body larger than the limit is a 413, by its declared length and by what actually arrives", async () => {
  const w = world();
  const declared = await post(w, form(), { "content-length": String(analyze.MAX_UPLOAD_BYTES + 2 * 1024 * 1024) });
  assertEquals([declared.status, (await declared.json()).error], [413, "That request is too large."]);
  const big = world();
  const huge = await post(big, form({ video: new File([new Uint8Array(analyze.MAX_UPLOAD_BYTES + 100)], "set.mp4") }));
  assertEquals(huge.status, 413);
  for (const x of [w, big]) assertEquals([spent(x.db), x.model.uploads.length], [false, 0]);
});

Deno.test("POST analyze: the daily allowance answers 429 with how long to wait; the owner and App Review are never limited", async () => {
  const w = world({ allowed: false });
  const r = await post(w, form());
  const body = await r.json();
  assertEquals([r.status, body.ok], [429, false]);
  assertStringIncludes(body.error, "You've used your 1 workout analysis for now — try again in about");
  assert(Number(r.headers.get("Retry-After")) > 0);
  assertEquals(w.model.uploads.length, 0);
  const exempt = world({ allowed: false, env: { REVIEW_ACCOUNT_EMAILS: "lifter@example.com" } });
  assertEquals((await post(exempt, form())).status, 200);
  assert(!spent(exempt.db));
  assert(exempt.db.calls.some((c) => c.params[1] === "feature:workout_analysis"), "still counted");
});

Deno.test("POST analyze: a good set is graded, its clip kept under the person's folder, the result saved, the use spent and counted", async () => {
  const w = world();
  const r = await post(w, form());
  const out = await r.json();
  assertEquals(r.status, 200);
  assertEquals([out.ok, out.id, out.exercise_label, out.overall_score, out.stretch_score, out.squeeze_score, out.favored, out.reps], [true, 11, "Bicep Curl", 68, 72, 64, "stretch", 9]);
  assertEquals([out.created_at, out.created_at_ms], ["2026-11-01T10:20:30.123456+00:00", Date.UTC(2026, 10, 1, 10, 20, 30, 123)]);
  assertEquals(out.sections.map((s: { css_class: string }) => s.css_class), ["summary", "positives", "negatives"]);
  assertEquals(out.sections[0].summary_html, "<p>9 reps, mostly full range</p>");
  assertEquals(out.sections[0].detail_html, "<ul><li>Tempo speeds up late in the set</li></ul>");
  assertEquals(out.feedback_text.startsWith("## Movement Summary"), true);
  assertEquals(out.video_url, `${PROJECT}/storage/v1/object/sign/analyze-videos/x?token=t`);
  const put = w.t.requests[0];
  assert(new RegExp(`/storage/v1/object/analyze-videos/${USER}/[0-9a-f]{32}\\.mp4$`).test(put.url), put.url);
  assertEquals([put.method, put.headers["content-type"], put.headers["x-upsert"]], ["POST", "video/mp4", "false"]);
  const insert = w.db.calls.find((c) => c.sql.includes("insert into public.analyze_results"))!;
  assertEquals(insert.params.slice(0, 8), [USER, "Bicep Curl", 68, 72, 64, "stretch", 9, out.feedback_text]);
  assert(/^[0-9a-f]{32}\.mp4$/.test(String(insert.params[8])));
  assert(spent(w.db) && !refunded(w.db));
  assert(w.db.calls.some((c) => c.sql.includes("usage_events") && c.params[1] === "feature:workout_analysis"));
  assertEquals(w.model.deleted, ["files/f1"]);
  assertEquals(w.model.uploads[0].bytes, 9000);
});

Deno.test("POST analyze: each container is stored with its own type", async () => {
  for (const [name, type] of [["a.mov", "video/quicktime"], ["a.M4V", "video/x-m4v"], ["a.avi", "video/x-msvideo"], ["a.mkv", "video/x-matroska"], ["a.webm", "video/webm"]]) {
    const w = world();
    assertEquals((await post(w, form({ video: new File([clip()], name) }))).status, 200, name);
    assertEquals(w.t.requests[0].headers["content-type"], type, name);
    assert(w.t.requests[0].url.endsWith(name.slice(name.lastIndexOf(".")).toLowerCase()), name);
  }
});

Deno.test("POST analyze: a set that cannot be graded says why and keeps the person's allowance; nothing is stored or saved", async () => {
  for (const reply of ["UNSCORABLE: black screen", "no scores here", null]) {
    const w = world({ model: new FakeGemini(() => reply) });
    const r = await post(w, form());
    assertEquals(r.status, 400, String(reply));
    assert(typeof (await r.json()).error === "string");
    assert(spent(w.db) && refunded(w.db) && !saved(w.db), String(reply));
    assertEquals(w.t.requests.length, 0);
    assertEquals(w.model.deleted, ["files/f1"]);
  }
});

Deno.test("POST analyze: a crash while grading is a 500 that gives the use back", async () => {
  const model = new FakeGemini(() => REPLY);
  model.fileAnswer = () => new TypeError("a bug");
  const w = world({ model });
  const error = console.error;
  console.error = () => {};
  try {
    assertEquals((await post(w, form())).status, 500);
  } finally {
    console.error = error;
  }
  assert(refunded(w.db) && !saved(w.db));
});

Deno.test("POST analyze: if saving fails the stored clip is removed again and the use is given back", async () => {
  const w = world({ saveError: new Error("db down") });
  const error = console.error;
  console.error = () => {};
  try {
    assertEquals((await post(w, form())).status, 500);
  } finally {
    console.error = error;
  }
  assert(refunded(w.db));
  const gone = w.t.requests.find((r) => r.method === "DELETE");
  assertEquals((gone!.body as { prefixes: string[] }).prefixes.length, 1);
  assert((gone!.body as { prefixes: string[] }).prefixes[0].startsWith(`${USER}/`));
});

Deno.test("POST analyze: when the clip cannot be stored the analysis is still saved, without a replay; a clip over the bucket's limit is not even tried", async () => {
  for (const status of [400, 413, 500]) {
    const w = world({ storage: (url) => (url.includes("/object/sign/") ? Response.json({}) : new Response(JSON.stringify({ statusCode: status === 413 ? "413" : "x", message: "no" }), { status })) });
    const r = await post(w, form());
    const out = await r.json();
    assertEquals([r.status, out.ok, out.video_url], [200, true, null], String(status));
    assertEquals(w.db.calls.find((c) => c.sql.includes("insert into public.analyze_results"))!.params[8], null);
  }
  const w = world();
  const r = await post(w, form({ video: new File([new Uint8Array(analyze.MAX_CLIP_BYTES + 1)], "big.mp4") }));
  assertEquals(r.status, 200);
  assertEquals(w.t.requests.length, 0, "nothing sent to Storage");
  assertEquals((await r.json()).video_url, null);
  assertEquals(w.model.uploads[0].bytes, analyze.MAX_CLIP_BYTES + 1, "the model still gets the whole clip");
});

Deno.test("POST analyze: the 21st analysis pushes out the oldest, its clip first; a clip that will not go keeps its row; a failing prune never fails the analysis", async () => {
  const stale = [{ id: 1, video_filename: "old.mp4" }, { id: 2, video_filename: null }];
  const w = world({ stale });
  assertEquals((await post(w, form())).status, 200);
  assertEquals((w.t.requests.find((r) => r.method === "DELETE")!.body as { prefixes: string[] }).prefixes, [`${USER}/old.mp4`]);
  const del = w.db.calls.find((c) => c.sql.includes("delete from public.analyze_results"))!;
  assertEquals(del.params, [USER, [1, 2]]);

  const stuck = world({ stale, storage: (url, init) => (init.method === "DELETE" ? new Response("{}", { status: 500 }) : url.includes("/object/sign/") ? Response.json({}) : new Response("{}")) });
  assertEquals((await post(stuck, form())).status, 200);
  assertEquals(stuck.db.calls.find((c) => c.sql.includes("delete from public.analyze_results"))!.params, [USER, [2]], "only the row with no clip goes");

  const nothing = world({ stale: [{ id: 3, video_filename: null }] });
  await post(nothing, form());
  assertEquals(nothing.t.requests.filter((r) => r.method === "DELETE").length, 0, "no clip, so Storage is not asked");

  const error = console.error;
  console.error = () => {};
  try {
    const db = new FakeDb((sql) => {
      if (sql.includes("select id, name, friend_code")) return [{ ...profileRow, ai_consent_at: new Date() }];
      if (sql.includes("insert into public.rate_limits")) return [{ window_start: 1 }];
      if (sql.includes("insert into public.analyze_results")) return [{ id: 11, created_text: CREATED }];
      if (sql.includes("offset $2")) return new Error("prune failed");
      return 1;
    });
    const r = await app(db, {}, undefined, fakeTransport().transport, new FakeGemini(() => REPLY))("/api/analyze", { method: "POST", body: form(), headers: await bearer() });
    assertEquals(r.status, 200);
  } finally {
    console.error = error;
  }
});

Deno.test("analyze prune: keeps exactly the newest twenty and touches only the caller's rows", async () => {
  const w = world({ stale: [] });
  assertEquals(await analyze.prune(w.db, new (await import("../_shared/supabaseAdmin.ts")).Storage(PROJECT, "k", w.t.transport), USER), 0);
  const q = w.db.calls[0];
  assertEquals([q.params, q.sql.includes("where user_id = $1"), q.sql.includes("order by created_at desc, id desc offset $2")], [[USER, 20], true, true]);
});

Deno.test("GET history, one analysis, the latest, and the clip link: only the caller's, in the shape a fresh one comes back in", async () => {
  const row = storedRow();
  const w = world({ rows: [{ ...row, user_id: USER }] });
  const list = await (await w.call("/api/analyze/history", { headers: await bearer() })).json();
  assertEquals(list, { ok: true, entries: [{ id: 7, exercise_label: "Bicep Curl", overall_score: 68, reps: 9, created_at: "2026-11-01T10:20:30.123456+00:00", has_video: true }] });
  assertEquals(w.db.calls[0].params, [USER, 20]);

  for (const path of ["/api/analyze/history/7", "/api/analyze/latest"]) {
    const out = await (await w.call(path, { headers: await bearer() })).json();
    assertEquals([out.ok, out.id, out.reps, out.video_url, out.created_at_ms], [true, 7, 9, `${PROJECT}/storage/v1/object/sign/analyze-videos/x?token=t`, Date.UTC(2026, 10, 1, 10, 20, 30, 123)], path);
    assertEquals(out.sections[0].summary_html, "<p>Elbows stay pinned</p>");
  }
  assertEquals(w.db.calls.at(-1)!.params, [USER], "latest is scoped to the caller in SQL");
  assertEquals(w.db.calls.at(-2)!.params, [USER, 7]);
  const link = await (await w.call("/api/analyze/video/7", { headers: await bearer() })).json();
  assertEquals(link, { ok: true, url: `${PROJECT}/storage/v1/object/sign/analyze-videos/x?token=t`, expires_in: 300 });
  assertEquals(w.t.requests.at(-1)!.url, `${PROJECT}/storage/v1/object/sign/analyze-videos/${USER}/abc.mp4`);
  assertEquals(w.t.requests.at(-1)!.body, { expiresIn: 300 });
});

Deno.test("GET analysis: someone else's, a missing one, one without a clip and one whose clip has vanished never produce a dead link", async () => {
  const none = world({ rows: [] });
  for (const path of ["/api/analyze/history/7", "/api/analyze/latest", "/api/analyze/video/7", "/api/analyze/history/abc"]) {
    const r = await none.call(path, { headers: await bearer() });
    assertEquals([r.status, (await r.json()).error], [404, "Not found."], path);
  }
  assertEquals(await (await none.call("/api/analyze/history", { headers: await bearer() })).json(), { ok: true, entries: [] });
  const bare = world({ rows: [{ ...storedRow({ video_filename: null }), user_id: USER }] });
  assertEquals((await (await bare.call("/api/analyze/history/7", { headers: await bearer() })).json()).video_url, null);
  assertEquals((await bare.call("/api/analyze/video/7", { headers: await bearer() })).status, 404);
  assertEquals(bare.t.requests.length, 0, "nothing to sign");
  const vanished = world({ rows: [{ ...storedRow(), user_id: USER }], storage: () => new Response("{}", { status: 404 }) });
  assertEquals((await (await vanished.call("/api/analyze/history/7", { headers: await bearer() })).json()).video_url, null);
  assertEquals((await vanished.call("/api/analyze/video/7", { headers: await bearer() })).status, 404);
  const down = world({ rows: [{ ...storedRow(), user_id: USER }], storage: () => new Response("{}", { status: 401 }) });
  assertEquals((await (await down.call("/api/analyze/history/7", { headers: await bearer() })).json()).video_url, null, "a Storage outage costs the replay, not the result");
  assertEquals(analyze.entryJson({ ...storedRow(), video_filename: null }).has_video, false);
});

// ---- edges the mutation run found nobody was watching -----------------------------------------------------------------------------

Deno.test("gradeClip: a try that has exactly 12 s left is still made; one pause needs 14 s, so with 13 s left the next try starts at once", async () => {
  const c = clock();
  let n = 0;
  const exact = new FakeGemini(() => { c.t += 48_000; return ++n === 1 ? null : REPLY; });
  assertEquals((await gradeClip(exact, clip(), ".mp4", "Bicep Curl", { clock: c })).reps, 9);
  assertEquals(exact.requests.map((r) => r.timeoutMs), [60_000, 12_000]);

  const c2 = clock();
  let m = 0;
  const thirteen = new FakeGemini(() => { c2.t += 47_000; return ++m === 1 ? new GeminiError("Gemini answered 503") : REPLY; });
  assertEquals((await gradeClip(thirteen, clip(), ".mp4", "Bicep Curl", { clock: c2 })).reps, 9);
  assertEquals([c2.sleeps, thirteen.requests.map((r) => r.timeoutMs)], [[], [60_000, 13_000]]);
});

Deno.test("gradeClip: an empty answer after an error clears the error, so the last word is about the empty answer", async () => {
  let n = 0;
  const model = new FakeGemini(() => (++n === 1 ? new GeminiError("Gemini answered 503") : null));
  await assertRejects(() => gradeClip(model, clip(), ".mp4", "Bicep Curl", { clock: clock() }), FormFailure, "Gemini didn't return a usable response for this video. Please try again.");
});

Deno.test("POST analyze: the model is given the clip under its own container's type, and NUL characters never reach the database", async () => {
  const model = new FakeGemini(() => REPLY.replace("Elbows", "El\u0000bows"));
  const w = world({ model });
  const r = await post(w, form({ video: new File([clip()], "set.MOV") }));
  assertEquals(r.status, 200);
  assertEquals(model.uploads[0].mimeType, "video/quicktime");
  const insert = w.db.calls.find((c) => c.sql.includes("insert into public.analyze_results"))!;
  assert(!String(insert.params[7]).includes("\u0000") && String(insert.params[7]).includes("Elbows"), "the text is saved with the NULs dropped");
});

Deno.test("the upload ceiling is 80 MiB and the history keeps twenty: numbers other code leans on", () => {
  assertEquals([analyze.MAX_UPLOAD_BYTES, analyze.MAX_CLIP_BYTES, analyze.HISTORY_KEEP], [80 * 1024 * 1024, 50 * 1024 * 1024, 20]);
});

Deno.test("the analyze queries are scoped to the caller and ordered newest first, in the SQL itself", async () => {
  const w = world({ rows: [{ ...storedRow(), user_id: USER }] });
  await w.call("/api/analyze/history/7", { headers: await bearer() });
  await w.call("/api/analyze/latest", { headers: await bearer() });
  await w.call("/api/analyze/history", { headers: await bearer() });
  const sql = w.db.calls.map((c) => c.sql);
  assert(sql[0].includes("where user_id = $1 and id = $2") && !sql[0].includes(" or "), sql[0]);
  assert(sql[1].includes("where user_id = $1 order by created_at desc, id desc limit 1"), sql[1]);
  assert(sql[2].includes("where user_id = $1 order by created_at desc, id desc limit $2"), sql[2]);
});

Deno.test("POST analyze: a failure that is not the person's clip (the model unreachable) still gives the use back and answers 400 with the website's words", async () => {
  const w = world({ model: new FakeGemini(() => new GeminiError("Gemini answered 503")) });
  const r = await post(w, form());
  assertEquals([r.status, (await r.json()).error], [400, "Gemini request failed after retries: Gemini answered 503"]);
  assert(refunded(w.db) && !saved(w.db));
});
