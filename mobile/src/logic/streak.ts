/**
 * Streaks: the run of consecutive days on which the person actually USED the app. static/streak.js is the original; same rules.
 *
 * A day counts for: logging food, a workout or a weigh-in, using the workout AI chat, running a form analysis, logging a HYROX
 * race, or any server-recorded action (a daily challenge, a check-in photo, ... via /api/activity/dates and `activity_days`).
 * Merely opening the app never counts. NOT counted on purpose: day-status overrides ("fasting" / "incomplete" marked on some other
 * day), which would let a streak be back-dated into existence.
 */
import { addDays, dayOf, daysBetween, isIsoDate, toIsoDate } from './dates';

/** Days from a list of ISO day strings (rows keyed by a date column). Anything that is not a real day is ignored. */
export function daysFromDates(dates: readonly unknown[]): string[] {
  return dates.filter(isIsoDate);
}

/** Days from instants (an ISO timestamp string or epoch ms), converted to the LOCAL day the person experienced. */
export function daysFromTimestamps(stamps: readonly unknown[]): string[] {
  const days: string[] = [];
  for (const stamp of stamps) {
    if (stamp === null || stamp === undefined) continue;
    const when = new Date(stamp as string | number);
    if (!Number.isNaN(when.getTime())) days.push(dayOf(when.getTime()));
  }
  return days;
}

export function activeDaySet(...sources: readonly (readonly string[])[]): Set<string> {
  const all = new Set<string>();
  for (const source of sources) for (const day of source) all.add(day);
  return all;
}

/**
 * Length of the run of active days ending today. If today has nothing on it YET, the run is counted from yesterday, so an ongoing
 * streak is not zeroed out before the day is over.
 */
export function currentStreak(active: ReadonlySet<string>, today: Date): number {
  let cursor = toIsoDate(today);
  if (!active.has(cursor)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (active.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** The longest run of consecutive active days ever recorded. */
export function longestStreak(active: ReadonlySet<string>): number {
  const sorted = Array.from(active).sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous !== null && daysBetween(previous, day) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }
  return best;
}

/** Whether `day` is one of the last `count` days ending today and active: for the little week dots on Home. */
export function lastDays(today: Date, count: number): string[] {
  const end = toIsoDate(today);
  return Array.from({ length: count }, (_, i) => addDays(end, i - (count - 1)));
}
