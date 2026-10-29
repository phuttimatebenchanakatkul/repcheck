/** Runs the real database code against the real Supabase project: `deno task test:live`.
 *
 * Not part of `deno task test` (the name does not end in .test.ts) because it needs the network and the project's keys,
 * read from the repo's gitignored .env. It creates ONE throwaway user, touches only that user's rows, and deletes the
 * user in a `finally` (the delete cascades through the profile and every table that points at it), so it can never
 * touch a real account.
 */
import { assert, assertEquals } from "@std/assert";

import { connect } from "../_shared/db.ts";
import { FoodLookup } from "../_shared/foodLookup.ts";
import { GeminiClient } from "../_shared/gemini.ts";
import { reserve, refund, reserveDailyAttempt, trackUsage } from "../_shared/limits.ts";
import { setConsent } from "../_shared/consent.ts";

function env(name: string): string | undefined {
  const fromProcess = Deno.env.get(name);
  if (fromProcess) return fromProcess;
  try {
    const file = Deno.readTextFileSync(new URL("../../../.env", import.meta.url));
    const match = file.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, "m"));
    return match ? match[1].replace(/^(['"])(.*)\1$/, "$2") : undefined;
  } catch {
    return undefined;
  }
}

const url = env("SUPABASE_URL")?.replace(/\/+$/, "");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const dbUrl = env("SUPABASE_DB_URL");

Deno.test({
  name: "live: rate limits, usage and consent work against the real database",
  ignore: !url || !serviceKey || !dbUrl,
  fn: async () => {
    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ email: `edge-${crypto.randomUUID()}@example.invalid`, password: crypto.randomUUID() + "Aa1!", email_confirm: true }),
    });
    assertEquals(created.status, 200, "the throwaway user could not be created");
    const id = (await created.json()).id as string;
    const db = connect(dbUrl!, 1);
    try {
      await db.transaction(async (tx) => {
        await tx.exec("insert into public.profiles (id, name, friend_code) values ($1, $2, $3)", [id, "Edge Check", "RC-" + id.slice(0, 6).toUpperCase()]);
      });

      // consent: granted keeps the first timestamp, withdrawn clears it
      const stamp = async () => (await db.transaction((tx) => tx.one<{ ai_consent_at: Date | null }>("select ai_consent_at from public.profiles where id = $1", [id])))!.ai_consent_at;
      assertEquals(await stamp(), null);
      assert(await db.transaction((tx) => setConsent(tx, id, true)));
      const first = await stamp();
      assert(first instanceof Date);
      await new Promise((r) => setTimeout(r, 20));
      await db.transaction((tx) => setConsent(tx, id, true));
      assertEquals((await stamp())!.getTime(), first.getTime(), "granting again must keep the first timestamp");
      await db.transaction((tx) => setConsent(tx, id, false));
      assertEquals(await stamp(), null);
      assertEquals(await db.transaction((tx) => setConsent(tx, crypto.randomUUID(), true)), false);

      // limits: one analysis a day; the second is refused with a wait; a refund gives the use back
      const now = Math.floor(Date.now() / 1000);
      const a = await db.transaction((tx) => reserve(tx, id, "workout_analysis", now));
      assertEquals([a.allowed, a.windowStart], [true, now]);
      const b = await db.transaction((tx) => reserve(tx, id, "workout_analysis", now + 60));
      assertEquals([b.allowed, b.retryAfter], [false, 86400 - 60]);
      await db.transaction((tx) => refund(tx, id, "workout_analysis", a));
      const c = await db.transaction((tx) => reserve(tx, id, "workout_analysis", now + 120));
      assertEquals(c.allowed, true);
      const next = await db.transaction((tx) => reserve(tx, id, "workout_analysis", now + 86400 + 1));
      assertEquals([next.allowed, next.windowStart], [true, now + 86401], "a new window opens when the old one has elapsed");

      // three chats a day share one bucket
      const chats = [];
      for (let i = 0; i < 4; i++) chats.push((await db.transaction((tx) => reserve(tx, id, "ai_chat", now))).allowed);
      assertEquals(chats, [true, true, true, false]);

      // the daily attempt: once per exercise per UTC day
      const t0 = Math.floor(Date.UTC(2026, 9, 28, 10) / 1000);
      assertEquals((await db.transaction((tx) => reserveDailyAttempt(tx, id, "pushups", t0))).allowed, true);
      assertEquals((await db.transaction((tx) => reserveDailyAttempt(tx, id, "pushups", t0 + 5))).allowed, false);
      assertEquals((await db.transaction((tx) => reserveDailyAttempt(tx, id, "pushups", t0 + 86400))).allowed, true, "the next UTC day is a fresh attempt");
      const keys = await db.transaction((tx) => tx.all<{ feature: string }>("select feature from public.rate_limits where user_id = $1 and feature like 'challenge:%'", [id]));
      assertEquals(keys.map((k) => k.feature), ["challenge:pushups:2026-10-29"], "yesterday's key is swept");

      // usage counter
      await db.transaction((tx) => trackUsage(tx, id, "feature:edge_check"));
      await db.transaction((tx) => trackUsage(tx, id, "feature:edge_check"));
      const usage = await db.transaction((tx) => tx.one<{ count: number }>("select count from public.usage_events where user_id = $1 and event = 'feature:edge_check'", [id]));
      assertEquals(usage!.count, 2);

      // a failing transaction rolls everything back
      await db.transaction(async (tx) => {
        await tx.exec("update public.profiles set name = 'Changed' where id = $1", [id]);
        throw new Error("boom");
      }).catch(() => {});
      const name = await db.transaction((tx) => tx.one<{ name: string }>("select name from public.profiles where id = $1", [id]));
      assertEquals(name!.name, "Edge Check");
    } finally {
      const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
      assert(gone.ok, "the throwaway user was not removed: delete " + id + " by hand");
    }
  },
});


