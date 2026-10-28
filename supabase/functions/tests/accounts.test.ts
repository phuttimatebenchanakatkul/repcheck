import { assert, assertEquals, assertRejects } from "@std/assert";

import {
  BUCKETS,
  cancelDeletion,
  cleanName,
  deleteStoredFiles,
  dueAt,
  ensureProfile,
  GRACE_DAYS,
  MAX_NAME_LENGTH,
  NameRejected,
  providerName,
  PurgeIncomplete,
  purgeDue,
  purgeUser,
  rename,
  scheduleDeletion,
  storedObjects,
} from "../_shared/accounts.ts";
import type { Identity } from "../_shared/auth.ts";
import { SWEEP_INTERVAL_MS, createHandler, Router } from "../_shared/app.ts";
import { AuthAdmin, Storage } from "../_shared/supabaseAdmin.ts";
import { app, bearer, FakeDb, fakeTransport, PROJECT, services, USER } from "./support.ts";

const tx = (db: FakeDb) => db.transaction((t) => Promise.resolve(t));
const who = (provider?: string, meta: Record<string, unknown> = {}): Identity => ({
  id: USER,
  email: "a@example.com",
  claims: { app_metadata: provider ? { provider } : {}, user_metadata: meta },
});
const rejects = (raw: unknown, message?: string) => {
  try {
    cleanName(raw);
  } catch (e) {
    assert(e instanceof NameRejected, String(raw));
    if (message) assertEquals(e.message, message);
    return;
  }
  throw new Error("accepted " + JSON.stringify(raw));
};

Deno.test("a name is trimmed, filtered, bounded and free of characters that break a list", () => {
  assertEquals(cleanName("  Sam Lifter  "), "Sam Lifter");
  assertEquals(cleanName("Z".repeat(60)), "Z".repeat(60));
  rejects("x".repeat(61), `Please keep your name to ${MAX_NAME_LENGTH} characters or fewer.`);
  for (const bad of ["a\x00b", "line\nbreak", "tab\there", "evil‮name", "bell\x07", "del\x7fx", "iso⁦late", 12345, ["Sam"], { a: 1 }, null, undefined, "", "   "]) rejects(bad);
  rejects("a\u0000b", "That name contains characters that aren't allowed.");
  rejects("shit", "That name isn't allowed. Please choose a different one.");
  rejects("", "Please enter your name.");
});

Deno.test("a name counts characters, not UTF-16 units: sixty emoji fit, sixty-one do not", () => {
  assertEquals(cleanName("🏋".repeat(60)), "🏋".repeat(60));
  rejects("🏋".repeat(61));
  const family = "Sam 🏋️ 👨‍👩‍👧";
  assertEquals(cleanName(family), family);
});

Deno.test("a provider's name is used, filtered leniently: blocked or missing becomes a neutral fallback", () => {
  assertEquals(providerName(who("google", { full_name: "Gina Google" }).claims as never), "Gina Google");
  assertEquals(providerName(who("google", { name: "Nina" }).claims as never), "Nina");
  assertEquals(providerName(who("google", { full_name: "shit" }).claims as never), "Google User");
  for (const meta of [{}, { full_name: "" }, { full_name: 7 }, { name: null }]) assertEquals(providerName(who("apple", meta).claims as never), "Apple User", JSON.stringify(meta));
  assertEquals(providerName({ app_metadata: {}, user_metadata: {} }), "App User");
  assertEquals(providerName({}), "App User");
  assertEquals(providerName({ app_metadata: { provider: 5 } }), "App User");
  assertEquals(providerName(who("GOOGLE", {}).claims as never), "Google User");
});

const profileRow = (extra: Record<string, unknown> = {}) => ({
  id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, ai_consent_at: null, deleted_at: null, created_at: new Date(), ...extra,
});

Deno.test("ensureProfile: an existing profile is returned untouched and nothing is inserted", async () => {
  const db = new FakeDb(() => [profileRow()]);
  const [p, created] = await ensureProfile(await tx(db), who(), "Someone Else");
  assertEquals([p.name, created], ["Sam", false]);
  assertEquals(db.calls.length, 1);
});

