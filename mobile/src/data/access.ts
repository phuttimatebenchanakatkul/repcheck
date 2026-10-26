/**
 * The app's data, read and written: reads come straight from Supabase (row-level security scopes them to the signed-in person, and
 * every query also filters by `user_id` so a loosened policy could not show someone else's rows); writes go through the outbox, so
 * they survive no signal, and ALSO patch the query cache straight away so the screen answers at once.
 *
 * Every cache patch is the same overlay function the hooks use on the waiting queue (src/data/overlay.ts), so "what the cache says
 * after my action" and "what the screen shows while the action is still queued" can never disagree.
 */
import type { QueryClient } from '@tanstack/react-query';

import type { CustomExercise, CustomFood, NewCustomFood } from '../api/endpoints';
import type { Goals, NutritionEntry, SplitPlan, WorkoutEntry } from '../logic/types';
import type { Operation, Outbox } from '../store/outbox';
import { addDays, toIsoDate } from '../logic/dates';
import { keys } from './keys';
import {
  nutritionRowToEntry,
  weightFromRow,
  workoutRowsToEntry,
  type AppSettings,
  type Row,
  type WeightEntry,
} from './mappers';
import {
  activityMark,
  dayStatus,
  exerciseFavorite,
  goalsUpsert,
  nutritionDelete,
  nutritionFavorite,
  nutritionUpsert,
  settingsUpsert,
  splitPlanUpsert,
  weightDelete,
  weightUpsert,
  workoutDelete,
  workoutSave,
} from './ops';
import {
  overlayDayStatuses,
  overlayNames,
  overlayNutritionDay,
  overlayNutritionRecent,
  overlayWeights,
  overlayWorkoutDay,
  overlayWorkoutRecent,
  type DayStatuses,
} from './overlay';

// -- what the data layer needs from Supabase and from the API --------------------------------------------------------------------------

export interface QueryResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
  status?: number;
}

/** The slice of the supabase-js query builder the reads use (the real client is cast to this; tests supply a fake). */
export interface ReadQuery extends PromiseLike<QueryResult> {
  select(columns?: string): ReadQuery;
  eq(column: string, value: unknown): ReadQuery;
  gte(column: string, value: unknown): ReadQuery;
  lte(column: string, value: unknown): ReadQuery;
  in(column: string, values: readonly unknown[]): ReadQuery;
  order(column: string, options?: { ascending?: boolean }): ReadQuery;
  limit(count: number): ReadQuery;
  range(from: number, to: number): ReadQuery;
  maybeSingle(): ReadQuery;
}

export interface Reader {
  from(table: string): ReadQuery;
}

export interface DataApi {
  listCustomFoods(): Promise<CustomFood[]>;
  createCustomFood(food: NewCustomFood): Promise<CustomFood>;
  deleteCustomFood(id: number): Promise<void>;
  listCustomExercises(): Promise<CustomExercise[]>;
  createCustomExercise(exercise: { name: string; emoji?: string; mode?: CustomExercise['mode'] }): Promise<CustomExercise>;
  deleteCustomExercise(id: number): Promise<void>;
  activityDates(tzOffsetMinutes: number): Promise<Record<string, string[]>>;
}

export interface DataDeps {
  userId: string;
  reader: Reader;
  outbox: Pick<Outbox, 'enqueue' | 'replace'>;
  queryClient: QueryClient;
  api: DataApi;
  /** Minutes to ADD to UTC to get the person's local time (positive east of Greenwich). */
  tzOffsetMinutes?: () => number;
  now?: () => Date;
}

export const PAGE_SIZE = 1000;
export const RECENT_NUTRITION_LIMIT = 400;
export const RECENT_WORKOUT_LIMIT = 60;
/** The streak looks at this many days back; a run longer than this is shown as the window's length. */
export const STREAK_WINDOW_DAYS = 400;

export type RecentNutrition = NutritionEntry & { day: string };
export type RecentWorkout = WorkoutEntry & { day: string };

/** An error that carries the HTTP status React Query's retry rule reads (src/store/queryClient.ts). */
export class DataError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
  }
}

function rowsOf<T>(result: QueryResult): T[] {
  if (result.error) throw new DataError(result.error.message ?? 'The request failed.', result.status, result.error.code);
  return Array.isArray(result.data) ? (result.data as T[]) : [];
}

function oneOf<T>(result: QueryResult): T | null {
  if (result.error) throw new DataError(result.error.message ?? 'The request failed.', result.status, result.error.code);
  return (result.data as T | null) ?? null;
}

