import { QueryClient } from '@tanstack/react-query';

import type { Supabase } from '@/supabase/client';

import type { CustomExercise, CustomFood } from '../../api/endpoints';
import type { NutritionEntry, WorkoutEntry } from '../../logic/types';
import { supabaseExecutor } from '../../store/executor';
import { MAX_QUEUED, Outbox, OutboxFullError, type KeyValueStorage } from '../../store/outbox';
import { FakeDatabase } from '../../testing/fakeSupabase';
import { PAGE_SIZE, RECENT_NUTRITION_LIMIT, RECENT_WORKOUT_LIMIT, STREAK_WINDOW_DAYS, createData, type DataApi, type RecentNutrition, type RecentWorkout } from '../access';
import { keys } from '../keys';
import { toTimestamp } from '../mappers';

const U = 'user-1';
const OTHER = 'user-2';
const DAY = '2026-10-26';
const YESTERDAY = '2026-10-25';
const NOW = new Date(2026, 9, 26, 12, 0, 0);
const T0 = new Date(2026, 9, 26, 8, 0, 0).getTime();

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
}

function fakeApi(over: Partial<DataApi> = {}): DataApi & { calls: string[] } {
  const calls: string[] = [];
  const api: DataApi = {
    listCustomFoods: async () => [],
    createCustomFood: async (food) => ({ id: 7, name: food.name, emoji: '🍽️', calories: 0, protein: food.protein, fat: food.fat, carbs: food.carbs, barcode: null, servingLabel: '1 serving', servingGrams: 100, servings: [] }),
    deleteCustomFood: async () => undefined,
    listCustomExercises: async () => [],
    createCustomExercise: async (e) => ({ id: 3, name: e.name, emoji: e.emoji ?? null, mode: e.mode ?? 'both' }),
    deleteCustomExercise: async () => undefined,
    activityDates: async () => ({}),
    ...over,
  };
  return Object.assign(api, { calls });
}

function setup(over: { api?: Partial<DataApi>; db?: FakeDatabase } = {}) {
  const db = over.db ?? new FakeDatabase();
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } }); // no gc timers: they would keep Jest alive
  const outbox = new Outbox(memoryStorage(), supabaseExecutor(db.client() as unknown as Supabase));
  const api = fakeApi(over.api);
  const data = createData({ userId: U, reader: db.client(), outbox, queryClient, api, tzOffsetMinutes: () => 0, now: () => NOW });
  return { db, queryClient, outbox, api, data };
}

const foodRow = (id: string, day: string, addedAt: number, user = U, over: Record<string, unknown> = {}) => ({
  user_id: user, id, log_date: day, food: `Food ${id}`, added_at: toTimestamp(addedAt), source: null, grams: 100, unit: 'g', base_calories: 100, base_carbs: 0, base_fat: 0, base_protein: 0, ingredients: null, extra: {}, ...over,
});

const food = (id: string, addedAt: number, over: Partial<NutritionEntry> = {}): NutritionEntry => ({ id, food: `Food ${id}`, addedAt, grams: 100, unit: 'g', baseCalories: 100, baseCarbs: 0, baseFat: 0, baseProtein: 0, ...over });

const set = (reps: number) => ({ reps, weightKg: 50, leftKg: null, rightKg: null, leftReps: null, rightReps: null });
const lift = (id: string, sets: number[], over: Partial<WorkoutEntry> = {}): WorkoutEntry => ({ id, exercise: `Lift ${id}`, addedAt: T0, unilateral: false, sets: sets.map(set), ...over });

