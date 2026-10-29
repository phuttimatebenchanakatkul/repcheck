import { assert, assertEquals } from "@std/assert";

import { signupCutoff } from "../_shared/admin.ts";
import { app, bearer, FakeDb } from "./support.ts";

const ADMIN = { ADMIN_EMAILS: "lifter@example.com" };
const ORIGIN = "https://repcheck-marketing.onrender.com";
const UID = "7c9e6679-7425-40de-944b-e07fc1f90ae8";

const ROUTES: [string, string][] = [
  ["GET", "/api/admin/reports"], ["POST", "/api/admin/reports/1/reset-name"], ["POST", "/api/admin/reports/1/handled"], ["POST", "/api/admin/ai-reports/1/handled"],
  ["GET", "/api/admin/waitlist"], ["POST", "/api/admin/waitlist/delete"], ["GET", "/api/admin/users"], [`GET`, `/api/admin/users/${UID}`],
];

function adminDb(options: { report?: boolean; handled?: boolean; waitlist?: boolean; user?: boolean } = {}) {
  return new FakeDb((raw) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    if (sql.includes("from public.content_reports r join")) return [{ id: 1, reason: "rude", created_text: "2026-10-29T01:02:03.123456", reporter_id: UID, reporter_name: "A", reported_id: "u2", reported_name: "B" }];
    if (sql.includes("from public.ai_reports a")) return [{ id: 2, feature: "coach", reason: "wrong", reply_text: "text", created_text: "2026-10-28T00:00:00.000000", reporter_name: "C" }];
    if (sql.startsWith("select reported_id")) return options.report === false ? [] : [{ reported_id: "u2" }];
    if (sql.startsWith("update public.content_reports set handled_at = now() where id") || sql.startsWith("update public.ai_reports")) return options.handled === false ? [] : [{ id: 1 }];
    if (sql.includes("from public.waitlist order by")) return [{ email: "=a@b.co", source: 'x"y', created_text: "2026-10-29T01:02:03.000000" }, { email: "c@d.co", source: null, created_text: "2026-10-28T00:00:00.500000" }];
    if (sql.startsWith("delete from public.waitlist")) return options.waitlist === false ? [] : [{ id: 1 }];
    if (sql.includes("from public.profiles p left join auth.users u on u.id = p.id where p.id")) {
      return options.user === false ? [] : [{ id: UID, name: "Sam", email: "s@x.co", created_text: "2026-10-01T00:00:00.000000", deleted_text: null, ai_consent_at: new Date() }];
    }
    if (sql.includes("from public.profiles p left join auth.users u")) return [{ id: UID, name: "Sam", email: null, created_text: "2026-10-29T00:00:00.250000" }];
    if (sql.includes("from public.usage_events")) return [{ event: "page:home", count: 4, last_text: "2026-10-29T01:00:00.000000" }, { event: "feature:food_scan", count: 2, last_text: "2026-10-29T02:00:00.000001" }];
    if (sql.includes("count(*) as n")) return [{ n: 3 }];
    if (sql.includes("from public.weight_entries")) return [{ day: "2026-10-27", kg: 80.5 }];
    if (sql.includes("from public.analyze_results")) return [{ id: 9, exercise_label: "Squat", overall_score: 88, created_text: "2026-10-26T00:00:00.000000" }];
    if (sql.includes("insert into public.auth_throttle")) return [{ window_start: 1 }];
    if (sql.includes("select window_start from public.auth_throttle")) return [{ window_start: Math.floor(Date.now() / 1000) - 100 }];
    if (sql.includes("insert into public.waitlist")) return [{ id: 5 }];
    return 1;
  });
}
const call = async (db: FakeDb, method: string, path: string, json?: unknown, env: Record<string, string> = ADMIN) =>
  app(db, env)(path, { method, headers: await bearer(), json });

Deno.test("every owner route demands a token", async () => {
  for (const [method, path] of ROUTES) assertEquals((await app(adminDb(), ADMIN)(path, { method })).status, 401, path);
});

