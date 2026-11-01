/** AI form analysis and its history. See _shared/analyze.ts for the rules and _shared/analyzeForm.ts for how a clip is graded. */
import type { Router } from "../../_shared/app.ts";
import { getProfile } from "../../_shared/accounts.ts";
import * as analyze from "../../_shared/analyze.ts";
import { FormFailure, gradeClip } from "../../_shared/analyzeForm.ts";
import { hasConsent, refusal } from "../../_shared/consent.ts";
import { fail, json, readBytesBounded } from "../../_shared/http.ts";
import { limitMessage, release, reserveUse, trackUsage } from "../../_shared/limits.ts";
import { parseMultipart, partNamed, textOf } from "../../_shared/multipart.ts";
import type { Row } from "../../_shared/db.ts";
import { SupabaseError, type Storage } from "../../_shared/supabaseAdmin.ts";

export const SIGNED_URL_SECONDS = 300;
// The clip plus two short form fields. Stated per request: the app-wide limit is for JSON bodies.
export const UPLOAD_BODY_LIMIT = analyze.MAX_UPLOAD_BYTES + 1024 * 1024;

const NO_PROFILE = "No profile yet. Create it first.";

/** A short-lived link to the stored clip, or null if there is none (or it cannot be signed right now). */
async function signedClipUrl(storage: Storage, userId: string, videoFilename: unknown): Promise<string | null> {
  if (!videoFilename) return null;
  try {
    return await storage.sign(analyze.BUCKET, analyze.clipKey(userId, String(videoFilename)), SIGNED_URL_SECONDS);
  } catch (e) {
    if (e instanceof SupabaseError) return null;
    throw e;
  }
}

/** Keep the clip for replay. Best-effort: any failure returns null and the analysis is saved without a clip. */
async function storeClip(storage: Storage, userId: string, data: Uint8Array, suffix: string): Promise<string | null> {
  if (data.length === 0 || data.length > analyze.MAX_CLIP_BYTES) return null;
  const name = analyze.newClipName(suffix);
  try {
    await storage.upload(analyze.BUCKET, analyze.clipKey(userId, name), data as unknown as BodyInit, analyze.CONTENT_TYPES[suffix], false);
  } catch (e) {
    if (e instanceof SupabaseError) return null; // includes the bucket refusing it
    throw e;
  }
  return name;
}

export function register(router: Router): void {
  router.post("/api/analyze", async ({ request, services, identity }) => {
    const userId = identity.id;
    // Consent first, and before the upload is touched: with it withdrawn nothing is read, saved or sent to the model.
    const profile = await services.db.transaction((tx) => getProfile(tx, userId));
    if (!profile) return fail(NO_PROFILE, 404);
    if (!hasConsent(profile)) return refusal();

    const body = await readBytesBounded(request, UPLOAD_BODY_LIMIT); // larger is a 413, never buffered whole
    const parts = parseMultipart(body, request.headers.get("content-type") ?? "");
    const upload = partNamed(parts, "video");
    if (!upload || upload.filename === undefined || !upload.filename) return fail("Please choose a video file.", 400);
    let exercise: string;
    let suffix: string;
    try {
      exercise = analyze.cleanExercise(textOf(partNamed(parts, "exercise")));
      suffix = analyze.checkSuffix(upload.filename);
    } catch (e) {
      if (e instanceof analyze.AnalyzeRejected) return fail(e.message, 400);
      throw e;
    }
    if (upload.data.length > analyze.MAX_UPLOAD_BYTES) return fail("That request is too large.", 413);

    // Spend the use now, before the slow and expensive part; give it back if the work does not produce a result.
    const reservation = await reserveUse(services.db, services.settings, identity, analyze.FEATURE);
    if (!reservation.allowed) {
      return json({ ok: false, error: limitMessage(analyze.FEATURE, reservation.retryAfter) }, 429, { "Retry-After": String(reservation.retryAfter) });
    }
    const refund = () => release(services.db, userId, analyze.FEATURE, reservation);

    let graded;
    try {
      graded = await gradeClip(services.gemini, upload.data, suffix, exercise);
    } catch (e) {
      await refund();
      if (e instanceof FormFailure) return fail(e.message, 400);
      throw e;
    }

    let storedName: string | null = null;
    let saved: analyze.Saved;
    try {
      storedName = await storeClip(services.storage, userId, upload.data, suffix);
      saved = await services.db.transaction(async (tx) => {
        const row = await analyze.saveResult(tx, userId, graded, storedName);
        await trackUsage(tx, userId, "feature:" + analyze.FEATURE);
        return row;
      });
    } catch (e) {
      if (storedName) await services.storage.remove(analyze.BUCKET, [analyze.clipKey(userId, storedName)]); // never leave an unreferenced clip
      await refund();
      throw e;
    }

    try {
      await analyze.prune(services.db, services.storage, userId);
    } catch (e) {
      console.error("could not prune analysis history:", e instanceof Error ? e.message : e); // the analysis is saved; pruning retries next time
    }

    console.log(`analyzed ${graded.exercise_label}: ${graded.reps} reps, clip stored: ${!!storedName}`);
    const row: Row = { ...graded, id: saved.id, created_text: saved.created_text, feedback_text: graded.feedback, video_filename: storedName };
    return json(analyze.resultJson(row, await signedClipUrl(services.storage, userId, storedName)));
  });

  router.get("/api/analyze/history", async ({ services, identity }) => {
    const rows = await services.db.transaction((tx) => analyze.history(tx, identity.id));
    return json({ ok: true, entries: rows.map(analyze.entryJson) });
  });

  router.get("/api/analyze/history/<int:result_id>", async ({ services, identity, params }) => {
    const row = await services.db.transaction((tx) => analyze.getResult(tx, identity.id, Number(params.result_id)));
    if (!row) return fail("Not found.", 404);
    return json(analyze.resultJson(row, await signedClipUrl(services.storage, identity.id, row.video_filename)));
  });

  router.get("/api/analyze/latest", async ({ services, identity }) => {
    const row = await services.db.transaction((tx) => analyze.latestResult(tx, identity.id));
    if (!row) return fail("Not found.", 404);
    return json(analyze.resultJson(row, await signedClipUrl(services.storage, identity.id, row.video_filename)));
  });

  /** A short-lived link that plays the clip an analysis was run on (Range requests work, so a player can seek). */
  router.get("/api/analyze/video/<int:result_id>", async ({ services, identity, params }) => {
    const row = await services.db.transaction((tx) => analyze.getResult(tx, identity.id, Number(params.result_id)));
    const url = row ? await signedClipUrl(services.storage, identity.id, row.video_filename) : null;
    if (!url) return fail("Not found.", 404);
    return json({ ok: true, url, expires_in: SIGNED_URL_SECONDS });
  });
}
