import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { COACH_SYSTEM_PROMPT, SOURCES } from "../_shared/chatData.ts";
import {
  askChat,
  buildAnalysisPrompt,
  buildWorkoutPrompt,
  ChatRejected,
  cleanRequest,
  EMPTY_REPLY,
  fallbackReply,
  limitedReply,
  MAX_CONTEXT_CHARS,
  MAX_HISTORY_TURNS,
  MAX_MESSAGE_CHARS,
  MAX_TURN_CHARS,
  pyJsonLength,
} from "../_shared/chats.ts";
import { GEMINI_MODEL, GeminiClient, GeminiError } from "../_shared/gemini.ts";
import { attachSources, MAX_SOURCES_PER_REPLY, promptInstruction, SOURCES_BY_ID } from "../_shared/healthSources.ts";
import { app, bearer, FakeDb, FakeGemini, fakeTransport, USER } from "./support.ts";

// ---- the sources --------------------------------------------------------------------------------------------------------

Deno.test("the catalog is the hand-checked one: 24 sources, unique ids, each a real https address", () => {
  assertEquals(SOURCES.length, 24);
  assertEquals(new Set(SOURCES.map((s) => s.id)).size, 24);
  for (const s of SOURCES) assert(s.url.startsWith("https://") && s.title && s.publisher, s.id);
  assertEquals(SOURCES_BY_ID.get("who_2020")!.publisher, "World Health Organization, 2020");
  assertEquals(MAX_SOURCES_PER_REPLY, 3);
});

Deno.test("the citation instruction lists every id and asks for one final line", () => {
  const text = promptInstruction();
  assert(text.startsWith("\n\nCiting sources (required)"));
  for (const s of SOURCES) assertStringIncludes(text, `- ${s.id}: ${s.title}`);
  assertStringIncludes(text, "SOURCES: id1, id2");
  assertStringIncludes(text, "listing 1 to 3 ids");
  assertStringIncludes(text, "write SOURCES: none");
});

Deno.test("a SOURCES line at the end is turned into links and taken off the reply", () => {
  const [reply, sources] = attachSources("Eat more protein.\nSOURCES: issn_protein_2017, morton_protein_2018", "x");
  assertEquals(reply, "Eat more protein.");
  assertEquals(sources.map((s) => s.id), ["issn_protein_2017", "morton_protein_2018"]);
  assertEquals(Object.keys(sources[0]).sort(), ["id", "publisher", "title", "url"]);
});

Deno.test("the line is tolerated in the markdown a model dresses it in", () => {
  for (const line of ["**Sources:** acsm_2009, who_2020", "SOURCES: [acsm_2009, who_2020]", "Sources - acsm_2009; who_2020", "> sources: acsm_2009, who_2020", "_sources: `acsm_2009`, `who_2020`.", "  * SOURCES : acsm_2009,who_2020  "]) {
    const [reply, sources] = attachSources(`Lift.\n${line}`, "");
    assertEquals([reply, sources.map((s) => s.id)], ["Lift.", ["acsm_2009", "who_2020"]], line);
  }
});

Deno.test("only a line that ENDS the reply is the citation: elsewhere it is the answer", () => {
  const text = "Sources: eggs, chicken, Greek yogurt\nand then more advice";
  const [reply] = attachSources(text, "");
  assertEquals(reply, text);
  const [kept] = attachSources("Good sources: eggs, chicken", "");
  assertEquals(kept, "Good sources: eggs, chicken");
  assertEquals(attachSources("Sources: eggs, chicken", "")[0], "Sources: eggs, chicken", "a final line not written in ids stays");
});

Deno.test("a made-up id in our format is dropped with its line; none means none; duplicates and extras are cut", () => {
  const [a, aSources] = attachSources("Try this.\nSOURCES: fake_study_2020", "protein");
  assertEquals(a, "Try this.");
  assertEquals(aSources.map((s) => s.id), ["issn_protein_2017", "morton_protein_2018"], "falls back to the keywords");
  const [b, bSources] = attachSources("Hello!\nSOURCES: none", "hi");
  assertEquals([b, bSources], ["Hello!", []]);
  assertEquals(attachSources("Hi.\nSOURCES: N/A", "hi")[1], []);
  assertEquals(attachSources("Hi.\nSOURCES: **None**", "hi")[1], []);
  const many = attachSources("x\nSOURCES: who_2020, who_2020, pag_2018, acsm_2011, acsm_2009", "")[1];
  assertEquals(many.map((s) => s.id), ["who_2020", "pag_2018", "acsm_2011"]);
});

