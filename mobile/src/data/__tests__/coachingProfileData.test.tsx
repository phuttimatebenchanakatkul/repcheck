import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Supabase } from '@/supabase/client';

import type { CoachingData } from '../../logic/coachingProfile';
import { supabaseExecutor } from '../../store/executor';
import { Outbox, rowIdentity, type KeyValueStorage } from '../../store/outbox';
import { FakeDatabase } from '../../testing/fakeSupabase';
import { createData, type DataApi } from '../access';
import { DataContext, useCoachingProfile } from '../hooks';
import { keys } from '../keys';
import { coachingRowFromData, type Row } from '../mappers';
import { coachingProfileSave } from '../ops';

const U = 'user-1';
const WEEK = { monday: { calories: 2300 }, sunday: { calories: 1900 } };

const data = (over: Partial<CoachingData> = {}): CoachingData => ({
  aspiration: 'lose', gender: 'female', weightKg: 70, goalWeightKg: 62, heightCm: 165, bodyFatRangeId: 'f3', activityLevel: 'lift_only',
  proteinPreference: 'high', dietPreference: 'low_carb', distribution: 'weekly', lossRatePct: 0.5, gainRatePct: null, createdOn: '2026-01-05', lastAdjustmentOn: '2026-10-27', ...over,
});
const storedRow = (over: Record<string, unknown> = {}) => ({
  user_id: U, aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
  goal_weight_kg: 62, height_cm: 165, distribution_mode: 'weekly', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: '2026-01-05', last_adjustment_on: '2026-10-20',
  last_adjustment_reason: 'x', last_adjustment_delta: -50, last_adjustment_at: '2026-10-20T08:00:00Z', weekly_distribution: null, goal_achieved_weight_kg: 62,
  goal_achieved_aspiration: 'lose', goal_handled_weight_kg: 62, goal_handled_aspiration: 'lose', inactivity_notified_on: '2026-10-25', extra: { note: 'kept' }, ...over,
});

describe('the whole row for a finished wizard', () => {
  it('has every answer, and the week when calories are spread', () => {
    const row = coachingRowFromData(U, data(), null, WEEK);
    expect(row).toMatchObject({
      user_id: U, aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
      goal_weight_kg: 62, height_cm: 165, distribution_mode: 'weekly', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: '2026-01-05', last_adjustment_on: '2026-10-27', weekly_distribution: WEEK,
    });
  });

  it('starts the plan over: the last adjustment and any reached goal are cleared', () => {
    const row = coachingRowFromData(U, data(), storedRow() as Row<'coaching_profiles'>, null);
    expect(row).toMatchObject({
      last_adjustment_reason: null, last_adjustment_delta: null, last_adjustment_at: null, goal_achieved_weight_kg: null, goal_achieved_aspiration: null,
      goal_handled_weight_kg: null, goal_handled_aspiration: null, weekly_distribution: null,
    });
  });

  it('keeps what this version does not manage', () => {
    const row = coachingRowFromData(U, data(), storedRow() as Row<'coaching_profiles'>, null);
    expect(row.inactivity_notified_on).toBe('2026-10-25');
    expect(row.extra).toEqual({ note: 'kept' });
    expect(coachingRowFromData(U, data(), null, null)).toMatchObject({ inactivity_notified_on: null, extra: {} });
  });

  it('writes every column, so a replaced row never keeps a stale value', () => {
    expect(Object.keys(coachingRowFromData(U, data(), null, null)).sort()).toEqual(Object.keys(storedRow()).sort());
  });
});

describe('the operation', () => {
  it('is an upsert on the person, and two saves are one waiting write', () => {
    const op = coachingProfileSave(U, data(), null, null);
    expect(op).toMatchObject({ kind: 'upsert', table: 'coaching_profiles', key: 'user_id' });
    expect(rowIdentity(op)).toBe(rowIdentity(coachingProfileSave(U, data({ weightKg: 71 }), null, null)));
  });
});

function memoryStorage(): KeyValueStorage {
  const store = new Map<string, string>();
  return { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => void store.set(k, v), removeItem: async (k) => void store.delete(k) };
}

