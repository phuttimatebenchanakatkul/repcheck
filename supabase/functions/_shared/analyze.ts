/** AI form analysis: validate an uploaded set, grade it, keep the clip in the private `analyze-videos` bucket and the result in
 * `analyze_results`, and keep only each person's newest HISTORY_KEEP of them. `api/analyze.py` on the Edge runtime; the rules are the same:
 *   - a use is reserved before the model is called and refunded if anything fails, so simultaneous requests cannot exceed the daily limit;
 *   - the exercise name is length- and character-checked (it goes into the model's prompt);
 *   - pruning removes a stale analysis's clip through the Storage API BEFORE its row, and keeps the row if the clip will not go;
 *   - storing the clip is best-effort (the analysis is saved without a replayable clip if storage fails), and a clip over the bucket's limit
 *     is not even attempted.
 * One difference from the website: the website kept the clip it had trimmed with ffmpeg; there is no ffmpeg here, so the clip kept for replay
 * is the upload as it came (the model was still shown only the stretch that counts).
 */
import type { Db, Row, Tx } from "./db.ts";
import { pyStrip } from "./nameFilter.ts";
import { isoSql, isoUtc } from "./rows.ts";
import { splitFeedbackSections } from "./feedback.ts";
import type { Storage } from "./supabaseAdmin.ts";

export const BUCKET = "analyze-videos";
export const HISTORY_KEEP = 20; // app.py ANALYZE_HISTORY_KEEP
export const ALLOWED_EXTENSIONS = [".avi", ".m4v", ".mkv", ".mov", ".mp4"] as const; // advertised (sorted, as the message lists them)
export const RECORDED_EXTENSIONS = [".webm"] as const; // what the in-app recorder can produce
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska", ".webm": "video/webm",
};
/** The most an upload may be. The website allowed 300 MB because ffmpeg worked on disk; here the whole upload sits in memory (256 MB for the
 *  function) while it goes to the model, and the app films at 720p for at most 65 seconds, which is tens of megabytes. */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
export const MAX_CLIP_BYTES = 50 * 1024 * 1024; // the bucket's own limit; a clip over it is not stored
export const MAX_EXERCISE_LENGTH = 100;
export const FEATURE = "workout_analysis";
export const TOO_BIG = "That video is too large. Please record a shorter or lower-quality clip and try again.";

/** The message is safe to show the user. */
export class AnalyzeRejected extends Error {}

export function cleanExercise(raw: unknown): string {
  const exercise = typeof raw === "string" ? pyStrip(raw) : "";
  if (!exercise || [...exercise].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new AnalyzeRejected("Please choose an exercise.");
  if ([...exercise].length > MAX_EXERCISE_LENGTH) throw new AnalyzeRejected("That exercise name is too long.");
  return exercise;
}

/** The lower-cased extension of an upload we accept (like Python's Path(name).suffix.lower()), or AnalyzeRejected. */
export function checkSuffix(filename: string): string {
  const suffix = pathSuffix(filename).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(suffix) && !(RECORDED_EXTENSIONS as readonly string[]).includes(suffix)) {
    const shown = [...suffix].map((c) => (c.charCodeAt(0) >= 0x21 && c.charCodeAt(0) <= 0x7e ? c : "?")).join("").slice(0, 16); // short and printable, never the raw input
    throw new AnalyzeRejected(`Unsupported file type '${shown}'. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`);
  }
  return suffix;
}

/** Python's pathlib suffix: the part of the last component from its last dot, none for a leading-dot name like ".mp4" or a trailing dot. */
export function pathSuffix(filename: string): string {
  const name = filename.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : "";
}

export const newClipName = (suffix: string) => `${crypto.randomUUID().replaceAll("-", "")}${suffix}`;
export const clipKey = (userId: string, name: string) => `${userId}/${name}`;

export interface GradedSet {
  exercise_label: string;
  overall_score: number;
  stretch_score: number | null;
  squeeze_score: number | null;
  favored: string | null;
  reps: number | null;
  feedback: string;
}