Deno.test("with no line at all, keywords choose, and an advice reply with no topic gets the general guidelines", () => {
  assertEquals(attachSources("Rest well.", "how long should I rest between sets")[1].map((s) => s.id), ["schoenfeld_rest_2016", "grgic_rest_2017"]);
  assertEquals(attachSources("ok", "my knee hurts")[1].map((s) => s.id), ["nhs_sports_injuries"]);
  assertEquals(attachSources("ok", "is creatine safe")[1].map((s) => s.id), ["issn_creatine_2017"]);
  assertEquals(attachSources("ok", "pre-workout coffee")[1].map((s) => s.id), ["issn_caffeine_2021"]);
  assertEquals(attachSources("ok", "drink water, avoid dehydration")[1].map((s) => s.id), ["acsm_fluid_2007"]);
  assertEquals(attachSources("ok", "best way to lose fat")[1].map((s) => s.id), ["helms_2014", "garthe_2011", "longland_2016"]);
  assertEquals(attachSources("ok", "how much protein")[1].map((s) => s.id), ["issn_protein_2017", "morton_protein_2018"]);
  assertEquals(attachSources("ok", "sleep and soreness")[1].map((s) => s.id), ["dupuy_recovery_2018", "aasm_sleep_2015"]);
  assertEquals(attachSources("ok", "stretching and warm up")[1].map((s) => s.id), ["behm_stretching_2016", "alizadeh_rom_2023"]);
  assertEquals(attachSources("ok", "back squat depth")[1].map((s) => s.id), ["schoenfeld_squat_2010"]);
  assertEquals(attachSources("ok", "weekly volume and frequency")[1].map((s) => s.id), ["schoenfeld_volume_2017", "schoenfeld_frequency_2016"]);
  assertEquals(attachSources("ok", "how to build muscle")[1].map((s) => s.id), ["schoenfeld_volume_2017", "schoenfeld_loading_2021"]);
  assertEquals(attachSources("ok", "progressive overload plan")[1].map((s) => s.id), ["acsm_2009", "schoenfeld_loading_2021"]);
  assertEquals(attachSources("ok", "daily steps and walking")[1].map((s) => s.id), ["who_2020", "pag_2018"]);
  assertEquals(attachSources("ok", "tell me a joke")[1].map((s) => s.id), ["acsm_2009", "who_2020"]);
  assertEquals(attachSources("ok", "cutting, protein, sleep, squat")[1].length, 3, "capped at three");
});

Deno.test("a word boundary is Python's: a Thai letter is a word character, so it hides the keyword", () => {
  assertEquals(attachSources("ok", "ฉัน creatine")[1].map((s) => s.id), ["issn_creatine_2017"]);
  assertEquals(attachSources("ok", "ฉันcreatine")[1].map((s) => s.id), ["acsm_2009", "who_2020"], "glued to Thai letters it is not a whole word");
  assertEquals(attachSources("ok", "creatinex")[1].map((s) => s.id), ["acsm_2009", "who_2020"]);
});

Deno.test("a carriage return inside the question does not stop '.*' in the rest rule, and does not make a SOURCES line", () => {
  assertEquals(attachSources("ok", "rest\rbetween")[1].map((s) => s.id), ["schoenfeld_rest_2016", "grgic_rest_2017"]);
  const [reply] = attachSources("a\rSOURCES: acsm_2009", "");
  assertEquals(reply, "a\rSOURCES: acsm_2009", "only a newline starts a line");
});

// ---- the request --------------------------------------------------------------------------------------------------------------

const reject = (payload: Record<string, unknown>, context: boolean, message: string) => {
  try {
    cleanRequest(payload, context);
  } catch (e) {
    assert(e instanceof ChatRejected, String(e));
    assertEquals(e.message, message);
    return;
  }
  throw new Error("accepted " + JSON.stringify(payload));
};