Deno.test("ensureProfile: a typed name creates the profile with an RC- friend code", async () => {
  const db = new FakeDb((sql) => sql.startsWith("select") ? [] : [profileRow({ name: "Sam Lifter" })]);
  const [p, created] = await ensureProfile(await tx(db), who(), "  Sam Lifter ");
  assertEquals([p.name, created], ["Sam Lifter", true]);
  const insert = db.calls[1];
  assertEquals(insert.params[0], USER);
  assertEquals(insert.params[1], "Sam Lifter");
  assert(/^RC-[0-9A-F]{6}$/.test(String(insert.params[2])), String(insert.params[2]));
  assert(insert.sql.includes("on conflict (id) do nothing"));
});

Deno.test("ensureProfile: the friend code is RC- and six upper-case hex digits of three random bytes, zero-padded", async () => {
  const real = crypto.getRandomValues;
  crypto.getRandomValues = ((a: Uint8Array) => (a.set([0x0a, 0xff, 0x00]), a)) as typeof crypto.getRandomValues;
  try {
    const db = new FakeDb((sql) => sql.startsWith("select") ? [] : [profileRow()]);
    await ensureProfile(await tx(db), who(), "Sam");
    assertEquals(db.calls[1].params[2], "RC-0AFF00");
  } finally {
    crypto.getRandomValues = real;
  }
});

Deno.test("ensureProfile: an email account must say who it is, a provider account gets the provider's name", async () => {
  for (const provider of [undefined, "email", "phone"]) {
    const db = new FakeDb(() => []);
    const e = await assertRejects(async () => ensureProfile(await tx(db), who(provider)), NameRejected);
    assertEquals(e.message, "Please enter your name.");
    assertEquals(db.calls.length, 1, "nothing is inserted");
  }
  const db = new FakeDb((sql) => sql.startsWith("select") ? [] : [profileRow({ name: "Gina Google" })]);
  await ensureProfile(await tx(db), who("google", { full_name: "Gina Google" }));
  assertEquals(db.calls[1].params[1], "Gina Google");
});

Deno.test("ensureProfile: a typed name wins over the provider's and is still filtered", async () => {
  const db = new FakeDb((sql) => sql.startsWith("select") ? [] : [profileRow()]);
  await ensureProfile(await tx(db), who("google", { full_name: "Gina Google" }), "Typed Name");
  assertEquals(db.calls[1].params[1], "Typed Name");
  await assertRejects(async () => ensureProfile(await tx(new FakeDb(() => [])), who("google"), "shit"), NameRejected);
});

Deno.test("ensureProfile: a concurrent first call returns the profile the other call made", async () => {
  let selects = 0;
  const db = new FakeDb((sql) => sql.startsWith("select") ? (++selects === 1 ? [] : [profileRow()]) : []);
  const [p, created] = await ensureProfile(await tx(db), who(), "Sam");
  assertEquals([p.name, created], ["Sam", false]);
});

Deno.test("ensureProfile: a friend code collision draws another, eight times at most", async () => {
  const unique = Object.assign(new Error("duplicate key"), { code: "23505" });
  let inserts = 0;
  const db = new FakeDb((sql) => {
    if (sql.startsWith("select")) return [];
    return ++inserts < 3 ? unique : [profileRow()];
  });
  const [, created] = await ensureProfile(await tx(db), who(), "Sam");
  assert(created);
  assertEquals(inserts, 3);
  const codes = new Set(db.calls.filter((c) => c.sql.startsWith("insert")).map((c) => c.params[2]));
  assertEquals(codes.size, 3, "a fresh code each time");
  const stuck = new FakeDb((sql) => sql.startsWith("select") ? [] : unique);
  await assertRejects(async () => ensureProfile(await tx(stuck), who(), "Sam"), Error, "could not allocate a friend code");
  assertEquals(stuck.calls.filter((c) => c.sql.startsWith("insert")).length, 8);
  const other = new FakeDb((sql) => sql.startsWith("select") ? [] : Object.assign(new Error("boom"), { code: "XX000" }));
  await assertRejects(async () => ensureProfile(await tx(other), who(), "Sam"), Error, "boom");
  assertEquals(other.calls.filter((c) => c.sql.startsWith("insert")).length, 1, "only a unique violation is retried");
});

Deno.test("rename: filtered the same way, and says whether there was a profile", async () => {
  const db = new FakeDb(() => [{ id: USER }]);
  assert(await rename(await tx(db), USER, " New Name "));
  assertEquals(db.calls[0].params, ["New Name", USER]);
  assertEquals(await rename(await tx(new FakeDb(() => [])), USER, "Name"), false);
  await assertRejects(async () => rename(await tx(db), USER, "shit"), NameRejected);
  assertEquals(db.calls.length, 1, "a refused name never reaches the database");
});

