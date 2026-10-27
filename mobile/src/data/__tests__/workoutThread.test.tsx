import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Supabase } from '@/supabase/client';

import type { ChatTurn } from '../../logic/chat';
import { supabaseExecutor } from '../../store/executor';
import { Outbox, rowIdentity, type KeyValueStorage, type Operation } from '../../store/outbox';
import { FakeDatabase } from '../../testing/fakeSupabase';
import { WORKOUT_HISTORY_LIMIT, createData, type DataApi } from '../access';
import { DataContext, useWorkoutHistory, useWorkoutThread } from '../hooks';
import { keys } from '../keys';
import { toTimestamp, workoutTurnFromRow, workoutTurnToRow, type Row } from '../mappers';
import { workoutChatClear, workoutTurnSave } from '../ops';
import { overlayWorkoutThread } from '../overlay';

const U = 'user-1';
const OTHER = 'user-2';
const DAY = '2026-10-26';
const PREV = '2026-10-25';
const SOURCE = { title: 'ACSM progression models', publisher: 'ACSM', url: 'https://example.org/acsm' };

const turn = (id: string, role: ChatTurn['role'], text: string, over: Partial<ChatTurn> = {}): ChatTurn => ({
  id, role, text, sources: role === 'assistant' ? [SOURCE] : null, date: DAY, ...over,
});
const row = (seq: number, id: string, role: string, body: string, over: Record<string, unknown> = {}) => ({
  seq, user_id: U, client_id: id, role, body, msg_date: DAY, sources: role === 'assistant' ? [SOURCE] : null, extra: {}, ...over,
});

describe('the row mapping', () => {
  it('reads the role, the key, the sources and the day', () => {
    expect(workoutTurnFromRow(row(1, 't1', 'assistant', 'Add 2.5 kg.') as Row<'workout_chat_messages'>)).toEqual(turn('t1', 'assistant', 'Add 2.5 kg.'));
    expect(workoutTurnFromRow(row(2, 't2', 'user', 'How?') as Row<'workout_chat_messages'>)).toEqual(turn('t2', 'user', 'How?'));
    expect(workoutTurnFromRow(row(3, 't3', 'assistant', 'x', { sources: null }) as Row<'workout_chat_messages'>).sources).toBeNull();
    expect(workoutTurnFromRow(row(3, 't3', 'assistant', 'x', { sources: [{ title: 'bad', url: 'ftp://x' }] }) as Row<'workout_chat_messages'>).sources).toEqual([]);
  });

  it('writes the whole row under the turn’s day, without a seq', () => {
    const written = workoutTurnToRow(U, turn('t1', 'assistant', 'Add 2.5 kg.'));
    expect(written).toEqual({ user_id: U, client_id: 't1', role: 'assistant', body: 'Add 2.5 kg.', msg_date: DAY, sources: [SOURCE], extra: {} });
    expect(written).not.toHaveProperty('seq');
    expect(workoutTurnToRow(U, turn('t2', 'user', 'How?'))).toMatchObject({ role: 'user', sources: null });
  });

  it('a row written and read back is the same turn', () => {
    for (const t of [turn('a', 'user', 'q'), turn('b', 'assistant', 'a'), turn('c', 'assistant', 'none', { sources: [] })]) {
      expect(workoutTurnFromRow({ seq: 1, ...workoutTurnToRow(U, t) } as Row<'workout_chat_messages'>)).toEqual(t);
    }
  });
});

describe('the operations', () => {
  it('a turn is an upsert on (user, client id); two saves of one turn are one waiting write', () => {
    const op = workoutTurnSave(U, turn('t1', 'user', 'How?'));
    expect(op).toMatchObject({ kind: 'upsert', table: 'workout_chat_messages', key: 'user_id,client_id' });
    expect(rowIdentity(op)).toBe(rowIdentity(workoutTurnSave(U, turn('t1', 'user', 'How? (sent)'))));
  });

  it('a clear is for one day of one person, and its key columns are on the match', () => {
    const op = workoutChatClear(U, DAY);
    expect(op).toEqual({ kind: 'delete', table: 'workout_chat_messages', key: 'user_id,msg_date', match: { user_id: U, msg_date: DAY } });
    expect(rowIdentity(op)).not.toBe(rowIdentity(workoutChatClear(U, PREV)));
  });
});