Deno.test("a message is trimmed, not empty, and at most 1000 characters", () => {
  assertEquals(cleanRequest({ message: "  hi  " }, false), ["hi", [], {}]);
  assertEquals(cleanRequest({ message: "a".repeat(MAX_MESSAGE_CHARS) }, false)[0].length, MAX_MESSAGE_CHARS);
  assertEquals(cleanRequest({ message: "\u{1F3CB}".repeat(MAX_MESSAGE_CHARS) }, false)[0], "\u{1F3CB}".repeat(MAX_MESSAGE_CHARS), "characters, not UTF-16 units");
  for (const bad of [undefined, null, "", "   ", "　\n"]) reject({ message: bad }, false, "Message can't be empty.");
  reject({}, false, "Message can't be empty.");
  reject({ message: "a".repeat(MAX_MESSAGE_CHARS + 1) }, false, "That message is too long. Please keep it under 1,000 characters.");
  assertEquals(cleanRequest({ message: 5 }, false)[0], "5");
  assertEquals(cleanRequest({ message: true }, false)[0], "True");
});

Deno.test("history: a list of {role, text} strings, the newest 40, each clipped; anything else is invalid", () => {
  assertEquals(cleanRequest({ message: "m", history: [{ role: "coach", text: "a" }, { role: "user", text: "b" }] }, false)[1], [{ role: "coach", text: "a" }, { role: "user", text: "b" }]);
  for (const empty of [undefined, null, [], {}, "", 0, false]) assertEquals(cleanRequest({ message: "m", history: empty }, false)[1], [], String(empty));
  for (const bad of ["x", 5, true, { a: 1 }, [5], ["x"], [null], [[]], [{ role: 5, text: "a" }], [{ role: "a", text: 5 }], [{ text: "a" }]]) {
    reject({ message: "m", history: bad }, false, "Invalid history.");
  }
  assertEquals(cleanRequest({ message: "m", history: [{ role: "user" }] }, false)[1], [{ role: "user", text: "" }], "a missing text is empty");
  const many = Array.from({ length: 60 }, (_, i) => ({ role: "user", text: String(i) }));
  const kept = cleanRequest({ message: "m", history: many }, false)[1];
  assertEquals([kept.length, kept[0].text, kept.at(-1)!.text, MAX_HISTORY_TURNS], [40, "20", "59", 40]);
  const clipped = cleanRequest({ message: "m", history: [{ role: "r".repeat(30), text: "t".repeat(MAX_TURN_CHARS + 5) }] }, false)[1][0];
  assertEquals([clipped.role.length, clipped.text.length], [20, MAX_TURN_CHARS]);
  assertEquals(cleanRequest({ message: "m", history: [{ role: "r", text: "\u{1F3CB}".repeat(MAX_TURN_CHARS + 1) }] }, false)[1][0].text, "\u{1F3CB}".repeat(MAX_TURN_CHARS));
  reject({ message: "m", history: [...many.slice(0, 3), 5] }, false, "Invalid history.");
  assertEquals(cleanRequest({ message: "m", history: [5, ...many.slice(0, 40)] }, false)[1].length, 40, "an old bad turn beyond the window is never looked at");
});

Deno.test("context: only the chats that take one read it, and it must be an object under 40,000 characters as Python would write it", () => {
  assertEquals(cleanRequest({ message: "m", context: { a: 1 } }, true)[2], { a: 1 });
  assertEquals(cleanRequest({ message: "m", context: { a: 1 } }, false)[2], {}, "the coach ignores it");
  assertEquals(cleanRequest({ message: "m" }, true)[2], {});
  for (const empty of [null, [], {}, "", 0, false]) assertEquals(cleanRequest({ message: "m", context: empty }, true)[2], {}, String(empty));
  for (const bad of ["x", 5, true, [1], ["a"]]) reject({ message: "m", context: bad }, true, "Invalid context.");
  assertEquals(MAX_CONTEXT_CHARS, 40_000);
  const sized = (n: number) => ({ k: "x".repeat(n - '{"k": ""}'.length) });
  assertEquals(pyJsonLength(sized(MAX_CONTEXT_CHARS)), MAX_CONTEXT_CHARS);
  assertEquals(cleanRequest({ message: "m", context: sized(MAX_CONTEXT_CHARS) }, true)[2].k as string, "x".repeat(MAX_CONTEXT_CHARS - 9));
  reject({ message: "m", context: sized(MAX_CONTEXT_CHARS + 1) }, true, "Invalid context.");
  reject({ message: "m", context: { k: "ก".repeat(7000) } }, true, "Invalid context.");   // 6 characters each once escaped
  assertEquals((cleanRequest({ message: "m", context: { k: "ก".repeat(6000) } }, true)[2].k as string).length, 6000);
});