Deno.test("anyone who is not in ADMIN_EMAILS gets a 404 and nothing is read (the review account and exempt accounts included)", async () => {
  for (const env of [{}, { ADMIN_EMAILS: "someone@else.com" }, { REVIEW_ACCOUNT_EMAILS: "lifter@example.com" }] as Record<string, string>[]) {
    for (const [method, path] of ROUTES) {
      const db = adminDb();
      const r = await call(db, method, path, method === "POST" ? {} : undefined, env);
      assertEquals([r.status, await r.json()], [404, { ok: false, error: "Not found." }], `${path} ${JSON.stringify(env)}`);
      assertEquals(db.calls.length, 0);
    }
  }
  const upper = await call(adminDb(), "GET", "/api/admin/reports", undefined, { ADMIN_EMAILS: "LIFTER@Example.com" });
  assertEquals(upper.status, 200, "addresses are compared in lower case");
});

Deno.test("reports: open ones, oldest first, a hundred at most, times as Python writes them", async () => {
  const db = adminDb();
  const out = await (await call(db, "GET", "/api/admin/reports")).json();
  assertEquals(out.reports, [{ id: 1, reason: "rude", created_at: "2026-10-29T01:02:03.123456+00:00", reporter_id: UID, reporter_name: "A", reported_id: "u2", reported_name: "B" }]);
  assertEquals(out.ai_reports, [{ id: 2, feature: "coach", reason: "wrong", reply_text: "text", created_at: "2026-10-28T00:00:00+00:00", reporter_name: "C" }]);
  assert(out.ok && db.calls.every((c) => c.params[0] === 100));
});

Deno.test("reports: resetting a name closes every open report against the account; a report that is gone is a 404", async () => {
  const db = adminDb();
  const done = await (await call(db, "POST", "/api/admin/reports/1/reset-name")).json();
  assertEquals(done, { ok: true, reset: "u2" });
  assertEquals(db.calls.filter((c) => c.sql.startsWith("update")).map((c) => c.params), [["RepCheck User", "u2"], ["u2"]]);
  const gone = await call(adminDb({ report: false }), "POST", "/api/admin/reports/1/reset-name");
  assertEquals([gone.status, (await gone.json()).error], [404, "Report not found."]);
});

Deno.test("reports: marking handled says whether anything changed, for both kinds", async () => {
  for (const path of ["/api/admin/reports/1/handled", "/api/admin/ai-reports/1/handled"]) {
    assertEquals(await (await call(adminDb(), "POST", path)).json(), { ok: true, changed: true });
    assertEquals(await (await call(adminDb({ handled: false }), "POST", path)).json(), { ok: true, changed: false });
  }
});

Deno.test("waitlist: the list as JSON, and as a CSV a spreadsheet cannot run", async () => {
  const out = await (await call(adminDb(), "GET", "/api/admin/waitlist")).json();
  assertEquals([out.ok, out.total, out.entries[1]], [true, 2, { email: "c@d.co", source: null, created_at: "2026-10-28T00:00:00.500000+00:00" }]);
  const csv = await call(adminDb(), "GET", "/api/admin/waitlist?format=csv");
  assertEquals([csv.headers.get("Content-Type"), csv.headers.get("Content-Disposition")], ["text/csv; charset=utf-8", 'attachment; filename="repcheck_waitlist.csv"']);
  assertEquals(await csv.text(), 'email,source,joined_utc\r\n"\'=a@b.co","x""y","2026-10-29T01:02:03+00:00"\r\n"c@d.co","","2026-10-28T00:00:00.500000+00:00"\r\n');
});

Deno.test("waitlist: deleting an address is by its lower-case trimmed text, and says whether it was there", async () => {
  const db = adminDb();
  assertEquals(await (await call(db, "POST", "/api/admin/waitlist/delete", { email: "  A@B.co " })).json(), { ok: true, removed: true });
  assertEquals(db.calls[0].params, ["a@b.co"]);
  const none = adminDb();
  for (const body of [{}, { email: "" }, { email: "  " }, { email: 5 }, { email: null }]) assertEquals((await (await call(none, "POST", "/api/admin/waitlist/delete", body)).json()).removed, false);
  assertEquals(none.calls.length, 0, "nothing to look for, nothing asked");
  assertEquals((await (await call(adminDb({ waitlist: false }), "POST", "/api/admin/waitlist/delete", { email: "x@y.co" })).json()).removed, false);
});

