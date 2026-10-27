/**
 * Database rows <-> the app's own shapes. Rows are snake_case with `timestamptz` strings; the app uses camelCase and epoch ms.
 *
 * Two rules every writer here follows:
 *  - A row is written WHOLE, every column spelled out (NULL for absent). The write is an upsert, so a dish converted from a simple
 *    food must NULL the simple columns rather than leave stale ones behind.
 *  - What the database stores as `extra` (fields a version of the importer or the app did not recognise) is carried through
 *    unchanged, so editing a row never discards something another version put there.
 */
import type { Database, Json } from '@/supabase/database.types';

import { cleanSources, type ChatTurn } from '../logic/chat';
import { normaliseGoals, isFoodUnit, num } from '../logic/macros';
import type { Goals, Ingredient, NutritionEntry, SplitPlan, WorkoutEntry, WorkoutSet } from '../logic/types';
import { resolveUnits, type UnitPrefs } from '../logic/units';

type Tables = Database['public']['Tables'];
export type Row<T extends keyof Tables> = Tables[T]['Row'];
export type NewRow<T extends keyof Tables> = Tables[T]['Insert'];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extraOf(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** An integer column: a whole, non-negative number, or null. */
function wholeOrNull(value: unknown, max: number): number | null {
  const n = finite(value);
  return n === null || n < 0 ? null : Math.min(max, Math.round(n));
}

/** A load in kg: finite and not negative, or null. */
function loadOrNull(value: unknown): number | null {
  const n = finite(value);
  return n === null || n < 0 ? null : n;
}

export const MAX_REPS = 10_000;

/** `timestamptz` text -> epoch ms (0 if unreadable, so it sorts first rather than crashing a screen). */
export function toMs(value: unknown): number {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

export function toTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

// -- food log ---------------------------------------------------------------------------------------------------------------------

function ingredientFromJson(raw: unknown): Ingredient | null {
  if (!isObject(raw) || typeof raw.name !== 'string') return null;
  const ingredient: Ingredient = {
    name: raw.name,
    grams: num(raw.grams),
    baseCalories: num(raw.baseCalories),
    baseCarbs: num(raw.baseCarbs),
    baseFat: num(raw.baseFat),
    baseProtein: num(raw.baseProtein),
  };
  if (isFoodUnit(raw.unit)) ingredient.unit = raw.unit;
  return ingredient;
}

function ingredientToJson(i: Ingredient): Json {
  return { name: i.name, grams: num(i.grams), unit: i.unit ?? 'g', baseCalories: num(i.baseCalories), baseCarbs: num(i.baseCarbs), baseFat: num(i.baseFat), baseProtein: num(i.baseProtein) };
}

export function nutritionRowToEntry(row: Row<'nutrition_entries'>): NutritionEntry {
  const entry: NutritionEntry = { id: row.id, food: row.food, addedAt: toMs(row.added_at) };
  if (row.source) entry.source = row.source;
  if (Array.isArray(row.ingredients)) {
    entry.ingredients = row.ingredients.map(ingredientFromJson).filter((i): i is Ingredient => i !== null);
  } else {
    if (row.grams !== null) entry.grams = row.grams;
    if (isFoodUnit(row.unit)) entry.unit = row.unit;
    if (row.base_calories !== null) entry.baseCalories = row.base_calories;
    if (row.base_carbs !== null) entry.baseCarbs = row.base_carbs;
    if (row.base_fat !== null) entry.baseFat = row.base_fat;
    if (row.base_protein !== null) entry.baseProtein = row.base_protein;
  }
  const extra = extraOf(row.extra);
  if (Object.keys(extra).length) entry.extra = extra;
  return entry;
}

export function nutritionEntryToRow(userId: string, day: string, entry: NutritionEntry): NewRow<'nutrition_entries'> {
  const dish = !!entry.ingredients && entry.ingredients.length > 0;
  return {
    user_id: userId,
    id: entry.id,
    log_date: day,
    food: entry.food,
    added_at: toTimestamp(entry.addedAt),
    source: entry.source ?? null,
    grams: dish ? null : finite(entry.grams),
    unit: dish ? null : (entry.unit ?? 'g'),
    base_calories: dish ? null : finite(entry.baseCalories),
    base_carbs: dish ? null : finite(entry.baseCarbs),
    base_fat: dish ? null : finite(entry.baseFat),
    base_protein: dish ? null : finite(entry.baseProtein),
    ingredients: dish ? (entry.ingredients as Ingredient[]).map(ingredientToJson) : null,
    extra: (entry.extra ?? {}) as Json,
  };
}

// -- workouts ------------------------------------------------------------------------------------------------------------------------

export function workoutSetFromRow(row: Row<'workout_sets'>): WorkoutSet {
  const set: WorkoutSet = {
    reps: row.reps,
    weightKg: row.weight_kg,
    leftKg: row.left_kg,
    rightKg: row.right_kg,
    leftReps: row.left_reps,
    rightReps: row.right_reps,
  };
  const extra = extraOf(row.extra);
  if (Object.keys(extra).length) set.extra = extra;
  return set;
}

export function workoutRowsToEntry(row: Row<'workout_entries'>, setRows: readonly Row<'workout_sets'>[]): WorkoutEntry {
  const entry: WorkoutEntry = {
    id: row.id,
    exercise: row.exercise,
    addedAt: toMs(row.added_at),
    unilateral: row.unilateral === true,
    sets: setRows.filter((s) => s.entry_id === row.id).sort((a, b) => a.position - b.position).map(workoutSetFromRow),
  };
  const extra = extraOf(row.extra);
  if (Object.keys(extra).length) entry.extra = extra;
  return entry;
}

export function workoutEntryToRow(userId: string, day: string, entry: WorkoutEntry): NewRow<'workout_entries'> {
  return { user_id: userId, id: entry.id, log_date: day, exercise: entry.exercise, added_at: toTimestamp(entry.addedAt), unilateral: entry.unilateral, extra: (entry.extra ?? {}) as Json };
}

export function workoutSetToRow(userId: string, entryId: string, position: number, set: WorkoutSet): NewRow<'workout_sets'> {
  return {
    user_id: userId,
    entry_id: entryId,
    position,
    reps: wholeOrNull(set.reps, MAX_REPS),
    weight_kg: loadOrNull(set.weightKg),
    left_kg: loadOrNull(set.leftKg),
    right_kg: loadOrNull(set.rightKg),
    left_reps: wholeOrNull(set.leftReps, MAX_REPS),
    right_reps: wholeOrNull(set.rightReps, MAX_REPS),
    extra: (set.extra ?? {}) as Json,
  };
}

// -- body, goals, settings, plan ------------------------------------------------------------------------------------------------------

export interface WeightEntry {
  day: string;
  kg: number;
  loggedAt: number;
}

export const MAX_WEIGHT_KG = 400;

export function weightFromRow(row: Row<'weight_entries'>): WeightEntry {
  return { day: row.log_date, kg: row.kg, loggedAt: toMs(row.logged_at) };
}

/** A weigh-in for a day, or null if the figure is outside what the database allows (more than 0 and at most 400 kg). */
export function weightToRow(userId: string, entry: WeightEntry): NewRow<'weight_entries'> | null {
  if (!Number.isFinite(entry.kg) || entry.kg <= 0 || entry.kg > MAX_WEIGHT_KG) return null;
  return { user_id: userId, log_date: entry.day, kg: entry.kg, logged_at: toTimestamp(entry.loggedAt), extra: {} };
}

export function goalsFromRow(row: Row<'nutrition_goals'> | null | undefined): Goals {
  return normaliseGoals(row ? { protein: row.protein, fat: row.fat, carbs: row.carbs } : null);
}

/** The database holds whole grams, so the macros are rounded on the way in (calories are never stored). */
export function goalsToRow(userId: string, goals: Pick<Goals, 'protein' | 'fat' | 'carbs'>, extra: Json = {}): NewRow<'nutrition_goals'> {
  const clean = normaliseGoals(goals);
  return { user_id: userId, protein: Math.round(clean.protein), fat: Math.round(clean.fat), carbs: Math.round(clean.carbs), extra };
}

export interface AppSettings {
  units: UnitPrefs;
  language: 'en' | 'th' | null;
  theme: 'light' | 'dark' | null;
}

export function settingsFromRow(row: Row<'user_settings'> | null | undefined): AppSettings {
  return {
    units: resolveUnits(row ? { weight: row.units_weight, height: row.units_height, distance: row.units_distance, clock: row.units_clock } : null),
    language: row?.language === 'en' || row?.language === 'th' ? row.language : null,
    theme: row?.theme === 'light' || row?.theme === 'dark' ? row.theme : null,
  };
}

/** The whole settings row. `base` is the row as last read, so what this version does not manage (HYROX preferences, extra) survives. */
export function settingsToRow(userId: string, settings: AppSettings, base?: Row<'user_settings'> | null): NewRow<'user_settings'> {
  return {
    user_id: userId,
    theme: settings.theme,
    language: settings.language,
    units_weight: settings.units.weight,
    units_height: settings.units.height,
    units_distance: settings.units.distance,
    units_clock: settings.units.clock,
    hyrox_leaderboard_gender: base?.hyrox_leaderboard_gender ?? null,
    hyrox_facility_lane_m: base?.hyrox_facility_lane_m ?? null,
    hyrox_history_backfilled: base?.hyrox_history_backfilled ?? false,
    extra: base?.extra ?? {},
  };
}

export function splitPlanFromRow(row: Row<'split_plans'> | null | undefined): SplitPlan | null {
  if (!row) return null;
  const days = Array.isArray(row.days)
    ? (row.days as unknown[]).filter(isObject).map((d) => ({ label: String(d.label ?? ''), exercises: Array.isArray(d.exercises) ? d.exercises.filter((e): e is string => typeof e === 'string') : [] }))
    : [];
  const schedule: Record<string, string> = {};
  if (isObject(row.schedule)) for (const [key, value] of Object.entries(row.schedule)) if (typeof value === 'string') schedule[key] = value;
  const prescriptions: SplitPlan['exercisePrescriptions'] = {};
  if (isObject(row.exercise_prescriptions)) {
    for (const [key, value] of Object.entries(row.exercise_prescriptions)) {
      if (isObject(value)) prescriptions[key] = { sets: finite(value.sets) ?? undefined, reps: finite(value.reps) ?? undefined };
    }
  }
  return { splitType: row.split_type, daysPerWeek: row.days_per_week, goal: row.goal, days, schedule, exercisePrescriptions: prescriptions };
}

export function splitPlanToRow(userId: string, plan: SplitPlan, extra: Json = {}): NewRow<'split_plans'> {
  return {
    user_id: userId,
    split_type: plan.splitType,
    days_per_week: plan.daysPerWeek,
    goal: plan.goal,
    days: plan.days.map((d) => ({ label: d.label, exercises: d.exercises })),
    schedule: plan.schedule,
    exercise_prescriptions: plan.exercisePrescriptions as Json,
    extra,
  };
}

// -- the coach's thread ------------------------------------------------------------------------------------------------------------

/** One saved coach turn. The table calls the AI's side "coach" (what the website and the importer wrote); the app calls it "assistant". */
export function coachTurnFromRow(row: Row<'coach_messages'>): ChatTurn {
  return {
    id: row.client_id,
    role: row.role === 'user' ? 'user' : 'assistant',
    text: row.body,
    sources: Array.isArray(row.sources) ? cleanSources(row.sources) : null,
    date: row.msg_date ?? '',
  };
}

/** The whole row. `seq` is the database's own ordering (generated always), so it is never written. */
export function coachTurnToRow(userId: string, turn: ChatTurn): NewRow<'coach_messages'> {
  return {
    user_id: userId,
    client_id: turn.id,
    role: turn.role === 'user' ? 'user' : 'coach',
    body: turn.text,
    msg_date: turn.date,
    sources: turn.sources === null ? null : (turn.sources as unknown as Json),
    extra: {},
  };
}

// -- an analysis's chat thread -------------------------------------------------------------------------------------------------------

function isoDay(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

/** One saved turn of an analysis's chat. The table has no date column, so the day a turn was made on rides in `extra`. */
export function analysisTurnFromRow(row: Row<'analyze_chat_messages'>): ChatTurn {
  return {
    id: row.client_id,
    role: row.role === 'user' ? 'user' : 'assistant',
    text: row.body,
    sources: Array.isArray(row.sources) ? cleanSources(row.sources) : null,
    date: isoDay(extraOf(row.extra).date),
  };
}

/** The whole row for `analysisId`'s thread. `seq` is the database's own ordering (generated always), so it is never written. */
export function analysisTurnToRow(userId: string, analysisId: number, turn: ChatTurn): NewRow<'analyze_chat_messages'> {
  return {
    user_id: userId,
    analyze_result_id: analysisId,
    client_id: turn.id,
    role: turn.role,
    body: turn.text,
    sources: turn.sources === null ? null : (turn.sources as unknown as Json),
    extra: { date: turn.date },
  };
}

// -- the workout chat's thread (one per day) ---------------------------------------------------------------------------------------

/** One saved turn of a day's workout chat. */
export function workoutTurnFromRow(row: Row<'workout_chat_messages'>): ChatTurn {
  return {
    id: row.client_id,
    role: row.role === 'user' ? 'user' : 'assistant',
    text: row.body,
    sources: Array.isArray(row.sources) ? cleanSources(row.sources) : null,
    date: row.msg_date,
  };
}

/** The whole row, filed under the turn's day. `seq` is the database's own ordering (generated always), so it is never written. */
export function workoutTurnToRow(userId: string, turn: ChatTurn): NewRow<'workout_chat_messages'> {
  return {
    user_id: userId,
    client_id: turn.id,
    role: turn.role,
    body: turn.text,
    msg_date: turn.date,
    sources: turn.sources === null ? null : (turn.sources as unknown as Json),
    extra: {},
  };
}