Deno.test("pyJsonLength counts what Python's json.dumps writes", () => {
  assertEquals(pyJsonLength({ a: 1, b: [true, null, "x"] }), '{"a": 1, "b": [true, null, "x"]}'.length);
  assertEquals(pyJsonLength([]), 2);
  assertEquals(pyJsonLength({}), 2);
  assertEquals(pyJsonLength('a"b\\c\nd\u0001é\u{1F3CB}'), '"a\\"b\\\\c\\nd\\u0001\\u00e9\\ud83c\\udfcb"'.length);
  assertEquals(pyJsonLength(false), 5);
  assertEquals(pyJsonLength(-12.5), 5);
  assertEquals(pyJsonLength("\u007f"), 3, "DEL is written as is");
});

Deno.test("the over-limit reply is a normal-looking message with the flags the widgets lock on", () => {
  assertEquals(limitedReply(7200), { ok: true, reply: "You've reached your 3 chat messages for now. Please check back in about 2 hours.", sources: [], limited: true, retry_after_seconds: 7200 });
});

// ---- the prompts ---------------------------------------------------------------------------------------------------------------

Deno.test("the analysis prompt carries the exercise, the scores it was given, the reps and the feedback, clipped", () => {
  const p = buildAnalysisPrompt({ exercise_label: " Bench Press ", overall_score: 82, stretch_score: 70.5, squeeze_score: "x", reps: 8.9, feedback_text: "  Keep your back flat.  " });
  assertStringIncludes(p, "a set of Bench Press analyzed");
  assertStringIncludes(p, "Scores:\nOverall form & technique: 82/100\nStretch: 70.5/100\nReps counted: 8\n\n");
  assertStringIncludes(p, "Full analysis given to the user:\nKeep your back flat.\n\n");
  assert(!p.includes("Squeeze:"));
  assertStringIncludes(buildAnalysisPrompt({}), "a set of the exercise analyzed");
  assertStringIncludes(buildAnalysisPrompt({}), "Scores:\n(not available)\n\n");
  assertStringIncludes(buildAnalysisPrompt({ feedback_text: "x".repeat(7000) }), "x".repeat(6000) + "\n\nRules");
  assert(!buildAnalysisPrompt({ feedback_text: "x".repeat(7000) }).includes("x".repeat(6001)));
  assertStringIncludes(buildAnalysisPrompt({ exercise_label: "" }), "a set of the exercise");
});

Deno.test("the workout prompt carries the summary, clipped, or says nothing is logged", () => {
  assertStringIncludes(buildWorkoutPrompt({ workout_summary: " Mon: squat 100kg " }), "The user's logged workout data:\nMon: squat 100kg\n\n");
  assertStringIncludes(buildWorkoutPrompt({}), "The user's logged workout data:\n(No workouts logged yet.)\n\n");
  assertStringIncludes(buildWorkoutPrompt({ workout_summary: "   " }), "(No workouts logged yet.)");
  assertStringIncludes(buildWorkoutPrompt({ workout_summary: "y".repeat(15000) }), "y".repeat(14000) + "\n\nRules");
  assert(!buildWorkoutPrompt({ workout_summary: "y".repeat(15000) }).includes("y".repeat(14001)));
});

// ---- asking the model -----------------------------------------------------------------------------------------------------------

