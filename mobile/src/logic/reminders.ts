/**
 * Which reminders to have waiting on the phone, and when. They are local notifications (no server, no signal needed), recomputed whenever
 * the person's data changes, so they are always for the NEXT occasion only: coming back and logging moves them out of the way.
 *
 * Two of them, the website's: "you haven't logged in a few days" (static/coaching.js maybeNotifyInactivity, which could only fire while a tab was open) and
 * "your weekly check-in is due".
 */
import { addDays, parseIso, toIsoDate } from './dates';
import { CHECKIN_INTERVAL_DAYS } from './checkin';
import { INACTIVITY_DAYS } from './inactivity';

/** The evening the "you have been away" reminder arrives, and the morning the check-in one does. */
export const INACTIVITY_HOUR = 18;
export const CHECKIN_HOUR = 9;

export type ReminderId = 'inactivity' | 'checkin';

export interface PlannedReminder {
  id: ReminderId;
  at: Date;
}

/** A local date-time: `hour` o'clock on the day `iso`, in the phone's own time zone. */
function atHour(iso: string, hour: number): Date | null {
  const day = parseIso(iso);
  return day ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour) : null;
}

export interface ReminderInput {
  now: Date;
  /** The person has a coaching profile; without one there is nothing to remind them about. */
  hasProfile: boolean;
  createdOn: string | null;
  lastAdjustmentOn: string | null;
  latestWeightDay: string | null;
  latestFoodDay: string | null;
}

/** The next time it is `hour` o'clock: later today if that is still ahead, else tomorrow. */
function nextAt(now: Date, hour: number): Date {
  const today = toIsoDate(now);
  const todayAt = atHour(today, hour) as Date;
  return todayAt.getTime() > now.getTime() ? todayAt : (atHour(addDays(today, 1), hour) as Date);
}

export function planReminders(input: ReminderInput): PlannedReminder[] {
  if (!input.hasProfile) return [];
  const now = input.now;
  const plan: PlannedReminder[] = [];

  // Away: the evening the third quiet day begins; if that has passed, the next evening (once, not every day: coming back resets it).
  const lastActivity = [input.latestWeightDay, input.latestFoodDay].filter((d): d is string => !!d).sort().pop() ?? input.createdOn;
  if (lastActivity) {
    const due = atHour(addDays(lastActivity, INACTIVITY_DAYS), INACTIVITY_HOUR);
    if (due) plan.push({ id: 'inactivity', at: due.getTime() > now.getTime() ? due : nextAt(now, INACTIVITY_HOUR) });
  }

  // Check-in: the morning it falls due. One already due (or due today and past the hour) is not reminded of: the cards in the app say so.
  const base = input.lastAdjustmentOn ?? input.createdOn;
  if (base) {
    const due = atHour(addDays(base, CHECKIN_INTERVAL_DAYS), CHECKIN_HOUR);
    if (due && due.getTime() > now.getTime()) plan.push({ id: 'checkin', at: due });
  }
  return plan;
}
