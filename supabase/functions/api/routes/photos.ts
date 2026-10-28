/** Weekly check-in photos. See _shared/photos.ts for the rules. */
import type { Router } from "../../_shared/app.ts";
import { getProfile } from "../../_shared/accounts.ts";
import { fail, json, readFormBounded } from "../../_shared/http.ts";
import * as photos from "../../_shared/photos.ts";
import { Refused, SupabaseError } from "../../_shared/supabaseAdmin.ts";

export const SIGNED_URL_SECONDS = 300;
// The request body is a photo plus two short fields. Stated per request: the app-wide limit is for JSON bodies.
export const UPLOAD_BODY_LIMIT = photos.MAX_PHOTO_BYTES + 64 * 1024;

const NO_PROFILE = "No profile yet. Create it first.";
const dayText = (d: Date) => d.toISOString().slice(0, 10);

export function register(router: Router): void {
  router.post("/api/checkin/photo", async ({ request, services, identity }) => {
    const userId = identity.id;
    const form = await readFormBounded(request, UPLOAD_BODY_LIMIT); // larger is a 413, never buffered whole
    const angle = form.get("angle");
    if (typeof angle !== "string" || !(photos.ANGLES as readonly string[]).includes(angle)) return fail("angle must be 'front' or 'back'.", 400);
    const upload = form.get("photo");
    if (!(upload instanceof File)) return fail("No photo uploaded.", 400);
    const data = new Uint8Array(await upload.arrayBuffer());

    let day: string;
    let extension: string;
    let contentType: string;
    try {
      const gate = await services.db.transaction(async (tx) => {
        const profile = await getProfile(tx, userId);
        if (!profile) return null;
        const checked = photos.checkDate(form.get("date"), photos.accountDay(profile));
        return { day: checked, full: await photos.count(tx, userId) >= photos.PHOTO_LIMIT };
      });
      if (gate === null) return fail(NO_PROFILE, 404);
      if (gate.full) return fail(photos.overLimitMessage(), 429); // cheap early refusal; the real, race-free check is below
      day = gate.day;
      [extension, contentType] = photos.inspectImage(data);
    } catch (e) {
      if (e instanceof photos.PhotoRejected) return fail(e.message, e.status);
      throw e;
    }

    const name = photos.newName(extension);
    const key = photos.objectKey(userId, name);
    try {
      await services.storage.upload(photos.BUCKET, key, data, contentType, false);
    } catch (e) {
      if (e instanceof Refused) return fail("That photo can't be saved. Please try a different one.", 400);
      if (e instanceof SupabaseError) return fail("We couldn't save your photo. Please try again.", 502);
      throw e;
    }

    let photoId: number | null;
    try {
      photoId = await services.db.transaction((tx) => photos.insertIfRoom(tx, userId, day, angle, name));
    } catch (e) {
      await services.storage.remove(photos.BUCKET, [key]); // never leave a file no row points at
      throw e;
    }
    if (photoId === null) {
      await services.storage.remove(photos.BUCKET, [key]);
      return fail(photos.overLimitMessage(), 429);
    }
    return json({ ok: true, id: photoId });
  });

  router.get("/api/checkin/photos", async ({ services, identity }) => {
    const rows = await services.db.transaction((tx) => photos.listPhotos(tx, identity.id));
    return json({ ok: true, photos: rows.map((r) => ({ id: r.id, date: dayText(r.date), angle: r.angle })) });
  });

  /** A short-lived link to the caller's own photo (the file is private; the link is the permission). */
  router.get("/api/checkin/photo/<int:photo_id>", async ({ services, identity, params }) => {
    const row = await services.db.transaction((tx) => photos.getPhoto(tx, identity.id, Number(params.photo_id)));
    if (!row) return fail("Not found.", 404);
    let url: string | null;
    try {
      url = await services.storage.sign(photos.BUCKET, photos.objectKey(identity.id, row.filename), SIGNED_URL_SECONDS);
    } catch (e) {
      if (e instanceof SupabaseError) return fail("We couldn't load your photo. Please try again.", 502);
      throw e;
    }
    if (url === null) return fail("Not found.", 404);
    return json({ ok: true, url, expires_in: SIGNED_URL_SECONDS });
  });

  router.delete("/api/checkin/photo/<int:photo_id>", async ({ services, identity, params }) => {
    const userId = identity.id;
    const id = Number(params.photo_id);
    const row = await services.db.transaction((tx) => photos.getPhoto(tx, userId, id));
    if (!row) return fail("Not found.", 404);
    // The file first: if it cannot be removed the photo stays listed and the delete can simply be retried.
    if ((await services.storage.remove(photos.BUCKET, [photos.objectKey(userId, row.filename)])).length) {
      return fail("We couldn't delete your photo. Please try again.", 502);
    }
    await services.db.transaction((tx) => photos.deleteRow(tx, userId, id));
    return json({ ok: true });
  });
}
