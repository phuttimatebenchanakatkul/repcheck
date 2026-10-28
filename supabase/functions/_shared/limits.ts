/** Per-account AI usage limits, and the lifetime usage counters.
 *
 * A fixed window per (user, feature): it opens on the first use and lasts `window` seconds; once `limit` uses land in
 * it, more are refused until it elapses, and the next use opens a fresh one. A use is RESERVED atomically before the
 * expensive call and REFUNDED if the work fails, so a failed Gemini call never burns a person's scarce analysis, and
 * concurrent requests can never exceed the limit.
 */
import type { Db, Tx } from "./db.ts";
import type { Identity } from "./auth.ts";
import type { Settings } from "./settings.ts";

export const DAY = 24 * 60 * 60;

/** [uses, window in seconds]: the website's values (a test pins them against app.py). */
export const RATE_LIMITS = {
  workout_analysis: [1, DAY],
  food_analysis: [1, DAY],
  ai_chat: [3, DAY], // the coach, analysis follow-ups and workout chat share this one bucket
  split_generation: [1, DAY],
  hyrox_analysis: [8, 5 * 60 * 60],
  // The weekly check-in may call the model with photos. Past the limit it still completes with the deterministic
  // adjustment, so a limited person loses only the AI refinement.
  checkin_analysis: [5, DAY],
} as const satisfies Record<string, readonly [number, number]>;

export type Feature = keyof typeof RATE_LIMITS;

export interface Reservation {
  allowed: boolean;
  /** Seconds until the window resets, when refused. */
  retryAfter: number;
  /** The window the use was charged to (null: exempt, nothing was charged). */
  windowStart: number | null;
}

export const EXEMPT: Reservation = { allowed: true, retryAfter: 0, windowStart: null };

export function isExempt(settings: Settings, identity: Identity): boolean {
  return !!identity.email && settings.rateLimitExempt.has(identity.email.toLowerCase());
}

/** A short human phrase for how long until the window resets. */
export function friendlyWait(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.round(seconds / 3600); // at least an hour here, so at least 1
    return `about ${hours} hour${hours !== 1 ? "s" : ""}`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `about ${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

/** Spend one use of `feature` if the window has room, in a single statement (the row is locked while it runs, so
 *  simultaneous calls are serialised). A refused reservation says how long to wait. */
export function reserve(tx: Tx, userId: string, feature: Feature, now?: number): Promise<Reservation> {
  const [limit, window] = RATE_LIMITS[feature];
  return reserveWindow(tx, userId, feature, limit, window, now);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function reserveWindow(
  tx: Tx,
  userId: string,
  feature: string,
  limit: number,
  window: number,
  now: number = nowSeconds(),
): Promise<Reservation> {
  now = Math.trunc(now);
  const row = await tx.one<{ window_start: number }>(
    `insert into public.rate_limits (user_id, feature, window_start, count) values ($1, $2, $3, 1)
     on conflict (user_id, feature) do update set
         window_start = case when $3::bigint - rate_limits.window_start >= $4::bigint then $3::bigint else rate_limits.window_start end,
         count        = case when $3::bigint - rate_limits.window_start >= $4::bigint then 1 else rate_limits.count + 1 end
     where $3::bigint - rate_limits.window_start >= $4::bigint or rate_limits.count < $5::integer
     returning window_start`,
    [userId, feature, now, window, limit],
  );
  if (row) return { allowed: true, retryAfter: 0, windowStart: Number(row.window_start) };
  const current = await tx.one<{ window_start: number }>(
    "select window_start from public.rate_limits where user_id = $1 and feature = $2",
    [userId, feature],
  );
  const started = current ? Number(current.window_start) : now;
  return { allowed: false, retryAfter: Math.max(1, window - (now - started)), windowStart: null };
}

/** Give a reserved use back (the work failed). Only if the window is still the one it was charged to: a use reserved
 *  in a window that has since rolled over is not a use of the new window. */
export async function refund(tx: Tx, userId: string, feature: string, reservation: Reservation): Promise<void> {
  if (reservation.windowStart === null) return;
  await tx.exec(
    `update public.rate_limits set count = greatest(count - 1, 0)
     where user_id = $1 and feature = $2 and window_start = $3`,
    [userId, feature, reservation.windowStart],
  );
}

const attemptKey = (exercise: string, now: number = nowSeconds()) =>
  `challenge:${exercise}:${new Date(Math.trunc(now) * 1000).toISOString().slice(0, 10)}`;

/** The one challenge attempt per exercise per UTC day, held while the clip is graded so that simultaneous submissions
 *  cannot both reach the model. The key carries the day, so it resets at midnight UTC exactly as the saved-attempt
 *  check does; earlier days' keys are swept as a new one is taken. */
export async function reserveDailyAttempt(tx: Tx, userId: string, exercise: string, now: number = nowSeconds()): Promise<Reservation> {
  now = Math.trunc(now);
  const key = attemptKey(exercise, now);
  await tx.exec(
    "delete from public.rate_limits where user_id = $1 and feature like 'challenge:%' and feature not like $2",
    [userId, "%:" + key.slice(key.lastIndexOf(":") + 1)],
  );
  return reserveWindow(tx, userId, key, 1, DAY, now);
}

/** Give the attempt back (the clip could not be graded), so a failed upload does not use up the day's attempt. */
export function releaseDailyAttempt(tx: Tx, userId: string, exercise: string, reservation: Reservation, now?: number): Promise<void> {
  return refund(tx, userId, attemptKey(exercise, now), reservation);
}

export function limitMessage(feature: Feature, retryAfter: number): string {
  const uses = RATE_LIMITS[feature][0];
  if (feature === "workout_analysis") {
    const plural = uses === 1 ? "analysis" : "analyses";
    return `You've used your ${uses} workout ${plural} for now — try again in ${friendlyWait(retryAfter)}.`;
  }
  return `You've reached your limit for now — try again in ${friendlyWait(retryAfter)}.`;
}

/** Lifetime counter for the admin activity view; counts every account, exempt ones included. */
export async function trackUsage(tx: Tx, userId: string, event: string): Promise<void> {
  await tx.exec(
    `insert into public.usage_events (user_id, event, count, last_at) values ($1, $2, 1, now())
     on conflict (user_id, event) do update set count = usage_events.count + 1, last_at = now()`,
    [userId, event],
  );
}

/** Lifetime counter for the admin view, in a transaction of its own. Best-effort: losing a counter must not fail a request that succeeded. */
export async function track(db: Db, userId: string, event: string): Promise<void> {
  try {
    await db.transaction((tx) => trackUsage(tx, userId, "feature:" + event));
  } catch {
    console.error("could not count", event);
  }
}