Deno.test({
  name: "live: a profile is made once, a deletion is purged with its files first, and nobody else is touched",
  ignore: !url || !serviceKey || !dbUrl,
  fn: async () => {
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { ensureProfile, scheduleDeletion, cancelDeletion, purgeDue, getProfile, storedObjects, rename, dueAt } = await import("../_shared/accounts.ts");
    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const make = async () => {
      const created = await fetch(`${url}/auth/v1/admin/users`, {
        method: "POST",
        headers: admin,
        body: JSON.stringify({ email: `edge-${crypto.randomUUID()}@example.invalid`, password: crypto.randomUUID() + "Aa1!", email_confirm: true }),
      });
      assertEquals(created.status, 200);
      return (await created.json()).id as string;
    };
    const [a, b] = [await make(), await make()];
    const db = connect(dbUrl!, 1);
    const store = new Store(url!, serviceKey!);
    const authAdmin = new Auth(url!, serviceKey!);
    const identity = (id: string) => ({ id, email: null, claims: { app_metadata: { provider: "email" } } });
    try {
      // a profile is created once, with a friend code, and a second call changes nothing
      const [made, created] = await db.transaction((tx) => ensureProfile(tx, identity(a), "  Edge Lifter "));
      assert(created && made.name === "Edge Lifter" && /^RC-[0-9A-F]{6}$/.test(made.friend_code));
      const [again, createdAgain] = await db.transaction((tx) => ensureProfile(tx, identity(a), "Someone Else"));
      assertEquals([createdAgain, again.name, again.friend_code], [false, "Edge Lifter", made.friend_code]);
      await db.transaction((tx) => ensureProfile(tx, identity(b), "Other Lifter"));

      // a rename changes only that person
      assert(await db.transaction((tx) => rename(tx, a, "Renamed Lifter")));
      assertEquals((await db.transaction((tx) => getProfile(tx, b)))!.name, "Other Lifter");

      // a unique violation inside a savepoint leaves the transaction usable (this is how a friend code collision is survived)
      const survived = await db.transaction(async (tx) => {
        await tx.savepoint((sp) => sp.exec("insert into public.profiles (id, name, friend_code) values ($1, 'dup', 'RC-DUP000')", [a])).catch((e) => {
          assertEquals((e as { code?: string }).code, "23505");
        });
        return await getProfile(tx, a);
      });
      assertEquals(survived!.name, "Renamed Lifter");

      // schedule: starts once, restore clears it
      const first = await db.transaction((tx) => scheduleDeletion(tx, a));
      assert(first instanceof Date);
      await new Promise((r) => setTimeout(r, 20));
      assertEquals((await db.transaction((tx) => scheduleDeletion(tx, a)))!.getTime(), first.getTime(), "asking again must not push the purge back");
      assert(/^\d{4}-\d\d-\d\d$/.test(dueAt(first)!));
      await db.transaction((tx) => cancelDeletion(tx, a));
      assertEquals((await db.transaction((tx) => getProfile(tx, a)))!.deleted_at, null);

      // each has a stored file; only `a` is due
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      await store.upload("progress-photos", `${a}/edge check.png`, png, "image/png");
      await store.upload("progress-photos", `${b}/edge check.png`, png, "image/png");
      assertEquals((await db.transaction((tx) => storedObjects(tx, a))).length, 1);
      await db.transaction((tx) => scheduleDeletion(tx, a));
      await db.transaction((tx) => scheduleDeletion(tx, b));
      await db.transaction((tx) => tx.exec("update public.profiles set deleted_at = now() - interval '31 days' where id = $1", [a]));

      // `b` is not yet due, and the sweep is restricted to the two throwaway ids so it can never reach a real account
      const [purged, failed] = await purgeDue(db, store, authAdmin, { only: [a, b] });
      assertEquals([purged, failed], [[a], []]);
      assertEquals(await db.transaction((tx) => getProfile(tx, a)), null, "the profile went with the Auth user");
      assertEquals((await db.transaction((tx) => storedObjects(tx, a))).length, 0, "the files went first");
      assertEquals((await db.transaction((tx) => storedObjects(tx, b))).length, 1, "the other person's file is untouched");
      assert(await db.transaction((tx) => getProfile(tx, b)));
    } finally {
      for (const id of [a, b]) {
        await store.remove("progress-photos", (await db.transaction((tx) => storedObjects(tx, id))).map(([, k]) => k)).catch(() => []);
        const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
        assert(gone.ok || gone.status === 404, "a throwaway user was not removed: delete " + id + " by hand");
      }
    }
  },
});

Deno.test({
  name: "live: the whole API, signed in with a real token: profile, photo round trip, consent, deletion, and an imported password moving across",
  ignore: !url || !serviceKey || !dbUrl || !env("SUPABASE_ANON_KEY"),
  fn: async () => {
    const { createHandler } = await import("../_shared/app.ts");
    const { Verifier } = await import("../_shared/auth.ts");
    const { fromEnv } = await import("../_shared/settings.ts");
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { buildRouter } = await import("../api/router.ts");
    const settings = fromEnv((name) => (name === "SUPABASE_URL" ? url : env(name)));
    const db = connect(dbUrl!, 2);
    const handler = createHandler({
      settings,
      db,
      verifier: new Verifier(settings), // the project's REAL keys, fetched over the network
      storage: new Store(url!, serviceKey!),
      authAdmin: new Auth(url!, serviceKey!),
      gemini: new GeminiClient(env("GEMINI_API_KEY")),
      food: new FoodLookup((...a) => fetch(...a), null),
      background: () => {},
      sweep: false,
    }, buildRouter());
    const call = (path: string, init: RequestInit = {}) => handler(new Request(`${url}/functions/v1${path}`, init));

    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const email = `edge-${crypto.randomUUID()}@example.invalid`;
    const password = crypto.randomUUID() + "Aa1!";
    const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) });
    assertEquals(created.status, 200);
    const id = (await created.json()).id as string;
    const signIn = async (pw: string) => {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
      return r.status === 200 ? (await r.json()).access_token as string : null;
    };
    try {
      const token = (await signIn(password))!;
      assert(token, "the throwaway user could not sign in");
      const auth = { Authorization: `Bearer ${token}` };
      const getJson = async (r: Response) => await r.json();

      // a forged token is refused by the real key set
      assertEquals((await call("/api/profile", { headers: { Authorization: `Bearer ${token.slice(0, -4)}AAAA` } })).status, 401);
      assertEquals((await call("/api/profile")).status, 401);
      assertEquals((await call("/api/health")).status, 200);

      // profile
      assertEquals((await call("/api/profile", { headers: auth })).status, 404);
      const made = await call("/api/profile", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Edge Http" }) });
      const madeBody = await getJson(made);
      assertEquals([made.status, madeBody.created, madeBody.profile.name, madeBody.profile.id], [201, true, "Edge Http", id]);
      assertEquals((await getJson(await call("/api/profile", { headers: auth }))).profile.friend_code, madeBody.profile.friend_code);

      // consent
      const consent = await call("/api/ai-consent", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ granted: true }) });
      assertEquals(await getJson(consent), { ok: true, granted: true });
      assertEquals((await getJson(await call("/api/profile", { headers: auth }))).profile.ai_consent, true);

      // a photo makes the whole round trip: upload, list, signed link that serves the same bytes, delete
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.set("angle", "front");
      form.set("date", new Date().toISOString().slice(0, 10));
      form.set("photo", new File([png], "mine.png", { type: "image/png" }));
      const up = await call("/api/checkin/photo", { method: "POST", headers: auth, body: form });
      const upBody = await getJson(up);
      assertEquals([up.status, upBody.ok], [200, true]);
      const listed = (await getJson(await call("/api/checkin/photos", { headers: auth }))).photos;
      assertEquals(listed.length, 1);
      assertEquals([listed[0].id, listed[0].angle], [upBody.id, "front"]);
      const link = await getJson(await call(`/api/checkin/photo/${upBody.id}`, { headers: auth }));
      assertEquals(link.expires_in, 300);
      const served = new Uint8Array(await (await fetch(link.url)).arrayBuffer());
      assertEquals(served, png, "the signed link serves the stored bytes");
      const notPng = new FormData();
      notPng.set("angle", "back");
      notPng.set("date", new Date().toISOString().slice(0, 10));
      notPng.set("photo", new File([new TextEncoder().encode("not an image")], "x.png", { type: "image/png" }));
      assertEquals((await call("/api/checkin/photo", { method: "POST", headers: auth, body: notPng })).status, 400);
      const del = await call(`/api/checkin/photo/${upBody.id}`, { method: "DELETE", headers: auth });
      assertEquals([del.status, (await getJson(del)).ok], [200, true]);
      assertEquals((await getJson(await call("/api/checkin/photos", { headers: auth }))).photos, []);
      assertEquals((await db.transaction((tx) => tx.all("select name from storage.objects where bucket_id = 'progress-photos' and split_part(name, '/', 1) = $1", [id]))).length, 0, "the file is gone too");
      assertEquals((await call(`/api/checkin/photo/${upBody.id}`, { headers: auth })).status, 404);

      // an imported account's old password moves across and then works as the real one
      const OLD = "old-password-1";
      const OLD_HASH = "scrypt:32768:8:1$jG9tzm50OwcoCAWB$e23b30f057ac0c7ff0728868264e7a0d590ea80885fec59923e0eefef5dc91de801e0ac05fb72c10eb7e71c1c9924496e3d8fc0adbbab5c016438dda6e095035";
      await db.transaction((tx) => tx.exec("insert into public.legacy_password_hashes (user_id, password_hash) values ($1, $2)", [id, OLD_HASH]));
      const asJson = { "Content-Type": "application/json", "X-Forwarded-For": `10.0.0.${Math.floor(Math.random() * 250)}` };
      const wrong = await call("/api/auth/legacy-login", { method: "POST", headers: asJson, body: JSON.stringify({ email, password: "wrong" }) });
      assertEquals(wrong.status, 401);
      assertEquals(await signIn(OLD), null, "a wrong try moved nothing");
      const moved = await call("/api/auth/legacy-login", { method: "POST", headers: asJson, body: JSON.stringify({ email: email.toUpperCase(), password: OLD }) });
      assertEquals([moved.status, (await getJson(moved)).ok], [200, true]);
      assert(await signIn(OLD), "the old password now signs in on Supabase");
      assertEquals((await db.transaction((tx) => tx.all("select 1 from public.legacy_password_hashes where user_id = $1", [id]))).length, 0, "the old hash is gone");
      const again = await call("/api/auth/legacy-login", { method: "POST", headers: asJson, body: JSON.stringify({ email, password: OLD }) });
      assertEquals(again.status, 401, "it can be done only once");

      // deletion is scheduled once, and can be undone
      const token2 = (await signIn(OLD))!;
      const auth2 = { Authorization: `Bearer ${token2}` };
      const scheduled = await getJson(await call("/api/account", { method: "DELETE", headers: auth2 }));
      assertEquals([scheduled.ok, scheduled.grace_days, /^\d{4}-\d\d-\d\d$/.test(scheduled.due_at)], [true, 30, true]);
      assertEquals((await getJson(await call("/api/account/restore", { method: "POST", headers: auth2 }))).ok, true);
      assertEquals((await getJson(await call("/api/profile", { headers: auth2 }))).profile.deleted_at, null);
    } finally {
      await db.transaction((tx) => tx.exec("delete from public.auth_throttle where key = $1", [`legacy:${email}`])).catch(() => 0);
      const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
      assert(gone.ok || gone.status === 404, "the throwaway user was not removed: delete " + id + " by hand");
    }
  },
});

