/** Coaching calculations: the profile check, and the inputs to the weekly check-in. A port of api/coaching.py (itself a port of the
 *  website's _validate_coaching_profile; a test runs the Python and this on the same inputs and requires identical output). */
import type { Tx } from "./db.ts";
import {
  FEMALE_BODY_FAT_RANGES,
  GAIN_RATE_DEFAULT_PCT,
  GAIN_RATE_MAX_PCT,
  GAIN_RATE_MIN_PCT,
  LOSS_RATE_DEFAULT_PCT,
  LOSS_RATE_MAX_PCT,
  LOSS_RATE_MIN_PCT,
  MALE_BODY_FAT_RANGES,
} from "./coachingData.ts";
import { WEEKDAYS, type Profile } from "./coachingEngine.ts";
import { pyFloat, pyInt, pyTruthy } from "./pyNumbers.ts";

export const MAX_LOG_ENTRIES = 31; // a week's weigh-ins and calorie days; a month is generous
export const MAX_CHECKIN_PHOTOS = 2; // front + back

/** `value` is one of `options`, a string only: a list or an object is simply "not one of them" rather than an error. */
const oneOf = (value: unknown, options: readonly string[]): value is string => typeof value === "string" && options.includes(value);

/** A float the way Python's float() reads a JSON value, or null (Python's TypeError / ValueError). */
function floatOrNull(value: unknown): number | null {
  const n = pyFloat(value);
  return Number.isNaN(n) ? null : n;
}

/** [profile, null] or [null, message]. The goal, gender, activity, protein and diet choices, a body-fat range that exists for that
 *  gender, a weight of 35-300 kg (below that the Katch-McArdle maths stops producing safe targets), an optional height, and the
 *  weekly rate the goal needs (an explicit null means "not supplied", exactly like an absent key). */
export function validateProfile(payload: Record<string, unknown>): [Profile, null] | [null, string] {
  const { aspiration, gender, activity_level: activity, protein_preference: protein, body_fat_range_id: bodyFat } = payload;
  const diet = pyTruthy(payload.diet_preference) ? payload.diet_preference : "balanced"; // older profiles predate the question

  if (!oneOf(aspiration, ["lose", "maintain", "gain"])) return [null, "Please choose a goal: lose, maintain, or gain weight."];
  if (!oneOf(gender, ["male", "female"])) return [null, "Please choose a gender."];
  if (!oneOf(activity, ["none", "cardio_only", "lift_only", "lift_and_cardio"])) return [null, "Please choose an activity level."];
  if (!oneOf(protein, ["low_moderate", "moderate", "high", "highest"])) return [null, "Please choose a protein intake level."];
  if (!oneOf(diet, ["balanced", "low_fat", "low_carb", "keto"])) return [null, "Please choose a diet type."];
  const validRanges = (gender === "female" ? FEMALE_BODY_FAT_RANGES : MALE_BODY_FAT_RANGES).map((r) => r.id);
  if (!oneOf(bodyFat, validRanges)) return [null, "Please choose a body type."];

  const weight = floatOrNull(payload.weight_kg);
  if (weight === null || !(35 <= weight && weight <= 300)) return [null, "Please enter a realistic weight of at least 35 kg."];

  let height: number | null = null;
  if (payload.height_cm !== undefined && payload.height_cm !== null) {
    height = floatOrNull(payload.height_cm);
    if (height === null || !(100 <= height && height <= 250)) return [null, "Please choose a realistic height."];
  }

  let loss: number | null = null;
  if (aspiration === "lose") {
    loss = floatOrNull(payload.loss_rate_pct === undefined || payload.loss_rate_pct === null ? LOSS_RATE_DEFAULT_PCT : payload.loss_rate_pct);
    if (loss === null || !(LOSS_RATE_MIN_PCT - 0.01 <= loss && loss <= LOSS_RATE_MAX_PCT + 0.01)) return [null, "Please choose a realistic weekly weight loss rate."];
  }

  let gain: number | null = null;
  if (aspiration === "gain") {
    gain = floatOrNull(payload.gain_rate_pct === undefined || payload.gain_rate_pct === null ? GAIN_RATE_DEFAULT_PCT : payload.gain_rate_pct);
    if (gain === null || !(GAIN_RATE_MIN_PCT - 0.01 <= gain && gain <= GAIN_RATE_MAX_PCT + 0.01)) return [null, "Please choose a realistic weekly weight gain rate."];
  }

  return [{
    aspiration,
    gender,
    activity_level: activity,
    protein_preference: protein,
    diet_preference: diet,
    body_fat_range_id: bodyFat,
    weight_kg: weight,
    height_cm: height,
    loss_rate_pct: loss,
    gain_rate_pct: gain,
  }, null];
}

/** The lower-case weekday names in `raw`, ignoring anything else. */
export function trainingDays(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((d): d is string => typeof d === "string").map((d) => d.toLowerCase()).filter((d) => (WEEKDAYS as readonly string[]).includes(d)));
}

/** `raw` if it is a list of at most MAX_LOG_ENTRIES objects, else null (a missing value is an empty list). */
export function boundedList(raw: unknown): Record<string, unknown>[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_LOG_ENTRIES || !raw.every((x) => x !== null && typeof x === "object" && !Array.isArray(x))) return null;
  return raw as Record<string, unknown>[];
}

export interface PhotoRow {
  id: number;
  filename: string;
}

/** The caller's own progress-photo rows for the first MAX_CHECKIN_PHOTOS usable ids, in order. An id that is not a number, or not
 *  theirs, is skipped (never an error, never someone else's photo). */
export async function ownPhotos(tx: Tx, userId: string, photoIds: unknown): Promise<PhotoRow[]> {
  const rows: PhotoRow[] = [];
  for (const raw of (Array.isArray(photoIds) ? photoIds : []).slice(0, MAX_CHECKIN_PHOTOS)) {
    if (typeof raw === "boolean") continue;
    const id = pyInt(raw);
    if (Number.isNaN(id)) continue;
    const row = await tx.one<PhotoRow>("select id, filename from public.progress_photos where id = $1 and user_id = $2", [id, userId]);
    if (row) rows.push(row);
  }
  return rows;
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp" };

/** The image type for a stored file name (the same table Python's mimetypes uses for pictures), image/jpeg when unknown. As in Python,
 *  a dot that starts the name is part of the name, not an extension: ".png" is a file called ".png", of no known type. */
export function mimeFor(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const leadingDots = base.length - base.replace(/^\.+/, "").length;
  const dot = base.lastIndexOf(".");
  return (dot > leadingDots && MIME[base.slice(dot).toLowerCase()]) || "image/jpeg";
}
