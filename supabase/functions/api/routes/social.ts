/** Friends, blocking and reporting, challenges, the leaderboards, HYROX results and the streak's server-side dates.
 *  (Submitting a challenge clip grades a video, which moves with the video grader.) */
import type { Context, Router } from "../../_shared/app.ts";
import { getProfile } from "../../_shared/accounts.ts";
import { fail, json, jsonBody } from "../../_shared/http.ts";
import { track } from "../../_shared/limits.ts";
import { pyStrip } from "../../_shared/nameFilter.ts";
import * as social from "../../_shared/social.ts";

const NO_PROFILE = "No profile yet. Create it first.";

/** The caller's profile must exist for anything that writes about them; this is the refusal when it does not. */
async function needProfile({ services, identity }: Context): Promise<Response | null> {
  const profile = await services.db.transaction((tx) => getProfile(tx, identity.id));
  return profile ? null : fail(NO_PROFILE, 404);
}

function refused(r: social.Rejected): Response {
  const { retry_after, ...rest } = r.extra;
  return json({ ok: false, error: r.message, ...rest }, r.status, retry_after === undefined ? {} : { "Retry-After": String(retry_after) });
}

/** The id of an account that exists, from a posted `user_id`, or null. A row is only ever written for an account that
 *  exists, so a bad client cannot fill these tables. */
async function target(ctx: Context, payload: Record<string, unknown>): Promise<string | null> {
  const id = social.parseUserId(payload.user_id);
  if (id === null) return null;
  return (await ctx.services.db.transaction((tx) => social.profileExists(tx, id))) ? id : null;
}

/** An integer query value the way Flask's `type=int` reads it: `" 5 "` and `"+5"` are 5, `"5.5"` and `"x"` are nothing. */
export function intParam(value: string | null): number | null {
  return value !== null && /^[+-]?[0-9]+$/.test(pyStrip(value)) ? Number.parseInt(value, 10) : null;
}