Deno.test({
  name: "live: friends, blocks, reports, challenges, the leaderboards and HYROX results between two real people",
  ignore: !url || !serviceKey || !dbUrl || !env("SUPABASE_ANON_KEY"),
  fn: async () => {
    const { createHandler } = await import("../_shared/app.ts");
    const { Verifier } = await import("../_shared/auth.ts");
    const { fromEnv } = await import("../_shared/settings.ts");
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { buildRouter } = await import("../api/router.ts");
    const { todaysExercise } = await import("../_shared/social.ts");
    const settings = fromEnv((name) => (name === "SUPABASE_URL" ? url : env(name)));
    const db = connect(dbUrl!, 2);
    const handler = createHandler({
      settings,
      db,
      verifier: new Verifier(settings),
      storage: new Store(url!, serviceKey!),
      authAdmin: new Auth(url!, serviceKey!),
      gemini: new GeminiClient(env("GEMINI_API_KEY")),
      food: new FoodLookup((...a) => fetch(...a), null),
      background: () => {},
      sweep: false,
    }, buildRouter());
    const call = (path: string, init: RequestInit = {}) => handler(new Request(`${url}/functions/v1${path}`, init));
    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

    const people: { id: string; headers: Record<string, string>; name: string }[] = [];
    const make = async (name: string) => {
      const email = `edge-${crypto.randomUUID()}@example.invalid`;
      const password = crypto.randomUUID() + "Aa1!";
      const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) });
      assertEquals(created.status, 200);
      const id = (await created.json()).id as string;
      const person = { id, headers: {} as Record<string, string>, name };
      people.push(person);
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      person.headers = { Authorization: `Bearer ${(await r.json()).access_token}`, "Content-Type": "application/json" };
      const made = await call("/api/profile", { method: "POST", headers: person.headers, body: JSON.stringify({ name }) });
      assertEquals(made.status, 201);
      return person;
    };
    const json = async (r: Response) => await r.json();
    try {
      const ann = await make("Ann Edge");
      const bob = await make("Bob Edge");
      const post = (who: typeof ann, path: string, body: unknown) => call(path, { method: "POST", headers: who.headers, body: JSON.stringify(body) });
      const get = (who: typeof ann, path: string) => call(path, { headers: who.headers });

      // friends by code: a wrong code is a miss, a right one links both ways, your own is refused
      const annCode = (await json(await get(ann, "/api/friends"))).code as string;
      const bobCode = (await json(await get(bob, "/api/friends"))).code as string;
      assert(/^RC-[0-9A-F]{6}$/.test(annCode));
      assertEquals((await post(ann, "/api/friends/add", { code: "RC-000000" })).status, 404);
      assertEquals((await post(ann, "/api/friends/add", { code: annCode })).status, 400);
      const added = await json(await post(ann, "/api/friends/add", { code: ` ${bobCode.toLowerCase()} ` }));
      assertEquals([added.ok, added.friend.id, added.friend.name], [true, bob.id, "Bob Edge"]);
      assertEquals((await json(await get(ann, "/api/friends"))).friends, [{ id: bob.id, name: "Bob Edge" }]);
      assertEquals((await json(await get(bob, "/api/friends"))).friends, [{ id: ann.id, name: "Ann Edge" }]);
      assertEquals((await post(ann, "/api/friends/add", { code: bobCode })).status, 200, "adding a friend twice is harmless");
      assertEquals(Number((await db.transaction((tx) => tx.one<{ n: number }>("select count(*) as n from public.auth_throttle where key = $1", [`friendcode:${ann.id}`])))!.n), 1, "only the one wrong code was counted");

      // a challenge: Ann makes today's; Bob (a friend) sees it; a stranger would not
      const made = await json(await post(ann, "/api/challenges", {}));
      assertEquals([made.ok, made.exercise], [true, todaysExercise()]);
      const today = await json(await get(ann, "/api/challenges/today"));
      assertEquals([today.exercise, today.attempted], [todaysExercise(), false]);
      const annList = await json(await get(ann, "/api/challenges"));
      assertEquals([annList.me, annList.challenges.length, annList.challenges[0].creator_name, annList.challenges[0].leaderboard], [ann.id, 1, "Ann Edge", []]);
      assertEquals((await json(await get(bob, "/api/challenges"))).challenges.length, 1, "a friend sees it");

      // submissions (the video grader is a later slice, so the rows are written directly) feed both boards and the streak
      await db.transaction(async (tx) => {
        await tx.exec("insert into public.challenge_submissions (challenge_id, user_id, reps, notes) values ($1, $2, 12, 'a'), ($1, $3, 20, 'b')", [made.id, ann.id, bob.id]);
      });
      const board = await json(await get(ann, "/api/challenges"));
      assertEquals(board.challenges[0].leaderboard.map((s: { name: string; reps: number }) => [s.name, s.reps]), [["Bob Edge", 20], ["Ann Edge", 12]]);
      const reps = await json(await get(ann, "/api/leaderboard?scope=friends"));
      assertEquals(reps.leaderboard.map((r: { name: string; total_reps: number }) => [r.name, r.total_reps]), [["Bob Edge", 20], ["Ann Edge", 12]]);
      assertEquals(reps.myRank, { rank: 2, total_reps: 12, name: "Ann Edge" });
      assertEquals((await json(await get(ann, "/api/leaderboard?scope=friends&limit=1"))).leaderboard.length, 1);
      const global = await json(await get(ann, "/api/leaderboard?scope=global"));
      assert(global.totalEntries >= 2 && global.myRank !== null);
      assertEquals((await json(await get(ann, "/api/challenges/today"))).attempted, true);
      const refused = await post(ann, "/api/challenges", {});
      assertEquals([refused.status, (await json(refused)).limitReached], [429, true]);
      const dates = (await json(await get(ann, "/api/activity/dates?tz_offset_minutes=420"))).dates;
      assertEquals(Object.values(dates), [["challenge"]]);

      // HYROX: a result, a board, an implausible time refused
      assertEquals((await post(ann, "/api/hyrox/results", { gender: "men", category: "open", format: "singles", total_seconds: 100 })).status, 400);
      const posted = await json(await post(ann, "/api/hyrox/results", { gender: "men", category: "open", format: "singles", total_seconds: 3700.5 }));
      assertEquals(posted.ok, true);
      await post(bob, "/api/hyrox/results", { gender: "men", category: "open", format: "singles", total_seconds: 3600 });
      const hy = await json(await get(ann, "/api/hyrox/leaderboard?gender=men&category=open&format=singles"));
      const mine = hy.leaderboard.filter((r: { user_id: string }) => r.user_id === ann.id || r.user_id === bob.id).map((r: { name: string; best_seconds: number }) => [r.name, r.best_seconds]);
      assertEquals(mine, [["Bob Edge", 3600], ["Ann Edge", 3700.5]]);
      assertEquals(hy.me.name, "Ann Edge");
      assertEquals((await get(ann, "/api/hyrox/leaderboard?gender=men&category=open")).status, 400);

      // an AI reply report, twice: one report
      assertEquals((await json(await post(ann, "/api/ai-report", { reply: "bad advice", feature: "coach", reason: "harmful" }))).ok, true);
      await post(ann, "/api/ai-report", { reply: "bad advice" });
      assertEquals(Number((await db.transaction((tx) => tx.one<{ n: number }>("select count(*) as n from public.ai_reports where user_id = $1", [ann.id])))!.n), 1);

      // Ann reports Bob: he is blocked, gone from her friends, her boards and his challenges, and she is gone from his (both ways)
      const rep = await json(await post(ann, "/api/safety/report", { user_id: bob.id, reason: "spam" }));
      assertEquals(rep, { ok: true, blocked: { id: bob.id } });
      assertEquals((await json(await get(ann, "/api/friends"))).friends, []);
      assertEquals((await json(await get(bob, "/api/friends"))).friends, []);
      assertEquals((await json(await get(ann, "/api/safety/blocks"))).blocked, [{ id: bob.id, name: "Bob Edge" }]);
      assertEquals((await json(await get(bob, "/api/safety/blocks"))).blocked, [], "being blocked is not visible");
      assertEquals((await json(await get(ann, "/api/leaderboard?scope=global"))).leaderboard.some((r: { user_id: string }) => r.user_id === bob.id), false);
      assertEquals((await json(await get(bob, "/api/leaderboard?scope=global"))).leaderboard.some((r: { user_id: string }) => r.user_id === ann.id), false);
      assertEquals((await json(await get(ann, "/api/challenges"))).challenges[0].leaderboard.map((s: { name: string }) => s.name), ["Ann Edge"]);
      assertEquals((await json(await get(bob, "/api/challenges"))).challenges.length, 0);
      assertEquals((await post(bob, "/api/friends/add", { code: annCode })).status, 404, "a blocked person is told exactly what a wrong code is told");
      const hy2 = await json(await get(ann, "/api/hyrox/leaderboard?gender=men&category=open&format=singles"));
      assertEquals(hy2.leaderboard.some((r: { user_id: string }) => r.user_id === bob.id), false);
      assertEquals(Number((await db.transaction((tx) => tx.one<{ n: number }>("select count(*) as n from public.content_reports where reporter_id = $1", [ann.id])))!.n), 1);
      await post(ann, "/api/safety/report", { user_id: bob.id, reason: "spam" });
      assertEquals(Number((await db.transaction((tx) => tx.one<{ n: number }>("select count(*) as n from public.content_reports where reporter_id = $1", [ann.id])))!.n), 1, "one open report per pair");

      // unblocking brings them back (they are not friends any more)
      assertEquals((await call("/api/safety/block", { method: "DELETE", headers: ann.headers, body: JSON.stringify({ user_id: bob.id }) })).status, 200);
      assertEquals((await json(await get(ann, "/api/safety/blocks"))).blocked, []);
      assertEquals((await json(await get(ann, "/api/challenges"))).challenges[0].leaderboard.length, 2);

      // block directly, and blocking yourself or nobody is refused
      assertEquals((await post(ann, "/api/safety/block", { user_id: ann.id })).status, 400);
      assertEquals((await post(ann, "/api/safety/block", { user_id: crypto.randomUUID() })).status, 404);
      assertEquals((await post(ann, "/api/safety/block", { user_id: bob.id })).status, 200);
    } finally {
      for (const p of people) {
        const gone = await fetch(`${url}/auth/v1/admin/users/${p.id}`, { method: "DELETE", headers: admin });
        assert(gone.ok || gone.status === 404, "a throwaway user was not removed: delete " + p.id + " by hand");
      }
    }
  },
});