Deno.test("dueAt is the UTC day thirty days after the deletion was scheduled", () => {
  assertEquals(GRACE_DAYS, 30);
  assertEquals(dueAt(null), null);
  assertEquals(dueAt(undefined), null);
  assertEquals(dueAt(new Date("2026-10-28T23:59:59Z")), "2026-11-27");
  assertEquals(dueAt(new Date("2026-02-01T00:00:00Z")), "2026-03-03");
  assertEquals(dueAt(new Date("2026-12-15T10:00:00+07:00")), "2027-01-14");
});

Deno.test("scheduling a deletion starts the clock once, and cancelling clears it", async () => {
  const when = new Date("2026-10-28T00:00:00Z");
  const db = new FakeDb((sql) => sql.startsWith("select") ? [{ deleted_at: when }] : 1);
  assertEquals(await scheduleDeletion(await tx(db), USER), when);
  assert(db.calls[0].sql.includes("deleted_at is null"), "asking again must not push the purge back");
  assertEquals(await scheduleDeletion(await tx(new FakeDb(() => [])), USER), null);
  await cancelDeletion(await tx(db), USER);
  assertEquals(db.calls.at(-1)!.sql, "update public.profiles set deleted_at = null where id = $1");
});

// ---- the purge -------------------------------------------------------------------------------------------------

function purgeWorld(options: { files?: [string, string][]; stuck?: boolean; due?: string[]; failAuth?: string[] } = {}) {
  const files = [...(options.files ?? [])];
  const due = options.due ?? [USER];
  const db = new FakeDb((sql, params) => {
    if (sql.includes("storage.objects")) return files.filter(([, k]) => k.startsWith(`${params[1]}/`)).map(([b, name]) => ({ bucket_id: b, name }));
    if (sql.includes("make_interval")) return due.map((id) => ({ id }));
    return [];
  });
  const t = fakeTransport((url, init) => {
    if (init.method === "DELETE" && url.includes("/storage/")) {
      if (!options.stuck) {
        const { prefixes } = JSON.parse(String(init.body));
        const bucket = url.split("/object/")[1];
        for (const k of prefixes as string[]) {
          const i = files.findIndex(([b, f]) => b === bucket && f === k);
          if (i >= 0) files.splice(i, 1);
        }
      }
      return new Response("[]");
    }
    if (init.method === "DELETE" && url.includes("/auth/")) {
      return new Response("{}", { status: options.failAuth?.some((id) => url.endsWith(id)) ? 500 : 200 });
    }
    return new Response("{}");
  });
  return { db, requests: t.requests, store: new Storage(PROJECT, "k", t.transport), admin: new AuthAdmin(PROJECT, "k", t.transport), files };
}

Deno.test("stored objects are listed from the database by the user's folder, in both buckets", async () => {
  const { db } = purgeWorld({ files: [[BUCKETS[0], `${USER}/a.jpg`], [BUCKETS[1], `${USER}/v.mp4`]] });
  assertEquals(await storedObjects(await tx(db), USER), [[BUCKETS[0], `${USER}/a.jpg`], [BUCKETS[1], `${USER}/v.mp4`]]);
  assertEquals(db.calls[0].params, [[...BUCKETS], USER]);
  assertEquals([...BUCKETS], ["progress-photos", "analyze-videos"]);
});

Deno.test("a purge removes the files through the Storage API first and the Auth user after", async () => {
  const w = purgeWorld({ files: [[BUCKETS[0], `${USER}/a.jpg`], [BUCKETS[1], `${USER}/v.mp4`]] });
  await purgeUser(w.db, w.store, w.admin, USER);
  const kinds = w.requests.map((r) => (r.url.includes("/storage/") ? "storage" : "auth"));
  assertEquals(kinds, ["storage", "storage", "auth"]);
  assertEquals(w.files, []);
});

Deno.test("a storage service that claims success but leaves files does not get the person deleted", async () => {
  const w = purgeWorld({ files: [[BUCKETS[0], `${USER}/a.jpg`]], stuck: true });
  const e = await assertRejects(() => purgeUser(w.db, w.store, w.admin, USER), PurgeIncomplete);
  assertEquals(e.message, "1 stored files remain");
  assert(!w.requests.some((r) => r.url.includes("/auth/")), "the Auth user must be left in place");
});