Deno.test("asking the coach: roles, the last sixteen turns, no blank turns, the safety setting, the citation rule", async () => {
  const model = new FakeGemini(() => "Do squats.\nSOURCES: schoenfeld_squat_2010");
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "coach" : "user", text: i === 5 ? "   " : `turn ${i}` }));
  const result = await askChat(model, "coach", "and legs?", history, {});
  assertEquals([result.reply, result.failed, result.sources.map((s) => s.id)], ["Do squats.", false, ["schoenfeld_squat_2010"]]);
  const [req] = model.requests;
  assertEquals(req.safe, true);
  assertEquals(req.model, undefined);
  assertEquals(req.system, COACH_SYSTEM_PROMPT + promptInstruction());
  assertEquals(req.contents.length, 15 + 1, "sixteen turns minus the blank one, plus the question");
  assertEquals(req.contents[0], { role: "user", text: "turn 4" });
  assertEquals(req.contents[1], { role: "user", text: "turn 6" }, "the blank coach turn 5 was skipped");
  assertEquals(req.contents[2], { role: "model", text: "turn 7" }, "and 'coach' is the model");
  assertEquals(req.contents.at(-1), { role: "user", text: "and legs?" });
});

Deno.test("the analysis and workout chats call their own assistant 'assistant', and the coach is the only 'coach'", async () => {
  for (const kind of ["analysis", "workout"] as const) {
    const model = new FakeGemini();
    await askChat(model, kind, "q", [{ role: "assistant", text: "a" }, { role: "coach", text: "c" }, { role: "user", text: "u" }], {});
    assertEquals(model.requests[0].contents.map((c) => c.role), ["model", "user", "user", "user"], kind);
  }
  const model = new FakeGemini();
  await askChat(model, "coach", "q", [{ role: "assistant", text: "a" }], {});
  assertEquals(model.requests[0].contents[0].role, "user");
});

Deno.test("each chat builds its own system prompt", async () => {
  const analysis = new FakeGemini();
  await askChat(analysis, "analysis", "q", [], { exercise_label: "Squat" });
  assertEquals(analysis.requests[0].system, buildAnalysisPrompt({ exercise_label: "Squat" }) + promptInstruction());
  const workout = new FakeGemini();
  await askChat(workout, "workout", "q", [], { workout_summary: "s" });
  assertEquals(workout.requests[0].system, buildWorkoutPrompt({ workout_summary: "s" }) + promptInstruction());
});

Deno.test("no key, an unreachable model and an empty answer are three different replies", async () => {
  const none = await askChat(new FakeGemini(() => "x", false), "workout", "q", [], {});
  assertEquals(none, { reply: fallbackReply("workout"), sources: [], failed: true });
  const down = await askChat(new FakeGemini(() => new GeminiError("boom")), "coach", "q", [], {});
  assertEquals(down, { reply: fallbackReply("coach"), sources: [], failed: true });
  for (const empty of [null, "", "   ", "\nSOURCES: none"]) {
    const r = await askChat(new FakeGemini(() => empty), "analysis", "q", [], {});
    assertEquals(r, { reply: EMPTY_REPLY, sources: [], failed: false }, JSON.stringify(empty));
  }
  assertEquals(fallbackReply("coach"), "The AI coach isn't reachable right now (no Gemini connection). Please try again in a moment.");
  assertEquals(fallbackReply("analysis"), "The analysis assistant isn't reachable right now (no Gemini connection). Please try again in a moment.");
  assertEquals(fallbackReply("workout"), "The workout chat isn't reachable right now (no Gemini connection). Please try again in a moment.");
});

// ---- the model client -------------------------------------------------------------------------------------------------------------