Deno.test({
  name: "live: the three AI chats answer through the real model, cite real sources, and the fourth message of the day is limited",
  ignore: !url || !serviceKey || !dbUrl || !env("SUPABASE_ANON_KEY") || !env("GEMINI_API_KEY"),
  fn: async () => {
    const { createHandler } = await import("../_shared/app.ts");
    const { Verifier } = await import("../_shared/auth.ts");
    const { fromEnv } = await import("../_shared/settings.ts");
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { buildRouter } = await import("../api/router.ts");
    const { SOURCES_BY_ID } = await import("../_shared/healthSources.ts");
    const { fallbackReply } = await import("../_shared/chats.ts");
    const settings = fromEnv((name) => (name === "SUPABASE_URL" ? url : env(name)));
    const db = connect(dbUrl!, 2);
    const handler = createHandler({
      settings,
      db,
      verifier: new Verifier(settings),
      storage: new Store(url!, serviceKey!),
      authAdmin: new Auth(url!, serviceKey!),
      gemini: new GeminiClient(env("GEMINI_API_KEY"), undefined, undefined, env("GEMINI_MODEL") || undefined),
      food: new FoodLookup((...a) => fetch(...a), null),
      background: () => {},
      sweep: false,
    }, buildRouter());
    const call = (path: string, init: RequestInit = {}) => handler(new Request(`${url}/functions/v1${path}`, init));
    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const email = `edge-${crypto.randomUUID()}@example.invalid`;
    const password = crypto.randomUUID() + "Aa1!";
    const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) });
    assertEquals(created.status, 200);
    const id = (await created.json()).id as string;
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const headers = { Authorization: `Bearer ${(await r.json()).access_token}`, "Content-Type": "application/json" };
      const post = (path: string, body: unknown) => call(path, { method: "POST", headers, body: JSON.stringify(body) });
      await post("/api/profile", { name: "Edge Chat" });

      // without consent the model is never asked
      const refused = await post("/api/coach-chat", { message: "hi" });
      assertEquals([refused.status, (await refused.json()).needs_ai_consent], [403, true]);
      await post("/api/ai-consent", { granted: true });

      const check = async (path: string, body: unknown, fallback: string) => {
        const res = await post(path, body);
        const out = await res.json();
        assertEquals([res.status, out.ok, out.limited], [200, true, false], JSON.stringify(out));
        assert(out.reply.length > 0 && out.reply !== fallback, "the model did not answer: " + out.reply);
        assert(!/SOURCES\s*:/i.test(out.reply), "the citation line was not taken off: " + out.reply);
        assert(out.sources.length >= 1 && out.sources.length <= 3);
        for (const s of out.sources) assert(SOURCES_BY_ID.has(s.id) && s.url.startsWith("https://"), JSON.stringify(s));
        return out;
      };
      const coach = await check("/api/coach-chat", { message: "In one short sentence: how much protein should a lifter eat a day?", history: [] }, fallbackReply("coach"));
      assert(coach.reply.length < 2000);
      await check("/api/analyze-chat", {
        message: "Why was my squeeze score lower?",
        history: [],
        context: { exercise_label: "Bicep curl", overall_score: 78, stretch_score: 80, squeeze_score: 65, reps: 10, feedback_text: "Good control on the way down. You swing slightly at the top, which reduces the squeeze." },
      }, fallbackReply("analysis"));
      await check("/api/workout-chat", {
        message: "How do I progress my squat?",
        history: [],
        context: { workout_summary: "Exercise history (last 4 sessions each):\nSquat: 2026-10-20 3x5 @ 100 kg; 2026-10-23 3x5 @ 102.5 kg; 2026-10-27 3x5 @ 105 kg" },
      }, fallbackReply("workout"));

      // the three shared one budget, so the fourth is a friendly reply that never reached the model
      const fourth = await (await post("/api/coach-chat", { message: "one more" })).json();
      assertEquals([fourth.ok, fourth.limited, fourth.sources], [true, true, []]);
      assert(fourth.reply.startsWith("You've reached your 3 chat messages for now."));
      assertEquals(Number((await db.transaction((tx) => tx.one<{ n: number }>("select count(*) as n from public.usage_events where user_id = $1 and event like 'feature:%_chat_message'", [id])))!.n), 3);
    } finally {
      const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
      assert(gone.ok || gone.status === 404, "the throwaway user was not removed: delete " + id + " by hand");
    }
  },
});