function setup() {
  const db = new FakeDatabase();
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const outbox = new Outbox(memoryStorage(), supabaseExecutor(db.client() as unknown as Supabase));
  const api: DataApi = {
    listCustomFoods: async () => [], createCustomFood: jest.fn(), deleteCustomFood: jest.fn(), listCustomExercises: async () => [],
    createCustomExercise: jest.fn(), deleteCustomExercise: jest.fn(), activityDates: async () => ({}),
  };
  const dataLayer = createData({ userId: U, reader: db.client(), outbox, queryClient, api, tzOffsetMinutes: () => 0, now: () => new Date(2026, 9, 27, 12) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={{ data: dataLayer, queue: outbox.pending() }}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  return { db, queryClient, outbox, data: dataLayer, wrapper };
}

describe('reading and saving', () => {
  it('reads the row, or nothing', async () => {
    const { db, data: layer } = setup();
    expect(await layer.fetch.coachingRow()).toBeNull();
    db.seed('coaching_profiles', [storedRow(), storedRow({ user_id: 'user-2', weight_kg: 99 })]);
    expect((await layer.fetch.coachingRow())?.weight_kg).toBe(70);
  });

  it('a save is queued, shown at once from the cache, and sent as one row', async () => {
    const { db, data: layer, outbox, queryClient } = setup();
    db.seed('coaching_profiles', [storedRow()]);
    queryClient.setQueryData(keys.coachingRow(U), storedRow());
    await layer.actions.saveCoachingProfile(data({ weightKg: 68 }), WEEK);
    expect(queryClient.getQueryData<Row<'coaching_profiles'>>(keys.coachingRow(U))).toMatchObject({ weight_kg: 68, extra: { note: 'kept' }, weekly_distribution: WEEK });
    await outbox.flush(U);
    const rows = db.rows('coaching_profiles');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ weight_kg: 68, last_adjustment_reason: null, goal_achieved_weight_kg: null, inactivity_notified_on: '2026-10-25', weekly_distribution: WEEK });
  });

  it('the second save starts from the first, not from what was last read', async () => {
    const { data: layer, queryClient } = setup();
    queryClient.setQueryData(keys.coachingRow(U), storedRow({ extra: { a: 1 } }));
    await layer.actions.saveCoachingProfile(data(), null);
    await layer.actions.saveCoachingProfile(data({ weightKg: 66 }), null);
    expect(queryClient.getQueryData<Row<'coaching_profiles'>>(keys.coachingRow(U))).toMatchObject({ weight_kg: 66, extra: { a: 1 } });
  });
});

describe('useCoachingProfile', () => {
  it('null until a profile exists, then the stored one, then a waiting save over it', async () => {
    const h = setup();
    const hook = await renderHook(() => useCoachingProfile(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.data).toBeNull();
    await act(async () => {
      await h.data.actions.saveCoachingProfile(data({ weightKg: 68 }), null);
    });
    await hook.rerender({});
    expect(hook.result.current.data?.weightKg).toBe(68);
    expect(hook.result.current.data?.dietPreference).toBe('low_carb');
  });

  it('the server’s row when nothing is waiting', async () => {
    const h = setup();
    h.db.seed('coaching_profiles', [storedRow()]);
    const hook = await renderHook(() => useCoachingProfile(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.data?.weightKg).toBe(70));
    expect(hook.result.current.data).toMatchObject({ aspiration: 'lose', createdOn: '2026-01-05', lastAdjustmentOn: '2026-10-20' });
  });

  it('a half-made profile reads as none', async () => {
    const h = setup();
    h.db.seed('coaching_profiles', [storedRow({ weight_kg: null })]);
    const hook = await renderHook(() => useCoachingProfile(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.data).toBeNull();
  });
});

describe('survivors: a save waiting in the queue', () => {
  it('shows over what the server has, even if the cache was not patched', async () => {
    const h = setup();
    h.db.seed('coaching_profiles', [storedRow()]);
    const hook = await renderHook(() => useCoachingProfile(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.data?.weightKg).toBe(70));
    await act(async () => {
      await h.outbox.enqueue(U, coachingProfileSave(U, data({ weightKg: 68, aspiration: 'maintain', lossRatePct: null }), null, null));
    });
    await hook.rerender({});
    expect(hook.result.current.data).toMatchObject({ weightKg: 68, aspiration: 'maintain' });
  });

  it('the newest of several waiting saves wins', async () => {
    const h = setup();
    const hook = await renderHook(() => useCoachingProfile(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await act(async () => {
      await h.outbox.enqueue(U, coachingProfileSave(U, data({ weightKg: 68 }), null, null));
      await h.outbox.enqueue(U, { kind: 'upsert', table: 'workout_entries', key: 'user_id,id', row: { user_id: U, id: 'w' } });
    });
    await hook.rerender({});
    expect(hook.result.current.data?.weightKg).toBe(68);
  });
});