Deno.test("the Gemini client posts the conversation, the system prompt and the safety settings, and joins the text parts", async () => {
  const t = fakeTransport(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello " }, { text: "there", thought: false }, { text: "hidden thought", thought: true }, { inlineData: {} }] } }] })));
  const client = new GeminiClient("key-123", t.transport.fetch);
  assertEquals(client.configured, true);
  const out = await client.generate({ system: "be kind", contents: [{ role: "user", text: "hi" }, { role: "model", text: "yo" }], safe: true });
  assertEquals(out, "Hello there");
  const [r] = t.requests;
  assertEquals([r.method, r.url], ["POST", `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`]);
  assertEquals([r.headers["x-goog-api-key"], r.headers["content-type"]], ["key-123", "application/json"]);
  const body = r.body as { contents: unknown; systemInstruction: unknown; safetySettings: { category: string; threshold: string }[] };
  assertEquals(body.contents, [{ role: "user", parts: [{ text: "hi" }] }, { role: "model", parts: [{ text: "yo" }] }]);
  assertEquals(body.systemInstruction, { parts: [{ text: "be kind" }] });
  assertEquals(body.safetySettings.map((s) => [s.category, s.threshold]), [
    ["HARM_CATEGORY_HARASSMENT", "BLOCK_MEDIUM_AND_ABOVE"], ["HARM_CATEGORY_HATE_SPEECH", "BLOCK_MEDIUM_AND_ABOVE"], ["HARM_CATEGORY_SEXUALLY_EXPLICIT", "BLOCK_MEDIUM_AND_ABOVE"], ["HARM_CATEGORY_DANGEROUS_CONTENT", "BLOCK_MEDIUM_AND_ABOVE"],
  ]);
  await client.generate({ system: "s", contents: [], model: "other-model" });
  assertStringIncludes(t.requests[1].url, "/models/other-model:generateContent");
  assert(!("safetySettings" in (t.requests[1].body as object)), "no safety settings unless asked for");
});

Deno.test("the Gemini client: blocked or empty is null; a refusal, a bad body or no network is an error; no key is an error", async () => {
  const answer = (body: unknown, status = 200) => new GeminiClient("k", fakeTransport(() => new Response(JSON.stringify(body), { status })).transport.fetch);
  const ask = (c: GeminiClient) => c.generate({ system: "s", contents: [{ role: "user", text: "q" }] });
  assertEquals(await ask(answer({})), null);
  assertEquals(await ask(answer({ candidates: [] })), null);
  assertEquals(await ask(answer({ candidates: [{ finishReason: "SAFETY" }] })), null);
  assertEquals(await ask(answer({ candidates: [{ content: { parts: [] } }] })), null);
  assertEquals(await ask(answer({ candidates: [{ content: { parts: [{ text: "" }] } }] })), null);
  for (const status of [400, 403, 429, 500, 503]) {
    const e = await ask(answer({ error: {} }, status)).catch((x) => x);
    assert(e instanceof GeminiError && e.message === `Gemini answered ${status}`, String(status));
  }
  const notJson = new GeminiClient("k", () => Promise.resolve(new Response("<html>")));
  assert(await ask(notJson).catch((x) => x) instanceof GeminiError);
  const offline = new GeminiClient("k", () => Promise.reject(new TypeError("fetch failed")));
  const e = await ask(offline).catch((x) => x);
  assert(e instanceof GeminiError && !e.message.includes("fetch failed") === false || e instanceof GeminiError);
  const keyless = new GeminiClient(undefined);
  assertEquals(keyless.configured, false);
  assert(await ask(keyless).catch((x) => x) instanceof GeminiError);
  assertEquals(new GeminiClient("").configured, false);
});

// ---- the routes ------------------------------------------------------------------------------------------------------------------

const row = (extra: Record<string, unknown> = {}) => ({ id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, ai_consent_at: new Date(), deleted_at: null, created_at: new Date(), ...extra });

function chatDb(options: { profile?: boolean; consent?: boolean; allowed?: boolean; started?: number } = {}) {
  return new FakeDb((sql) => {
    if (sql.includes("select id, name, friend_code")) return options.profile === false ? [] : [row({ ai_consent_at: options.consent === false ? null : new Date() })];
    if (sql.includes("insert into public.rate_limits")) return options.allowed === false ? [] : [{ window_start: 1000 }];
    if (sql.includes("select window_start from public.rate_limits")) return [{ window_start: Math.floor(Date.now() / 1000) - 600 }];
    return 1;
  });
}

const ask = (db: FakeDb, model: FakeGemini, path: string, body: unknown, env: Record<string, string> = {}) =>
  bearer().then((headers) => app(db, env, undefined, undefined, model)(path, { method: "POST", headers, json: body }));

Deno.test("every chat route demands a token", async () => {
  for (const path of ["/api/coach-chat", "/api/analyze-chat", "/api/workout-chat"]) assertEquals((await app()(path, { method: "POST" })).status, 401, path);
});

Deno.test("chat: no profile is a 404, no consent is the app's consent refusal, a bad message is a 400 that costs nothing", async () => {
  const model = new FakeGemini();
  const none = await ask(chatDb({ profile: false }), model, "/api/coach-chat", { message: "hi" });
  assertEquals([none.status, (await none.json()).error], [404, "No profile yet. Create it first."]);
  const noConsent = await ask(chatDb({ consent: false }), model, "/api/coach-chat", { message: "hi" });
  assertEquals([noConsent.status, (await noConsent.json()).needs_ai_consent], [403, true]);
  const db = chatDb();
  const empty = await ask(db, model, "/api/coach-chat", { message: "  " });
  assertEquals([empty.status, (await empty.json()).error], [400, "Message can't be empty."]);
  const badContext = await ask(db, model, "/api/analyze-chat", { message: "hi", context: [1] });
  assertEquals([badContext.status, (await badContext.json()).error], [400, "Invalid context."]);
  assertEquals(model.requests.length, 0);
  assert(!db.calls.some((c) => c.sql.includes("insert into public.rate_limits")), "no use was spent");
});

Deno.test("chat: a reply spends one use, is counted, and carries its sources", async () => {
  const model = new FakeGemini(() => "- Lift heavy\nSOURCES: acsm_2009");
  const db = chatDb();
  const r = await ask(db, model, "/api/coach-chat", { message: "how do I get stronger?", history: [{ role: "user", text: "hi" }] });
  const body = await r.json();
  assertEquals([r.status, body.ok, body.reply, body.limited, body.retry_after_seconds, body.sources.map((s: { id: string }) => s.id)], [200, true, "- Lift heavy", false, 0, ["acsm_2009"]]);
  assertEquals(db.calls.find((c) => c.sql.includes("insert into public.rate_limits"))!.params.slice(0, 2), [USER, "ai_chat"]);
  assert(db.calls.some((c) => c.params[1] === "feature:coach_chat_message"));
  assert(!db.calls.some((c) => c.sql.includes("greatest(count - 1")), "nothing was refunded");
  await ask(db, model, "/api/analyze-chat", { message: "why?", context: { exercise_label: "Squat" } });
  await ask(db, model, "/api/workout-chat", { message: "next?", context: { workout_summary: "s" } });
  assert(db.calls.some((c) => c.params[1] === "feature:analyze_chat_message") && db.calls.some((c) => c.params[1] === "feature:workout_chat_message"));
  assertStringIncludes(model.requests[1].system ?? "", "a set of Squat analyzed");
  assertStringIncludes(model.requests[2].system ?? "", "The user's logged workout data:\ns");
});

Deno.test("chat: the fourth message of the day is a friendly reply, not an error, and never reaches the model", async () => {
  const model = new FakeGemini();
  const r = await ask(chatDb({ allowed: false }), model, "/api/coach-chat", { message: "hi" });
  const body = await r.json();
  assertEquals([r.status, body.ok, body.limited, body.sources], [200, true, true, []]);
  assertStringIncludes(body.reply, "You've reached your 3 chat messages for now. Please check back in about");
  assert(body.retry_after_seconds > 0);
  assertEquals(model.requests.length, 0);
});

Deno.test("chat: an exempt account is never limited and spends nothing", async () => {
  const model = new FakeGemini();
  const db = chatDb({ allowed: false });
  const r = await ask(db, model, "/api/coach-chat", { message: "hi" }, { REVIEW_ACCOUNT_EMAILS: "lifter@example.com" });
  assertEquals((await r.json()).limited, false);
  assert(!db.calls.some((c) => c.sql.includes("insert into public.rate_limits")));
  assertEquals(model.requests.length, 1);
});

Deno.test("chat: an unreachable model gives the use back, so a failed message never burns one", async () => {
  for (const model of [new FakeGemini(() => new GeminiError("down")), new FakeGemini(() => "x", false)]) {
    const db = chatDb();
    const r = await ask(db, model, "/api/workout-chat", { message: "hi" });
    const body = await r.json();
    assertEquals([r.status, body.ok, body.reply], [200, true, fallbackReply("workout")]);
    const refund = db.calls.find((c) => c.sql.includes("greatest(count - 1, 0)"))!;
    assertEquals(refund.params, [USER, "ai_chat", 1000]);
    assert(!db.calls.some((c) => c.params[1] === "feature:workout_chat_message"), "and it is not counted as a message");
  }
});

Deno.test("chat: a crash after the use was spent gives it back and still fails the request", async () => {
  // a model that throws from the answer is the "unreachable" case above; a crash in the chat code itself is something else
  const model = new FakeGemini();
  Object.defineProperty(model, "configured", {
    get() {
      throw new Error("unexpected");
    },
  });
  const db = chatDb();
  const logged = console.error;
  console.error = () => {};
  try {
    const r = await ask(db, model, "/api/coach-chat", { message: "hi" });
    assertEquals(r.status, 500);
  } finally {
    console.error = logged;
  }
  assert(db.calls.some((c) => c.sql.includes("greatest(count - 1, 0)")));
});

Deno.test("the Gemini client retries 'busy' answers (429 and 5xx) up to three times with a growing wait, and nothing else", async () => {
  const run = async (statuses: number[]) => {
    const queue = [...statuses];
    const sleeps: number[] = [];
    const t = fakeTransport(() => {
      const status = queue.shift() ?? 200;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "fine" }] } }] }), { status });
    });
    const client = new GeminiClient("k", t.transport.fetch, (ms) => (sleeps.push(ms), Promise.resolve()));
    const out = await client.generate({ system: "s", contents: [] }).catch((e) => e);
    return { out, calls: t.requests.length, sleeps };
  };
  const recovers = await run([503, 503]);
  assertEquals([recovers.out, recovers.calls, recovers.sleeps], ["fine", 3, [1000, 2000]]);
  const gives = await run([503, 503, 503]);
  assert(gives.out instanceof GeminiError && gives.out.message === "Gemini answered 503");
  assertEquals([gives.calls, gives.sleeps], [3, [1000, 2000]]);
  for (const status of [429, 500, 502, 504]) assertEquals((await run([status])).out, "fine", String(status));
  for (const status of [400, 401, 403, 404]) {
    const r = await run([status]);
    assert(r.out instanceof GeminiError && r.out.message === `Gemini answered ${status}`, String(status));
    assertEquals([r.calls, r.sleeps], [1, []]);
  }
  const first = await run([]);
  assertEquals([first.out, first.calls, first.sleeps], ["fine", 1, []]);
});

