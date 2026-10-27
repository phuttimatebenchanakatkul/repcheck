/**
 * What the workout chat is told about the person's training: the website's `buildRecentWorkoutSummary` (templates/workouts.html), line
 * for line. The model recites the numbers in this text before it gives progressive-overload advice, so it has to be exact: the last
 * seven calendar days as a short overview, then for each exercise (the 30 touched most recently) its last four sessions with every set.
 */
import { addDays } from './dates';
import { kgToDisplay, weightUnitLabel, type UnitPrefs } from './units';
import { isBodyweight } from './workouts';
import type { WorkoutEntry, WorkoutSet } from './types';

export type LoggedWorkout = WorkoutEntry & { day: string };

export const RECENT_DAYS = 7;
/** Per exercise, how many of its most recent sessions to recite: a COUNT of occurrences, not a calendar window. */
export const EXERCISE_HISTORY_SESSIONS = 4;
/** Bounds the history to the exercises touched most recently, so a long-time user's whole catalogue does not bloat every request. */
export const MAX_EXERCISES_IN_HISTORY = 30;

export type DayWords = (key: 'workouts.plan.today' | 'workouts.day.yesterday') => string;

const blank = (v: unknown) => v === '' || v === null || v === undefined;

/** "Today", "Yesterday", or a friendly date such as "Sunday, 25 Oct". */
export function dayLabelFor(iso: string, today: string, words: DayWords, locale: string): string {
  if (iso === today) return words('workouts.plan.today');
  if (iso === addDays(today, -1)) return words('workouts.day.yesterday');
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' });
}

/** One set as the model reads it (in the person's own units), or null for a set with no reps. */
export function describeSet(entry: Pick<WorkoutEntry, 'exercise' | 'unilateral'>, set: WorkoutSet, units: UnitPrefs): string | null {
  const unit = weightUnitLabel(units);
  if (entry.unilateral) {
    if (blank(set.leftReps) && blank(set.rightReps)) return null;
    const leftWeight = !blank(set.leftKg) ? `${kgToDisplay(set.leftKg as number, units)}${unit} ` : '';
    const rightWeight = !blank(set.rightKg) ? `${kgToDisplay(set.rightKg as number, units)}${unit} ` : '';
    const leftReps = blank(set.leftReps) ? '-' : set.leftReps;
    const rightReps = blank(set.rightReps) ? '-' : set.rightReps;
    return `L ${leftWeight}x ${leftReps} reps, R ${rightWeight}x ${rightReps} reps`;
  }
  if (blank(set.reps)) return null;
  if (isBodyweight(entry.exercise)) return `${set.reps} reps (bodyweight)`;
  const weightPart = !blank(set.weightKg) ? `${kgToDisplay(set.weightKg as number, units)}${unit} ` : '';
  return `${weightPart}x ${set.reps} reps`;
}

/** The last seven calendar days, entries only: no "nothing logged" filler. */
export function recentDaysOverview(entries: readonly LoggedWorkout[], today: string, words: DayWords, locale: string): string {
  const lines: string[] = [];
  for (let i = RECENT_DAYS - 1; i >= 0; i--) {
    const iso = addDays(today, -i);
    const ofDay = entries.filter((e) => e.day === iso).sort((a, b) => a.addedAt - b.addedAt);
    if (!ofDay.length) continue;
    lines.push(`${dayLabelFor(iso, today, words, locale)} (${iso}): ${ofDay.map((e) => e.exercise).join(', ')}`);
  }
  return lines.length ? lines.join('\n') : '(No workouts logged in the last 7 days.)';
}

/** For each exercise logged, its most recent sessions with the exact sets: the numbers the model recites rather than guesses. */
export function exerciseHistorySection(entries: readonly LoggedWorkout[], today: string, units: UnitPrefs, words: DayWords, locale: string): string {
  const byExercise = new Map<string, LoggedWorkout[]>();
  for (const entry of entries) {
    const list = byExercise.get(entry.exercise);
    if (list) list.push(entry);
    else byExercise.set(entry.exercise, [entry]);
  }
  if (!byExercise.size) return '(No exercises logged yet.)';

  const exercises = Array.from(byExercise.entries()).map(([exercise, occurrences]) => {
    // Most recent first: day descending, then added-time descending for several sessions of one exercise on a day.
    occurrences.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : b.addedAt - a.addedAt));
    return { exercise, occurrences, mostRecentDate: occurrences[0].day };
  });
  // The website's comparator, tie for tie: exercises last touched on the same day have no meaningful order.
  exercises.sort((a, b) => (a.mostRecentDate < b.mostRecentDate ? 1 : -1));

  const lines: string[] = [];
  for (const { exercise, occurrences } of exercises.slice(0, MAX_EXERCISES_IN_HISTORY)) {
    lines.push(`${exercise}:`);
    for (const entry of occurrences.slice(0, EXERCISE_HISTORY_SESSIONS)) {
      const described = entry.sets.map((s) => describeSet(entry, s, units)).filter((d): d is string => !!d);
      lines.push(`- ${dayLabelFor(entry.day, today, words, locale)} (${entry.day}): ${described.length ? described.join('; ') : 'no sets recorded'}`);
    }
  }
  return lines.join('\n');
}

/** The whole `workout_summary` the workout chat sends with each question. */
export function buildWorkoutSummary(entries: readonly LoggedWorkout[], today: string, units: UnitPrefs, words: DayWords, locale: string): string {
  return (
    `Workouts logged in the last 7 days:\n${recentDaysOverview(entries, today, words, locale)}\n\n` +
    `Exercise history (last ${EXERCISE_HISTORY_SESSIONS} sessions each):\n${exerciseHistorySection(entries, today, units, words, locale)}`
  );
}