Deno.test("purging a person with no files works, and deleting the files reports how many there were", async () => {
  const w = purgeWorld();
  assertEquals(await deleteStoredFiles(w.db, w.store, USER), 0);
  await purgeUser(w.db, w.store, w.admin, USER);
  assert(w.requests.some((r) => r.url.includes("/auth/")));
  const w2 = purgeWorld({ files: [[BUCKETS[0], `${USER}/a.jpg`], [BUCKETS[0], `${USER}/b.jpg`]] });
  assertEquals(await deleteStoredFiles(w2.db, w2.store, USER), 2);
});

Deno.test("a sweep purges who is due; one failure never stops the rest, and failures are reported to retry", async () => {
  const A = "aaaaaaaa-0000-4000-8000-000000000000";
  const B = "bbbbbbbb-0000-4000-8000-000000000000";
  const C = "cccccccc-0000-4000-8000-000000000000";
  const w = purgeWorld({ due: [A, B, C], failAuth: [B], files: [] });
  const logged = console.error;
  console.error = () => {};
  try {
    const [purged, failed] = await purgeDue(w.db, w.store, w.admin);
    assertEquals([purged, failed], [[A, C], [B]]);
  } finally {
    console.error = logged;
  }
});

Deno.test("the sweep query: grace days, and an optional list of ids to restrict to", async () => {
  const w = purgeWorld({ due: [] });
  await purgeDue(w.db, w.store, w.admin);
  assertEquals(w.db.calls[0].params, [30, null]);
  assert(w.db.calls[0].sql.includes("deleted_at is not null") && w.db.calls[0].sql.includes("deleted_at <= now() - make_interval(days => $1::int)"));
  await purgeDue(w.db, w.store, w.admin, { graceDays: 7.9, only: [USER] });
  assertEquals(w.db.calls[1].params, [7, [USER]]);
});

Deno.test("an unexpected failure in a purge is not swallowed as a retry", async () => {
  const w = purgeWorld({ due: [USER] });
  const boom = new FakeDb((sql) => sql.includes("make_interval") ? [{ id: USER }] : new Error("database down"));
  await assertRejects(() => purgeDue(boom, w.store, w.admin), Error, "database down");
});

// ---- the routes -------------------------------------------------------------------------------------------------

Deno.test("GET /api/profile: none yet is a 404, one is returned in the app's shape", async () => {
  const none = await app(new FakeDb(() => []))("/api/profile", { headers: await bearer() });
  assertEquals([none.status, await none.json()], [404, { ok: false, error: "No profile yet. Create it first." }]);
  const created_at = new Date();
  const db = new FakeDb(() => [profileRow({ ai_consent_at: created_at, deleted_at: new Date("2026-10-01T00:00:00Z"), onboarding_completed: true })]);
  const r = await app(db)("/api/profile", { headers: await bearer() });
  assertEquals(await r.json(), {
    ok: true,
    profile: { id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: true, ai_consent: true, deleted_at: "2026-10-01T00:00:00.000Z", due_at: "2026-10-31" },
  });
  assertEquals(db.calls[0].params, [USER], "only the caller's own row");
});

Deno.test("POST /api/profile: 201 when created, 200 when it already existed, and a bad name is a 400", async () => {
  const fresh = new FakeDb((sql) => sql.startsWith("select") ? [] : [profileRow({ name: "Sam Lifter" })]);
  const r = await app(fresh)("/api/profile", { method: "POST", headers: await bearer(), json: { name: " Sam Lifter " } });
  const body = await r.json();
  assertEquals([r.status, body.created, body.profile.name, body.profile.ai_consent, body.profile.deleted_at], [201, true, "Sam Lifter", false, null]);
  const again = await app(new FakeDb(() => [profileRow()]))("/api/profile", { method: "POST", headers: await bearer(), json: { name: "Other" } });
  assertEquals([again.status, (await again.json()).created], [200, false]);
  for (const name of [12345, ["Sam"], { a: 1 }, true]) {
    const bad = await app(new FakeDb(() => []))("/api/profile", { method: "POST", headers: await bearer(), json: { name } });
    assertEquals([bad.status, (await bad.json()).error], [400, "Please enter your name."], JSON.stringify(name));
  }
  for (const body of [{}, { name: null }, { name: "" }, { name: "   " }]) {
    const bad = await app(new FakeDb(() => []))("/api/profile", { method: "POST", headers: await bearer(), json: body });
    assertEquals([bad.status, (await bad.json()).error], [400, "Please enter your name."], JSON.stringify(body));
  }
  const filtered = await app(new FakeDb(() => []))("/api/profile", { method: "POST", headers: await bearer(), json: { name: "shit" } });
  assertEquals(filtered.status, 400);
});

