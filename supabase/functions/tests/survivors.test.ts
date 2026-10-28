import { assert, assertEquals, assertRejects } from "@std/assert";

import { Verifier } from "../_shared/auth.ts";
import { boundedJsonBody, DEFAULT_MAX_BODY, jsonBody, Stop } from "../_shared/http.ts";
import { DAY, EXEMPT, friendlyWait, reserve } from "../_shared/limits.ts";
import { SWEEP_INTERVAL_MS } from "../_shared/app.ts";
import { AuthAdmin, SupabaseError, Storage, WeakPassword } from "../_shared/supabaseAdmin.ts";
import { app, bearer, FakeDb, fakeTransport, publicKey, settings, token, USER } from "./support.ts";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("https://x.test/", { method: "POST", body, headers });

const stopped = async (p: Promise<unknown>) => {
  const e = await assertRejects(() => p, Stop);
  return [e.response.status, await e.response.json()];
};

Deno.test("a day is 86400 seconds, and an exempt reservation charges nothing", () => {
  assertEquals(DAY, 86400);
  assertEquals(EXEMPT, { allowed: true, retryAfter: 0, windowStart: null });
});

Deno.test("a short wait still says a minute, and the minute and hour edges round as expected", () => {
  assertEquals(friendlyWait(0), "about 1 minute");
  assertEquals(friendlyWait(10), "about 1 minute");
  assertEquals(friendlyWait(89), "about 1 minute");
  assertEquals(friendlyWait(90), "about 2 minutes");
  assertEquals(friendlyWait(5399), "about 1 hour");
});

Deno.test("with no clock handed in, a reservation is stamped with the current second", async () => {
  const db = new FakeDb(() => [{ window_start: 0 }]);
  const real = Date.now;
  Date.now = () => 1_800_000_123_999;
  try {
    await reserve(await db.transaction((t) => Promise.resolve(t)), USER, "ai_chat");
  } finally {
    Date.now = real;
  }
  assertEquals(db.calls[0].params[2], 1_800_000_123);
});

Deno.test("the wait is whole seconds left in the window", async () => {
  const db = new FakeDb((sql) => sql.includes("returning") ? [] : [{ window_start: 100 }]);
  assertEquals((await reserve(await db.transaction((t) => Promise.resolve(t)), USER, "workout_analysis", 100)).retryAfter, DAY);
  assertEquals((await reserve(await db.transaction((t) => Promise.resolve(t)), USER, "workout_analysis", 101)).retryAfter, DAY - 1);
});

Deno.test("a subject must be a whole uuid, zeros in any group included", async () => {
  const verifier = new Verifier(settings(), publicKey);
  const ok = "00000000-0000-4000-8000-000000000000";
  assertEquals((await verifier.verify(await token({ sub: ok }))).id, ok);
  for (const bad of ["0000000-0000-4000-8000-000000000000", "000000000-0000-4000-8000-000000000000", "00000000-000-4000-8000-000000000000", "00000000-0000-4000-8000-00000000000", "00000000-0000-4000-8000-0000000000000", "g0000000-0000-4000-8000-000000000000"]) {
    await assertRejects(async () => verifier.verify(await token({ sub: bad })), Error, "Invalid session.");
  }
});

Deno.test("the clock-skew allowance is ten seconds, no more and no less", async () => {
  const verifier = new Verifier(settings(), publicKey);
  const now = Math.floor(Date.now() / 1000);
  // jose counts a token expired once exp <= now - tolerance, so ten seconds' grace means exp = now - 10 is already out.
  // (A second ticking over between these lines only makes the token older, so the first can't flake, the second can't either.)
  assertEquals((await verifier.verify(await token({ exp: now - 8 }))).id, USER);
  await assertRejects(async () => verifier.verify(await token({ exp: now - 10 })));
});

Deno.test("a body that is JSON null, a number, a list or a string is an empty object", async () => {
  for (const text of ["null", "7", "[]", '"x"', "true", "", "{broken"]) assertEquals(await jsonBody(post(text)), {}, text);
  assertEquals(await jsonBody(post('{"a":1}')), { a: 1 });
});