Deno.test({
  name: "live: coaching targets, and the weekly check-in with a real photo through the real model (or, if Google is busy, the deterministic number)",
  ignore: !url || !serviceKey || !dbUrl || !env("SUPABASE_ANON_KEY"),
  fn: async () => {
    const { createHandler } = await import("../_shared/app.ts");
    const { Verifier } = await import("../_shared/auth.ts");
    const { fromEnv } = await import("../_shared/settings.ts");
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { buildRouter } = await import("../api/router.ts");
    const settings = fromEnv((name) => (name === "SUPABASE_URL" ? url : env(name)));
    const db = connect(dbUrl!, 2);
    const handler = createHandler({
      settings,
      db,
      verifier: new Verifier(settings),
      storage: new Store(url!, serviceKey!),
      authAdmin: new Auth(url!, serviceKey!),
      gemini: new GeminiClient(env("GEMINI_API_KEY"), undefined, undefined, env("GEMINI_MODEL") || undefined),
      food: new FoodLookup((...a) => fetch(...a), null),
      background: () => {},
      sweep: false,
    }, buildRouter());
    const call = (path: string, init: RequestInit = {}) => handler(new Request(`${url}/functions/v1${path}`, init));
    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const email = `edge-${crypto.randomUUID()}@example.invalid`;
    const password = crypto.randomUUID() + "Aa1!";
    const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) });
    assertEquals(created.status, 200);
    const id = (await created.json()).id as string;
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const headers = { Authorization: `Bearer ${(await r.json()).access_token}`, "Content-Type": "application/json" };
      const post = (path: string, body: unknown) => call(path, { method: "POST", headers, body: JSON.stringify(body) });
      await post("/api/profile", { name: "Edge Coach" });
      await post("/api/ai-consent", { granted: true });

      const profile = { aspiration: "lose", gender: "male", activity_level: "lift_and_cardio", protein_preference: "high", body_fat_range_id: "m3", weight_kg: 80, loss_rate_pct: 1 };
      const calc = await (await post("/api/coaching/calculate", { ...profile, distribution: "weekly", training_days: ["monday", "wednesday"] })).json();
      assertEquals(calc.targets, { bmr: 1796, tdee: 2783, calories: 2238, protein: 185, fat: 62, carbs: 235 });
      assertEquals(calc.distribution.monday.calories, 2462);

      // a real photo through the real upload route, then a check-in that uses it
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.set("angle", "front");
      form.set("date", new Date().toISOString().slice(0, 10));
      form.set("photo", new File([png], "p.png", { type: "image/png" }));
      const up = await (await call("/api/checkin/photo", { method: "POST", headers: { Authorization: headers.Authorization }, body: form })).json();
      assertEquals(up.ok, true);
      const week = {
        ...profile,
        current_targets: calc.targets,
        week_weight_entries: [{ date: "2026-10-21", kg: 80 }, { date: "2026-10-28", kg: 79.9 }],
        week_calorie_days: [{ date: "2026-10-22", calories: 2600 }, { date: "2026-10-23", calories: 2650 }, { date: "2026-10-24", calories: 2550 }],
        photo_ids: [up.id],
      };
      const out = await (await post("/api/coaching/weekly-adjustment", week)).json();
      assertEquals(out.ok, true);
      assert(out.adjustment !== null, "a stalled loss at 2600 against a 2238 target always changes something");
      assert(Math.abs(out.adjustment.delta) <= 150 && out.adjustment.calories >= 1500 && typeof out.adjustment.reason === "string" && out.adjustment.reason.length > 0);
      const usedModel = Number((await db.transaction((tx) => tx.one<{ n: number }>("select count(*) as n from public.usage_events where user_id = $1 and event = 'feature:checkin_ai_analysis'", [id])))!.n);
      console.log(usedModel ? "  (the model reviewed the check-in: " + JSON.stringify(out.adjustment) + ")" : "  (the model was unavailable: the deterministic number was used)");
      if (usedModel) {
        assertEquals(out.adjustment.protein, 185);
      } else {
        assertEquals(out.adjustment.delta, -150);
      }
      // without a photo or a profile the deterministic answer is the same shape
      const plain = await (await post("/api/coaching/weekly-adjustment", { ...week, photo_ids: [] })).json();
      assertEquals(plain.ok, true);
    } finally {
      const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
      assert(gone.ok || gone.status === 404, "the throwaway user was not removed: delete " + id + " by hand");
    }
  },
});

