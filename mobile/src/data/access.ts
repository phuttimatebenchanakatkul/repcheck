/**
 * The app's data, read and written: reads come straight from Supabase (row-level security scopes them to the signed-in person, and
 * every query also filters by `user_id` so a loosened policy could not show someone else's rows); writes go through the outbox, so
 * they survive no signal, and ALSO patch the query cache straight away so the screen answers at once.
 *
 * Every cache patch is the same overlay function the hooks use on the waiting queue (src/data/overlay.ts), so "what the cache says
 * after my action" and "what the screen shows while the action is still queued" can never disagree.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Json } from '../supabase/database.types';

import type { CustomExercise, CustomFood, NewCustomFood } from '../api/endpoints';
import type { ChatTurn } from '../logic/chat';
import type { Adjustment } from '../logic/checkin';
import type { Race } from '../logic/hyrox';
import type { CoachingData } from '../logic/coachingProfile';
import type { Goals, NutritionEntry, SplitPlan, WorkoutEntry } from '../logic/types';
import type { Operation, Outbox } from '../store/outbox';
import { addDays, toIsoDate } from '../logic/dates';
import type { CoachingProfile } from '../logic/splitPlan';
import { keys } from './keys';
import {
  workoutTurnFromRow,
  analysisTurnFromRow,
  coachTurnFromRow,
  hyroxPrefsFromRow,
  hyroxRaceFromRows,
  nutritionRowToEntry,
  toMs,
  weightFromRow,
  workoutRowsToEntry,
  type AppSettings,
  type HyroxPrefs,
  type Row,
  type WeightEntry,
} from './mappers';
import {
  activityMark,
  coachingCheckinSave,
  coachingInactivityNoticed,
  hyroxPrefsSave,
  hyroxRaceDelete,
  hyroxRaceSave,
  coachingProfileSave,
  workoutChatClear,
  workoutTurnSave,
  analysisTurnSave,
  coachClear,
  coachTurnSave,
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
  overlayWorkoutThread,
  overlayAnalysisThread,
  overlayCoachThread,
  overlayDayStatuses,
  overlayHyroxRaces,
  overlayNames,
  overlayNutritionDay,
  overlayNutritionRange,
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
/** The workout chat recites each exercise's last sessions from this many of the newest entries (the website used the whole log). */
export const WORKOUT_HISTORY_LIMIT = 300;
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

