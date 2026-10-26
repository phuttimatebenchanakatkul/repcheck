/** The app's own shapes for what a person logs. The database rows (src/data/mappers.ts) map to and from these. */

export type FoodUnit = 'g' | 'oz' | 'ml';

export interface Macros {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** A food in the shared library: per 100 g (or 100 mL). A dish also carries its recipe. */
export interface FoodItem {
  name: string;
  calories: number;
  carbs: number;
  fat: number;
  protein: number;
  ingredients?: { name: string; grams: number }[];
}

/** One ingredient of a logged dish: its own amount and its own per-100 g macros, copied at the time of logging. */
export interface Ingredient {
  name: string;
  grams: number;
  unit?: FoodUnit;
  baseCalories: number;
  baseCarbs: number;
  baseFat: number;
  baseProtein: number;
}

/**
 * A logged food. Two forms, never mixed: SIMPLE (grams, unit and the four base_* values per 100 g) or COMPOSITE (`ingredients`,
 * none of the others). Totals are always computed from the per-100 g values; none are stored.
 */
export interface NutritionEntry {
  id: string;
  food: string;
  /** Epoch ms: when it was logged (decides the hour it sits under). Independent of the day it is filed under. */
  addedAt: number;
  source?: string | null;
  grams?: number;
  unit?: FoodUnit;
  baseCalories?: number;
  baseCarbs?: number;
  baseFat?: number;
  baseProtein?: number;
  ingredients?: Ingredient[];
  /** Fields this version does not know about, kept so they survive a round trip. */
  extra?: Record<string, unknown>;
}

export interface MacroGoals {
  protein: number;
  fat: number;
  carbs: number;
}

export interface Goals extends MacroGoals {
  calories: number;
}

export interface WorkoutSet {
  reps: number | null;
  /** Both-sides mode. */
  weightKg: number | null;
  /** Each-side mode. */
  leftKg: number | null;
  rightKg: number | null;
  leftReps: number | null;
  rightReps: number | null;
  extra?: Record<string, unknown>;
}

export interface WorkoutEntry {
  id: string;
  exercise: string;
  addedAt: number;
  /** "Each side" mode. */
  unilateral: boolean;
  sets: WorkoutSet[];
  extra?: Record<string, unknown>;
}

/** A person's own exercise (created through the API): how it logs. */
export type CustomExerciseMode = 'both' | 'each' | 'either';

export interface SplitDay {
  label: string;
  exercises: string[];
}

export interface SplitPlan {
  splitType: string | null;
  daysPerWeek: number | null;
  goal: string | null;
  days: SplitDay[];
  /** monday..sunday -> a day's label, or "Rest". */
  schedule: Record<string, string>;
  /** `[label,exercise]` (JSON) -> {sets, reps}. */
  exercisePrescriptions: Record<string, { sets?: number; reps?: number }>;
}
