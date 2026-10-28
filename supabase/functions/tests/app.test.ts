import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { createHandler, Router, routePath } from "../_shared/app.ts";
import { fail, json } from "../_shared/http.ts";
import { fromEnv, SettingsError } from "../_shared/settings.ts";
import { app, bearer, FakeDb, PROJECT, services } from "./support.ts";

const body = async (r: Response) => await r.json();

Deno.test("the function's name and the gateway's prefix are both removed from a path", () => {
  for (
    const url of [`${PROJECT}/api/profile`, `${PROJECT}/functions/v1/api/profile`, `${PROJECT}/functions/v1/api/profile/`, `${PROJECT}/api/profile?x=1`]
  ) assertEquals(routePath(url), "/api/profile");
  assertEquals(routePath(`${PROJECT}/functions/v1`), "/");
});

Deno.test("unknown routes and wrong methods answer JSON", async () => {
  const call = app();
  const missing = await call("/api/nope");
  assertEquals([missing.status, await body(missing)], [404, { ok: false, error: "Not found." }]);
  const wrong = await call("/api/health", { method: "DELETE" });
  assertEquals([wrong.status, await body(wrong)], [405, { ok: false, error: "Method not allowed." }]);
});

Deno.test("every response is uncacheable and not sniffed", async () => {
  const call = app();
  for (const r of [await call("/api/health"), await call("/api/nope"), await call("/api/ai-consent", { method: "POST" })]) {
    assertEquals(r.headers.get("Cache-Control"), "no-store");
    assertEquals(r.headers.get("X-Content-Type-Options"), "nosniff");
    assertStringIncludes(r.headers.get("Content-Type") ?? "", "application/json");
  }
});

Deno.test("the health check is public and reports a dead database as 503", async () => {
  const ok = await app()("/api/health");
  assertEquals([ok.status, await body(ok)], [200, { ok: true }]);
  const down = await app(new FakeDb(() => new Error("connection refused: secret-host:6543")))("/api/health");
  const text = JSON.stringify(await body(down));
  assertEquals(down.status, 503);
  assert(!text.includes("secret-host"), "the driver's message must not reach the caller");
});

Deno.test("every route but health demands a token, and the 401 carries a challenge", async () => {
  const call = app();
  for (const header of [undefined, "", "Bearer", "Basic abc", "Bearer not.a.jwt"]) {
    const r = await call("/api/ai-consent", { method: "POST", headers: header === undefined ? {} : { Authorization: header } });
    assertEquals(r.status, 401);
    assertEquals(r.headers.get("WWW-Authenticate"), "Bearer");
  }
});

Deno.test("an outage fetching keys is a 503 without a challenge", async () => {
  const { Verifier } = await import("../_shared/auth.ts");
  const { errors } = await import("jose");
  const s = services();
  const handler = createHandler({ ...s, verifier: new Verifier(s.settings, () => Promise.reject(new errors.JWKSTimeout())) }, (() => {
    const r = new Router();
    r.get("/api/x", () => json({ ok: true }));
    return r;
  })());
  const r = await handler(new Request(`${PROJECT}/functions/v1/api/x`, { headers: await bearer() }));
  assertEquals(r.status, 503);
  assertEquals(r.headers.get("WWW-Authenticate"), null);
});

Deno.test("an unexpected failure is a generic 500 that leaks nothing", async () => {
  const router = new Router().get("/api/boom", () => {
    throw new Error("select * from secrets where password = 'hunter2'");
  }, { auth: false });
  const logged = console.error;
  console.error = () => {};
  try {
    const r = await app(new FakeDb(), {}, router)("/api/boom");
    const text = JSON.stringify(await body(r));
    assertEquals(r.status, 500);
    assert(!text.includes("hunter2") && !text.includes("select"));
  } finally {
    console.error = logged;
  }
});

Deno.test("a route that fails with fail() keeps its status and message", async () => {
  const router = new Router().get("/api/teapot", () => fail("I am a teapot.", 418), { auth: false });
  const r = await app(new FakeDb(), {}, router)("/api/teapot");
  assertEquals([r.status, await body(r)], [418, { ok: false, error: "I am a teapot." }]);
});

Deno.test("settings: the project address is trimmed of slashes and must be https", () => {
  assertEquals(fromEnv((n) => ({ SUPABASE_URL: " https://abc.supabase.co// " })[n]).supabaseUrl, "https://abc.supabase.co");
  for (const bad of [undefined, "", "http://abc.supabase.co", "not a url", "https://"]) {
    try {
      fromEnv((n) => ({ SUPABASE_URL: bad })[n]);
      throw new Error("accepted " + bad);
    } catch (e) {
      assert(e instanceof SettingsError, String(bad));
    }
  }
});

Deno.test("settings: only ADMIN_EMAILS makes an admin, but the review account is exempt from limits too", () => {
  const s = fromEnv((n) => ({ SUPABASE_URL: PROJECT, ADMIN_EMAILS: " Owner@Example.com ,", REVIEW_ACCOUNT_EMAILS: "Review@Example.com" })[n]);
  assertEquals([...s.adminEmails], ["owner@example.com"]);
  assertEquals([...s.rateLimitExempt].sort(), ["owner@example.com", "review@example.com"]);
  const none = fromEnv((n) => ({ SUPABASE_URL: PROJECT })[n]);
  assertEquals([none.adminEmails.size, none.rateLimitExempt.size], [0, 0]);
});

Deno.test("settings: a missing value is named and nothing else is echoed", () => {
  try {
    fromEnv(() => undefined);
    throw new Error("accepted");
  } catch (e) {
    assertEquals((e as Error).message, "missing SUPABASE_URL");
  }
});
