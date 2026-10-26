/** A whole data layer in memory for screen tests: a fake Supabase, a real outbox and query cache, and the provider screens read from. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import type { Supabase } from '@/supabase/client';

import { createData, type DataApi } from '../data/access';
import { DataContext } from '../data/hooks';
import { toTimestamp } from '../data/mappers';
import { supabaseExecutor } from '../store/executor';
import { Outbox, type KeyValueStorage } from '../store/outbox';
import { FakeDatabase } from './fakeSupabase';

export const USER = 'user-1';

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
}

export function dataHarness(apiOver: Partial<DataApi> = {}, now: () => Date = () => new Date()) {
  const db = new FakeDatabase();
  // No gc timers (they would keep Jest alive) and no retries (a failed read should fail the test, not wait).
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const outbox = new Outbox(memoryStorage(), supabaseExecutor(db.client() as unknown as Supabase));
  const api: DataApi = {
    listCustomFoods: async () => [],
    createCustomFood: async (food) => ({ id: 1, name: food.name, emoji: '🍽️', calories: Math.round(food.protein * 4 + food.carbs * 4 + food.fat * 9), protein: food.protein, fat: food.fat, carbs: food.carbs, barcode: null, servingLabel: food.servingLabel ?? '1 serving', servingGrams: food.servingGrams ?? 100, servings: [] }),
    deleteCustomFood: async () => undefined,
    listCustomExercises: async () => [],
    createCustomExercise: async (e) => ({ id: 1, name: e.name, emoji: e.emoji ?? null, mode: e.mode ?? 'both' }),
    deleteCustomExercise: async () => undefined,
    activityDates: async () => ({}),
    ...apiOver,
  };
  const data = createData({ userId: USER, reader: db.client(), outbox, queryClient, api, tzOffsetMinutes: () => 0, now });

  function Provider({ children }: { children: ReactNode }) {
    const [queue, setQueue] = useState(outbox.pending(USER));
    useEffect(() => outbox.subscribe(() => setQueue(outbox.pending(USER))), []);
    return (
      <QueryClientProvider client={queryClient}>
        <DataContext.Provider value={{ data, queue }}>{children}</DataContext.Provider>
      </QueryClientProvider>
    );
  }

  return {
    db,
    queryClient,
    outbox,
    data,
    api,
    Provider,
    /** Sends everything waiting, as the sync manager does once there is signal. */
    flush: () => outbox.flush(USER),
    /** Make every write the "server" receives fail as if there were no signal (reads still work: this is the offline-with-cache case). */
    goOffline: () => {
      db.failWhen = (kind) => (kind === 'upsert' || kind === 'delete' ? { status: 0, message: 'offline' } : null);
    },
    goOnline: () => {
      db.failWhen = null;
    },
  };
}

export const nutritionRow = (id: string, day: string, addedAt: number, over: Record<string, unknown> = {}) => ({
  user_id: USER, id, log_date: day, food: `Food ${id}`, added_at: toTimestamp(addedAt), source: null, grams: 100, unit: 'g',
  base_calories: 100, base_carbs: 10, base_fat: 5, base_protein: 20, ingredients: null, extra: {}, ...over,
});
