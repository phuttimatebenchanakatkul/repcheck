/** Runs the real database code against the real Supabase project: `deno task test:live`.
 *
 * Not part of `deno task test` (the name does not end in .test.ts) because it needs the network and the project's keys,
 * read from the repo's gitignored .env. It creates ONE throwaway user, touches only that user's rows, and deletes the
 * user in a `finally` (the delete cascades through the profile and every table that points at it), so it can never
 * touch a real account.
 */
import { assert, assertEquals } from "@std/assert";

import { connect } from "../_shared/db.ts";
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
