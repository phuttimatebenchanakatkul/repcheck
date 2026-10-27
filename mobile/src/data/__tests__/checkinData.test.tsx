import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Supabase } from '@/supabase/client';

import { supabaseExecutor } from '../../store/executor';
import { Outbox, rowIdentity, type KeyValueStorage } from '../../store/outbox';
import { FakeDatabase } from '../../testing/fakeSupabase';
import { DataError, createData, type DataApi } from '../access';
import { DataContext, useCoachingProfile, useGoalHandled, useInactivityNoticedOn } from '../hooks';
import { keys } from '../keys';
import { coachingRowAfterCheckin, coachingRowWithInactivityNoticed, type Row } from '../mappers';
import { coachingCheckinSave, coachingInactivityNoticed, coachingProfileSave } from '../ops';

const U = 'user-1';
const NOW = new Date(2026, 9, 27, 12);

const storedRow = (over: Record<string, unknown> = {}) =>
  ({
    user_id: U, aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
    goal_weight_kg: 62, height_cm: 165, distribution_mode: 'stable', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: '2026-01-05', last_adjustment_on: '2026-10-20',
    last_adjustment_reason: 'old', last_adjustment_delta: 40, last_adjustment_at: '2026-10-20T08:00:00.000Z', weekly_distribution: { monday: 1 }, goal_achieved_weight_kg: 62,
    goal_achieved_aspiration: 'lose', goal_handled_weight_kg: null, goal_handled_aspiration: null, inactivity_notified_on: '2026-10-25', extra: { note: 'kept' }, ...over,
  }) as Row<'coaching_profiles'>;

const checkin = { today: '2026-10-27', nowIso: '2026-10-27T05:00:00.000Z', adjustment: null, goalHandled: false };

describe('the coaching row after a check-in', () => {
  it('moves the check-in day and keeps everything else', () => {
    const row = coachingRowAfterCheckin(storedRow(), checkin);
    expect(row).toEqual({ ...storedRow(), last_adjustment_on: '2026-10-27' });
  });

  it('records why and by how much the targets moved, and when', () => {
    const row = coachingRowAfterCheckin(storedRow(), { ...checkin, adjustment: { reason: 'Weight is stalling.', delta: -80 } });
    expect(row).toMatchObject({ last_adjustment_on: '2026-10-27', last_adjustment_reason: 'Weight is stalling.', last_adjustment_delta: -80, last_adjustment_at: '2026-10-27T05:00:00.000Z' });
  });

  it('on track leaves the last adjustment as it was', () => {
    expect(coachingRowAfterCheckin(storedRow(), checkin)).toMatchObject({ last_adjustment_reason: 'old', last_adjustment_delta: 40, last_adjustment_at: '2026-10-20T08:00:00.000Z' });
  });

  it('a reached goal is marked handled, with the flag that made the check-in early cleared', () => {
    const row = coachingRowAfterCheckin(storedRow(), { ...checkin, goalHandled: true });
    expect(row).toMatchObject({ goal_handled_weight_kg: 62, goal_handled_aspiration: 'lose', goal_achieved_weight_kg: null, goal_achieved_aspiration: null });
  });

  it('a goal not reached leaves the handled marker alone', () => {
    const row = coachingRowAfterCheckin(storedRow({ goal_handled_weight_kg: 60, goal_handled_aspiration: 'gain' }), checkin);
    expect(row).toMatchObject({ goal_handled_weight_kg: 60, goal_handled_aspiration: 'gain', goal_achieved_weight_kg: 62 });
  });

  it('the operation is the same waiting write as a wizard save', () => {
    const op = coachingCheckinSave(U, storedRow(), checkin);
    expect(op).toMatchObject({ kind: 'upsert', table: 'coaching_profiles', key: 'user_id' });
    expect(rowIdentity(op)).toBe(rowIdentity(coachingProfileSave(U, { ...dataOf(), lastAdjustmentOn: '2026-10-27' }, null, null)));
  });
});

function dataOf() {
  return {
    aspiration: 'lose' as const, gender: 'female' as const, weightKg: 70, goalWeightKg: 62, heightCm: 165, bodyFatRangeId: 'f3', activityLevel: 'lift_only' as const,
    proteinPreference: 'high' as const, dietPreference: 'low_carb' as const, distribution: 'stable' as const, lossRatePct: 0.5, gainRatePct: null, createdOn: '2026-01-05', lastAdjustmentOn: '2026-10-20',
  };
}

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
  const layer = createData({ userId: U, reader: db.client(), outbox, queryClient, api, tzOffsetMinutes: () => 0, now: () => NOW });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={{ data: layer, queue: outbox.pending() }}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  return { db, queryClient, outbox, data: layer, wrapper };
}

