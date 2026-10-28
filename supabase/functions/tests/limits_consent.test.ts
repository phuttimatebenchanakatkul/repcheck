import { assert, assertEquals } from "@std/assert";

import { CONSENT_ERROR, hasConsent, refusal } from "../_shared/consent.ts";
import {
  DAY,
  EXEMPT,
  friendlyWait,
  isExempt,
  limitMessage,
  RATE_LIMITS,
  refund,
  releaseDailyAttempt,
  reserve,
  reserveDailyAttempt,
  trackUsage,
} from "../_shared/limits.ts";
import { app, bearer, FakeDb, settings, USER } from "./support.ts";

const tx = (db: FakeDb) => db.transaction((t) => Promise.resolve(t));

Deno.test("the limits are the websites, and a use not yet spent is allowed", async () => {
  assertEquals(RATE_LIMITS, {
    workout_analysis: [1, DAY], food_analysis: [1, DAY], ai_chat: [3, DAY], split_generation: [1, DAY], hyrox_analysis: [8, 18000], checkin_analysis: [5, DAY],
  });
  const db = new FakeDb(() => [{ window_start: 1000 }]);
  const r = await reserve(await tx(db), USER, "ai_chat", 1000);
  assertEquals(r, { allowed: true, retryAfter: 0, windowStart: 1000 });
  assertEquals(db.calls[0].params, [USER, "ai_chat", 1000, DAY, 3]);
});

Deno.test("a full window is refused and says how long to wait", async () => {
  const db = new FakeDb((sql) => sql.includes("returning") ? [] : [{ window_start: 1000 }]);
  const r = await reserve(await tx(db), USER, "workout_analysis", 1000 + 3600);
  assertEquals(r, { allowed: false, retryAfter: DAY - 3600, windowStart: null });
});

Deno.test("a refusal with no row to read waits the whole window, and never less than a second", async () => {
  const none = new FakeDb(() => []);
  assertEquals((await reserve(await tx(none), USER, "workout_analysis", 5)).retryAfter, DAY);
  const over = new FakeDb((sql) => sql.includes("returning") ? [] : [{ window_start: 0 }]);
  assertEquals((await reserve(await tx(over), USER, "workout_analysis", DAY + 50)).retryAfter, 1);
});

Deno.test("the reserve statement opens a fresh window only when the old one has elapsed", async () => {
  const db = new FakeDb(() => [{ window_start: 1 }]);
  await reserve(await tx(db), USER, "ai_chat", 1);
  const sql = db.calls[0].sql;
  assert(sql.includes("on conflict (user_id, feature) do update"));
  assert(sql.includes("$3::bigint - rate_limits.window_start >= $4::bigint then 1 else rate_limits.count + 1"));
  assert(sql.includes("where $3::bigint - rate_limits.window_start >= $4::bigint or rate_limits.count < $5::integer"));
});

Deno.test("a refund returns the use to the window it was charged to, and an exempt one refunds nothing", async () => {
  const db = new FakeDb(() => 1);
  await refund(await tx(db), USER, "ai_chat", { allowed: true, retryAfter: 0, windowStart: 777 });
  assertEquals(db.calls[0].params, [USER, "ai_chat", 777]);
  assert(db.calls[0].sql.includes("greatest(count - 1, 0)") && db.calls[0].sql.includes("window_start = $3"));
  await refund(await tx(db), USER, "ai_chat", EXEMPT);
  assertEquals(db.calls.length, 1);
});

Deno.test("the daily challenge attempt is keyed by exercise and UTC day, and earlier days are swept", async () => {
  const db = new FakeDb(() => [{ window_start: 5 }]);
  const noon = Date.UTC(2026, 9, 28, 12) / 1000;
  const r = await reserveDailyAttempt(await tx(db), USER, "pushups", noon);
  assertEquals(r.allowed, true);
  assertEquals(db.calls[0].params, [USER, "%:2026-10-28"]);
  assertEquals(db.calls[1].params, [USER, "challenge:pushups:2026-10-28", noon, DAY, 1]);
  const late = Date.UTC(2026, 9, 28, 23, 59, 59) / 1000;
  await reserveDailyAttempt(await tx(db), USER, "pushups", late + 2);
  assertEquals(db.calls[3].params[1], "challenge:pushups:2026-10-29");
  await releaseDailyAttempt(await tx(db), USER, "pushups", { allowed: true, retryAfter: 0, windowStart: 5 }, noon);
  assertEquals(db.calls.at(-1)!.params, [USER, "challenge:pushups:2026-10-28", 5]);
});

