/**
 * The "it's been N days" nudge: static/coaching.js (renderInactivityBanner, getLastActivityIso) is the original. It shows once someone
 * with a coaching profile has gone three days without logging a weight or food, until they dismiss it for the day.
 */
import { daysBetween } from './dates';

export const INACTIVITY_DAYS = 3;

/**
 * Days since the last weigh-in or food log (the later of the two); with neither ever, since the profile was made. Null when there is
 * nothing to count from.
 */
export function idleDays(createdOn: string | null, latestWeightDay: string | null, latestFoodDay: string | null, today: string): number | null {
  const last = [latestWeightDay, latestFoodDay].filter((day): day is string => !!day).sort().pop() ?? createdOn;
  return last ? Math.max(0, daysBetween(last, today)) : null;
}

/** The number of idle days to tell the person about, or null: not idle enough yet, or already dismissed today. */
export function inactivityNotice(idle: number | null, noticedOn: string | null, today: string): number | null {
  if (idle === null || idle < INACTIVITY_DAYS || noticedOn === today) return null;
  return idle;
}