Deno.test("a bounded body: exactly the limit is read, one byte more is a 413, from the header or from the text", async () => {
  assertEquals(DEFAULT_MAX_BODY, 1024 * 1024);
  const pad = (n: number) => JSON.stringify({ p: "x".repeat(n - 8) });
  assertEquals(Object.keys(await boundedJsonBody(post(pad(100)), 100)), ["p"]);
  assertEquals(await stopped(boundedJsonBody(post(pad(101)), 100)), [413, { ok: false, error: "That request is too large." }]);
  assertEquals((await stopped(boundedJsonBody(post("{}", { "content-length": "101" }), 100)))[0], 413);
  assertEquals(await boundedJsonBody(post("{}", { "content-length": "100" }), 100), {});
  assertEquals(Object.keys(await boundedJsonBody(post(pad(DEFAULT_MAX_BODY)))), ["p"]);
  assertEquals((await stopped(boundedJsonBody(post(pad(DEFAULT_MAX_BODY + 1))))) [0], 413);
  assertEquals(await boundedJsonBody(post(""), 0), {});
  assertEquals(await boundedJsonBody(post("[1]")), {});
  assertEquals(await boundedJsonBody(post("nope")), {});
});

Deno.test("an unexpected failure answers ok:false with the generic message", async () => {
  const db = new FakeDb(() => new Error("kaboom"));
  const logged = console.error;
  console.error = () => {};
  try {
    const r = await app(db)("/api/ai-consent", { method: "POST", headers: await bearer(), json: { granted: true } });
    assertEquals([r.status, await r.json()], [500, { ok: false, error: "Something went wrong. Please try again." }]);
  } finally {
    console.error = logged;
  }
});

Deno.test("the sweep interval is one hour", () => {
  assertEquals(SWEEP_INTERVAL_MS, 3_600_000);
});

Deno.test("a 504 is retried like the other gateway errors", async () => {
  const answers = [new Response("", { status: 504 }), new Response("{}")];
  const t = fakeTransport(() => answers.shift()!);
  await new AuthAdmin("https://abc.supabase.co", "k", t.transport).deleteUser("u1");
  assertEquals(t.requests.length, 2);
});

Deno.test("a JSON null from Storage or Auth is read as an empty answer, not crashed on", async () => {
  const nulls = () => fakeTransport(() => new Response("null", { status: 422 })).transport;
  const e = await assertRejects(() => new AuthAdmin("https://abc.supabase.co", "k", nulls()).setPassword("u1", "x"), SupabaseError);
  assertEquals(e.message, "setting a password answered 422");
  assert(!(e instanceof WeakPassword));
  const f = await assertRejects(() => new Storage("https://abc.supabase.co", "k", nulls()).download("b", "u/k"), SupabaseError);
  assertEquals(f.message, "downloading from b answered 422");
});

Deno.test("POST /api/profile: a provider account that sends no name, or a null one, still gets the provider's name", async () => {
  for (const body of [{}, { name: null }]) {
    const db = new FakeDb((sql) => sql.startsWith("select") ? [] : [{ id: USER, name: "Gina Google", friend_code: "RC-ABC123", onboarding_completed: false, ai_consent_at: null, deleted_at: null, created_at: new Date() }]);
    const r = await app(db)("/api/profile", {
      method: "POST",
      headers: await bearer({ app_metadata: { provider: "google" }, user_metadata: { full_name: "Gina Google" } }),
      json: body,
    });
    const answer = await r.json();
    assertEquals([r.status, answer.ok, answer.created], [201, true, true], JSON.stringify(body));
    assertEquals(db.calls[1].params[1], "Gina Google");
  }
});

Deno.test("POST /api/profile: ok is true on both the create and the already-there answers", async () => {
  const row = { id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, ai_consent_at: null, deleted_at: null, created_at: new Date() };
  const there = await app(new FakeDb(() => [row]))("/api/profile", { method: "POST", headers: await bearer(), json: { name: "Sam" } });
  assertEquals((await there.json()).ok, true);
});

Deno.test("a sweep that purges someone says so in the log, and a quiet one says nothing", async () => {
  const { createHandler, Router } = await import("../_shared/app.ts");
  const { services } = await import("./support.ts");
  const logs: string[] = [];
  const realLog = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  const real = Date.now;
  let clock = 5_000_000_000_000;
  Date.now = () => clock;
  try {
    const run = async (due: string[]) => {
      const s = services(new FakeDb((sql) => sql.includes("make_interval") ? due.map((id) => ({ id })) : []));
      s.sweep = true;
      const h = createHandler(s, new Router().get("/api/x", () => new Response("ok"), { auth: false }));
      await h(new Request("https://abc.supabase.co/functions/v1/api/x"));
      await Promise.all(s.collected);
      clock += SWEEP_INTERVAL_MS;
    };
    await run([]);
    assertEquals(logs, []);
    await run([USER]);
    assertEquals(logs, ["account purge: 1 purged, 0 to retry"]);
  } finally {
    console.log = realLog;
    Date.now = real;
  }
});
