/** Weekly check-in progress photos: validate, store in the private `progress-photos` bucket, record in `progress_photos`.
 *
 * The rules are the website's, with three deliberate differences (as in the Flask version this ports):
 *   - the stored type and extension come from what the bytes VERIFY as, not from the filename the caller chose;
 *   - the 500-photo ceiling is enforced under a per-user lock, so two uploads racing at 499 cannot both land;
 *   - deleting removes the file BEFORE the row, so a removal that fails leaves the photo visible and retryable instead of
 *     an invisible file nobody can delete.
 *
 * Object key: '<user id>/<32 hex>.<jpg|png|webp>'. The database row is the only index of it; the app reads its own rows
 * and files directly (row-level security) and uses the API only to write.
 */
import type { Tx } from "./db.ts";
import { pyStrip } from "./nameFilter.ts";

export const PHOTO_LIMIT = 500; // database.py PER_USER_LIMITS["progress_photos"]
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // app.py MAX_PHOTO_BYTES; also the bucket's own limit
export const BUCKET = "progress-photos";
export const ANGLES = ["front", "back"] as const;
/** More pixels than this and Pillow (which the Flask version used) refuses to open the picture at all: twice its warning threshold. */
export const MAX_PIXELS = 2 * 89_478_485;

/** The message is safe to show the user; `status` is the HTTP status to answer with. */
export class PhotoRejected extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const utcToday = (): Date => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const dayText = (d: Date) => d.toISOString().slice(0, 10);

/** The UTC calendar day the account was created. */
export const accountDay = (profile: { created_at: Date }): string => dayText(profile.created_at);

/** The check-in day (YYYY-MM-DD), or PhotoRejected. This field feeds the streak (every distinct photo date is an active day),
 *  so an unbounded value would let a user invent streak history: no later than tomorrow (the client's local day can run a
 *  day ahead of the server's), no earlier than the day the account was created. */
export function checkDate(raw: unknown, accountCreated: string | null): string {
  const text = pyStrip(String(raw ?? ""));
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text)) throw new PhotoRejected("Invalid date.");
  const day = new Date(text + "T00:00:00Z");
  if (Number.isNaN(day.getTime()) || dayText(day) !== text) throw new PhotoRejected("Invalid date."); // 2026-02-30 is not a day
  const tomorrow = new Date(utcToday().getTime() + 86_400_000);
  if (day > tomorrow) throw new PhotoRejected("Invalid date.");
  if (accountCreated && text < accountCreated) throw new PhotoRejected("Invalid date.");
  return text;
}

// ---- looking inside an image ----------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xFFFFFFFF;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const be32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const le32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

type Size = [width: number, height: number];

/** PNG: the signature, then every chunk with its CRC checked, IHDR first and IEND last (what Pillow's verify() does). */
export function pngSize(b: Uint8Array): Size | null {
  let at = 8;
  let size: Size | null = null;
  let first = true;
  while (at + 8 <= b.length) {
    const length = be32(b, at);
    const type = ascii(b, at + 4, 4);
    if (type === "IEND" && !first) return size; // like Pillow's verify(), the end marker is not itself checked
    const end = at + 8 + length;
    if (end + 4 > b.length) return null; // a chunk that runs off the end
    if (crc32(b, at + 4, end) !== be32(b, end)) return null;
    if (first) {
      if (type !== "IHDR" || length !== 13) return null;
      size = [be32(b, at + 8), be32(b, at + 12)];
      first = false;
    }
    at = end + 4;
  }
  return null; // no IEND: cut off
}

/** JPEG: markers up to the first start-of-frame, which holds the size. */
export function jpegSize(b: Uint8Array): Size | null {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xFF) return null;
    const marker = b[at + 1];
    if (marker === 0xFF) { // fill byte
      at += 1;
      continue;
    }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { // markers with no length
      at += 2;
      continue;
    }
    if (marker === 0xD9 || marker === 0xDA) return null; // the image ended or its data began with no frame header
    const length = be16(b, at + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isFrame) {
      if (length < 8 || at + 9 > b.length) return null;
      return [be16(b, at + 7), be16(b, at + 5)];
    }
    at += 2 + length;
  }
  return null;
}