export function register(router: Router): void {
  // -- friends --------------------------------------------------------------------------------------------------------
  router.get("/api/friends", async ({ services, identity }) => {
    return await services.db.transaction(async (tx) => {
      const code = await social.friendCode(tx, identity.id);
      if (code === null) return fail(NO_PROFILE, 404);
      return json({ ok: true, code, friends: await social.friends(tx, identity.id) });
    });
  });

  router.post("/api/friends/add", async (ctx) => {
    const early = await needProfile(ctx);
    if (early) return early;
    const body = await jsonBody(ctx.request);
    const result = await ctx.services.db.transaction((tx) => social.addByCode(tx, ctx.identity.id, body.code, Math.floor(Date.now() / 1000)));
    if ("rejected" in result) return refused(result.rejected);
    await track(ctx.services.db, ctx.identity.id, "friend_added");
    return json({ ok: true, friend: result.friend });
  });

  // -- blocking and reporting -----------------------------------------------------------------------------------------
  router.get("/api/safety/blocks", async ({ services, identity }) => {
    return json({ ok: true, blocked: await services.db.transaction((tx) => social.blockedAccounts(tx, identity.id)) });
  });

  router.post("/api/safety/block", async (ctx) => {
    const early = await needProfile(ctx);
    if (early) return early;
    const id = await target(ctx, await jsonBody(ctx.request));
    if (!id) return fail("That account no longer exists.", 404);
    if (id === ctx.identity.id) return fail("You can't block yourself.", 400);
    await ctx.services.db.transaction((tx) => social.block(tx, ctx.identity.id, id));
    await track(ctx.services.db, ctx.identity.id, "block_user");
    // No name in the reply: ids are not secret enough to let this become an oracle that walks them and reads every name.
    return json({ ok: true, blocked: { id } });
  });

  router.delete("/api/safety/block", async ({ request, services, identity }) => {
    const id = social.parseUserId((await jsonBody(request)).user_id);
    if (id === null) return fail("Which account?", 400);
    // Not gated on the account still existing: a block on an account deleted since must stay removable.
    await services.db.transaction((tx) => social.unblock(tx, identity.id, id));
    return json({ ok: true });
  });

  router.post("/api/safety/report", async (ctx) => {
    const early = await needProfile(ctx);
    if (early) return early;
    const payload = await jsonBody(ctx.request);
    const id = await target(ctx, payload);
    if (!id) return fail("That account no longer exists.", 404);
    if (id === ctx.identity.id) return fail("You can't report yourself.", 400);
    await ctx.services.db.transaction((tx) => social.reportUser(tx, ctx.identity.id, id, payload.reason));
    await track(ctx.services.db, ctx.identity.id, "report_user");
    return json({ ok: true, blocked: { id } });
  });

  router.post("/api/ai-report", async (ctx) => {
    const early = await needProfile(ctx);
    if (early) return early;
    const payload = await jsonBody(ctx.request);
    const reply = payload.reply;
    if (typeof reply !== "string" || !reply.trim()) return fail("Nothing to report.", 400);
    const filed = await ctx.services.db.transaction((tx) => social.reportAiReply(tx, ctx.identity.id, payload.feature, payload.reason, reply));
    if (!filed) return fail("You have too many reports waiting for review.", 429);
    await track(ctx.services.db, ctx.identity.id, "report_ai_reply");
    return json({ ok: true });
  });

  // -- the streak -----------------------------------------------------------------------------------------------------
  router.get("/api/activity/dates", async ({ request, services, identity }) => {
    const offset = new URL(request.url).searchParams.get("tz_offset_minutes") ?? 0;
    return json({ ok: true, dates: await services.db.transaction((tx) => social.activityDates(tx, identity.id, offset)) });
  });

  // -- challenges -----------------------------------------------------------------------------------------------------
  router.get("/api/challenges", async ({ services, identity }) => {
    const challenges = await services.db.transaction((tx) => social.visibleChallenges(tx, identity.id));
    return json({ ok: true, challenges, me: identity.id });
  });

  router.post("/api/challenges", async (ctx) => {
    const early = await needProfile(ctx);
    if (early) return early;
    const exercise = social.todaysExercise();
    try {
      const id = await ctx.services.db.transaction((tx) => social.createChallenge(tx, ctx.identity.id, exercise));
      return json({ ok: true, id, exercise });
    } catch (e) {
      if (e instanceof social.Rejected) return refused(e);
      throw e;
    }
  });

  router.get("/api/challenges/today", async ({ services, identity }) => {
    const exercise = social.todaysExercise();
    const attempted = await services.db.transaction((tx) => social.hasSubmittedToday(tx, identity.id, exercise));
    return json({ ok: true, exercise, label: social.CHALLENGE_EXERCISES[exercise], attempted });
  });

  // -- leaderboards ---------------------------------------------------------------------------------------------------
  router.get("/api/leaderboard", async ({ request, services, identity }) => {
    const params = new URL(request.url).searchParams;
    const scope = params.get("scope") ?? "friends";
    const limit = intParam(params.get("limit"));
    const rows = await services.db.transaction((tx) => social.repsBoard(tx, identity.id, scope));
    return json({
      ok: true,
      scope,
      me: identity.id,
      leaderboard: limit ? rows.slice(0, limit) : rows,
      totalEntries: rows.length,
      myRank: social.myRank(rows, identity.id, "total_reps"),
    });
  });

  router.post("/api/hyrox/results", async (ctx) => {
    const early = await needProfile(ctx);
    if (early) return early;
    try {
      const [gender, category, format, seconds] = social.cleanHyroxResult(await jsonBody(ctx.request));
      const id = await ctx.services.db.transaction((tx) => social.createHyroxResult(tx, ctx.identity.id, gender, category, format, seconds));
      return json({ ok: true, id });
    } catch (e) {
      if (e instanceof social.Rejected) return refused(e);
      throw e;
    }
  });

  router.get("/api/hyrox/leaderboard", async ({ request, services, identity }) => {
    const params = new URL(request.url).searchParams;
    const [gender, category, format] = ["gender", "category", "format"].map((k) => params.get(k) ?? "");
    if (!social.hyroxCombo(gender, category, format)) return fail("Invalid gender, category, or format.", 400);
    const rows = await services.db.transaction((tx) => social.hyroxBoard(tx, identity.id, gender, category, format));
    return json({ ok: true, leaderboard: rows.slice(0, social.HYROX_LEADERBOARD_ROWS), totalEntries: rows.length, me: social.myRank(rows, identity.id, "best_seconds") });
  });
}