export interface Saved {
  id: number;
  created_text: string;
}

/** Record a graded set. */
export async function saveResult(tx: Tx, userId: string, result: GradedSet, videoFilename: string | null): Promise<Saved> {
  const row = await tx.one<{ id: number | string; created_text: string }>(
    `insert into public.analyze_results (user_id, exercise_label, overall_score, stretch_score, squeeze_score, favored, reps, feedback_text, video_filename)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, ${isoSql("created_at")} as created_text`,
    [userId, result.exercise_label, result.overall_score, result.stretch_score, result.squeeze_score, result.favored, result.reps, result.feedback.replaceAll("\0", ""), videoFilename],
  );
  return { id: Number(row!.id), created_text: row!.created_text };
}

export async function history(tx: Tx, userId: string, limit = HISTORY_KEEP): Promise<Row[]> {
  return await tx.all(
    `select id, exercise_label, overall_score, reps, ${isoSql("created_at")} as created_text, video_filename from public.analyze_results
     where user_id = $1 order by created_at desc, id desc limit $2`,
    [userId, limit],
  );
}

const WHOLE = `select *, ${isoSql("created_at")} as created_text from public.analyze_results`;

export const getResult = (tx: Tx, userId: string, id: number) => tx.one<Row>(`${WHOLE} where user_id = $1 and id = $2`, [userId, id]);
export const latestResult = (tx: Tx, userId: string) => tx.one<Row>(`${WHOLE} where user_id = $1 order by created_at desc, id desc limit 1`, [userId]);

/** Python's int(created_at.timestamp() * 1000), from the microsecond text the database gave. */
export function createdMs(createdText: string): number {
  const [whole, fraction = ""] = createdText.split(".");
  return Date.parse(`${whole}Z`) + Number(fraction.padEnd(3, "0").slice(0, 3));
}

export function entryJson(row: Row) {
  return {
    id: Number(row.id), exercise_label: row.exercise_label, overall_score: row.overall_score, reps: row.reps,
    created_at: isoUtc(String(row.created_text)), has_video: !!row.video_filename,
  };
}

/** One stored analysis, in the shape a fresh analysis answers with. */
export function resultJson(row: Row, videoUrl: string | null) {
  return {
    ok: true, id: Number(row.id), exercise_label: row.exercise_label, overall_score: row.overall_score,
    stretch_score: row.stretch_score, squeeze_score: row.squeeze_score, favored: row.favored, reps: row.reps,
    sections: splitFeedbackSections(String(row.feedback_text), row.overall_score as number | null),
    feedback_text: row.feedback_text, created_at: isoUtc(String(row.created_text)), created_at_ms: createdMs(String(row.created_text)), video_url: videoUrl,
  };
}

/** Delete this person's analyses beyond the newest `keep`, their clips first. A clip that will not go keeps its row (the next analysis
 *  retries). A pruned analysis takes its chat thread with it (a cascade). Returns how many went. */
export async function prune(db: Db, storage: Storage, userId: string, keep = HISTORY_KEEP): Promise<number> {
  const stale = await db.transaction((tx) =>
    tx.all<{ id: number | string; video_filename: string | null }>(
      "select id, video_filename from public.analyze_results where user_id = $1 order by created_at desc, id desc offset $2",
      [userId, keep],
    )
  );
  if (!stale.length) return 0;
  const keys = new Map(stale.filter((r) => r.video_filename).map((r) => [Number(r.id), clipKey(userId, r.video_filename as string)]));
  const stuck = new Set(keys.size ? await storage.remove(BUCKET, [...keys.values()]) : []);
  const deletable = stale.map((r) => Number(r.id)).filter((id) => !stuck.has(keys.get(id) as string));
  if (deletable.length) await db.transaction((tx) => tx.exec("delete from public.analyze_results where user_id = $1 and id = any($2)", [userId, deletable]));
  return deletable.length;
}