/** WebP: a RIFF file whose first chunk is lossy (VP8 ), lossless (VP8L) or extended (VP8X). */
export function webpSize(b: Uint8Array): Size | null {
  if (b.length < 20 || le32(b, 4) + 8 > b.length) return null;
  const kind = ascii(b, 12, 4);
  const size = le32(b, 16);
  if (20 + size > b.length) return null;
  if (kind === "VP8X") return size >= 10 ? [le24(b, 24) + 1, le24(b, 27) + 1] : null;
  if (kind === "VP8L") return size >= 5 && b[20] === 0x2F ? [(((b[22] & 0x3F) << 8) | b[21]) + 1, ((((b[24] & 0x0F) << 10) | (b[23] << 2) | (b[22] >> 6))) + 1] : null;
  if (kind === "VP8 ") {
    if (size < 10 || b[23] !== 0x9D || b[24] !== 0x01 || b[25] !== 0x2A) return null;
    return [(b[26] | (b[27] << 8)) & 0x3FFF, (b[28] | (b[29] << 8)) & 0x3FFF];
  }
  return null;
}

const OTHER_IMAGE_SIGNATURES: [string, (b: Uint8Array) => boolean][] = [
  ["GIF", (b) => ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a"],
  ["BMP", (b) => ascii(b, 0, 2) === "BM"],
  ["TIFF", (b) => ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*"],
  ["ICO", (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0],
  ["HEIF", (b) => ascii(b, 4, 4) === "ftyp"],
];

/** [extension, content type] of an image this app accepts, from the bytes alone, or PhotoRejected. */
export function inspectImage(data: Uint8Array): [string, string] {
  if (!data.length) throw new PhotoRejected("No photo uploaded.");
  if (data.length > MAX_PHOTO_BYTES) {
    throw new PhotoRejected(`That photo is too large. Please keep it under ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`, 413);
  }
  const unreadable = () => new PhotoRejected("That file isn't a readable image.");
  let result: [string, string];
  let size: Size | null;
  if (data[0] === 0x89 && ascii(data, 1, 3) === "PNG" && data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A) {
    result = [".png", "image/png"];
    size = pngSize(data);
  } else if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    result = [".jpg", "image/jpeg"];
    size = jpegSize(data);
  } else if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") {
    result = [".webp", "image/webp"];
    size = webpSize(data);
  } else if (data.length >= 12 && OTHER_IMAGE_SIGNATURES.some(([, is]) => is(data))) {
    throw new PhotoRejected("Unsupported image format.");
  } else {
    throw unreadable();
  }
  if (size === null || size[0] < 1 || size[1] < 1 || size[0] * size[1] > MAX_PIXELS) throw unreadable();
  return result;
}

export const newName = (extension: string): string => crypto.randomUUID().replaceAll("-", "") + extension;
export const objectKey = (userId: string, name: string): string => `${userId}/${name}`;

// ---- the database ---------------------------------------------------------------------------------------------------

export async function count(tx: Tx, userId: string): Promise<number> {
  const row = await tx.one<{ n: number | string }>("select count(*) as n from public.progress_photos where user_id = $1", [userId]);
  return Number(row!.n);
}

export const overLimitMessage = (): string => `You've reached the maximum of ${PHOTO_LIMIT.toLocaleString("en-US")} saved items here. Delete some to add more.`;

/** Serialise one user's photo writes. Held until the end of this transaction, which is the only kind of lock the transaction pooler allows. */
export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.exec("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [`progress_photos:${userId}`]);
}

/** Record the photo unless the user is at the ceiling. Returns the new id or null. */
export async function insertIfRoom(tx: Tx, userId: string, day: string, angle: string, name: string): Promise<number | null> {
  await lockUser(tx, userId);
  if (await count(tx, userId) >= PHOTO_LIMIT) return null;
  const row = await tx.one<{ id: number }>(
    "insert into public.progress_photos (user_id, date, angle, filename) values ($1, $2::date, $3, $4) returning id",
    [userId, day, angle, name],
  );
  return row!.id;
}

export function listPhotos(tx: Tx, userId: string) {
  return tx.all<{ id: number; date: Date; angle: string }>(
    "select id, date, angle from public.progress_photos where user_id = $1 order by date desc, angle asc",
    [userId],
  );
}

/** The caller's own photo row, or null. (Scoped by user in SQL: this connection bypasses row-level security.) */
export function getPhoto(tx: Tx, userId: string, photoId: number) {
  return tx.one<{ id: number; date: Date; angle: string; filename: string }>(
    "select id, date, angle, filename from public.progress_photos where id = $1 and user_id = $2",
    [photoId, userId],
  );
}

export async function deleteRow(tx: Tx, userId: string, photoId: number): Promise<void> {
  await tx.exec("delete from public.progress_photos where id = $1 and user_id = $2", [photoId, userId]);
}