Deno.test("the Gemini client does not retry a network failure or a timeout", async () => {
  let calls = 0;
  const client = new GeminiClient("k", () => {
    calls++;
    return Promise.reject(new DOMException("timed out", "TimeoutError"));
  }, () => Promise.resolve());
  const e = await client.generate({ system: "s", contents: [] }).catch((x) => x);
  assert(e instanceof GeminiError);
  assertEquals([calls, e.message], [1, "TimeoutError"]);
});

// ---- the last survivors of the chat code ----------------------------------------------------------------------------------------

Deno.test("the chat limits are the numbers they are meant to be", () => {
  assertEquals([MAX_MESSAGE_CHARS, MAX_HISTORY_TURNS, MAX_TURN_CHARS, MAX_CONTEXT_CHARS], [1000, 40, 4000, 40000]);
});

Deno.test("a made-up id in our format goes with its line whatever punctuation the model wraps it in, but an empty list or prose stays", () => {
  for (const line of ["SOURCES: `fake_study_2020`.", "SOURCES: [fake_one, fake_two]", "SOURCES: (fake_study_2020)", "SOURCES: 2020_fake_study", "SOURCES: 7_x"]) {
    assertEquals(attachSources(`Try this.\n${line}`, "zzz")[0], "Try this.", line);
  }
  for (const line of ["SOURCES:", "SOURCES:   ", "SOURCES: .", "SOURCES: **fake_one**;", "SOURCES: fake", "SOURCES: fake_study_2020 and more", "SOURCES: _x"]) {
    assertEquals(attachSources(`Try this.\n${line}`, "zzz")[0], `Try this.\n${line}`, line);
  }
});

Deno.test("the size Python would write is exact at every character class boundary", () => {
  const quoted = (cp: number) => pyJsonLength(String.fromCodePoint(cp));
  assertEquals([quoted(0x1f), quoted(0x20), quoted(0x7e), quoted(0x7f), quoted(0x80), quoted(0xffff), quoted(0x10000)], [8, 3, 3, 3, 8, 8, 14]);
  assertEquals([quoted(0x0a), quoted(0x22), quoted(0x5c), quoted(0x08), quoted(0x0c), quoted(0x0d), quoted(0x09)], [4, 4, 4, 4, 4, 4, 4]);
  assertEquals(quoted(0x00), 8);
});