describe('reading', () => {
  it('the food log for a day is only that person’s, only that day’s, oldest first', async () => {
    const { db, data } = setup();
    db.seed('nutrition_entries', [foodRow('b', DAY, T0 + 10), foodRow('a', DAY, T0), foodRow('x', YESTERDAY, T0), foodRow('z', DAY, T0, OTHER)]);
    expect((await data.fetch.nutritionDay(DAY)).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('recent foods are newest first, carry their day, and are capped', async () => {
    const { db, data } = setup();
    db.seed('nutrition_entries', [foodRow('a', YESTERDAY, T0), foodRow('b', DAY, T0 + 5), foodRow('c', DAY, T0 + 9), foodRow('z', DAY, T0 + 99, OTHER)]);
    expect((await data.fetch.nutritionRecent(2)).map((e) => [e.id, e.day])).toEqual([['c', DAY], ['b', DAY]]);
  });

  it('a day’s workouts come with their own sets in position order, and no one else’s', async () => {
    const { db, data } = setup();
    db.seed('workout_entries', [
      { user_id: U, id: 'w1', log_date: DAY, exercise: 'Bench', added_at: toTimestamp(T0), unilateral: false, extra: {} },
      { user_id: U, id: 'w2', log_date: YESTERDAY, exercise: 'Squat', added_at: toTimestamp(T0), unilateral: false, extra: {} },
      { user_id: OTHER, id: 'w1', log_date: DAY, exercise: 'Theirs', added_at: toTimestamp(T0), unilateral: false, extra: {} },
    ]);
    db.seed('workout_sets', [
      { user_id: U, entry_id: 'w1', position: 1, reps: 8, weight_kg: 50, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {} },
      { user_id: U, entry_id: 'w1', position: 0, reps: 10, weight_kg: 50, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {} },
      { user_id: OTHER, entry_id: 'w1', position: 0, reps: 99, weight_kg: 1, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {} },
    ]);
    const day = await data.fetch.workoutDay(DAY);
    expect(day).toHaveLength(1);
    expect(day[0].exercise).toBe('Bench');
    expect(day[0].sets.map((s) => s.reps)).toEqual([10, 8]);
    expect(await data.fetch.workoutDay('2000-01-01')).toEqual([]);
  });

  it('recent workouts are newest first with their day', async () => {
    const { db, data } = setup();
    db.seed('workout_entries', [
      { user_id: U, id: 'old', log_date: YESTERDAY, exercise: 'A', added_at: toTimestamp(T0), unilateral: false, extra: {} },
      { user_id: U, id: 'new', log_date: DAY, exercise: 'B', added_at: toTimestamp(T0 + 50), unilateral: false, extra: {} },
    ]);
    const recent = await data.fetch.workoutRecent(5);
    expect(recent.map((e) => [e.id, e.day])).toEqual([['new', DAY], ['old', YESTERDAY]]);
  });

  it('a weight range, favourites, goals, settings, the split plan and day statuses', async () => {
    const { db, data } = setup();
    db.seed('weight_entries', [
      { user_id: U, log_date: '2026-10-20', kg: 82, logged_at: toTimestamp(T0), extra: {} },
      { user_id: U, log_date: '2026-09-01', kg: 90, logged_at: toTimestamp(T0), extra: {} },
      { user_id: OTHER, log_date: '2026-10-20', kg: 50, logged_at: toTimestamp(T0), extra: {} },
    ]);
    db.seed('nutrition_favorites', [{ user_id: U, food_name: 'Egg' }, { user_id: U, food_name: 'Apple' }, { user_id: OTHER, food_name: 'Nope' }]);
    db.seed('exercise_favorites', [{ user_id: U, exercise_name: 'Squat' }]);
    db.seed('nutrition_goals', [{ user_id: OTHER, protein: 1, fat: 1, carbs: 1, extra: {} }, { user_id: U, protein: 120, fat: 60, carbs: 180, extra: {} }]);
    db.seed('user_settings', [{ user_id: U, units_weight: 'lb' }]);
    db.seed('split_plans', [{ user_id: U, split_type: 'ppl', days_per_week: 3, goal: null, days: [], schedule: {}, exercise_prescriptions: {}, extra: {} }]);
    db.seed('day_status_overrides', [
      { user_id: U, log_date: DAY, status: 'fasting' },
      { user_id: U, log_date: YESTERDAY, status: 'bogus' },
      { user_id: U, log_date: '2026-01-01', status: 'incomplete' },
    ]);

    expect(await data.fetch.weights('2026-10-01', '2026-10-31')).toEqual([{ day: '2026-10-20', kg: 82, loggedAt: T0 }]);
    expect(await data.fetch.foodFavorites()).toEqual(['Apple', 'Egg']);
    expect(await data.fetch.exerciseFavorites()).toEqual(['Squat']);
    expect((await data.fetch.goalsRow())?.protein).toBe(120);
    expect((await data.fetch.settingsRow())?.units_weight).toBe('lb');
    expect((await data.fetch.splitPlanRow())?.split_type).toBe('ppl');
    expect(await data.fetch.dayStatuses('2026-10-01', '2026-10-31')).toEqual({ [DAY]: 'fasting' });
  });

  it('a person with no goals, settings or plan gets null, not an error', async () => {
    const { data } = setup();
    expect(await data.fetch.goalsRow()).toBeNull();
    expect(await data.fetch.settingsRow()).toBeNull();
    expect(await data.fetch.splitPlanRow()).toBeNull();
  });

  it('a failed read throws an error carrying the status the retry rule reads', async () => {
    const { db, data } = setup();
    db.failWhen = () => ({ status: 503, message: 'down', code: 'x' });
    await expect(data.fetch.nutritionDay(DAY)).rejects.toMatchObject({ message: 'down', status: 503, code: 'x' });
    db.failWhen = () => ({ status: 0, message: 'offline' });
    await expect(data.fetch.goalsRow()).rejects.toMatchObject({ status: 0 });
  });

  it('custom foods and exercises come from the API', async () => {
    const foods: CustomFood[] = [{ id: 1, name: 'Mine', emoji: '🥣', calories: 100, protein: 5, fat: 5, carbs: 5, barcode: null, servingLabel: 'bowl', servingGrams: 200, servings: [] }];
    const exercises: CustomExercise[] = [{ id: 2, name: 'Sled push', emoji: null, mode: 'both' }];
    const { data } = setup({ api: { listCustomFoods: async () => foods, listCustomExercises: async () => exercises } });
    expect(await data.fetch.customFoods()).toEqual(foods);
    expect(await data.fetch.customExercises()).toEqual(exercises);
  });
});

describe('the days that count toward the streak', () => {
  it('unions food, workouts, weigh-ins, recorded actions and the server’s days, sorted and without repeats', async () => {
    const { db, data } = setup({ api: { activityDates: async () => ({ '2026-10-18': ['challenge'], '2026-10-24': ['analysis', 'hyrox'] }) } });
    db.seed('nutrition_entries', [foodRow('a', DAY, T0), foodRow('b', DAY, T0 + 1), foodRow('o', DAY, T0, OTHER)]);
    db.seed('workout_entries', [{ user_id: U, id: 'w', log_date: '2026-10-24', exercise: 'x', added_at: toTimestamp(T0), unilateral: false, extra: {} }]);
    db.seed('weight_entries', [{ user_id: U, log_date: '2026-10-20', kg: 80, logged_at: toTimestamp(T0), extra: {} }]);
    db.seed('activity_days', [{ user_id: U, log_date: '2026-10-22', action: 'coach_chat' }, { user_id: OTHER, log_date: '2026-10-01', action: 'coach_chat' }]);
    db.seed('day_status_overrides', [{ user_id: U, log_date: '2026-10-10', status: 'fasting' }]);
    expect(await data.fetch.activeDays()).toEqual(['2026-10-18', '2026-10-20', '2026-10-22', '2026-10-24', DAY]);
  });

  it('asks the server for the days in the person’s own time zone', async () => {
    const seen: number[] = [];
    const db = new FakeDatabase();
    const data = createData({
      userId: U, reader: db.client(), outbox: new Outbox(memoryStorage(), async () => null), queryClient: new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
      api: fakeApi({ activityDates: async (offset) => (seen.push(offset), {}) }), tzOffsetMinutes: () => 420, now: () => NOW,
    });
    await data.fetch.activeDays();
    expect(seen).toEqual([420]);
  });

  it('reads past the first page of rows', async () => {
    const { db, data } = setup();
    db.maxRows = PAGE_SIZE;
    const rows = Array.from({ length: PAGE_SIZE + 250 }, (_, i) => foodRow(`n${i}`, i < PAGE_SIZE + 100 ? '2026-10-20' : '2026-10-21', T0 + i));
    db.seed('nutrition_entries', rows);
    expect(await data.fetch.activeDays()).toEqual(['2026-10-20', '2026-10-21']);
    expect(db.calls.filter((c) => c === 'read:nutrition_entries').length).toBe(2);
  });

  it('stops exactly at a full last page (one more request, finding it empty)', async () => {
    const { db, data } = setup();
    db.seed('nutrition_entries', Array.from({ length: PAGE_SIZE }, (_, i) => foodRow(`n${i}`, DAY, T0 + i)));
    expect(await data.fetch.activeDays()).toEqual([DAY]);
    expect(db.calls.filter((c) => c === 'read:nutrition_entries').length).toBe(2);
  });

  it('looks back only STREAK_WINDOW_DAYS', async () => {
    const { db, data } = setup({ api: { activityDates: async () => ({ '2020-01-01': ['challenge'], '2025-09-20': ['challenge'] }) } });
    const edge = '2025-09-21'; // 400 days before 2026-10-26
    expect(STREAK_WINDOW_DAYS).toBe(400);
    db.seed('nutrition_entries', [foodRow('old', '2025-09-20', T0), foodRow('edge', edge, T0)]);
    expect(await data.fetch.activeDays()).toEqual([edge]);
  });

  it('survives the API being unreachable: the streak is built from what Supabase has', async () => {
    const { db, data } = setup({ api: { activityDates: async () => { throw new Error('down'); } } });
    db.seed('nutrition_entries', [foodRow('a', DAY, T0)]);
    expect(await data.fetch.activeDays()).toEqual([DAY]);
  });

  it('fails when Supabase itself fails', async () => {
    const { db, data } = setup();
    db.failWhen = (_kind, table) => (table === 'weight_entries' ? { status: 500, message: 'boom' } : null);
    await expect(data.fetch.activeDays()).rejects.toMatchObject({ status: 500 });
  });
});

describe('writing food', () => {
  it('queues the whole row, and a flush puts it on the server', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveFood(DAY, food('a', T0, { grams: 150 }));
    expect(outbox.pending(U)).toHaveLength(1);
    expect(db.rows('nutrition_entries')).toEqual([]);
    await outbox.flush(U);
    expect(db.rows('nutrition_entries')).toMatchObject([{ user_id: U, id: 'a', log_date: DAY, grams: 150, base_calories: 100 }]);
    expect((await data.fetch.nutritionDay(DAY)).map((e) => e.id)).toEqual(['a']);
  });

  it('shows up at once in the cached day it belongs to, and in the recents, and nowhere else', async () => {
    const { queryClient, data } = setup();
    queryClient.setQueryData<NutritionEntry[]>(keys.nutritionDay(U, DAY), []);
    queryClient.setQueryData<NutritionEntry[]>(keys.nutritionDay(U, YESTERDAY), []);
    queryClient.setQueryData<RecentNutrition[]>(keys.nutritionRecent(U), []);
    await data.actions.saveFood(DAY, food('a', T0));
    expect(queryClient.getQueryData<NutritionEntry[]>(keys.nutritionDay(U, DAY))?.map((e) => e.id)).toEqual(['a']);
    expect(queryClient.getQueryData<NutritionEntry[]>(keys.nutritionDay(U, YESTERDAY))).toEqual([]);
    expect(queryClient.getQueryData<RecentNutrition[]>(keys.nutritionRecent(U))?.map((e) => [e.id, e.day])).toEqual([['a', DAY]]);
  });

  it('does not invent a cache entry for a day that was never opened', async () => {
    const { queryClient, data } = setup();
    await data.actions.saveFood(DAY, food('a', T0));
    expect(queryClient.getQueryData(keys.nutritionDay(U, DAY))).toBeUndefined();
  });

  it('an edit that moves the entry to another day moves it between the cached days', async () => {
    const { queryClient, data } = setup();
    queryClient.setQueryData<NutritionEntry[]>(keys.nutritionDay(U, DAY), [food('a', T0)]);
    queryClient.setQueryData<NutritionEntry[]>(keys.nutritionDay(U, YESTERDAY), []);
    await data.actions.saveFood(YESTERDAY, food('a', T0));
    expect(queryClient.getQueryData<NutritionEntry[]>(keys.nutritionDay(U, DAY))).toEqual([]);
    expect(queryClient.getQueryData<NutritionEntry[]>(keys.nutritionDay(U, YESTERDAY))?.map((e) => e.id)).toEqual(['a']);
  });

  it('deleting removes it from the cache and, once flushed, from the server', async () => {
    const { db, queryClient, outbox, data } = setup();
    db.seed('nutrition_entries', [foodRow('a', DAY, T0), foodRow('b', DAY, T0 + 1)]);
    queryClient.setQueryData(keys.nutritionDay(U, DAY), await data.fetch.nutritionDay(DAY));
    await data.actions.deleteFood('a');
    expect(queryClient.getQueryData<NutritionEntry[]>(keys.nutritionDay(U, DAY))?.map((e) => e.id)).toEqual(['b']);
    await outbox.flush(U);
    expect(db.rows('nutrition_entries').map((r) => r.id)).toEqual(['b']);
  });

  it('logging then deleting while offline never reaches the server', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveFood(DAY, food('a', T0));
    await data.actions.deleteFood('a');
    await outbox.flush(U);
    expect(db.calls).toEqual([]);
  });

  it('logging marks the day as active in the streak cache', async () => {
    const { queryClient, data } = setup();
    queryClient.setQueryData<string[]>(keys.activeDays(U), ['2026-10-20']);
    await data.actions.saveFood(DAY, food('a', T0));
    expect(queryClient.getQueryData<string[]>(keys.activeDays(U))).toEqual(['2026-10-20', DAY]);
  });

  it('a full queue throws and shows nothing as done', async () => {
    const { queryClient, outbox, data } = setup();
    queryClient.setQueryData<NutritionEntry[]>(keys.nutritionDay(U, DAY), []);
    for (let i = 0; i < MAX_QUEUED; i++) await outbox.enqueue(U, { kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date', row: { user_id: U, log_date: `d${i}`, kg: 1 } });
    await expect(data.actions.saveFood(DAY, food('a', T0))).rejects.toBeInstanceOf(OutboxFullError);
    expect(queryClient.getQueryData<NutritionEntry[]>(keys.nutritionDay(U, DAY))).toEqual([]);
  });
});

describe('writing workouts', () => {
  const entriesOnServer = (db: FakeDatabase) => db.rows('workout_entries').map((r) => r.id);
  const repsOnServer = (db: FakeDatabase, id: string) => db.rows('workout_sets').filter((r) => r.entry_id === id).sort((a, b) => Number(a.position) - Number(b.position)).map((r) => r.reps);

  it('saves the entry and its sets, and the server ends up with exactly them', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveWorkout(DAY, lift('w1', [10, 8, 6]));
    await outbox.flush(U);
    expect(entriesOnServer(db)).toEqual(['w1']);
    expect(repsOnServer(db, 'w1')).toEqual([10, 8, 6]);
  });

  it('re-saving with fewer sets while the first save is still queued sends only the new sets', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveWorkout(DAY, lift('w1', [10, 8, 6]));
    await data.actions.saveWorkout(DAY, lift('w1', [12]));
    await outbox.flush(U);
    expect(repsOnServer(db, 'w1')).toEqual([12]);
  });

  it('re-saving with fewer sets after the first save reached the server clears the extras there', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveWorkout(DAY, lift('w1', [10, 8, 6]));
    await outbox.flush(U);
    await data.actions.saveWorkout(DAY, lift('w1', [12, 11]));
    await outbox.flush(U);
    expect(repsOnServer(db, 'w1')).toEqual([12, 11]);
  });

  it('re-saving with more sets adds them', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveWorkout(DAY, lift('w1', [10]));
    await outbox.flush(U);
    await data.actions.saveWorkout(DAY, lift('w1', [10, 9, 8]));
    await outbox.flush(U);
    expect(repsOnServer(db, 'w1')).toEqual([10, 9, 8]);
  });

  it('another workout’s queued sets are untouched by a re-save', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveWorkout(DAY, lift('w1', [10, 8]));
    await data.actions.saveWorkout(DAY, lift('w2', [5, 5, 5]));
    await data.actions.saveWorkout(DAY, lift('w1', [1]));
    await outbox.flush(U);
    expect(repsOnServer(db, 'w1')).toEqual([1]);
    expect(repsOnServer(db, 'w2')).toEqual([5, 5, 5]);
  });

  it('deleting removes the entry and its sets from the server', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveWorkout(DAY, lift('w1', [10, 8]));
    await outbox.flush(U);
    await data.actions.deleteWorkout('w1');
    await outbox.flush(U);
    expect(entriesOnServer(db)).toEqual([]);
    expect(db.rows('workout_sets')).toEqual([]);
  });

  it('saving then deleting while offline never reaches the server', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveWorkout(DAY, lift('w1', [10, 8]));
    await data.actions.deleteWorkout('w1');
    expect(outbox.pending(U)).toEqual([]);
    await outbox.flush(U);
    expect(db.calls).toEqual([]);
  });

  it('a delete after a flushed save does reach the server', async () => {
    const { db, outbox, data } = setup();
    await data.actions.saveWorkout(DAY, lift('w1', [10]));
    await outbox.flush(U);
    await data.actions.deleteWorkout('w1');
    expect(outbox.pending(U).map((q) => q.op.table)).toEqual(['workout_entries']);
    await outbox.flush(U);
    expect(entriesOnServer(db)).toEqual([]);
  });

  it('patches the cached day and the recents the way the screen will read them', async () => {
    const { queryClient, data } = setup();
    queryClient.setQueryData<WorkoutEntry[]>(keys.workoutDay(U, DAY), [lift('w1', [10, 8, 6])]);
    queryClient.setQueryData<RecentWorkout[]>(keys.workoutRecent(U), [{ ...lift('w1', [10, 8, 6]), day: DAY }]);
    await data.actions.saveWorkout(DAY, lift('w1', [12]));
    expect(queryClient.getQueryData<WorkoutEntry[]>(keys.workoutDay(U, DAY))?.[0].sets.map((s) => s.reps)).toEqual([12]);
    expect(queryClient.getQueryData<RecentWorkout[]>(keys.workoutRecent(U))?.[0].sets.map((s) => s.reps)).toEqual([12]);
    await data.actions.deleteWorkout('w1');
    expect(queryClient.getQueryData<WorkoutEntry[]>(keys.workoutDay(U, DAY))).toEqual([]);
    expect(queryClient.getQueryData<RecentWorkout[]>(keys.workoutRecent(U))).toEqual([]);
  });

  it('a full queue leaves both the waiting writes and the screen as they were', async () => {
    const { queryClient, outbox, data } = setup();
    queryClient.setQueryData<WorkoutEntry[]>(keys.workoutDay(U, DAY), []);
    for (let i = 0; i < MAX_QUEUED - 1; i++) await outbox.enqueue(U, { kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date', row: { user_id: U, log_date: `d${i}`, kg: 1 } });
    const before = outbox.pending(U).map((q) => q.id);
    await expect(data.actions.saveWorkout(DAY, lift('w1', [1, 2, 3]))).rejects.toBeInstanceOf(OutboxFullError);
    expect(outbox.pending(U).map((q) => q.id)).toEqual(before);
    expect(queryClient.getQueryData<WorkoutEntry[]>(keys.workoutDay(U, DAY))).toEqual([]);
  });
});