Deno.test({
  name: "live: the split generator, with the real model's answer held to the schema (or, if Google is busy, the plan without it)",
  ignore: !url || !serviceKey || !dbUrl || !env("SUPABASE_ANON_KEY"),
  fn: async () => {
    const { createHandler } = await import("../_shared/app.ts");
    const { Verifier } = await import("../_shared/auth.ts");
    const { fromEnv } = await import("../_shared/settings.ts");
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { buildRouter } = await import("../api/router.ts");
    const { SUGGEST_GEMINI_MODEL, SUGGEST_RESPONSE_SCHEMA, buildSuggestPrompt, extractJson, validatePlan } = await import("../_shared/splitPlanner.ts");
    const settings = fromEnv((name) => (name === "SUPABASE_URL" ? url : env(name)));
    const db = connect(dbUrl!, 2);
    const gemini = new GeminiClient(env("GEMINI_API_KEY"), undefined, undefined, env("GEMINI_MODEL") || undefined);
    const handler = createHandler({
      settings,
      db,
      verifier: new Verifier(settings),
      storage: new Store(url!, serviceKey!),
      authAdmin: new Auth(url!, serviceKey!),
      gemini,
      food: new FoodLookup((...a) => fetch(...a), null),
      background: () => {},
      sweep: false,
    }, buildRouter());
    const call = (path: string, init: RequestInit = {}) => handler(new Request(`${url}/functions/v1${path}`, init));
    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

    // the schema the Python sends through its SDK, sent as REST: the API must accept it and answer in that shape
    try {
      const prompt = buildSuggestPrompt(3, "get stronger", "female", 70, 75, "gym");
      const text = await gemini.generate({ model: SUGGEST_GEMINI_MODEL, contents: [{ role: "user", text: prompt }], responseSchema: SUGGEST_RESPONSE_SCHEMA });
      assert(text !== null, "the model answered with nothing");
      const parsed = extractJson(text) as Record<string, unknown>;
      assertEquals(Object.keys(parsed).sort(), ["days", "rationale", "schedule", "split_type"]);
      const plan = validatePlan(parsed, 3, null, "gym", { minExercises: 4, maxExercises: 6, topUpShortDays: true });
      console.log("  (the model built:", parsed.split_type, "with", plan.days.map((d) => d.label).join(" / "), ")");
    } catch (e) {
      if (!(e instanceof Error && e.name === "GeminiError")) throw e;
      console.log("  (Google was busy, the schema call was not checked:", e.message, ")");
    }

    const withUser = async (run: (post: (path: string, body: unknown) => Promise<Response>, id: string) => Promise<void>) => {
      const email = `edge-${crypto.randomUUID()}@example.invalid`;
      const password = crypto.randomUUID() + "Aa1!";
      const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) });
      assertEquals(created.status, 200);
      const id = (await created.json()).id as string;
      try {
        const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        const headers = { Authorization: `Bearer ${(await r.json()).access_token}`, "Content-Type": "application/json" };
        const post = (path: string, body: unknown) => call(path, { method: "POST", headers, body: JSON.stringify(body) });
        await post("/api/profile", { name: "Edge Split" });
        await run(post, id);
      } finally {
        const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
        assert(gone.ok || gone.status === 404, "the throwaway user was not removed: delete " + id + " by hand");
      }
    };
    const suggestions = async (id: string) =>
      Number((await db.transaction((tx) => tx.one<{ n: number }>("select count(*) as n from public.usage_events where user_id = $1 and event = 'feature:split_ai_suggested'", [id])))!.n);

    await withUser(async (post, id) => {
      // without consent the model-built path is refused and nothing is spent
      const refused = await post("/api/generate-split", { split_type: "ai_suggest", days_per_week: 3 });
      assertEquals([refused.status, (await refused.json()).needs_ai_consent], [403, true]);
      await post("/api/ai-consent", { granted: true });
      const out = await (await post("/api/generate-split", { split_type: "ai_suggest", days_per_week: 3, goal: "get stronger", gender: "female", current_weight_kg: 75, goal_weight_kg: 70, location: "gym" })).json();
      assertEquals(out.ok, true);
      assert(["ppl", "upper_lower", "full_body", "bro_split"].includes(out.split_type), out.split_type);
      assertEquals(out.days.length, 3);
      assert(out.days.every((d: { exercises: string[] }) => d.exercises.length >= 4 && d.exercises.length <= 6));
      assertEquals(Object.keys(out.schedule), ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
      assertEquals(await suggestions(id), 1);
      // one plan a day: the second is a 429 that says when to come back
      const again = await post("/api/generate-split", { split_type: "ppl", days_per_week: 3 });
      assertEquals(again.status, 429);
      const limited = await again.json();
      assertEquals([limited.ok, limited.limited], [false, true]);
      assert(limited.retry_after_seconds > 80000 && limited.retry_after_seconds <= 86400, String(limited.retry_after_seconds));
      assertEquals(again.headers.get("Retry-After"), String(limited.retry_after_seconds));
    });

    await withUser(async (post, id) => {
      // a picked split, with the person's own exercises for one day, through the real model (or the plan without it)
      const picked = { Push: ["Squat", "Plank", "Pull-Up", "Bicep Curl"] };
      const out = await (await post("/api/generate-split", { split_type: "ppl", days_per_week: 3, goal: "some mobility too", location: "gym", custom_days_exercises: picked })).json();
      assertEquals(out.ok, true);
      assertEquals(out.days.length, 3);
      const push = out.days.find((d: { label: string }) => d.label === "Push");
      if (push) assertEquals(push.exercises, picked.Push, "the person's own exercises for a day are never changed");
      assertEquals(await suggestions(id), 0, "a picked split is not a suggestion");
      // a custom split never reaches the model, but still counts against the day's allowance
      const custom = await post("/api/generate-split", { split_type: "custom", days_per_week: 2, custom_days: ["Chest Day"] });
      assertEquals(custom.status, 429);
    });
  },
});

Deno.test({
  name: "live: the HYROX race analysis through the real model (or, if Google is busy, the neutral tips and the use given back)",
  ignore: !url || !serviceKey || !dbUrl || !env("SUPABASE_ANON_KEY"),
  fn: async () => {
    const { createHandler } = await import("../_shared/app.ts");
    const { Verifier } = await import("../_shared/auth.ts");
    const { fromEnv } = await import("../_shared/settings.ts");
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { buildRouter } = await import("../api/router.ts");
    const settings = fromEnv((name) => (name === "SUPABASE_URL" ? url : env(name)));
    const db = connect(dbUrl!, 2);
    const handler = createHandler({
      settings,
      db,
      verifier: new Verifier(settings),
      storage: new Store(url!, serviceKey!),
      authAdmin: new Auth(url!, serviceKey!),
      gemini: new GeminiClient(env("GEMINI_API_KEY"), undefined, undefined, env("GEMINI_MODEL") || undefined),
      food: new FoodLookup((...a) => fetch(...a), null),
      background: () => {},
      sweep: false,
    }, buildRouter());
    const call = (path: string, init: RequestInit = {}) => handler(new Request(`${url}/functions/v1${path}`, init));
    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const email = `edge-${crypto.randomUUID()}@example.invalid`;
    const password = crypto.randomUUID() + "Aa1!";
    const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) });
    assertEquals(created.status, 200);
    const id = (await created.json()).id as string;
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const headers = { Authorization: `Bearer ${(await r.json()).access_token}`, "Content-Type": "application/json" };
      const post = (path: string, body: unknown) => call(path, { method: "POST", headers, body: JSON.stringify(body) });
      await post("/api/profile", { name: "Edge Hyrox" });
      const race = {
        category: "open", format: "singles", gender: "male", total_seconds: 5400,
        segments: [
          ...Array.from({ length: 8 }, (_, i) => ({ type: "run", title: `Run ${i + 1}`, seconds: 300 + i * 6 })),
          ...["skierg", "sledPush", "sledPull", "burpeeBroadJump", "row", "farmersCarry", "lunges", "wallBalls"].map((key, i) => ({ type: "station", key, title: key, seconds: 220 + i * 25 })),
        ],
      };
      assertEquals((await post("/api/hyrox/analyze", { race })).status, 403, "no consent: refused");
      await post("/api/ai-consent", { granted: true });
      const out = await (await post("/api/hyrox/analyze", { race })).json();
      assertEquals([out.ok, out.limited], [true, false]);
      assertEquals(out.tips.map((t: { key: string }) => t.key), ["skierg", "sledPush", "sledPull", "burpeeBroadJump", "row", "farmersCarry", "lunges", "wallBalls"]);
      assert(out.tips.every((t: { rating: string }) => ["strong", "solid", "focus"].includes(t.rating)));
      const counted = Number((await db.transaction((tx) => tx.one<{ n: number }>("select count(*) as n from public.usage_events where user_id = $1 and event = 'feature:hyrox_ai_analysis'", [id])))!.n);
      if (counted) {
        assert(out.overall.length > 0 || out.tips.some((t: { tip: string }) => t.tip), "an analysis that was counted says something");
        console.log("  (the model analysed the race:", JSON.stringify(out.overall).slice(0, 120), ")");
      } else {
        assertEquals([out.overall, out.tips.every((t: { tip: string }) => !t.tip)], ["", true]);
        console.log("  (the model was unavailable: the neutral tips came back and the use was given back)");
      }
      const used = await db.transaction((tx) => tx.one<{ count: number }>("select count from public.rate_limits where user_id = $1 and feature = 'hyrox_analysis'", [id]));
      assertEquals(Number(used?.count ?? 0), counted ? 1 : 0, "a use is spent only for a real analysis");
    } finally {
      const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
      assert(gone.ok || gone.status === 404, "the throwaway user was not removed: delete " + id + " by hand");
    }
  },
});