Deno.test("users: a range, 'today' when it is not one, and the cutoff handed to the database", async () => {
  const db = adminDb();
  const out = await (await call(db, "GET", "/api/admin/users?range=week")).json();
  assertEquals([out.ok, out.range, out.users], [true, "week", [{ id: UID, name: "Sam", email: null, created_at: "2026-10-29T00:00:00.250000+00:00" }]]);
  assert(Math.abs(Date.parse(db.calls[0].params[0] as string) - (Date.now() - 7 * 86_400_000)) < 5000);
  for (const bad of ["", "?range=year", "?range=", "?range=TODAY"]) assertEquals((await (await call(adminDb(), "GET", `/api/admin/users${bad}`)).json()).range, "today", bad);
  const all = adminDb();
  await call(all, "GET", "/api/admin/users?range=all");
  assertEquals(all.calls[0].params, [null]);
});

Deno.test("users: today starts at midnight in Bangkok, a week and a month are 7 and 30 days back", () => {
  const at = (iso: string) => new Date(iso);
  assertEquals(signupCutoff("today", at("2026-10-29T16:59:59.999Z"))?.toISOString(), "2026-10-28T17:00:00.000Z");
  assertEquals(signupCutoff("today", at("2026-10-29T17:00:00.000Z"))?.toISOString(), "2026-10-29T17:00:00.000Z");
  assertEquals(signupCutoff("week", at("2026-10-29T12:00:00Z"))?.toISOString(), "2026-10-22T12:00:00.000Z");
  assertEquals(signupCutoff("month", at("2026-10-29T12:00:00Z"))?.toISOString(), "2026-09-29T12:00:00.000Z");
  assertEquals([signupCutoff("all"), signupCutoff("x")], [null, null]);
});

Deno.test("a user's detail: profile, usage split into pages and features, counts, latest weight, last analyses; a bad or unknown id is a 404", async () => {
  const out = await (await call(adminDb(), "GET", `/api/admin/users/${UID}`)).json();
  const user = out.user;
  assertEquals([out.ok, user.id, user.email, user.created_at, user.deleted_at, user.ai_consent], [true, UID, "s@x.co", "2026-10-01T00:00:00+00:00", null, true]);
  assertEquals(user.page_views, [{ event: "page:home", label: "Home", count: 4, last_at: "2026-10-29T01:00:00+00:00" }]);
  assertEquals(user.feature_uses, [{ event: "feature:food_scan", label: "Food photo scans (AI)", count: 2, last_at: "2026-10-29T02:00:00.000001+00:00" }]);
  assertEquals(Object.keys(user.counts), ["foods_logged", "exercises_logged", "weigh_ins", "analyses", "progress_photos", "custom_foods", "challenge_submissions", "hyrox_results", "friends"]);
  assertEquals([user.latest_weight, user.analyses], [{ date: "2026-10-27", kg: 80.5 }, [{ id: 9, exercise_label: "Squat", overall_score: 88, created_at: "2026-10-26T00:00:00+00:00" }]]);
  for (const bad of ["abc", "123", "x".repeat(40)]) assertEquals((await call(adminDb(), "GET", `/api/admin/users/${bad}`)).status, 404, bad);
  assertEquals((await call(adminDb({ user: false }), "GET", `/api/admin/users/${UID}`)).status, 404);
});

// ---- the waitlist the marketing site posts to ---------------------------------------------------------------------------------

const join = (db: FakeDb, body: unknown, headers: Record<string, string> = { Origin: ORIGIN }) =>
  app(db)("/api/waitlist", { method: "POST", headers: { "X-Forwarded-For": "9.9.9.9, 1.2.3.4", ...headers }, json: body });

