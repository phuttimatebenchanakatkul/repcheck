/**
 * The weekly check-in's rules: static/coaching.js (openCheckin, submitCheckin, checkinDaysRemaining, renderCheckinMacroRows) and the goal
 * check in templates/base.html are the originals. The adjustment itself is the server's (`POST /api/coaching/weekly-adjustment`, the
 * website's own coaching_engine / checkin_analyzer); this decides when a check-in is due, what is sent, and how the answer reads.
 */
import type { CoachingData } from './coachingProfile';
import { addDays, daysBetween } from './dates';
import { overrideFor, type DayStatus, type Override } from './nutritionHistory';

export const CHECKIN_INTERVAL_DAYS = 7;

/** The calorie change a check-in proposes, with the macros it leaves. */
export interface Adjustment {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  delta: number;
  reason: string;
}

export interface Targets {
  protein: number;
  fat: number;
  carbs: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The day when the goal weight has been reached, judged on the newest weigh-in; lose = at or under it, gain = at or over it. */
export function goalReached(profile: Pick<CoachingData, 'aspiration' | 'goalWeightKg'> | null, latestKg: number | null): boolean {
  if (!profile || profile.aspiration === 'maintain' || !profile.goalWeightKg || latestKg === null) return false;
  return profile.aspiration === 'lose' ? latestKg <= profile.goalWeightKg : latestKg >= profile.goalWeightKg;
}

/** A goal already checked in on (the profile's "handled" marker): the same goal weight and direction as now. */
export function goalHandled(profile: Pick<CoachingData, 'aspiration' | 'goalWeightKg'> | null, handled: { weightKg: number | null; aspiration: string | null }): boolean {
  return !!profile && handled.weightKg !== null && handled.weightKg === profile.goalWeightKg && handled.aspiration === profile.aspiration;
}

/**
 * Days until the next check-in is due, 0 when it is: seven days after the last one (or after the profile was made). Null with no profile.
 * Reaching the goal makes it due at once, until it has been acted on.
 */
export function checkinDaysRemaining(profile: CoachingData | null, goalDueNow: boolean, today: string): number | null {
  if (!profile) return null;
  if (goalDueNow) return 0;
  const last = profile.lastAdjustmentOn || profile.createdOn;
  if (!last) return 0;
  return Math.max(0, CHECKIN_INTERVAL_DAYS - daysBetween(last, today));
}

/** The seven days ending today, oldest first. */
export function weekDates(today: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
}

/**
 * Tapping a day cycles it between the two things it can be: a day with food between logged and incomplete, one without between not
 * logged and fasting. Returns the status it becomes and the override to store (null puts it back to automatic).
 */
export function cycleDay(current: DayStatus, hasEntries: boolean): { status: DayStatus; override: Override | null } {
  const options: DayStatus[] = hasEntries ? ['logged', 'incomplete'] : ['none', 'fasting'];
  const status = options[(options.indexOf(current) + 1) % options.length];
  return { status, override: status === 'logged' || status === 'none' ? null : overrideFor(status as 'incomplete' | 'fasting') };
}

/** The targets as the server wants them: the macros, with calories worked out the way the website does (4, 9 and 4 a gram). */
export function currentTargets(goals: Targets): Targets & { calories: number } {
  return { protein: goals.protein, fat: goals.fat, carbs: goals.carbs, calories: Math.round(goals.protein * 4 + goals.fat * 9 + goals.carbs * 4) };
}

/** The body `POST /api/coaching/weekly-adjustment` takes. */
export function checkinRequest(
  profile: CoachingData,
  targets: Targets,
  weights: readonly { day: string; kg: number }[],
  calorieDays: readonly { day: string; calories: number }[],
  photoIds: readonly number[],
): Record<string, unknown> {
  return {
    aspiration: profile.aspiration,
    gender: profile.gender,
    weight_kg: profile.weightKg,
    body_fat_range_id: profile.bodyFatRangeId,
    activity_level: profile.activityLevel,
    protein_preference: profile.proteinPreference,
    diet_preference: profile.dietPreference,
    loss_rate_pct: profile.lossRatePct,
    gain_rate_pct: profile.gainRatePct,
    current_targets: currentTargets(targets),
    week_weight_entries: weights.map((w) => ({ date: w.day, kg: w.kg })),
    week_calorie_days: calorieDays.map((d) => ({ date: d.day, calories: d.calories })),
    photo_ids: [...photoIds],
  };
}

/**
 * The server's answer: null when no change is needed ("on track"), an adjustment otherwise. `undefined` for anything that is neither,
 * so a malformed answer is not mistaken for "on track" and spend the week's check-in.
 */
export function parseAdjustment(body: unknown): Adjustment | null | undefined {
  if (!isRecord(body) || !('adjustment' in body)) return undefined;
  const a = body.adjustment;
  if (a === null) return null;
  if (!isRecord(a)) return undefined;
  const [calories, protein, fat, carbs, delta] = [num(a.calories), num(a.protein), num(a.fat), num(a.carbs), num(a.delta)];
  if (calories === null || protein === null || fat === null || carbs === null || delta === null) return undefined;
  return { calories, protein, fat, carbs, delta, reason: typeof a.reason === 'string' ? a.reason : '' };
}

export interface MacroRow {
  key: 'protein' | 'fat' | 'carbs';
  before: number;
  after: number;
  diff: number;
}

/** One row per macro: what it was, what it is, and the change, so what the adjustment touched (and what stayed put) is plain. */
export function macroRows(adjustment: Adjustment, previous: Targets | null): MacroRow[] {
  return (['protein', 'fat', 'carbs'] as const).map((key) => {
    const after = Math.round(adjustment[key]);
    const before = previous ? Math.round(previous[key]) : after;
    return { key, before, after, diff: after - before };
  });
}