Deno.test("friendly waits round to hours or minutes, never zero", () => {
  assertEquals(friendlyWait(3600), "about 1 hour");
  assertEquals(friendlyWait(5400), "about 2 hours");
  assertEquals(friendlyWait(59), "about 1 minute");
  assertEquals(friendlyWait(600), "about 10 minutes");
  assertEquals(friendlyWait(3599), "about 60 minutes");
});

Deno.test("the limit messages are the website's", () => {
  assertEquals(limitMessage("workout_analysis", 7200), "You've used your 1 workout analysis for now — try again in about 2 hours.");
  assertEquals(limitMessage("ai_chat", 600), "You've reached your limit for now — try again in about 10 minutes.");
});

Deno.test("only listed addresses are exempt, whatever their case, and a token without an email is not", () => {
  const s = settings({ REVIEW_ACCOUNT_EMAILS: "Review@Example.com" });
  assert(isExempt(s, { id: USER, email: "REVIEW@example.com", claims: {} }));
  assert(!isExempt(s, { id: USER, email: "other@example.com", claims: {} }));
  assert(!isExempt(s, { id: USER, email: null, claims: {} }));
  assert(!isExempt(settings(), { id: USER, email: "review@example.com", claims: {} }));
});

Deno.test("usage is counted per user and event", async () => {
  const db = new FakeDb(() => 1);
  await trackUsage(await tx(db), USER, "feature:x");
  assertEquals(db.calls[0].params, [USER, "feature:x"]);
  assert(db.calls[0].sql.includes("count = usage_events.count + 1"));
});

Deno.test("consent: only a stamped profile has it, and the refusal is a 403 the app can recognise", async () => {
  assert(hasConsent({ ai_consent_at: new Date() }));
  assert(!hasConsent({ ai_consent_at: null }) && !hasConsent(null) && !hasConsent(undefined));
  const r = refusal();
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { ok: false, needs_ai_consent: true, error: CONSENT_ERROR });
});

Deno.test("POST /api/ai-consent: a JSON true grants and keeps the first timestamp", async () => {
  const db = new FakeDb((sql) => sql.includes("update public.profiles") ? [{ id: USER }] : 1);
  const r = await app(db)("/api/ai-consent", { method: "POST", headers: await bearer(), json: { granted: true } });
  assertEquals([r.status, await r.json()], [200, { ok: true, granted: true }]);
  assert(db.calls[0].sql.includes("coalesce(ai_consent_at, now())"));
  assertEquals(db.calls[0].params, [USER]);
  assertEquals(db.calls[1].params, [USER, "feature:ai_consent_granted"]);
  assertEquals(db.transactions, 1);
});

Deno.test("POST /api/ai-consent: anything but a JSON true withdraws", async () => {
  for (const body of [{ granted: false }, { granted: "true" }, { granted: 1 }, {}, [], "true"]) {
    const db = new FakeDb((sql) => sql.includes("update public.profiles") ? [{ id: USER }] : 1);
    const r = await app(db)("/api/ai-consent", { method: "POST", headers: await bearer(), json: body });
    assertEquals(await r.json(), { ok: true, granted: false }, JSON.stringify(body));
    assert(db.calls[0].sql.includes("ai_consent_at = null"));
    assertEquals(db.calls[1].params[1], "feature:ai_consent_withdrawn");
  }
});

Deno.test("POST /api/ai-consent: an unreadable body withdraws, and no profile is a 404 that counts nothing", async () => {
  const db = new FakeDb(() => []);
  const r = await app(db)("/api/ai-consent", { method: "POST", headers: await bearer(), body: "{not json" });
  assertEquals([r.status, await r.json()], [404, { ok: false, error: "No profile yet. Create it first." }]);
  assertEquals(db.calls.length, 1);
});
