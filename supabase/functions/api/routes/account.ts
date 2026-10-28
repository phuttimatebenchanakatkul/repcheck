/** The signed-in person's profile and the lifecycle of their account. */
import type { Router } from "../../_shared/app.ts";
import { dueAt, ensureProfile, GRACE_DAYS, getProfile, NameRejected, cancelDeletion, rename, scheduleDeletion, type Profile } from "../../_shared/accounts.ts";
import { fail, json, jsonBody } from "../../_shared/http.ts";

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function profileJson(profile: Profile) {
  return {
    id: String(profile.id),
    name: profile.name,
    friend_code: profile.friend_code,
    onboarding_completed: profile.onboarding_completed,
    ai_consent: profile.ai_consent_at !== null,
    deleted_at: iso(profile.deleted_at),
    due_at: dueAt(profile.deleted_at),
  };
}

const NO_PROFILE = "No profile yet. Create it first.";

export function register(router: Router): void {
  router.get("/api/profile", async ({ services, identity }) => {
    const profile = await services.db.transaction((tx) => getProfile(tx, identity.id));
    if (!profile) return fail(NO_PROFILE, 404);
    return json({ ok: true, profile: profileJson(profile) });
  });

  /** Create the caller's profile if it does not exist (the app's first call after any sign-in, email or provider).
   *  Idempotent: an existing profile is returned as it is. */
  router.post("/api/profile", async ({ request, services, identity }) => {
    const name = (await jsonBody(request)).name;
    if (name !== undefined && name !== null && typeof name !== "string") return fail("Please enter your name.", 400);
    try {
      const [profile, created] = await services.db.transaction((tx) => ensureProfile(tx, identity, name));
      return json({ ok: true, created, profile: profileJson(profile) }, created ? 201 : 200);
    } catch (e) {
      if (e instanceof NameRejected) return fail(e.message, 400);
      throw e;
    }
  });

  /** Rename. (Email and password belong to Supabase Auth; the app changes those there.) */
  router.post("/api/account", async ({ request, services, identity }) => {
    const name = (await jsonBody(request)).name;
    if (typeof name !== "string") return fail("Nothing to update.", 400);
    try {
      const found = await services.db.transaction((tx) => rename(tx, identity.id, name));
      if (!found) return fail(NO_PROFILE, 404);
      return json({ ok: true });
    } catch (e) {
      if (e instanceof NameRejected) return fail(e.message, 400);
      throw e;
    }
  });

  // Apple App Store Guideline 5.1.1(v): an app that lets you create an account must let you delete it from inside the
  // app. This schedules the deletion; the account keeps working for GRACE_DAYS and can be restored the whole time.
  router.delete("/api/account", async ({ services, identity }) => {
    const deletedAt = await services.db.transaction((tx) => scheduleDeletion(tx, identity.id));
    if (deletedAt === null) return fail(NO_PROFILE, 404);
    return json({ ok: true, deleted_at: iso(deletedAt), due_at: dueAt(deletedAt), grace_days: GRACE_DAYS });
  });

  router.post("/api/account/restore", async ({ services, identity }) => {
    await services.db.transaction((tx) => cancelDeletion(tx, identity.id));
    return json({ ok: true });
  });
}
