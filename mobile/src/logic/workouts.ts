/** The exercise library (generated into src/data/exercises.json) and the rules for logging sets: templates/workouts.html is the original. */
import exercisesJson from '../data/exercises.json';

import { stampOnDay, weekdayIndex } from './dates';
import type { CustomExerciseMode, SplitPlan, WorkoutEntry, WorkoutSet } from './types';

export interface Exercise {
  name: string;
  category: string;
  location: 'gym' | 'home' | 'both';
  unilateral: boolean;
  bodyweight: boolean;
  emoji?: string;
  steps?: string[];
  /** A YouTube video id. */
  video?: string;
}

interface Library {
  categories: string[];
  exercises: Exercise[];
}

const library = exercisesJson as Library;

export const EXERCISES: readonly Exercise[] = library.exercises;
export const CATEGORIES: readonly string[] = library.categories;

const BY_NAME = new Map(EXERCISES.map((e) => [e.name, e]));
const UNILATERAL = new Set(EXERCISES.filter((e) => e.unilateral).map((e) => e.name));
const BODYWEIGHT = new Set(EXERCISES.filter((e) => e.bodyweight).map((e) => e.name));

export function exerciseByName(name: string): Exercise | undefined {
  return BY_NAME.get(name);
}

/** The person's own exercises, by name, as the API returns them. */
export type CustomExerciseMeta = Record<string, { mode: CustomExerciseMode }>;

/** Whether each-side (L/R) fields CAN render: library one-sided movements, and a custom exercise made "each" or "either". */
export function canBeUnilateral(name: string, custom: CustomExerciseMeta = {}): boolean {
  if (UNILATERAL.has(name)) return true;
  const meta = custom[name];
  return !!meta && (meta.mode === 'each' || meta.mode === 'either');
}

/**
 * Whether the "Both sides / Each side" TOGGLE is offered. Not the same as canBeUnilateral: a custom exercise made "Each side" is
 * locked to each-side, so it must not offer the switch back.
 */
export function showsUnilateralToggle(name: string, custom: CustomExerciseMeta = {}): boolean {
  if (UNILATERAL.has(name)) return true;
  const meta = custom[name];
  return !!meta && meta.mode === 'either';
}

/** Bodyweight movements have no external load to record: reps only, no weight field. */
export function isBodyweight(name: string): boolean {
  return BODYWEIGHT.has(name);
}

// -- searching ------------------------------------------------------------------------------------------------------------------

export const MAX_EXERCISE_RESULTS = 30;

/**
 * Exercises matching a typed query: the person's own before the library, then favourites floated above everything else (the sort
 * is stable, so the rest keep that order), at most 30. A name that is both custom and in the library appears once, as custom.
 */
export function searchExercises(query: string, favorites: ReadonlySet<string>, customNames: readonly string[] = [], names: readonly string[] = EXERCISES.map((e) => e.name)): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const libraryMatches = names.filter((name) => !customNames.includes(name) && name.toLowerCase().includes(q));
  const customMatches = customNames.filter((name) => name.toLowerCase().includes(q));
  return [...customMatches, ...libraryMatches].sort((a, b) => (favorites.has(b) ? 1 : 0) - (favorites.has(a) ? 1 : 0)).slice(0, MAX_EXERCISE_RESULTS);
}

/** A whole-body starter set for when there is no plan: the first (most canonical) movement of each category. */
export function defaultSuggestions(limit = 6, categoryFirsts: readonly string[] = CATEGORIES.map((c) => EXERCISES.find((e) => e.category === c)?.name ?? '')): string[] {
  const picks: string[] = [];
  for (const name of categoryFirsts) {
    if (name && BY_NAME.has(name)) picks.push(name);
    if (picks.length >= limit) break;
  }
  return picks;
}

// -- sets ---------------------------------------------------------------------------------------------------------------------------

export const blankSet = (): WorkoutSet => ({ reps: null, weightKg: null, leftKg: null, rightKg: null, leftReps: null, rightReps: null });

/** One set's reps for the summary line: one number both-sides; `L/R` each-side (one number if equal); null if not filled in. */
export function setRepsDisplay(entry: Pick<WorkoutEntry, 'unilateral'>, s: WorkoutSet): string | null {
  if (entry.unilateral) {
    const l = s.leftReps;
    const r = s.rightReps;
    if (l === null && r === null) return null;
    if (l === r) return String(l);
    return `${l === null ? '-' : l}/${r === null ? '-' : r}`;
  }
  return s.reps === null ? null : String(s.reps);
}

export type Translate = (key: 'workouts.exercise.setsLogged' | 'workouts.exercise.setsReps', vars: Record<string, string | number>) => string;

/** "3 sets logged" until reps are filled in; then "3 sets · 10, 8, -". */
export function repsSummary(entry: Pick<WorkoutEntry, 'unilateral' | 'sets'>, t: Translate): string {
  const sets = entry.sets;
  const n = sets.length;
  const s = n === 1 ? '' : 's';
  const shown = sets.map((set) => setRepsDisplay(entry, set));
  if (shown.every((d) => d === null)) return t('workouts.exercise.setsLogged', { n, s });
  return t('workouts.exercise.setsReps', { n, s, reps: shown.map((d) => (d === null ? '-' : d)).join(', ') });
}

