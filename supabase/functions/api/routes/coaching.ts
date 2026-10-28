/** Coaching: body-fat ranges, the target calculation, and the weekly check-in adjustment. */
import type { Router } from "../../_shared/app.ts";
import { getProfile } from "../../_shared/accounts.ts";
import { analyzeCheckin } from "../../_shared/checkin.ts";
import { boundedList, mimeFor, ownPhotos, trainingDays, validateProfile } from "../../_shared/coaching.ts";
import { FEMALE_BODY_FAT_RANGES, MALE_BODY_FAT_RANGES } from "../../_shared/coachingData.ts";
import { applyCalorieDelta, BadCheckin, calculateTargets, distributeWeeklyCalories, type Targets, weeklyAdjustment } from "../../_shared/coachingEngine.ts";
import { hasConsent } from "../../_shared/consent.ts";
import type { Image } from "../../_shared/gemini.ts";
import { fail, json, jsonBody } from "../../_shared/http.ts";
import { release, reserveUse, track } from "../../_shared/limits.ts";
import { SupabaseError } from "../../_shared/supabaseAdmin.ts";

const PHOTO_BUCKET = "progress-photos";
const FEATURE = "checkin_analysis";

export function register(router: Router): void {
  router.get("/api/coaching/body-fat-ranges", ({ request }) => {
    const gender = new URL(request.url).searchParams.get("gender") ?? "male";
    return json({ ok: true, ranges: gender === "female" ? FEMALE_BODY_FAT_RANGES : MALE_BODY_FAT_RANGES });
  });

  router.post("/api/coaching/calculate", async ({ request }) => {
    const payload = await jsonBody(request);
    const [profile, error] = validateProfile(payload);
    if (error !== null) return fail(error, 400);
    const targets = calculateTargets(profile);
    const distribution = payload.distribution === "weekly"
      ? distributeWeeklyCalories(targets.calories, targets.protein, targets.fat, targets.carbs, trainingDays(payload.training_days))
      : null;
    return json({ ok: true, targets, distribution });
  });

  /** The deterministic trend adjustment always runs and is the answer on its own; with consent, and while the daily check-in
   *  allowance lasts, the model may refine it (photos included), and a failure there quietly falls back to the deterministic number:
   *  a check-in the person just spent time on is never lost to an AI hiccup. */
  router.post("/api/coaching/weekly-adjustment", async ({ request, services, identity }) => {
    const userId = identity.id;
    const payload = await jsonBody(request);
    const [profile, error] = validateProfile(payload);
    if (error !== null) return fail(error, 400);
    const current = payload.current_targets;
    if (current === null || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, "calories")) return fail("Missing current_targets.", 400);
    const targets = current as Targets;
    const weights = boundedList(payload.week_weight_entries);
    const calorieDays = boundedList(payload.week_calorie_days);
    if (weights === null || calorieDays === null) return fail("Invalid check-in data.", 400);

    let baseline;
    try {
      baseline = weeklyAdjustment(profile, targets, weights, calorieDays);
    } catch (e) {
      if (e instanceof BadCheckin) return fail("Invalid check-in data.", 400);
      throw e;
    }

    const { stored, photos } = await services.db.transaction(async (tx) => {
      const stored = await getProfile(tx, userId);
      return { stored, photos: stored ? await ownPhotos(tx, userId, payload.photo_ids) : [] };
    });
    let adjustment = baseline;
    if (hasConsent(stored)) {
      const reservation = await reserveUse(services.db, services.settings, identity, FEATURE);
      if (reservation.allowed) {
        const files: Image[] = [];
        for (const row of photos) {
          let data: Uint8Array | null = null;
          try {
            data = await services.storage.download(PHOTO_BUCKET, `${userId}/${row.filename}`);
          } catch (e) {
            if (!(e instanceof SupabaseError)) throw e;
          }
          if (data && data.length) files.push({ data, mimeType: mimeFor(row.filename) });
        }
        try {
          const outcome = await analyzeCheckin(services.gemini, profile, targets, weights, calorieDays, baseline, files);
          adjustment = applyCalorieDelta(profile, targets, outcome.delta, outcome.reason);
          await track(services.db, userId, "checkin_ai_analysis");
        } catch {
          console.warn("check-in analysis failed; using the deterministic adjustment");
          await release(services.db, userId, FEATURE, reservation);
        }
      }
    }
    return json({ ok: true, adjustment });
  });
}