describe('the overlay', () => {
  const server = [turn('a', 'user', 'q'), turn('b', 'assistant', 'a')];

  it('adds waiting turns for the day after the server’s, in order, and ignores other days’', () => {
    const ops = [workoutTurnSave(U, turn('c', 'user', 'q2')), workoutTurnSave(U, turn('p', 'user', 'yesterday', { date: PREV })), workoutTurnSave(U, turn('d', 'assistant', 'a2'))];
    expect(overlayWorkoutThread(server, ops, DAY).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('replaces a turn the server already has, where it is', () => {
    expect(overlayWorkoutThread(server, [workoutTurnSave(U, turn('a', 'user', 'q (sent)'))], DAY).map((t) => [t.id, t.text])).toEqual([['a', 'q (sent)'], ['b', 'a']]);
  });

  it('a waiting clear of the day empties it; a clear of another day changes nothing', () => {
    expect(overlayWorkoutThread(server, [workoutChatClear(U, DAY)], DAY)).toEqual([]);
    expect(overlayWorkoutThread(server, [workoutChatClear(U, PREV)], DAY).map((t) => t.id)).toEqual(['a', 'b']);
    expect(overlayWorkoutThread(server, [workoutChatClear(U, DAY), workoutTurnSave(U, turn('e', 'user', 'fresh'))], DAY).map((t) => t.id)).toEqual(['e']);
    expect(overlayWorkoutThread(server, [workoutTurnSave(U, turn('e', 'user', 'fresh')), workoutChatClear(U, DAY)], DAY)).toEqual([]);
  });

  it('does not change its input', () => {
    const copy = JSON.parse(JSON.stringify(server));
    overlayWorkoutThread(server, [workoutChatClear(U, DAY), workoutTurnSave(U, turn('e', 'user', 'x'))], DAY);
    expect(server).toEqual(copy);
  });
});

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
}

function setup() {
  const db = new FakeDatabase();
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const outbox = new Outbox(memoryStorage(), supabaseExecutor(db.client() as unknown as Supabase));
  const api: DataApi = {
    listCustomFoods: async () => [], createCustomFood: jest.fn(), deleteCustomFood: jest.fn(), listCustomExercises: async () => [],
    createCustomExercise: jest.fn(), deleteCustomExercise: jest.fn(), activityDates: async () => ({}),
  };
  const data = createData({ userId: U, reader: db.client(), outbox, queryClient, api, tzOffsetMinutes: () => 0, now: () => new Date(2026, 9, 26, 12) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={{ data, queue: outbox.pending() }}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  return { db, queryClient, outbox, data, wrapper };
}

describe('reading and writing a day’s thread', () => {
  it('reads that person’s turns for that day, in the database’s order', async () => {
    const { db, data } = setup();
    db.seed('workout_chat_messages', [row(3, 'c', 'user', 'third'), row(1, 'a', 'user', 'first'), row(2, 'b', 'assistant', 'second'), row(4, 'old', 'user', 'yesterday', { msg_date: PREV }), row(5, 'x', 'user', 'theirs', { user_id: OTHER })]);
    expect((await data.fetch.workoutThread(DAY)).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(await data.fetch.workoutThread('2026-01-01')).toEqual([]);
  });

  it('a saved turn is queued, sent under its day, and numbered by the database', async () => {
    const { db, data, outbox } = setup();
    await data.actions.saveWorkoutTurn(turn('t1', 'user', 'How?'));
    await data.actions.saveWorkoutTurn(turn('t2', 'assistant', 'Add weight.'));
    await outbox.flush(U);
    expect(db.rows('workout_chat_messages').map((r) => [r.client_id, r.seq, r.role, r.msg_date])).toEqual([['t1', 1, 'user', DAY], ['t2', 2, 'assistant', DAY]]);
  });

  it('shows at once in that day’s cached thread only', async () => {
    const { data, queryClient } = setup();
    queryClient.setQueryData(keys.workoutThread(U, DAY), []);
    queryClient.setQueryData(keys.workoutThread(U, PREV), []);
    await data.actions.saveWorkoutTurn(turn('t1', 'user', 'How?'));
    expect(queryClient.getQueryData<ChatTurn[]>(keys.workoutThread(U, DAY))?.map((t) => t.id)).toEqual(['t1']);
    expect(queryClient.getQueryData<ChatTurn[]>(keys.workoutThread(U, PREV))).toEqual([]);
  });

  it('clearing a day removes that day’s turns and no other day’s, and no one else’s', async () => {
    const { db, data, outbox } = setup();
    db.seed('workout_chat_messages', [row(1, 'a', 'user', 'today'), row(2, 'p', 'user', 'yesterday', { msg_date: PREV }), row(3, 'x', 'user', 'theirs', { user_id: OTHER })]);
    await data.actions.clearWorkoutThread(DAY);
    await outbox.flush(U);
    expect(db.rows('workout_chat_messages').map((r) => r.client_id)).toEqual(['p', 'x']);
  });

  it('clearing drops that day’s turns still waiting, but keeps another day’s waiting turns', async () => {
    const { db, data, outbox } = setup();
    await data.actions.saveWorkoutTurn(turn('t1', 'user', 'today'));
    await data.actions.saveWorkoutTurn(turn('p1', 'user', 'yesterday', { date: PREV }));
    await data.actions.clearWorkoutThread(DAY);
    const waiting = outbox.pending(U).map((q) => q.op as Operation);
    expect(waiting.map((op) => [op.kind, op.kind === 'upsert' ? op.row.client_id : op.match.msg_date])).toEqual([['upsert', 'p1'], ['delete', DAY]]);
    await outbox.flush(U);
    expect(db.rows('workout_chat_messages').map((r) => r.client_id)).toEqual(['p1']);
  });

  it('a turn made after a clear is kept', async () => {
    const { db, data, outbox, queryClient } = setup();
    queryClient.setQueryData(keys.workoutThread(U, DAY), [turn('a', 'user', 'q')]);
    await data.actions.clearWorkoutThread(DAY);
    expect(queryClient.getQueryData<ChatTurn[]>(keys.workoutThread(U, DAY))).toEqual([]);
    await data.actions.saveWorkoutTurn(turn('b', 'user', 'fresh'));
    await outbox.flush(U);
    expect(db.rows('workout_chat_messages').map((r) => r.client_id)).toEqual(['b']);
  });
});

describe('useWorkoutThread', () => {
  it('the server’s turns for the day, then a waiting turn, and a waiting clear', async () => {
    const h = setup();
    h.db.seed('workout_chat_messages', [row(1, 'a', 'user', 'first')]);
    const hook = await renderHook(() => useWorkoutThread(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.data.map((t) => t.id)).toEqual(['a']));
    await act(async () => {
      await h.data.actions.saveWorkoutTurn(turn('b', 'assistant', 'second'));
      await h.data.actions.saveWorkoutTurn(turn('p', 'user', 'other day', { date: PREV }));
    });
    await hook.rerender({});
    expect(hook.result.current.data.map((t) => t.id)).toEqual(['a', 'b']);
    await act(async () => {
      await h.data.actions.clearWorkoutThread(DAY);
    });
    await hook.rerender({});
    expect(hook.result.current.data).toEqual([]);
  });
});

describe('the workouts the chat is told about', () => {
  const entry = (id: string, day: string, hour = 9) => ({ user_id: U, id, log_date: day, exercise: `Lift ${id}`, added_at: toTimestamp(new Date(`${day}T0${hour}:00:00`).getTime()), unilateral: false, extra: {} });

  it('reaches further back than the recent list does', async () => {
    const { db, data } = setup();
    expect(WORKOUT_HISTORY_LIMIT).toBe(300);
    db.seed('workout_entries', Array.from({ length: 150 }, (_, i) => ({ ...entry(`w${i}`, DAY), added_at: toTimestamp(Date.UTC(2026, 0, 1) + i * 1000) })));
    expect(await data.fetch.workoutHistory()).toHaveLength(150);
    expect(await data.fetch.workoutRecent()).toHaveLength(60);
  });

  it('a workout logged now is in it at once, and in the hook', async () => {
    const h = setup();
    const hook = await renderHook(() => useWorkoutHistory(), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await act(async () => {
      await h.data.actions.saveWorkout(DAY, { id: 'w1', exercise: 'Squat', addedAt: new Date(2026, 9, 26, 9).getTime(), unilateral: false, sets: [{ reps: 5, weightKg: 100, leftKg: null, rightKg: null, leftReps: null, rightReps: null }] });
    });
    await hook.rerender({});
    expect(hook.result.current.data.map((e) => [e.id, e.day])).toEqual([['w1', DAY]]);
  });
});