Deno.test({
  name: "live: custom foods and exercises in the real database, and the real product databases (Open Food Facts) and food-photo model",
  ignore: !url || !serviceKey || !dbUrl || !env("SUPABASE_ANON_KEY"),
  fn: async () => {
    const { createHandler } = await import("../_shared/app.ts");
    const { Verifier } = await import("../_shared/auth.ts");
    const { fromEnv } = await import("../_shared/settings.ts");
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { buildRouter } = await import("../api/router.ts");
    const settings = fromEnv((name) => (name === "SUPABASE_URL" ? url : env(name)));
    const db = connect(dbUrl!, 2);
    const handler = createHandler({
      settings,
      db,
      verifier: new Verifier(settings),
      storage: new Store(url!, serviceKey!),
      authAdmin: new Auth(url!, serviceKey!),
      gemini: new GeminiClient(env("GEMINI_API_KEY"), undefined, undefined, env("GEMINI_MODEL") || undefined),
      food: new FoodLookup((...a) => fetch(...a), settings.fatsecret),
      background: () => {},
      sweep: false,
    }, buildRouter());
    const call = (path: string, init: RequestInit = {}) => handler(new Request(`${url}/functions/v1${path}`, init));
    const admin = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const email = `edge-${crypto.randomUUID()}@example.invalid`;
    const password = crypto.randomUUID() + "Aa1!";
    const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) });
    assertEquals(created.status, 200);
    const id = (await created.json()).id as string;
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const auth = { Authorization: `Bearer ${(await r.json()).access_token}` };
      const json = { ...auth, "Content-Type": "application/json" };
      const post = (path: string, body: unknown) => call(path, { method: "POST", headers: json, body: JSON.stringify(body) });
      const get = (path: string) => call(path, { headers: auth });

      assertEquals((await post("/api/custom-foods", { name: "x" })).status, 404, "no profile yet");
      await post("/api/profile", { name: "Edge Food" });

      // custom foods: calories derived, barcode digits, extra servings, the duplicate-barcode 409, list order, scoped delete
      const made = await (await post("/api/custom-foods", { name: "Banana Bread", protein: 5, fat: 10, carbs: 20.5, calories: 1, barcode: "12-34", servingLabel: "1 slice", servingGrams: 60, servings: [{ label: "loaf", grams: 600 }, { label: "", grams: 3 }] })).json();
      assertEquals(made.ok, true);
      assertEquals([made.food.calories, made.food.barcode, made.food.servings], [192, "1234", [{ label: "loaf", grams: 600 }]]);
      const dup = await post("/api/custom-foods", { name: "Again", barcode: "1234" });
      assertEquals([dup.status, (await dup.json()).error], [409, "You already have a custom food saved for this barcode."]);
      await post("/api/custom-foods", { name: "Second", protein: 1 });
      const listed = await (await get("/api/custom-foods")).json();
      assertEquals(listed.foods.map((f: { name: string }) => f.name), ["Second", "Banana Bread"], "newest first");
      assertEquals(listed.foods[1].servings, [{ label: "loaf", grams: 600 }]);
      assertEquals(listed.foods[0].servingLabel, "1 serving");
      // the person's own food answers a scan of its barcode before any outside lookup
      const own = await (await post("/api/lookup-barcode", { barcode: "12 34" })).json();
      assertEquals([own.ok, own.confidence, own.custom_food_id, own.food_name], [true, "custom", made.food.id, "Banana Bread"]);
      const stranger = await fetch(`${url}/rest/v1/custom_foods?select=id`, { headers: { apikey: env("SUPABASE_ANON_KEY")!, ...auth } });
      assertEquals(stranger.status, 200);
      const gone = await call(`/api/custom-foods/${made.food.id}`, { method: "DELETE", headers: auth });
      assertEquals((await gone.json()).ok, true);
      assertEquals((await (await get("/api/custom-foods")).json()).foods.length, 1);
      // someone else's id is silently ignored, not an error
      assertEquals((await (await call("/api/custom-foods/999999999", { method: "DELETE", headers: auth })).json()).ok, true);

      // custom exercises
      const ex = await (await post("/api/custom-exercises", { name: "  Dead Hang ", emoji: "\u{1F4AA}", mode: "each" })).json();
      assertEquals([ex.exercise.name, ex.exercise.emoji, ex.exercise.mode], ["Dead Hang", "\u{1F4AA}", "each"]);
      assertEquals((await post("/api/custom-exercises", { name: "Plank", mode: "sideways" }).then((x) => x.json())).exercise.mode, "both");
      const exercises = (await (await get("/api/custom-exercises")).json()).exercises;
      assertEquals(exercises.map((e: { name: string }) => e.name), ["Plank", "Dead Hang"]);
      assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?\+00:00$/.test(exercises[0].created_at), exercises[0].created_at);
      assertEquals((await post("/api/custom-exercises", { name: "" })).status, 400);
      await call(`/api/custom-exercises/${ex.exercise.id}`, { method: "DELETE", headers: auth });
      assertEquals((await (await get("/api/custom-exercises")).json()).exercises.length, 1);

      // the real product databases
      const nutella = await (await post("/api/lookup-barcode", { barcode: "3017620422003" })).json();
      console.log("  (Open Food Facts for 3017620422003:", JSON.stringify(nutella).slice(0, 200), ")");
      assert(nutella.ok === true || nutella.error, "the product database answered something");
      const unknown = await post("/api/lookup-barcode", { barcode: "0000000000017" });
      const unknownBody = await unknown.json();
      console.log("  (Open Food Facts for an unknown barcode:", unknown.status, JSON.stringify(unknownBody).slice(0, 200), ")");
      const search = await (await get("/api/search-food-online?q=nutella")).json();
      console.log("  (search for nutella:", search.ok, Array.isArray(search.results) ? search.results.length + " results" : search.error, ")");
      assert(search.ok === true || typeof search.error === "string");

      // the food photo, through the real model: consent first
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      const form = () => {
        const f = new FormData();
        f.set("image", new File([png], "meal.png", { type: "image/png" }));
        return f;
      };
      assertEquals((await call("/api/analyze-food", { method: "POST", headers: auth, body: form() })).status, 403);
      await post("/api/ai-consent", { granted: true });
      const photo = await call("/api/analyze-food", { method: "POST", headers: auth, body: form() });
      const photoBody = await photo.json();
      console.log("  (food photo:", photo.status, JSON.stringify(photoBody).slice(0, 160), ")");
      assert(photo.status === 200 || photo.status === 502, String(photo.status));
      if (photo.status === 200) assert(Array.isArray(photoBody.ingredients) && typeof photoBody.calories === "number");
      const used = await db.transaction((tx) => tx.one<{ count: number }>("select count from public.rate_limits where user_id = $1 and feature = 'food_analysis'", [id]));
      assertEquals(Number(used?.count ?? 0), photo.status === 200 ? 1 : 0, "a use is spent only for an estimate that came back");
    } finally {
      const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
      assert(gone.ok || gone.status === 404, "the throwaway user was not removed: delete " + id + " by hand");
    }
  },
});