describe('saveCheckin', () => {
  it('an adjustment: the row, the new macros and the streak day are all saved', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData(keys.coachingRow(U), storedRow());
    queryClient.setQueryData(keys.activeDays(U), []);
    await data.actions.saveCheckin({ adjustment: { calories: 1950, protein: 150, fat: 62, carbs: 198, delta: -80, reason: 'Stalling.' }, goalReached: false });
    expect(queryClient.getQueryData<Row<'coaching_profiles'>>(keys.coachingRow(U))).toMatchObject({ last_adjustment_on: '2026-10-27', last_adjustment_reason: 'Stalling.', last_adjustment_delta: -80 });
    expect(queryClient.getQueryData(keys.activeDays(U))).toEqual(['2026-10-27']);
    await outbox.flush(U);
    expect(db.rows('coaching_profiles')[0]).toMatchObject({ user_id: U, last_adjustment_on: '2026-10-27', last_adjustment_reason: 'Stalling.', last_adjustment_delta: -80, inactivity_notified_on: '2026-10-25', extra: { note: 'kept' } });
    expect(db.rows('nutrition_goals')[0]).toMatchObject({ user_id: U, protein: 150, fat: 62, carbs: 198 });
    expect(db.rows('activity_days')).toEqual([{ user_id: U, log_date: '2026-10-27', action: 'checkin' }]);
  });

  it('on track: the day moves, the goals are left alone', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData(keys.coachingRow(U), storedRow());
    await data.actions.saveCheckin({ adjustment: null, goalReached: false });
    await outbox.flush(U);
    expect(db.rows('coaching_profiles')[0]).toMatchObject({ last_adjustment_on: '2026-10-27', last_adjustment_reason: 'old' });
    expect(db.rows('nutrition_goals')).toEqual([]);
    expect(db.rows('activity_days')).toHaveLength(1);
  });

  it('a reached goal is marked handled and the goals are left alone', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData(keys.coachingRow(U), storedRow());
    await data.actions.saveCheckin({ adjustment: null, goalReached: true });
    await outbox.flush(U);
    expect(db.rows('coaching_profiles')[0]).toMatchObject({ goal_handled_weight_kg: 62, goal_handled_aspiration: 'lose', goal_achieved_weight_kg: null });
    expect(db.rows('nutrition_goals')).toEqual([]);
  });

  it('with no coaching row there is nothing to record it on, and nothing is sent', async () => {
    const { db, queryClient, outbox, data } = setup();
    queryClient.setQueryData(keys.coachingRow(U), null);
    await expect(data.actions.saveCheckin({ adjustment: null, goalReached: false })).rejects.toBeInstanceOf(DataError);
    await outbox.flush(U);
    expect(db.rows('coaching_profiles')).toEqual([]);
    expect(db.rows('activity_days')).toEqual([]);
  });
});

describe('what the screens read after a check-in', () => {
  it('the profile has the new check-in day at once, and the goal marker shows what was handled', async () => {
    const h = setup();
    h.db.seed('coaching_profiles', [storedRow()]);
    const hook = await renderHook(() => ({ profile: useCoachingProfile(), handled: useGoalHandled() }), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.profile.data?.lastAdjustmentOn).toBe('2026-10-20'));
    expect(hook.result.current.handled.data).toEqual({ weightKg: null, aspiration: null });
    await act(async () => {
      await h.data.actions.saveCheckin({ adjustment: null, goalReached: true });
    });
    await hook.rerender({});
    expect(hook.result.current.profile.data?.lastAdjustmentOn).toBe('2026-10-27');
    expect(hook.result.current.handled.data).toEqual({ weightKg: 62, aspiration: 'lose' });
  });

  it('nothing handled before a profile exists', async () => {
    const h = setup();
    const hook = await renderHook(() => useGoalHandled(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.data).toEqual({ weightKg: null, aspiration: null });
  });
});

describe('dismissing the inactivity nudge', () => {
  it('notes today on the row and changes nothing else', () => {
    expect(coachingRowWithInactivityNoticed(storedRow(), '2026-10-27')).toEqual({ ...storedRow(), inactivity_notified_on: '2026-10-27' });
  });

  it('is the same waiting write as any other save of the coaching row', () => {
    const op = coachingInactivityNoticed(U, storedRow(), '2026-10-27');
    expect(op).toMatchObject({ kind: 'upsert', table: 'coaching_profiles', key: 'user_id' });
    expect(rowIdentity(op)).toBe(rowIdentity(coachingProfileSave(U, dataOf(), null, null)));
  });

  it('is shown at once, sent as the whole row, and read back by the hook', async () => {
    const h = setup();
    h.db.seed('coaching_profiles', [storedRow()]);
    const hook = await renderHook(() => useInactivityNoticedOn(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.data).toBe('2026-10-25');
    await act(async () => {
      await h.data.actions.dismissInactivity();
    });
    await hook.rerender({});
    expect(hook.result.current.data).toBe('2026-10-27');
    await h.outbox.flush(U);
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ inactivity_notified_on: '2026-10-27', extra: { note: 'kept' }, last_adjustment_on: '2026-10-20' });
  });

  it('with no coaching row there is nothing to record it on, and nothing is sent', async () => {
    const h = setup();
    h.queryClient.setQueryData(keys.coachingRow(U), null);
    await h.data.actions.dismissInactivity();
    await h.outbox.flush(U);
    expect(h.db.rows('coaching_profiles')).toEqual([]);
  });

  it('with no profile the hook says no day', async () => {
    const h = setup();
    const hook = await renderHook(() => useInactivityNoticedOn(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.data).toBeNull();
  });
});
