import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Supabase } from '@/supabase/client';

import type { NutritionEntry, WorkoutEntry } from '../../logic/types';
import { supabaseExecutor } from '../../store/executor';
import { Outbox, type KeyValueStorage } from '../../store/outbox';
import { FakeDatabase } from '../../testing/fakeSupabase';
import { createData, type DataApi } from '../access';
import {
  DataContext,
  useActions,
  useActiveDays,
  useCustomExercises,
  useCustomFoods,
  useDayStatuses,
  useExerciseFavorites,
  useFoodFavorites,
  useGoals,
  useNutritionDay,
  useNutritionRecent,
  useSettings,
  useSplitPlan,
  useStreak,
  useWeights,
  useWorkoutDay,
  useWorkoutRecent,
} from '../hooks';
import { toTimestamp } from '../mappers';

const U = 'user-1';
const OTHER = 'user-2';
const DAY = '2026-10-26';
const T0 = new Date(2026, 9, 26, 8, 0, 0).getTime();
const NOW = new Date(2026, 9, 26, 12, 0, 0);

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
}

function harness(apiOver: Partial<DataApi> = {}) {
  const db = new FakeDatabase();
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const outbox = new Outbox(memoryStorage(), supabaseExecutor(db.client() as unknown as Supabase));
  const api: DataApi = {
    listCustomFoods: async () => [], createCustomFood: jest.fn(), deleteCustomFood: jest.fn(), listCustomExercises: async () => [],
    createCustomExercise: jest.fn(), deleteCustomExercise: jest.fn(), activityDates: async () => ({}), ...apiOver,
  };
  const data = createData({ userId: U, reader: db.client(), outbox, queryClient, api, tzOffsetMinutes: () => 0, now: () => NOW });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={{ data, queue: outbox.pending() }}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  return { db, queryClient, outbox, data, wrapper };
}

const food = (id: string, addedAt: number, over: Partial<NutritionEntry> = {}): NutritionEntry => ({ id, food: `Food ${id}`, addedAt, grams: 100, unit: 'g', baseCalories: 100, baseCarbs: 0, baseFat: 0, baseProtein: 0, ...over });
const foodRow = (id: string, day: string, addedAt: number, user = U) => ({
  user_id: user, id, log_date: day, food: `Food ${id}`, added_at: toTimestamp(addedAt), source: null, grams: 100, unit: 'g', base_calories: 100, base_carbs: 0, base_fat: 0, base_protein: 0, ingredients: null, extra: {},
});
const set = (reps: number) => ({ reps, weightKg: 50, leftKg: null, rightKg: null, leftReps: null, rightReps: null });
const lift = (id: string, reps: number[], over: Partial<WorkoutEntry> = {}): WorkoutEntry => ({ id, exercise: `Lift ${id}`, addedAt: T0, unilateral: false, sets: reps.map(set), ...over });

describe('a hook outside the provider', () => {
  it('says what is wrong rather than failing obscurely', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useGoals())).rejects.toThrow('DataProvider');
    spy.mockRestore();
  });
});