Deno.test({
  name: "live: the waitlist and the owner's side against the real database",
  ignore: !url || !serviceKey || !dbUrl || !env("SUPABASE_ANON_KEY"),
  fn: async () => {
    const { createHandler } = await import("../_shared/app.ts");
    const { Verifier } = await import("../_shared/auth.ts");
    const { fromEnv } = await import("../_shared/settings.ts");
    const { AuthAdmin: Auth, Storage: Store } = await import("../_shared/supabaseAdmin.ts");
    const { buildRouter } = await import("../api/router.ts");
    const db = connect(dbUrl!, 2);
    const adminHeaders = { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const email = `edge-${crypto.randomUUID()}@example.invalid`;
    const password = crypto.randomUUID() + "Aa1!";
    const created = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) });
    assertEquals(created.status, 200);
    const id = (await created.json()).id as string;
    // this throwaway account is the owner for the duration of the test
    const settings = fromEnv((name) => (name === "SUPABASE_URL" ? url : name === "ADMIN_EMAILS" ? email : env(name)));
    const handler = createHandler({
      settings,
      db,
      verifier: new Verifier(settings),
      storage: new Store(url!, serviceKey!),
      authAdmin: new Auth(url!, serviceKey!),
      gemini: new GeminiClient(undefined),
      food: new FoodLookup((...a) => fetch(...a), null),
      background: () => {},
      sweep: false,
    }, buildRouter());
    const call = (path: string, init: RequestInit = {}) => handler(new Request(`${url}/functions/v1${path}`, init));
    const visitor = `edge-waitlist-${crypto.randomUUID()}@example.invalid`;
    const key = `waitlist:203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const auth = { Authorization: `Bearer ${(await r.json()).access_token}`, "Content-Type": "application/json" };
      const addr = key.slice("waitlist:".length);
      const join = (body: unknown) => call("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://repcheck-marketing.onrender.com", "X-Forwarded-For": addr }, body: JSON.stringify(body) });

      // the public door: no token, the marketing origin echoed, an address added once and then known
      const first = await join({ email: visitor.toUpperCase(), source: "live check" });
      assertEquals([first.status, await first.json(), first.headers.get("Access-Control-Allow-Origin")], [200, { ok: true, already: false }, "https://repcheck-marketing.onrender.com"]);
      assertEquals(await (await join({ email: visitor })).json(), { ok: true, already: true });
      assertEquals((await join({ email: "not an address" })).status, 400);
      // ...five tries an hour per address: two were taken above (a bad address is refused before it counts), three more are allowed, the sixth is refused
      assertEquals((await join({ email: visitor })).status, 200);
      assertEquals((await join({ email: visitor })).status, 200);
      assertEquals((await join({ email: visitor })).status, 200);
      const sixth = await join({ email: visitor });
      const sixthBody = await sixth.json();
      assertEquals([sixth.status, sixthBody.error], [429, "rate-limited"]);
      assert(sixthBody.retry_after_seconds > 3000 && sixthBody.retry_after_seconds <= 3600, String(sixthBody.retry_after_seconds));

      // the owner's side: only the owner may look
      assertEquals((await call("/api/admin/waitlist")).status, 401);
      const list = await (await call("/api/admin/waitlist", { headers: auth })).json();
      const mine = list.entries.find((e: { email: string }) => e.email === visitor);
      assert(mine, "the new address is in the list");
      assertEquals(mine.source, "live check");
      assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?\+00:00$/.test(mine.created_at), mine.created_at);
      assertEquals(list.total, list.entries.length);
      const csv = await call("/api/admin/waitlist?format=csv", { headers: auth });
      assertEquals(csv.headers.get("Content-Type"), "text/csv; charset=utf-8");
      assert((await csv.text()).includes(`"${visitor}","live check"`));
      assertEquals(await (await call("/api/admin/waitlist/delete", { method: "POST", headers: auth, body: JSON.stringify({ email: ` ${visitor.toUpperCase()} ` }) })).json(), { ok: true, removed: true });
      assertEquals((await (await call("/api/admin/waitlist/delete", { method: "POST", headers: auth, body: JSON.stringify({ email: visitor }) })).json()).removed, false);

      // reports: read-only here (nothing is handled or reset: those would touch real people's reports)
      const reports = await (await call("/api/admin/reports", { headers: auth })).json();
      assertEquals([reports.ok, Array.isArray(reports.reports), Array.isArray(reports.ai_reports)], [true, true, true]);

      // people: the list for a range, and this account's own detail (every count query runs against the real tables)
      await call("/api/profile", { method: "POST", headers: auth, body: JSON.stringify({ name: "Edge Owner" }) });
      const users = await (await call("/api/admin/users?range=today", { headers: auth })).json();
      assertEquals([users.ok, users.range], [true, "today"]);
      assert(users.users.some((u: { id: string; email: string }) => u.id === id && u.email === email), "the new account is in today's list");
      const detail = await (await call(`/api/admin/users/${id}`, { headers: auth })).json();
      assertEquals([detail.ok, detail.user.id, detail.user.email, detail.user.ai_consent, detail.user.deleted_at], [true, id, email, false, null]);
      assertEquals(Object.keys(detail.user.counts), ["foods_logged", "exercises_logged", "weigh_ins", "analyses", "progress_photos", "custom_foods", "challenge_submissions", "hyrox_results", "friends"]);
      assertEquals([detail.user.latest_weight, detail.user.analyses], [null, []]);
      assertEquals((await call(`/api/admin/users/${crypto.randomUUID()}`, { headers: auth })).status, 404);
      const all = await (await call("/api/admin/users?range=all", { headers: auth })).json();
      assert(all.users.length >= users.users.length);
    } finally {
      await db.transaction(async (tx) => {
        await tx.exec("delete from public.waitlist where email = $1", [visitor]);
        await tx.exec("delete from public.auth_throttle where key = $1", [key]);
      });
      const gone = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders });
      assert(gone.ok || gone.status === 404, "the throwaway user was not removed: delete " + id + " by hand");
    }
  },
});