Deno.test("waitlist join: needs no sign-in, answers only the marketing sites' own origins, one at a time", async () => {
  const ok = await join(adminDb(), { email: "New@Example.com" });
  assertEquals([ok.status, await ok.json()], [200, { ok: true, already: false }]);
  assertEquals(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assertEquals([ok.headers.get("Vary"), ok.headers.get("Access-Control-Allow-Methods"), ok.headers.get("Access-Control-Allow-Headers"), ok.headers.get("Access-Control-Max-Age")], ["Origin", "POST, OPTIONS", "Content-Type", "86400"]);
  const second = await join(adminDb(), { email: "a@b.co" }, { Origin: "https://repcheckofficials.onrender.com" });
  assertEquals(second.headers.get("Access-Control-Allow-Origin"), "https://repcheckofficials.onrender.com");
  for (const origin of ["https://evil.example", "https://repcheck-marketing.onrender.com.evil.example", "", "null", "*"]) {
    const r = await join(adminDb(), { email: "a@b.co" }, origin ? { Origin: origin } : {});
    assertEquals([r.status, r.headers.get("Access-Control-Allow-Origin"), r.headers.get("Access-Control-Allow-Methods")], [200, null, null], origin);
  }
});

Deno.test("waitlist join: the preflight is a 204 with the same rules", async () => {
  const ok = await app(adminDb())("/api/waitlist", { method: "OPTIONS", headers: { Origin: ORIGIN } });
  assertEquals([ok.status, await ok.text(), ok.headers.get("Access-Control-Allow-Origin")], [204, "", ORIGIN]);
  const other = await app(adminDb())("/api/waitlist", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assertEquals([other.status, other.headers.get("Access-Control-Allow-Origin")], [204, null]);
});

Deno.test("waitlist join: a bad address is a 400 that still carries the CORS headers, and nothing is spent or stored", async () => {
  for (const email of [undefined, null, 5, "", "nope", "a@b", "a b@c.co", "a\x00@b.co", ["a@b.co"], "x".repeat(250) + "@b.co"]) {
    const db = adminDb();
    const r = await join(db, { email });
    assertEquals([r.status, await r.json(), r.headers.get("Access-Control-Allow-Origin")], [400, { error: "invalid-email" }, ORIGIN], String(email));
    assertEquals(db.calls.length, 0);
  }
});

Deno.test("waitlist join: the same address twice looks the same from outside; the source is cleaned; a visitor has five tries an hour, counted by the proxy's address", async () => {
  const insert = (sql: string) => sql.includes("insert into public.waitlist");
  const db = new FakeDb((sql) => insert(sql) ? [] : sql.includes("insert into public.auth_throttle") ? [{ window_start: 1 }] : 1);
  const again = await join(db, { email: "A@B.co", source: "  hello\x00\x07 " + "x".repeat(100) });
  assertEquals([again.status, await again.json()], [200, { ok: true, already: true }]);
  const stored = db.calls.find((c) => insert(c.sql))!;
  assertEquals(stored.params[0], "a@b.co");
  assertEquals((stored.params[1] as string).length, 64);
  assertEquals((stored.params[1] as string).startsWith("  hello"), true);
  const throttle = db.calls.find((c) => c.sql.includes("insert into public.auth_throttle"))!;
  assertEquals([throttle.params[0], throttle.params[2], throttle.params[3]], ["waitlist:1.2.3.4", 3600, 5]);
  const anonymous = adminDb();
  await app(anonymous)("/api/waitlist", { method: "POST", json: { email: "a@b.co" } });
  assertEquals(anonymous.calls.find((c) => c.sql.includes("insert into public.auth_throttle"))!.params[0], "waitlist:unknown");
  const longAddress = adminDb();
  await join(longAddress, { email: "a@b.co" }, { Origin: ORIGIN, "X-Forwarded-For": "7".repeat(100) });
  assertEquals((longAddress.calls[0].params[0] as string).length, "waitlist:".length + 64);
});

Deno.test("waitlist join: past five tries it is a 429 that says when to come back, still with CORS, and stores nothing", async () => {
  const db = new FakeDb((sql) => sql.includes("insert into public.auth_throttle") ? [] : sql.includes("select window_start") ? [{ window_start: Math.floor(Date.now() / 1000) - 600 }] : 1);
  const r = await join(db, { email: "a@b.co" });
  const body = await r.json();
  assertEquals([r.status, body.error, r.headers.get("Access-Control-Allow-Origin")], [429, "rate-limited", ORIGIN]);
  assert(body.retry_after_seconds >= 3000 && body.retry_after_seconds <= 3000 + 5, String(body.retry_after_seconds));
  assert(!db.calls.some((c) => c.sql.includes("insert into public.waitlist")));
});