describe('writing weight, goals, settings, plan, favourites, status, activity', () => {
  it('a weigh-in the database would refuse is reported and nothing is queued', async () => {
    const { outbox, data } = setup();
    expect(await data.actions.saveWeight({ day: DAY, kg: 0, loggedAt: T0 })).toBe(false);
    expect(await data.actions.saveWeight({ day: DAY, kg: 401, loggedAt: T0 })).toBe(false);
    expect(outbox.pending(U)).toEqual([]);
  });

  it('a weigh-in lands in every cached range that covers its day and no other', async () => {
    const { queryClient, outbox, db, data } = setup();
    queryClient.setQueryData(keys.weights(U, '2026-10-01', '2026-10-31'), []);
    queryClient.setQueryData(keys.weights(U, '2026-09-01', '2026-09-30'), []);
    expect(await data.actions.saveWeight({ day: DAY, kg: 80.5, loggedAt: T0 })).toBe(true);
    expect(queryClient.getQueryData<unknown[]>(keys.weights(U, '2026-10-01', '2026-10-31'))).toHaveLength(1);
    expect(queryClient.getQueryData<unknown[]>(keys.weights(U, '2026-09-01', '2026-09-30'))).toEqual([]);
    await outbox.flush(U);
    expect(db.rows('weight_entries')).toMatchObject([{ log_date: DAY, kg: 80.5 }]);
    await data.actions.removeWeight(DAY);
    expect(queryClient.getQueryData<unknown[]>(keys.weights(U, '2026-10-01', '2026-10-31'))).toEqual([]);
    await outbox.flush(U);
    expect(db.rows('weight_entries')).toEqual([]);
  });

  it('goals keep the extra the server row had, and show at once', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData(keys.goals(U), { user_id: U, protein: 100, fat: 50, carbs: 100, extra: { keep: 1 } });
    await data.actions.saveGoals({ protein: 130, fat: 70, carbs: 220 });
    expect(queryClient.getQueryData(keys.goals(U))).toMatchObject({ protein: 130, fat: 70, carbs: 220, extra: { keep: 1 } });
    await outbox.flush(U);
    expect(db.rows('nutrition_goals')).toMatchObject([{ user_id: U, protein: 130, fat: 70, carbs: 220, extra: { keep: 1 } }]);
  });

  it('settings keep the HYROX columns the server row had', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData(keys.settings(U), { user_id: U, hyrox_leaderboard_gender: 'women', hyrox_facility_lane_m: 25, hyrox_history_backfilled: true, extra: {} });
    await data.actions.saveSettings({ units: { weight: 'lb', height: 'cm', distance: 'km', clock: '24h' }, language: 'th', theme: 'dark' });
    await outbox.flush(U);
    expect(db.rows('user_settings')).toMatchObject([{ units_weight: 'lb', units_clock: '24h', language: 'th', theme: 'dark', hyrox_leaderboard_gender: 'women', hyrox_facility_lane_m: 25, hyrox_history_backfilled: true }]);
  });

  it('a split plan is saved whole', async () => {
    const { db, queryClient, outbox, data } = setup();
    await data.actions.saveSplitPlan({ splitType: 'ppl', daysPerWeek: 3, goal: 'muscle', days: [{ label: 'Push', exercises: ['Bench press'] }], schedule: { monday: 'Push' }, exercisePrescriptions: {} });
    expect(queryClient.getQueryData(keys.splitPlan(U))).toMatchObject({ split_type: 'ppl' });
    await outbox.flush(U);
    expect(db.rows('split_plans')).toMatchObject([{ split_type: 'ppl', days: [{ label: 'Push', exercises: ['Bench press'] }], schedule: { monday: 'Push' } }]);
  });

  it('favourites toggle in the cache and on the server', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData<string[]>(keys.nutritionFavorites(U), ['Apple']);
    queryClient.setQueryData<string[]>(keys.exerciseFavorites(U), []);
    await data.actions.setFoodFavorite('Egg', true);
    await data.actions.setFoodFavorite('Apple', false);
    await data.actions.setExerciseFavorite('Squat', true);
    expect(queryClient.getQueryData(keys.nutritionFavorites(U))).toEqual(['Egg']);
    expect(queryClient.getQueryData(keys.exerciseFavorites(U))).toEqual(['Squat']);
    await outbox.flush(U);
    expect(db.rows('nutrition_favorites')).toEqual([{ user_id: U, food_name: 'Egg' }]);
    expect(db.rows('exercise_favorites')).toEqual([{ user_id: U, exercise_name: 'Squat' }]);
  });

  it('a day status shows in the cached range and clears again', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData(keys.dayStatuses(U, '2026-10-01', '2026-10-31'), {});
    await data.actions.setDayStatus(DAY, 'fasting');
    expect(queryClient.getQueryData(keys.dayStatuses(U, '2026-10-01', '2026-10-31'))).toEqual({ [DAY]: 'fasting' });
    await outbox.flush(U);
    expect(db.rows('day_status_overrides')).toEqual([{ user_id: U, log_date: DAY, status: 'fasting' }]);
    await data.actions.setDayStatus(DAY, null);
    expect(queryClient.getQueryData(keys.dayStatuses(U, '2026-10-01', '2026-10-31'))).toEqual({});
    await outbox.flush(U);
    expect(db.rows('day_status_overrides')).toEqual([]);
  });

  it('a day status does not count toward the streak', async () => {
    const { queryClient, data } = setup();
    queryClient.setQueryData<string[]>(keys.activeDays(U), []);
    await data.actions.setDayStatus(DAY, 'incomplete');
    expect(queryClient.getQueryData(keys.activeDays(U))).toEqual([]);
  });

  it('a recorded action makes the day active', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData<string[]>(keys.activeDays(U), []);
    await data.actions.markActivity(DAY, 'coach_chat');
    expect(queryClient.getQueryData(keys.activeDays(U))).toEqual([DAY]);
    await outbox.flush(U);
    expect(db.rows('activity_days')).toEqual([{ user_id: U, log_date: DAY, action: 'coach_chat' }]);
  });
});