/** A waiting write to one of this workout entry's sets. */
const isSetOf = (entryId: string) => (op: Operation) => op.table === 'workout_sets' && (op.kind === 'upsert' ? op.row.entry_id : op.match.entry_id) === entryId;

export function createData(deps: DataDeps) {
  const { userId, reader, outbox, queryClient, api } = deps;
  const now = deps.now ?? (() => new Date());
  const tzOffset = deps.tzOffsetMinutes ?? (() => -new Date().getTimezoneOffset());

  const table = (name: string) => reader.from(name).select('*').eq('user_id', userId);

  // -- reads ---------------------------------------------------------------------------------------------------------------------

  async function nutritionDay(day: string): Promise<NutritionEntry[]> {
    const rows = rowsOf<Row<'nutrition_entries'>>(await table('nutrition_entries').eq('log_date', day).order('added_at'));
    return rows.map(nutritionRowToEntry);
  }

  async function nutritionRecent(limit = RECENT_NUTRITION_LIMIT): Promise<RecentNutrition[]> {
    const rows = rowsOf<Row<'nutrition_entries'>>(await table('nutrition_entries').order('added_at', { ascending: false }).limit(limit));
    return rows.map((row) => ({ ...nutritionRowToEntry(row), day: row.log_date }));
  }

  async function goalsRow(): Promise<Row<'nutrition_goals'> | null> {
    return oneOf<Row<'nutrition_goals'>>(await table('nutrition_goals').maybeSingle());
  }

  async function foodFavorites(): Promise<string[]> {
    return rowsOf<Row<'nutrition_favorites'>>(await table('nutrition_favorites')).map((r) => r.food_name).sort();
  }

  async function exerciseFavorites(): Promise<string[]> {
    return rowsOf<Row<'exercise_favorites'>>(await table('exercise_favorites')).map((r) => r.exercise_name).sort();
  }

  async function setsFor(entryIds: readonly string[]): Promise<Row<'workout_sets'>[]> {
    if (!entryIds.length) return [];
    return rowsOf<Row<'workout_sets'>>(await table('workout_sets').in('entry_id', entryIds).order('position'));
  }

  async function workoutDay(day: string): Promise<WorkoutEntry[]> {
    const entries = rowsOf<Row<'workout_entries'>>(await table('workout_entries').eq('log_date', day).order('added_at'));
    const sets = await setsFor(entries.map((e) => e.id));
    return entries.map((entry) => workoutRowsToEntry(entry, sets));
  }

  async function workoutRecent(limit = RECENT_WORKOUT_LIMIT): Promise<RecentWorkout[]> {
    const entries = rowsOf<Row<'workout_entries'>>(await table('workout_entries').order('added_at', { ascending: false }).limit(limit));
    const sets = await setsFor(entries.map((e) => e.id));
    return entries.map((entry) => ({ ...workoutRowsToEntry(entry, sets), day: entry.log_date }));
  }

  async function splitPlanRow(): Promise<Row<'split_plans'> | null> {
    return oneOf<Row<'split_plans'>>(await table('split_plans').maybeSingle());
  }

  async function weights(from: string, to: string): Promise<WeightEntry[]> {
    const rows = rowsOf<Row<'weight_entries'>>(await table('weight_entries').gte('log_date', from).lte('log_date', to).order('log_date'));
    return rows.map(weightFromRow);
  }

  async function settingsRow(): Promise<Row<'user_settings'> | null> {
    return oneOf<Row<'user_settings'>>(await table('user_settings').maybeSingle());
  }

  async function dayStatuses(from: string, to: string): Promise<DayStatuses> {
    const rows = rowsOf<Row<'day_status_overrides'>>(await table('day_status_overrides').gte('log_date', from).lte('log_date', to));
    const out: DayStatuses = {};
    for (const row of rows) if (row.status === 'fasting' || row.status === 'incomplete') out[row.log_date] = row.status;
    return out;
  }

  /** Every `log_date` of a table since `since`, a page at a time (the server returns at most PAGE_SIZE rows per request). */
  async function logDates(name: string, since: string): Promise<string[]> {
    const days: string[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = rowsOf<{ log_date: string }>(
        await reader.from(name).select('log_date').eq('user_id', userId).gte('log_date', since).order('log_date').range(from, from + PAGE_SIZE - 1),
      );
      for (const row of page) days.push(row.log_date);
      if (page.length < PAGE_SIZE) return days;
    }
  }

  /**
   * Days with something on them, for the streak: food, workouts, weigh-ins and client-recorded actions from Supabase, plus the days
   * only the server records (challenges, form analyses, HYROX races, check-in photos). The server part is best-effort: if the API is
   * unreachable the streak is built from the rest rather than the whole screen failing.
   */
  async function activeDays(): Promise<string[]> {
    const since = addDays(toIsoDate(now()), -STREAK_WINDOW_DAYS);
    const [food, workouts, weigh, actions, server] = await Promise.all([
      logDates('nutrition_entries', since),
      logDates('workout_entries', since),
      logDates('weight_entries', since),
      logDates('activity_days', since),
      api.activityDates(tzOffset()).catch(() => ({}) as Record<string, string[]>),
    ]);
    return Array.from(new Set([...food, ...workouts, ...weigh, ...actions, ...Object.keys(server).filter((d) => d >= since)])).sort();
  }

  // -- the cache, patched by the same overlays the screens use -------------------------------------------------------------------------

  /** Applies `fn` to every cached query under `prefix` that holds data (a day not yet visited has nothing to patch). */
  function patch<T>(prefix: readonly unknown[], fn: (old: T, key: readonly unknown[]) => T): void {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
      const key = query.queryKey;
      queryClient.setQueryData<T>(key, (old) => (old === undefined ? old : fn(old, key)));
    }
  }

  function patchOne<T>(key: readonly unknown[], fn: (old: T) => T): void {
    queryClient.setQueryData<T>(key, (old) => (old === undefined ? old : fn(old)));
  }

  function patchNutrition(ops: readonly Operation[]): void {
    patch<NutritionEntry[]>([...keys.all(userId), 'nutrition'], (old, key) => overlayNutritionDay(old, ops, String(key[3])));
    patchOne<RecentNutrition[]>(keys.nutritionRecent(userId), (old) => overlayNutritionRecent(old, ops).slice(0, RECENT_NUTRITION_LIMIT));
  }

  function patchWorkouts(ops: readonly Operation[]): void {
    patch<WorkoutEntry[]>([...keys.all(userId), 'workouts'], (old, key) => overlayWorkoutDay(old, ops, String(key[3])));
    patchOne<RecentWorkout[]>(keys.workoutRecent(userId), (old) => overlayWorkoutRecent(old, ops, RECENT_WORKOUT_LIMIT));
  }

  function addActiveDays(days: readonly string[]): void {
    if (!days.length) return;
    patchOne<string[]>(keys.activeDays(userId), (old) => Array.from(new Set([...old, ...days])).sort());
  }

  /** Queue an operation. A full queue throws OutboxFullError before anything is shown as done. */
  const send = (op: Operation): Promise<void> => outbox.enqueue(userId, op);

  /** The one-row tables: the cache holds the row as the server has it, so a later write starts from what is really there. */
  function patchRow<T extends object>(key: readonly unknown[], op: Operation): void {
    queryClient.setQueryData<T | null>(key, op.kind === 'upsert' ? (op.row as unknown as T) : null);
  }

  // -- writes ------------------------------------------------------------------------------------------------------------------------

  async function saveFood(day: string, entry: NutritionEntry): Promise<void> {
    const op = nutritionUpsert(userId, day, entry);
    await send(op);
    patchNutrition([op]);
    addActiveDays([day]);
  }

  async function deleteFood(id: string): Promise<void> {
    const op = nutritionDelete(userId, id);
    await send(op);
    patchNutrition([op]);
  }

  async function saveWorkout(day: string, entry: WorkoutEntry): Promise<void> {
    const ops = workoutSave(userId, day, entry);
    // A re-save REPLACES the sets: drop any older version's set writes still waiting, or a shorter new version would be followed by
    // the longer old one's extra sets (coalescing only replaces the same position). All or nothing, saved once.
    await outbox.replace(userId, isSetOf(entry.id), ops);
    patchWorkouts(ops);
    addActiveDays([day]);
  }

  async function deleteWorkout(id: string): Promise<void> {
    const op = workoutDelete(userId, id);
    await outbox.replace(userId, isSetOf(id), [op]);
    patchWorkouts([op]);
  }

  /** false when the figure is outside what the database accepts (nothing is queued). */
  async function saveWeight(entry: WeightEntry): Promise<boolean> {
    const op = weightUpsert(userId, entry);
    if (!op) return false;
    await send(op);
    patch<WeightEntry[]>(keys.weightsPrefix(userId), (old, key) => overlayWeights(old, [op], String(key[3]), String(key[4])));
    addActiveDays([entry.day]);
    return true;
  }

  async function removeWeight(day: string): Promise<void> {
    const op = weightDelete(userId, day);
    await send(op);
    patch<WeightEntry[]>(keys.weightsPrefix(userId), (old, key) => overlayWeights(old, [op], String(key[3]), String(key[4])));
  }

  async function saveGoals(goals: Pick<Goals, 'protein' | 'fat' | 'carbs'>): Promise<void> {
    const base = queryClient.getQueryData<Row<'nutrition_goals'> | null>(keys.goals(userId));
    const op = goalsUpsert(userId, goals, base?.extra);
    await send(op);
    patchRow(keys.goals(userId), op);
  }

  async function saveSettings(settings: AppSettings): Promise<void> {
    const base = queryClient.getQueryData<Row<'user_settings'> | null>(keys.settings(userId));
    const op = settingsUpsert(userId, settings, base);
    await send(op);
    patchRow(keys.settings(userId), op);
  }

  async function saveSplitPlan(plan: SplitPlan): Promise<void> {
    const base = queryClient.getQueryData<Row<'split_plans'> | null>(keys.splitPlan(userId));
    const op = splitPlanUpsert(userId, plan, base?.extra);
    await send(op);
    patchRow(keys.splitPlan(userId), op);
  }

  async function setFoodFavorite(name: string, on: boolean): Promise<void> {
    const op = nutritionFavorite(userId, name, on);
    await send(op);
    patchOne<string[]>(keys.nutritionFavorites(userId), (old) => overlayNames(old, [op], 'food_name'));
  }

  async function setExerciseFavorite(name: string, on: boolean): Promise<void> {
    const op = exerciseFavorite(userId, name, on);
    await send(op);
    patchOne<string[]>(keys.exerciseFavorites(userId), (old) => overlayNames(old, [op], 'exercise_name'));
  }

  async function setDayStatus(day: string, status: 'fasting' | 'incomplete' | null): Promise<void> {
    const op = dayStatus(userId, day, status);
    await send(op);
    patch<DayStatuses>(keys.dayStatusPrefix(userId), (old, key) => overlayDayStatuses(old, [op], String(key[3]), String(key[4])));
  }

  /** Records an action that has no dated record of its own (coach chat, a split plan edit, ...) as a streak day. */
  async function markActivity(day: string, action: string): Promise<void> {
    await send(activityMark(userId, day, action));
    addActiveDays([day]);
  }

  // -- custom foods and exercises (through the API: it enforces the per-person ceilings and the barcode rule) ---------------------------

  async function createCustomFood(food: NewCustomFood): Promise<CustomFood> {
    const created = await api.createCustomFood(food);
    patchOne<CustomFood[]>(keys.customFoods(userId), (old) => [created, ...old.filter((f) => f.id !== created.id)]);
    return created;
  }

  async function deleteCustomFood(id: number): Promise<void> {
    await api.deleteCustomFood(id);
    patchOne<CustomFood[]>(keys.customFoods(userId), (old) => old.filter((f) => f.id !== id));
  }

  async function createCustomExercise(exercise: { name: string; emoji?: string; mode?: CustomExercise['mode'] }): Promise<CustomExercise> {
    const created = await api.createCustomExercise(exercise);
    patchOne<CustomExercise[]>(keys.customExercises(userId), (old) => [created, ...old.filter((e) => e.id !== created.id)]);
    return created;
  }

  async function deleteCustomExercise(id: number): Promise<void> {
    await api.deleteCustomExercise(id);
    patchOne<CustomExercise[]>(keys.customExercises(userId), (old) => old.filter((e) => e.id !== id));
  }

  return {
    userId,
    fetch: {
      nutritionDay, nutritionRecent, goalsRow, foodFavorites, exerciseFavorites, workoutDay, workoutRecent, splitPlanRow,
      weights, settingsRow, dayStatuses, activeDays,
      customFoods: () => api.listCustomFoods(),
      customExercises: () => api.listCustomExercises(),
    },
    actions: {
      saveFood, deleteFood, saveWorkout, deleteWorkout, saveWeight, removeWeight, saveGoals, saveSettings, saveSplitPlan,
      setFoodFavorite, setExerciseFavorite, setDayStatus, markActivity,
      createCustomFood, deleteCustomFood, createCustomExercise, deleteCustomExercise,
    },
  };
}

export type Data = ReturnType<typeof createData>;