describe('the food log', () => {
  it('is loading, then the server’s entries', async () => {
    const h = harness();
    h.db.seed('nutrition_entries', [foodRow('a', DAY, T0), foodRow('b', DAY, T0 + 1), foodRow('x', '2026-10-25', T0), foodRow('o', DAY, T0, OTHER)]);
    const { result } = await renderHook(() => useNutritionDay(DAY), { wrapper: h.wrapper });
    expect(result.current).toMatchObject({ data: [], isLoading: true, isError: false });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('shows an entry that is only queued (offline) and hides one that is queued for deletion', async () => {
    const h = harness();
    h.db.seed('nutrition_entries', [foodRow('a', DAY, T0), foodRow('b', DAY, T0 + 5)]);
    h.db.failWhen = (kind) => (kind === 'upsert' || kind === 'delete' ? { status: 0, message: 'offline' } : null);
    const { result, rerender } = await renderHook(() => useNutritionDay(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    await act(async () => {
      await h.data.actions.saveFood(DAY, food('c', T0 + 9));
      await h.data.actions.deleteFood('a');
    });
    await rerender({});
    expect(result.current.data.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('keeps showing a queued entry when the server is refetched without it', async () => {
    const h = harness();
    const { result, rerender } = await renderHook(() => useNutritionDay(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await h.data.actions.saveFood(DAY, food('c', T0));
    });
    await rerender({});
    await act(async () => {
      await h.queryClient.invalidateQueries({ queryKey: ['data', U] }); // the server still has nothing
    });
    await rerender({});
    expect(result.current.data.map((e) => e.id)).toEqual(['c']);
  });

  it('once the write is sent and the screen reads again, the server’s copy is shown (and nothing is doubled)', async () => {
    const h = harness();
    const { result, rerender } = await renderHook(() => useNutritionDay(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await h.data.actions.saveFood(DAY, food('c', T0));
      await h.outbox.flush(U);
      await h.queryClient.invalidateQueries({ queryKey: ['data', U] });
    });
    await rerender({});
    expect(h.outbox.pending(U)).toEqual([]);
    expect(result.current.data.map((e) => e.id)).toEqual(['c']);
  });

  it('another person’s queued writes never show', async () => {
    const h = harness();
    const { result, rerender } = await renderHook(() => useNutritionDay(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await h.outbox.enqueue(OTHER, { kind: 'upsert', table: 'nutrition_entries', key: 'user_id,id', row: foodRow('z', DAY, T0, OTHER) });
    await rerender({});
    expect(result.current.data).toEqual([]);
  });

  it('a failed first load is an error with nothing to show; queued entries still show', async () => {
    const h = harness();
    h.db.failWhen = (kind) => (kind === 'read' ? { status: 500, message: 'boom' } : null);
    await h.outbox.enqueue(U, { kind: 'upsert', table: 'nutrition_entries', key: 'user_id,id', row: foodRow('q', DAY, T0) });
    const { result } = await renderHook(() => useNutritionDay(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data.map((e) => e.id)).toEqual(['q']);
  });

  it('a failed refetch is not an error while there is cached data to show', async () => {
    const h = harness();
    h.db.seed('nutrition_entries', [foodRow('a', DAY, T0)]);
    const { result } = await renderHook(() => useNutritionDay(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    h.db.failWhen = () => ({ status: 500, message: 'boom' });
    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(h.db.calls.filter((c) => c === 'read:nutrition_entries').length).toBeGreaterThan(1));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toHaveLength(1);
  });

  it('switching day reads that day', async () => {
    const h = harness();
    h.db.seed('nutrition_entries', [foodRow('a', DAY, T0), foodRow('x', '2026-10-25', T0)]);
    const { result, rerender } = await renderHook(({ day }: { day: string }) => useNutritionDay(day), { wrapper: h.wrapper, initialProps: { day: DAY } });
    await waitFor(() => expect(result.current.data.map((e) => e.id)).toEqual(['a']));
    await rerender({ day: '2026-10-25' });
    await waitFor(() => expect(result.current.data.map((e) => e.id)).toEqual(['x']));
  });

  it('recent foods overlay too', async () => {
    const h = harness();
    h.db.seed('nutrition_entries', [foodRow('a', DAY, T0)]);
    const { result, rerender } = await renderHook(() => useNutritionRecent(), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    await act(async () => {
      await h.data.actions.saveFood(DAY, food('b', T0 + 100));
    });
    await rerender({});
    expect(result.current.data.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('workouts', () => {
  it('a re-saved workout with fewer sets shows only the new sets, before and after sending', async () => {
    const h = harness();
    await h.data.actions.saveWorkout(DAY, lift('w1', [10, 8, 6]));
    await h.outbox.flush(U);
    const { result, rerender } = await renderHook(() => useWorkoutDay(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.data[0]?.sets).toHaveLength(3));
    h.db.failWhen = (kind) => (kind === 'upsert' || kind === 'delete' ? { status: 0, message: 'offline' } : null);
    await act(async () => {
      await h.data.actions.saveWorkout(DAY, lift('w1', [12]));
    });
    await rerender({});
    expect(result.current.data[0].sets.map((s) => s.reps)).toEqual([12]);
    await act(async () => {
      await h.queryClient.invalidateQueries({ queryKey: ['data', U] }); // refetch while the save is still waiting
    });
    await rerender({});
    expect(result.current.data[0].sets.map((s) => s.reps)).toEqual([12]);
    h.db.failWhen = null;
    await act(async () => {
      await h.outbox.flush(U);
      await h.queryClient.invalidateQueries({ queryKey: ['data', U] });
    });
    await rerender({});
    expect(result.current.data[0].sets.map((s) => s.reps)).toEqual([12]);
    expect(h.db.rows('workout_sets')).toHaveLength(1);
  });

  it('recent workouts and favourites', async () => {
    const h = harness();
    h.db.seed('exercise_favorites', [{ user_id: U, exercise_name: 'Squat' }]);
    const recent = await renderHook(() => useWorkoutRecent(), { wrapper: h.wrapper });
    const favourites = await renderHook(() => useExerciseFavorites(), { wrapper: h.wrapper });
    await waitFor(() => expect(favourites.result.current.data).toEqual(['Squat']));
    await act(async () => {
      await h.data.actions.saveWorkout(DAY, lift('w1', [5]));
      await h.data.actions.setExerciseFavorite('Deadlift', true);
    });
    await recent.rerender({});
    await favourites.rerender({});
    expect(recent.result.current.data.map((e) => e.id)).toEqual(['w1']);
    expect(favourites.result.current.data).toEqual(['Deadlift', 'Squat']);
  });
});

describe('one-row settings', () => {
  it('goals: the defaults, then the server’s, then a waiting edit', async () => {
    const h = harness();
    h.db.seed('nutrition_goals', [{ user_id: U, protein: 100, fat: 50, carbs: 100, extra: {} }]);
    const { result, rerender } = await renderHook(() => useGoals(), { wrapper: h.wrapper });
    expect(result.current.data).toEqual({ protein: 150, fat: 65, carbs: 200, calories: 1985 });
    await waitFor(() => expect(result.current.data.calories).toBe(1250));
    await act(async () => {
      await h.data.actions.saveGoals({ protein: 120, fat: 60, carbs: 150 });
    });
    await rerender({});
    expect(result.current.data).toEqual({ protein: 120, fat: 60, carbs: 150, calories: 1620 });
  });

  it('settings: a waiting edit wins over the server’s row', async () => {
    const h = harness();
    h.db.seed('user_settings', [{ user_id: U, units_weight: 'kg' }]);
    h.db.failWhen = (kind) => (kind === 'upsert' ? { status: 0, message: 'offline' } : null);
    const { result, rerender } = await renderHook(() => useSettings(), { wrapper: h.wrapper });
    await waitFor(() => expect(h.db.calls).toContain('read:user_settings'));
    await act(async () => {
      await h.data.actions.saveSettings({ units: { weight: 'lb', height: 'cm', distance: 'km', clock: '12h' }, language: null, theme: null });
    });
    await rerender({});
    expect(result.current.data.units.weight).toBe('lb');
  });

  it('split plan: none, then a waiting plan', async () => {
    const h = harness();
    const { result, rerender } = await renderHook(() => useSplitPlan(), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    await act(async () => {
      await h.data.actions.saveSplitPlan({ splitType: 'ppl', daysPerWeek: 3, goal: null, days: [{ label: 'Push', exercises: ['Bench press'] }], schedule: { monday: 'Push' }, exercisePrescriptions: {} });
    });
    await rerender({});
    expect(result.current.data).toMatchObject({ splitType: 'ppl', days: [{ label: 'Push' }] });
  });

  it('food favourites, weights and day statuses overlay their waiting writes', async () => {
    const h = harness();
    h.db.seed('nutrition_favorites', [{ user_id: U, food_name: 'Apple' }]);
    const fav = await renderHook(() => useFoodFavorites(), { wrapper: h.wrapper });
    const weights = await renderHook(() => useWeights('2026-10-01', '2026-10-31'), { wrapper: h.wrapper });
    const statuses = await renderHook(() => useDayStatuses('2026-10-01', '2026-10-31'), { wrapper: h.wrapper });
    await waitFor(() => expect(fav.result.current.data).toEqual(['Apple']));
    await act(async () => {
      await h.data.actions.setFoodFavorite('Egg', true);
      await h.data.actions.saveWeight({ day: DAY, kg: 80, loggedAt: T0 });
      await h.data.actions.setDayStatus(DAY, 'fasting');
    });
    await fav.rerender({});
    await weights.rerender({});
    await statuses.rerender({});
    expect(fav.result.current.data).toEqual(['Apple', 'Egg']);
    expect(weights.result.current.data).toEqual([{ day: DAY, kg: 80, loggedAt: T0 }]);
    expect(statuses.result.current.data).toEqual({ [DAY]: 'fasting' });
  });
});

describe('the streak', () => {
  it('counts the server’s days and the days of logs still waiting to be sent', async () => {
    const h = harness({ activityDates: async () => ({ '2026-10-23': ['challenge'] }) });
    h.db.seed('nutrition_entries', [foodRow('a', '2026-10-24', T0)]);
    h.db.failWhen = (kind) => (kind === 'upsert' ? { status: 0, message: 'offline' } : null);
    const { result, rerender } = await renderHook(() => useStreak(NOW), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.data.active.size).toBe(2));
    expect(result.current.data.current).toBe(0); // 24th is not yesterday-or-today
    await act(async () => {
      await h.data.actions.saveFood('2026-10-25', food('b', T0));
      await h.data.actions.saveFood(DAY, food('c', T0));
    });
    await rerender({});
    expect(Array.from(result.current.data.active).sort()).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', DAY]);
    expect(result.current.data.current).toBe(4);
    expect(result.current.data.longest).toBe(4);
  });

  it('a streak that ran up to yesterday still counts before today has anything', async () => {
    const h = harness();
    h.db.seed('nutrition_entries', [foodRow('a', '2026-10-24', T0), foodRow('b', '2026-10-25', T0)]);
    const { result } = await renderHook(() => useStreak(NOW), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.data.current).toBe(2));
  });

  it('active days are sorted and unique', async () => {
    const h = harness();
    h.db.seed('nutrition_entries', [foodRow('a', DAY, T0), foodRow('b', DAY, T0 + 1)]);
    const { result } = await renderHook(() => useActiveDays(), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.data).toEqual([DAY]));
  });
});

describe('custom foods and exercises', () => {
  it('come from the API', async () => {
    const h = harness({
      listCustomFoods: async () => [{ id: 1, name: 'Mine', emoji: '🥣', calories: 1, protein: 1, fat: 0, carbs: 0, barcode: null, servingLabel: 'bowl', servingGrams: 100, servings: [] }],
      listCustomExercises: async () => [{ id: 2, name: 'Sled', emoji: null, mode: 'both' }],
    });
    const foods = await renderHook(() => useCustomFoods(), { wrapper: h.wrapper });
    const exercises = await renderHook(() => useCustomExercises(), { wrapper: h.wrapper });
    await waitFor(() => expect(foods.result.current.data.map((f) => f.name)).toEqual(['Mine']));
    await waitFor(() => expect(exercises.result.current.data.map((e) => e.name)).toEqual(['Sled']));
  });

  it('a failing API is an error state, not a crash', async () => {
    const h = harness({ listCustomFoods: async () => { throw Object.assign(new Error('down'), { status: 503 }); } });
    const { result } = await renderHook(() => useCustomFoods(), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useActions', () => {
  it('is the data layer’s writes', async () => {
    const h = harness();
    const { result } = await renderHook(() => useActions(), { wrapper: h.wrapper });
    expect(result.current).toBe(h.data.actions);
  });
});