describe('custom foods and exercises', () => {
  const mine: CustomFood = { id: 1, name: 'Mine', emoji: '🥣', calories: 1, protein: 1, fat: 0, carbs: 0, barcode: null, servingLabel: 'bowl', servingGrams: 100, servings: [] };

  it('a created food goes to the top of the cached list; a repeat of the same id does not double it', async () => {
    const { queryClient, data } = setup();
    queryClient.setQueryData<CustomFood[]>(keys.customFoods(U), [mine]);
    const created = await data.actions.createCustomFood({ name: 'New', protein: 10, fat: 5, carbs: 20 });
    expect(created.id).toBe(7);
    expect(queryClient.getQueryData<CustomFood[]>(keys.customFoods(U))?.map((f) => f.id)).toEqual([7, 1]);
    queryClient.setQueryData<CustomFood[]>(keys.customFoods(U), [created, mine]);
    await data.actions.createCustomFood({ name: 'New', protein: 10, fat: 5, carbs: 20 });
    expect(queryClient.getQueryData<CustomFood[]>(keys.customFoods(U))?.map((f) => f.id)).toEqual([7, 1]);
  });

  it('a deleted food leaves the list', async () => {
    const { queryClient, data } = setup();
    queryClient.setQueryData<CustomFood[]>(keys.customFoods(U), [mine]);
    await data.actions.deleteCustomFood(1);
    expect(queryClient.getQueryData(keys.customFoods(U))).toEqual([]);
  });

  it('when the server refuses, the error reaches the caller and the cache is untouched', async () => {
    const { queryClient, data } = setup({ api: { createCustomFood: async () => { throw Object.assign(new Error('You already have a custom food saved for this barcode.'), { status: 409 }); }, deleteCustomFood: async () => { throw new Error('nope'); } } });
    queryClient.setQueryData<CustomFood[]>(keys.customFoods(U), [mine]);
    await expect(data.actions.createCustomFood({ name: 'x', protein: 1, fat: 1, carbs: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(data.actions.deleteCustomFood(1)).rejects.toThrow('nope');
    expect(queryClient.getQueryData<CustomFood[]>(keys.customFoods(U))).toEqual([mine]);
  });

  it('exercises create and delete the same way', async () => {
    const { queryClient, data } = setup();
    queryClient.setQueryData<CustomExercise[]>(keys.customExercises(U), []);
    const created = await data.actions.createCustomExercise({ name: 'Sled push', mode: 'each' });
    expect(queryClient.getQueryData<CustomExercise[]>(keys.customExercises(U))).toEqual([created]);
    await data.actions.deleteCustomExercise(created.id);
    expect(queryClient.getQueryData(keys.customExercises(U))).toEqual([]);
  });
});

describe('survivors: limits, window edge, replacing a custom exercise', () => {
  it('recent foods are cut to the documented limit, newest kept', async () => {
    const { db, data } = setup();
    db.maxRows = 10_000;
    db.seed('nutrition_entries', Array.from({ length: RECENT_NUTRITION_LIMIT + 1 }, (_, i) => foodRow(`n${i}`, DAY, T0 + i)));
    const recent = await data.fetch.nutritionRecent();
    expect(recent).toHaveLength(RECENT_NUTRITION_LIMIT);
    expect(recent[0].id).toBe(`n${RECENT_NUTRITION_LIMIT}`);
  });

  it('recent workouts are cut to the documented limit, newest kept', async () => {
    const { db, data } = setup();
    db.seed('workout_entries', Array.from({ length: RECENT_WORKOUT_LIMIT + 1 }, (_, i) => ({ user_id: U, id: `w${i}`, log_date: DAY, exercise: 'x', added_at: toTimestamp(T0 + i), unilateral: false, extra: {} })));
    const recent = await data.fetch.workoutRecent();
    expect(recent).toHaveLength(RECENT_WORKOUT_LIMIT);
    expect(recent[0].id).toBe(`w${RECENT_WORKOUT_LIMIT}`);
  });

  it('a day the server alone records, exactly at the edge of the window, counts', async () => {
    const edge = '2025-09-21'; // 400 days before 2026-10-26
    const { data } = setup({ api: { activityDates: async () => ({ [edge]: ['challenge'], '2025-09-20': ['challenge'] }) } });
    expect(await data.fetch.activeDays()).toEqual([edge]);
  });

  it('creating an exercise replaces a cached one with the same id and keeps the others', async () => {
    const { queryClient, data } = setup({ api: { createCustomExercise: async (e) => ({ id: 3, name: e.name, emoji: null, mode: 'each' }) } });
    const keep: CustomExercise = { id: 1, name: 'Keep', emoji: null, mode: 'both' };
    queryClient.setQueryData<CustomExercise[]>(keys.customExercises(U), [keep, { id: 3, name: 'Old name', emoji: null, mode: 'both' }]);
    await data.actions.createCustomExercise({ name: 'New name' });
    expect(queryClient.getQueryData<CustomExercise[]>(keys.customExercises(U))?.map((e) => e.name)).toEqual(['New name', 'Keep']);
  });
});

describe('survivors 2: the documented numbers', () => {
  it('the lists are as long as the plan says', () => {
    expect(RECENT_NUTRITION_LIMIT).toBe(400);
    expect(RECENT_WORKOUT_LIMIT).toBe(60);
    expect(PAGE_SIZE).toBe(1000);
  });
});

describe('the coaching profile for planning', () => {
  it('is the few fields a plan is tailored with', async () => {
    const { db, data } = setup();
    db.seed('coaching_profiles', [{ user_id: OTHER, gender: 'male', weight_kg: 1, goal_weight_kg: 1 }, { user_id: U, gender: 'female', weight_kg: 66, goal_weight_kg: 60, height_cm: 170 }]);
    expect(await data.fetch.coachingProfile()).toEqual({ gender: 'female', goal_weight_kg: 60, current_weight_kg: 66 });
  });

  it('no profile, or trouble reading it, is no tailoring rather than an error', async () => {
    const { db, data } = setup();
    expect(await data.fetch.coachingProfile()).toEqual({});
    db.failWhen = () => ({ status: 500, message: 'boom' });
    expect(await data.fetch.coachingProfile()).toEqual({});
  });
});
