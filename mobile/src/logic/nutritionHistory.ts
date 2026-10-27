/**
 * Day statuses (the Logging History page) and the week's calories (Full stats): static/coaching.js's getDayStatus and
 * templates/logging_history.html / full_stats.html are the originals.
 */

export type DayStatus = 'logged' | 'fasting' | 'incomplete' | 'none';
export type Override = 'fasting' | 'incomplete';

/** A day is "logged" once it has a food entry, "none" otherwise; a fasting / incomplete mark overrides either. */
export function dayStatus(hasEntries: boolean, override: string | null | undefined): DayStatus {
  if (override === 'fasting' || override === 'incomplete') return override;
  return hasEntries ? 'logged' : 'none';
}

export interface StatusOption {
  /** What choosing it does to the stored override. */
  choice: 'logged' | 'incomplete' | 'fasting';
  /** Translation key of its label. */
  labelKey: 'coaching.status.logged.title' | 'coaching.status.incomplete.title' | 'coaching.status.notLogged.title' | 'coaching.status.fasting.title';
}

/** The two things a day can be marked, depending on whether it has food: a day with food can be left as logged or marked incomplete; one without can be left as not logged or marked fasting. */
export function statusOptions(hasEntries: boolean): [StatusOption, StatusOption] {
  return hasEntries
    ? [
        { choice: 'logged', labelKey: 'coaching.status.logged.title' },
        { choice: 'incomplete', labelKey: 'coaching.status.incomplete.title' },
      ]
    : [
        { choice: 'logged', labelKey: 'coaching.status.notLogged.title' },
        { choice: 'fasting', labelKey: 'coaching.status.fasting.title' },
      ];
}

/** The override to store for a choice: "logged" clears it (back to automatic), the others are stored. */
export const overrideFor = (choice: StatusOption['choice']): Override | null => (choice === 'logged' ? null : choice);

export type StatusCounts = Record<DayStatus, number>;

/** A month's counts by status; days after today count as nothing. */
export function statusCounts(days: readonly string[], today: string, statusOf: (day: string) => DayStatus): StatusCounts {
  const counts: StatusCounts = { logged: 0, fasting: 0, incomplete: 0, none: 0 };
  for (const day of days) if (day <= today) counts[statusOf(day)]++;
  return counts;
}

// -- Full stats ------------------------------------------------------------------------------------------------------------------------

/** A day counts as "on target" when its calories are within this fraction of the goal. */
export const ON_TARGET_TOLERANCE = 0.1;

export interface WeekDay {
  day: string;
  calories: number;
  hasData: boolean;
}

/** The mean calories of the days with food (rounded), how many of those landed within 10% of the goal, and how many had food. */
export function weekStats(days: readonly WeekDay[], goal: number): { average: number | null; onTarget: number; logged: number } {
  const logged = days.filter((d) => d.hasData);
  const average = logged.length ? Math.round(logged.reduce((sum, d) => sum + d.calories, 0) / logged.length) : null;
  const onTarget = logged.filter((d) => Math.abs(d.calories - goal) <= goal * ON_TARGET_TOLERANCE).length;
  return { average, onTarget, logged: logged.length };
}

/** The chart's vertical scale: a little above the taller of the goal and the biggest day (1 if everything is zero). */
export function chartScale(days: readonly WeekDay[], goal: number): number {
  const peak = Math.max(goal, ...days.map((d) => d.calories));
  return peak > 0 ? peak * 1.08 : 1;
}

/** A bar's or the goal line's height as a percentage of the chart. */
export const heightPercent = (value: number, scale: number): number => (value / scale) * 100;