/** A waiting write to one of this race's splits. */
const isSplitOf = (raceId: string) => (op: Operation) => op.table === 'hyrox_race_splits' && (op.kind === 'upsert' ? op.row.race_id : op.match.race_id) === raceId;

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

  /** Every entry filed under days from `from` to `to`, a page at a time (a month of food is a few hundred rows). */
  async function nutritionRange(from: string, to: string): Promise<RecentNutrition[]> {
    const out: RecentNutrition[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const page = rowsOf<Row<'nutrition_entries'>>(
        await table('nutrition_entries').gte('log_date', from).lte('log_date', to).order('added_at').range(start, start + PAGE_SIZE - 1),
      );
      out.push(...page.map((row) => ({ ...nutritionRowToEntry(row), day: row.log_date })));
      if (page.length < PAGE_SIZE) return out;
    }
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

  /** The coach's turns for one day, oldest first (the table's own `seq` order). */
  async function coachThread(day: string): Promise<ChatTurn[]> {
    const rows = rowsOf<Row<'coach_messages'>>(await table('coach_messages').eq('msg_date', day).order('seq').limit(PAGE_SIZE));
    return rows.map(coachTurnFromRow);
  }

  /** One day's workout chat, oldest first (the table's own `seq` order). */
  async function workoutThread(day: string): Promise<ChatTurn[]> {
    const rows = rowsOf<Row<'workout_chat_messages'>>(await table('workout_chat_messages').eq('msg_date', day).order('seq').limit(PAGE_SIZE));
    return rows.map(workoutTurnFromRow);
  }

  /** One analysis's chat, oldest first (the table's own `seq` order). */
  async function analysisThread(analysisId: number): Promise<ChatTurn[]> {
    const rows = rowsOf<Row<'analyze_chat_messages'>>(await table('analyze_chat_messages').eq('analyze_result_id', analysisId).order('seq').limit(PAGE_SIZE));
    return rows.map(analysisTurnFromRow);
  }

  async function splitPlanRow(): Promise<Row<'split_plans'> | null> {
    return oneOf<Row<'split_plans'>>(await table('split_plans').maybeSingle());
  }

  /** A range of weigh-ins, a page at a time (the history page reads them all, and the server returns at most PAGE_SIZE rows per request). */
  async function weights(from: string, to: string): Promise<WeightEntry[]> {
    const out: WeightEntry[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const page = rowsOf<Row<'weight_entries'>>(await table('weight_entries').gte('log_date', from).lte('log_date', to).order('log_date').range(start, start + PAGE_SIZE - 1));
      out.push(...page.map(weightFromRow));
      if (page.length < PAGE_SIZE) return out;
    }
  }

  /** Every HYROX race with its splits, a page at a time (a race has 16 splits, so a long history is more than one request). */
  async function hyroxRaces(): Promise<Race[]> {
    const races: Row<'hyrox_races'>[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const page = rowsOf<Row<'hyrox_races'>>(await table('hyrox_races').order('raced_at').range(start, start + PAGE_SIZE - 1));
      races.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    const splits: Row<'hyrox_race_splits'>[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const page = rowsOf<Row<'hyrox_race_splits'>>(await table('hyrox_race_splits').order('race_id').order('position').range(start, start + PAGE_SIZE - 1));
      splits.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return races.map((row) => hyroxRaceFromRows(row, splits)).sort((a, b) => toMs(b.date) - toMs(a.date));
  }

  async function settingsRow(): Promise<Row<'user_settings'> | null> {
    return oneOf<Row<'user_settings'>>(await table('user_settings').maybeSingle());
  }

  /** The stored coaching profile row (every field), or null when there is none. */
  async function coachingRow(): Promise<Row<'coaching_profiles'> | null> {
    return oneOf<Row<'coaching_profiles'>>(await table('coaching_profiles').maybeSingle());
  }

  /** What the coach knows about the person, for tailoring a plan. Optional by design: no profile, or any trouble reading it, is just no tailoring. */
  async function coachingProfile(): Promise<CoachingProfile> {
    try {
      const row = oneOf<Row<'coaching_profiles'>>(await table('coaching_profiles').maybeSingle());
      return row ? { gender: row.gender, goal_weight_kg: row.goal_weight_kg, current_weight_kg: row.weight_kg } : {};
    } catch {
      return {};
    }
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
    patch<RecentNutrition[]>(keys.nutritionRangePrefix(userId), (old, key) => overlayNutritionRange(old, ops, String(key[3]), String(key[4])));
  }

  function patchWorkouts(ops: readonly Operation[]): void {
    patch<WorkoutEntry[]>([...keys.all(userId), 'workouts'], (old, key) => overlayWorkoutDay(old, ops, String(key[3])));
    patchOne<RecentWorkout[]>(keys.workoutRecent(userId), (old) => overlayWorkoutRecent(old, ops, RECENT_WORKOUT_LIMIT));
    patchOne<RecentWorkout[]>(keys.workoutHistory(userId), (old) => overlayWorkoutRecent(old, ops, WORKOUT_HISTORY_LIMIT));
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

  /** Adds a turn to the coach's thread (the person's question, then the coach's answer). */
  async function saveCoachTurn(turn: ChatTurn): Promise<void> {
    const op = coachTurnSave(userId, turn);
    await send(op);
    patch<ChatTurn[]>(keys.coachThreadPrefix(userId), (old, key) => (turn.date === String(key[3]) ? overlayCoachThread(old, [op]) : old));
  }

  /** Saves the coaching profile a wizard produced (with the week laid out when calories are spread). */
  async function saveCoachingProfile(data: CoachingData, weeklyDistribution: Json | null): Promise<void> {
    const base = queryClient.getQueryData<Row<'coaching_profiles'> | null>(keys.coachingRow(userId));
    const op = coachingProfileSave(userId, data, base, weeklyDistribution);
    await send(op);
    patchRow(keys.coachingRow(userId), op);
  }

  /**
   * Records a finished weekly check-in: the check-in's day on the coaching row (and why the targets moved, or that a reached goal was
   * acted on), the new protein / fat / carb goals when they changed, and the day as a streak day. Throws when there is no coaching row to
   * record it on.
   */
  async function saveCheckin(result: { adjustment: Adjustment | null; goalReached: boolean }): Promise<void> {
    const base = queryClient.getQueryData<Row<'coaching_profiles'> | null>(keys.coachingRow(userId));
    if (!base) throw new DataError('There is no coaching profile to check in on.');
    const today = toIsoDate(now());
    const op = coachingCheckinSave(userId, base, {
      today,
      nowIso: now().toISOString(),
      adjustment: result.adjustment ? { reason: result.adjustment.reason, delta: result.adjustment.delta } : null,
      goalHandled: result.goalReached,
    });
    await send(op);
    patchRow(keys.coachingRow(userId), op);
    if (result.adjustment) await saveGoals({ protein: result.adjustment.protein, fat: result.adjustment.fat, carbs: result.adjustment.carbs });
    await markActivity(today, 'checkin');
  }

  /** Saves a finished HYROX race (the race, then its splits) and shows it at once. */
  async function saveHyroxRace(race: Race): Promise<void> {
    const ops = hyroxRaceSave(userId, race);
    await outbox.replace(userId, isSplitOf(race.id), ops);
    patchOne<Race[]>(keys.hyroxRaces(userId), (old) => overlayHyroxRaces(old, ops));
  }

  async function deleteHyroxRace(id: string): Promise<void> {
    const op = hyroxRaceDelete(userId, id);
    await outbox.replace(userId, isSplitOf(id), [op]);
    patchOne<Race[]>(keys.hyroxRaces(userId), (old) => overlayHyroxRaces(old, [op]));
  }

  /** Changes the HYROX preferences (lane length, leaderboard gender); what is not named stays. The rest of the settings row is untouched. */
  async function saveHyroxPrefs(change: Partial<HyroxPrefs>): Promise<void> {
    const base = queryClient.getQueryData<Row<'user_settings'> | null>(keys.settings(userId));
    const op = hyroxPrefsSave(userId, { ...hyroxPrefsFromRow(base), ...change }, base);
    await send(op);
    patchRow(keys.settings(userId), op);
  }

  /** Dismisses the "it's been N days" nudge for today. Nothing to record on without a coaching row. */
  async function dismissInactivity(): Promise<void> {
    const base = queryClient.getQueryData<Row<'coaching_profiles'> | null>(keys.coachingRow(userId));
    if (!base) return;
    const op = coachingInactivityNoticed(userId, base, toIsoDate(now()));
    await send(op);
    patchRow(keys.coachingRow(userId), op);
  }

  /** Adds a turn to a day's workout chat (the day is the turn's own). */
  async function saveWorkoutTurn(turn: ChatTurn): Promise<void> {
    const op = workoutTurnSave(userId, turn);
    await send(op);
    patch<ChatTurn[]>(keys.workoutThreadPrefix(userId), (old, key) => overlayWorkoutThread(old, [op], String(key[3])));
  }

  /** Empties one day's workout chat; turns of that day still waiting are dropped first (they would only be deleted). */
  async function clearWorkoutThread(day: string): Promise<void> {
    const op = workoutChatClear(userId, day);
    await outbox.replace(userId, (queued) => queued.table === 'workout_chat_messages' && (queued.kind === 'upsert' ? queued.row.msg_date : queued.match.msg_date) === day, [op]);
    patch<ChatTurn[]>(keys.workoutThreadPrefix(userId), (old, key) => overlayWorkoutThread(old, [op], String(key[3])));
  }

  /** Adds a turn to one analysis's chat. */
  async function saveAnalysisTurn(analysisId: number, turn: ChatTurn): Promise<void> {
    const op = analysisTurnSave(userId, analysisId, turn);
    await send(op);
    patch<ChatTurn[]>(keys.analysisThreadPrefix(userId), (old, key) => overlayAnalysisThread(old, [op], Number(key[3])));
  }

  /** Empties the coach's thread: waiting turns are dropped (they would only be deleted), then one delete clears the rest. */
  async function clearCoach(): Promise<void> {
    const op = coachClear(userId);
    await outbox.replace(userId, (queued) => queued.table === 'coach_messages', [op]);
    patch<ChatTurn[]>(keys.coachThreadPrefix(userId), (old) => overlayCoachThread(old, [op]));
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
      nutritionDay, nutritionRecent, nutritionRange, goalsRow, foodFavorites, exerciseFavorites, workoutDay, workoutRecent, splitPlanRow,
      weights, hyroxRaces, settingsRow, dayStatuses, activeDays, coachingProfile, coachingRow, coachThread, analysisThread, workoutThread, workoutHistory: () => workoutRecent(WORKOUT_HISTORY_LIMIT),
      customFoods: () => api.listCustomFoods(),
      customExercises: () => api.listCustomExercises(),
    },
    actions: {
      saveFood, deleteFood, saveWorkout, deleteWorkout, saveWeight, removeWeight, saveGoals, saveSettings, saveSplitPlan,
      setFoodFavorite, setExerciseFavorite, setDayStatus, markActivity, saveCoachTurn, clearCoach, saveAnalysisTurn, saveWorkoutTurn, clearWorkoutThread, saveCoachingProfile, saveCheckin, dismissInactivity, saveHyroxRace, deleteHyroxRace, saveHyroxPrefs,
      createCustomFood, deleteCustomFood, createCustomExercise, deleteCustomExercise,
    },
  };
}

export type Data = ReturnType<typeof createData>;