Deno.test("POST /api/profile: a Google sign-in with no typed name takes the provider's name", async () => {
  const db = new FakeDb((sql) => sql.startsWith("select") ? [] : [profileRow({ name: "Gina Google" })]);
  const r = await app(db)("/api/profile", {
    method: "POST",
    headers: await bearer({ app_metadata: { provider: "google" }, user_metadata: { full_name: "Gina Google" } }),
    json: {},
  });
  assertEquals(r.status, 201);
  assertEquals(db.calls[1].params[1], "Gina Google");
});

Deno.test("POST /api/account renames; delete schedules once and says when it is due; restore cancels", async () => {
  const headers = await bearer();
  const none = await app(new FakeDb(() => []))("/api/account", { method: "POST", headers, json: { name: "Nobody" } });
  assertEquals([none.status, (await none.json()).error], [404, "No profile yet. Create it first."]);
  const renamed = await app(new FakeDb(() => [{ id: USER }]))("/api/account", { method: "POST", headers, json: { name: "New Name" } });
  assertEquals([renamed.status, await renamed.json()], [200, { ok: true }]);
  for (const body of [{}, { name: 5 }, { name: null }]) {
    const r = await app(new FakeDb())("/api/account", { method: "POST", headers, json: body });
    assertEquals([r.status, (await r.json()).error], [400, "Nothing to update."], JSON.stringify(body));
  }
  const bad = await app(new FakeDb())("/api/account", { method: "POST", headers, json: { name: "shit" } });
  assertEquals(bad.status, 400);

  const when = new Date("2026-10-28T05:00:00Z");
  const del = await app(new FakeDb((sql) => sql.startsWith("select") ? [{ deleted_at: when }] : 1))("/api/account", { method: "DELETE", headers });
  assertEquals([del.status, await del.json()], [200, { ok: true, deleted_at: "2026-10-28T05:00:00.000Z", due_at: "2026-11-27", grace_days: 30 }]);
  const gone = await app(new FakeDb(() => []))("/api/account", { method: "DELETE", headers });
  assertEquals(gone.status, 404);

  const db = new FakeDb(() => 1);
  const restored = await app(db)("/api/account/restore", { method: "POST", headers });
  assertEquals([restored.status, await restored.json()], [200, { ok: true }]);
  assertEquals(db.calls[0].params, [USER]);
});

Deno.test("every account route demands a token", async () => {
  const call = app();
  for (const [method, path] of [["GET", "/api/profile"], ["POST", "/api/profile"], ["POST", "/api/account"], ["DELETE", "/api/account"], ["POST", "/api/account/restore"]]) {
    assertEquals((await call(path, { method })).status, 401, `${method} ${path}`);
  }
});

// ---- the request-triggered sweep --------------------------------------------------------------------------------

Deno.test("the sweep runs on the first request, then at most hourly, in the background, and never fails a request", async () => {
  const real = Date.now;
  let clock = 1_000_000_000_000;
  Date.now = () => clock;
  try {
    const s = services(new FakeDb(() => []));
    s.sweep = true;
    const handler = createHandler(s, new Router().get("/api/x", () => new Response("ok"), { auth: false }));
    const hit = () => handler(new Request(`${PROJECT}/functions/v1/api/x`));
    assertEquals((await hit()).status, 200);
    assertEquals(s.collected.length, 1, "once at startup");
    await hit();
    clock += SWEEP_INTERVAL_MS - 1;
    await hit();
    assertEquals(s.collected.length, 1, "not before the hour is up");
    clock += 1;
    await hit();
    assertEquals(s.collected.length, 2, "again after the hour");
    await Promise.all(s.collected);

    const quiet = services(new FakeDb(() => []));
    const off = createHandler(quiet, new Router().get("/api/x", () => new Response("ok"), { auth: false }));
    await off(new Request(`${PROJECT}/functions/v1/api/x`));
    assertEquals(quiet.collected.length, 0, "off unless asked for");

    const broken = services(new FakeDb(() => new Error("down")));
    broken.sweep = true;
    const logged = console.error;
    console.error = () => {};
    try {
      const h = createHandler(broken, new Router().get("/api/x", () => new Response("ok"), { auth: false }));
      assertEquals((await h(new Request(`${PROJECT}/functions/v1/api/x`))).status, 200);
      await Promise.all(broken.collected);
    } finally {
      console.error = logged;
    }
  } finally {
    Date.now = real;
  }
});