/**
 * The set "Add set" appends. Another set is almost always at the same load, so the weight carries forward (scanning back, so two
 * adds in a row still carry it through the blank one just added). Reps stay blank: that is the number that varies, and pre-filling
 * it would record a rep count nobody performed. Each side carries independently.
 */
export function newSetCarryingWeight(sets: readonly WorkoutSet[]): WorkoutSet {
  const set = blankSet();
  for (let i = sets.length - 1; i >= 0; i--) {
    const prev = sets[i];
    if (set.weightKg === null && prev.weightKg !== null) set.weightKg = prev.weightKg;
    if (set.leftKg === null && prev.leftKg !== null) set.leftKg = prev.leftKg;
    if (set.rightKg === null && prev.rightKg !== null) set.rightKg = prev.rightKg;
  }
  return set;
}

/** The heaviest weight (kg) on any set, for the collapsed card's at-a-glance line; null if none was entered. */
export function topWeightKg(entry: Pick<WorkoutEntry, 'unilateral' | 'sets'>): number | null {
  let top: number | null = null;
  for (const s of entry.sets) {
    for (const w of entry.unilateral ? [s.leftKg, s.rightKg] : [s.weightKg]) {
      if (w !== null && (top === null || w > top)) top = w;
    }
  }
  return top;
}

/** Done once every set has its rep count (both sides' counts, each-side). An exercise with no sets is not complete. */
export function entryIsComplete(entry: Pick<WorkoutEntry, 'unilateral' | 'sets'>): boolean {
  if (entry.sets.length === 0) return false;
  return entry.sets.every((s) => (entry.unilateral ? s.leftReps !== null && s.rightReps !== null : s.reps !== null));
}

export interface NewWorkoutOptions {
  id: string;
  day: string;
  now: Date;
  custom?: CustomExerciseMeta;
}

/** A new exercise on a day, with one blank set. A custom exercise made "each side" starts in each-side mode. */
export function newWorkoutEntry(exercise: string, { id, day, now, custom = {} }: NewWorkoutOptions): WorkoutEntry {
  return { id, exercise, addedAt: stampOnDay(day, now), unilateral: custom[exercise]?.mode === 'each', sets: [blankSet()] };
}

/**
 * An exercise that cannot be done one side at a time must not stay in each-side mode (left over from before it was excluded):
 * collapse it to one weight and one rep count, taking the left side's where the single fields are blank, else the right's.
 * Returns the entry itself when there is nothing to fix.
 */
export function collapseOneSided(entry: WorkoutEntry, custom: CustomExerciseMeta = {}): WorkoutEntry {
  if (!entry.unilateral || canBeUnilateral(entry.exercise, custom)) return entry;
  return {
    ...entry,
    unilateral: false,
    sets: entry.sets.map((s) => ({
      ...s,
      weightKg: s.weightKg ?? s.leftKg ?? s.rightKg,
      reps: s.reps ?? s.leftReps ?? s.rightReps,
    })),
  };
}

/** Switching both-sides <-> each-side keeps both groups of fields, so nothing typed is lost by switching back. */
export function setUnilateral(entry: WorkoutEntry, unilateral: boolean): WorkoutEntry {
  return { ...entry, unilateral };
}

// -- the split plan -----------------------------------------------------------------------------------------------------------------

export const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface TodaysSplit {
  weekdayName: string;
  label: string;
  exercises: string[];
}

/** What today's plan says, or null (no plan, a rest day, or a schedule pointing at a day that does not exist). */
export function todaysSplit(plan: SplitPlan | null | undefined, today: string): TodaysSplit | null {
  if (!plan || !plan.schedule || !plan.days) return null;
  const index = weekdayIndex(today);
  const label = plan.schedule[WEEKDAY_KEYS[index]];
  if (!label || label === 'Rest') return null;
  const day = plan.days.find((d) => d.label === label);
  if (!day) return null;
  return { weekdayName: WEEKDAY_NAMES[index], label, exercises: day.exercises };
}

/** First matching bucket wins, so the ORDER is the behaviour. */
export const SETS_REPS_BUCKETS = [
  { test: /lateral raise|rear delt|face pull|front raise/, sets: 3, repsLow: 12, repsHigh: 15 },
  { test: /curl|extension|pushdown|crusher|kickback|fly|flye|shrug|calf raise/, sets: 3, repsLow: 10, repsHigh: 12 },
  { test: /^(flat bench press|overhead press|barbell row|deadlift|back squat|front squat)$/, sets: 4, repsLow: 6, repsHigh: 8 },
  { test: /press|squat|deadlift|row|pull-?up|lat pulldown|leg press/, sets: 4, repsLow: 8, repsHigh: 10 },
] as const;
export const SETS_REPS_FALLBACK = { sets: 3, repsLow: 10, repsHigh: 12 } as const;

export function setsRepsBucket(name: string): { sets: number; repsLow: number; repsHigh: number } {
  const lower = name.toLowerCase();
  return SETS_REPS_BUCKETS.find((bucket) => bucket.test.test(lower)) ?? SETS_REPS_FALLBACK;
}

/** "4 sets • 8-10 reps". */
export function setsRepsText(name: string): string {
  const b = setsRepsBucket(name);
  return `${b.sets} sets • ${b.repsLow}-${b.repsHigh} reps`;
}
