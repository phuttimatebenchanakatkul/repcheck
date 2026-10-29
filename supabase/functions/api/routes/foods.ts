/** Food: the AI photo scan, barcode lookup, online food search, and a person's own foods and exercises.
 *
 *  Not here: POST /api/scan-barcode (a photo of a barcode decoded on the server). The app reads barcodes on the phone and sends the digits to
 *  /api/lookup-barcode; decoding an image needs a native library the Edge runtime does not have. */
import type { Router } from "../../_shared/app.ts";
import { getProfile } from "../../_shared/accounts.ts";
import { hasConsent, refusal } from "../../_shared/consent.ts";
import { analyzeFoodPhoto, FoodAnalysisError } from "../../_shared/foodPhoto.ts";
import { LookupError, ProductNotFound } from "../../_shared/foodLookup.ts";
import * as foods from "../../_shared/foods.ts";
import { fail, json, jsonBody, readFormBounded } from "../../_shared/http.ts";
import { friendlyWait, RATE_LIMITS, release, reserveUse, track } from "../../_shared/limits.ts";
import { inspectImage, MAX_PHOTO_BYTES, PhotoRejected } from "../../_shared/photos.ts";
import { cleanText } from "../../_shared/rows.ts";
import type { Context } from "../../_shared/app.ts";

export const FOOD_PHOTO_BODY_LIMIT = MAX_PHOTO_BYTES + 64 * 1024;
export const MAX_NOTE = 300;
export const MAX_SEARCH = 100;
export const SEARCH_RESULTS = 12;
const FEATURE = "food_analysis";
const NO_PROFILE = "No profile yet. Create it first.";

/** A person's own food for this exact barcode always wins over an outside lookup (their verified data for their product). */
async function resolveBarcode(ctx: Context, barcode: string) {
  const mine = await ctx.services.db.transaction((tx) => foods.foodByBarcode(tx, ctx.identity.id, barcode));
  return mine ? foods.foodAsScanResult(mine) : await ctx.services.food.lookupBarcode(barcode);
}

/** The person has a profile, or the 404 to answer with. */
async function needProfile(ctx: Context): Promise<Response | null> {
  return await ctx.services.db.transaction((tx) => getProfile(tx, ctx.identity.id)) ? null : fail(NO_PROFILE, 404);
}

export function register(router: Router): void {
  // -- the AI food photo -----------------------------------------------------------------------------------------------------

  router.post("/api/analyze-food", async ({ request, services, identity }) => {
    const userId = identity.id;
    const profile = await services.db.transaction((tx) => getProfile(tx, userId));
    if (!profile) return fail(NO_PROFILE, 404);
    if (!hasConsent(profile)) return refusal();
    const form = await readFormBounded(request, FOOD_PHOTO_BODY_LIMIT); // larger is a 413, never buffered whole
    const upload = form.get("image");
    if (!(upload instanceof File) || !upload.name) return fail("Please provide a photo.", 400);
    const data = new Uint8Array(await upload.arrayBuffer());
    let mimeType: string;
    try {
      [, mimeType] = inspectImage(data); // real bytes, a real image, the real type: not the client's word
    } catch (e) {
      if (e instanceof PhotoRejected) return fail(e.message, e.status);
      throw e;
    }
    const rawNote = form.get("note");
    const note = cleanText(typeof rawNote === "string" ? rawNote : null, MAX_NOTE) || null;

    const reservation = await reserveUse(services.db, services.settings, identity, FEATURE);
    if (!reservation.allowed) {
      return json({
        ok: false,
        error: `You've used your ${RATE_LIMITS[FEATURE][0]} food scans for today — try again in ${friendlyWait(reservation.retryAfter)}.`,
      }, 429, { "Retry-After": String(reservation.retryAfter) });
    }
    let result;
    try {
      result = await analyzeFoodPhoto(services.gemini, data, mimeType, note);
    } catch (e) {
      await release(services.db, userId, FEATURE, reservation);
      if (e instanceof FoodAnalysisError) {
        console.warn("Food photo analysis failed:", e.message);
        return fail("Couldn't analyze that photo. Please try again.", 502);
      }
      throw e;
    }
    await track(services.db, userId, "food_scan");
    return json({ ok: true, ...result });
  });

  // -- barcodes and online search ---------------------------------------------------------------------------------------------

  router.post("/api/lookup-barcode", async (ctx) => {
    const payload = await jsonBody(ctx.request);
    const barcode = [...foods.digitsOnly(payload.barcode)].slice(0, foods.MAX_BARCODE).join("");
    if (!barcode) return fail("No barcode value given.", 400);
    try {
      return json({ ok: true, ...await resolveBarcode(ctx, barcode) });
    } catch (e) {
      if (e instanceof ProductNotFound) return json({ ok: false, not_found: true, barcode, error: e.message }); // a normal outcome, not an error
      if (e instanceof LookupError) {
        console.warn("Barcode lookup failed:", e.message);
        return fail(e.message, 502);
      }
      throw e;
    }
  });

  router.get("/api/search-food-online", async ({ request, services }) => {
    const query = cleanText(new URL(request.url).searchParams.get("q") ?? "", MAX_SEARCH);
    try {
      return json({ ok: true, results: await services.food.search(query, SEARCH_RESULTS) });
    } catch (e) {
      if (e instanceof LookupError) {
        console.warn("Open Food Facts search failed:", e.message);
        return fail(e.message, 502);
      }
      throw e;
    }
  });

  // -- a person's own foods and exercises ---------------------------------------------------------------------------------------

  router.get("/api/custom-foods", async ({ services, identity }) =>
    json({ ok: true, foods: await services.db.transaction((tx) => foods.listFoods(tx, identity.id)) }));

  router.post("/api/custom-foods", async (ctx) => {
    const early = await needProfile(ctx);
    if (early) return early;
    const payload = await jsonBody(ctx.request);
    try {
      return json({ ok: true, food: await ctx.services.db.transaction((tx) => foods.createFood(tx, ctx.identity.id, payload)) });
    } catch (e) {
      if (e instanceof foods.Rejected) return fail(e.message, e.status);
      throw e;
    }
  });

  router.delete("/api/custom-foods/<int:food_id>", async ({ services, identity, params }) => {
    await services.db.transaction((tx) => foods.deleteFood(tx, identity.id, Number(params.food_id)));
    return json({ ok: true });
  });

  router.get("/api/custom-exercises", async ({ services, identity }) =>
    json({ ok: true, exercises: await services.db.transaction((tx) => foods.listExercises(tx, identity.id)) }));

  router.post("/api/custom-exercises", async (ctx) => {
    const early = await needProfile(ctx);
    if (early) return early;
    const payload = await jsonBody(ctx.request);
    try {
      return json({ ok: true, exercise: await ctx.services.db.transaction((tx) => foods.createExercise(tx, ctx.identity.id, payload)) });
    } catch (e) {
      if (e instanceof foods.Rejected) return fail(e.message, e.status);
      throw e;
    }
  });

  router.delete("/api/custom-exercises/<int:exercise_id>", async ({ services, identity, params }) => {
    await services.db.transaction((tx) => foods.deleteExercise(tx, identity.id, Number(params.exercise_id)));
    return json({ ok: true });
  });
}
