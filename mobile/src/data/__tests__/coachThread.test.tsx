import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Supabase } from '@/supabase/client';

import type { ChatTurn } from '../../logic/chat';
import { supabaseExecutor } from '../../store/executor';
import { Outbox, rowIdentity, type KeyValueStorage, type Operation } from '../../store/outbox';
import { FakeDatabase } from '../../testing/fakeSupabase';
import { createData, type DataApi } from '../access';
import { DataContext, useCoachThread } from '../hooks';
import { keys } from '../keys';
import { coachTurnFromRow, coachTurnToRow, type Row } from '../mappers';
import { coachClear, coachTurnSave } from '../ops';
import { overlayCoachThread } from '../overlay';

const U = 'user-1';
const OTHER = 'user-2';
const DAY = '2026-10-26';
const YESTERDAY = '2026-10-25';
const SOURCE = { title: 'ISSN position stand', publisher: 'ISSN', url: 'https://example.org/issn' };

const turn = (id: string, role: ChatTurn['role'], text: string, over: Partial<ChatTurn> = {}): ChatTurn => ({
  id, role, text, sources: role === 'assistant' ? [SOURCE] : null, date: DAY, ...over,
});
const row = (seq: number, id: string, role: string, body: string, over: Record<string, unknown> = {}) => ({
  seq, user_id: U, client_id: id, role, body, msg_date: DAY, sources: role === 'coach' ? [SOURCE] : null, extra: {}, ...over,
});

describe('the row mapping', () => {
  it('the AI’s side is "coach" in the table and "assistant" in the app, and the key is the client id', () => {
    expect(coachTurnFromRow(row(1, 't1', 'coach', 'Eat.') as Row<'coach_messages'>)).toEqual(turn('t1', 'assistant', 'Eat.'));
    expect(coachTurnFromRow(row(2, 't2', 'user', 'Hi') as Row<'coach_messages'>)).toEqual(turn('t2', 'user', 'Hi'));
  });

  it('an old turn with no date has none, a null list of sources is no footer, and a bad citation is dropped', () => {
    expect(coachTurnFromRow(row(1, 'a', 'coach', 'x', { msg_date: null }) as Row<'coach_messages'>).date).toBe('');
    expect(coachTurnFromRow(row(1, 'a', 'coach', 'x', { sources: null }) as Row<'coach_messages'>).sources).toBeNull();
    expect(coachTurnFromRow(row(1, 'a', 'coach', 'x', { sources: [{ title: 'bad', url: 'javascript:1' }, SOURCE] }) as Row<'coach_messages'>).sources).toEqual([SOURCE]);
    expect(coachTurnFromRow(row(1, 'a', 'coach', 'x', { sources: {} }) as Row<'coach_messages'>).sources).toBeNull();
  });

  it('writes the whole row, without a seq (the database numbers it)', () => {
    const written = coachTurnToRow(U, turn('t1', 'assistant', 'Eat.'));
    expect(written).toEqual({ user_id: U, client_id: 't1', role: 'coach', body: 'Eat.', msg_date: DAY, sources: [SOURCE], extra: {} });
    expect(written).not.toHaveProperty('seq');
    expect(coachTurnToRow(U, turn('t2', 'user', 'Hi'))).toMatchObject({ role: 'user', sources: null });
  });

  it('a row written and read back is the same turn', () => {
    for (const t of [turn('a', 'user', 'q'), turn('b', 'assistant', 'a'), turn('c', 'assistant', 'no sources', { sources: [] })]) {
      expect(coachTurnFromRow({ seq: 1, ...coachTurnToRow(U, t) } as Row<'coach_messages'>)).toEqual(t);
    }
  });
});

describe('the operations', () => {
  it('a turn is an upsert on (user, client id); two saves of one turn are one waiting write', () => {
    const op = coachTurnSave(U, turn('t1', 'user', 'Hi'));
    expect(op).toMatchObject({ kind: 'upsert', table: 'coach_messages', key: 'user_id,client_id' });
    expect(rowIdentity(op)).toBe(rowIdentity(coachTurnSave(U, turn('t1', 'user', 'Hi again'))));
    expect(rowIdentity(op)).not.toBe(rowIdentity(coachTurnSave(U, turn('t2', 'user', 'Hi'))));
  });

  it('a clear deletes by the person alone, and its key column is on the match', () => {
    const op = coachClear(U);
    expect(op).toEqual({ kind: 'delete', table: 'coach_messages', key: 'user_id', match: { user_id: U } });
  });
});

describe('the overlay', () => {
  const server = [turn('a', 'user', 'q'), turn('b', 'assistant', 'a')];

  it('waiting turns come after the server’s, in the order they were made', () => {
    const ops = [coachTurnSave(U, turn('c', 'user', 'q2')), coachTurnSave(U, turn('d', 'assistant', 'a2'))];
    expect(overlayCoachThread(server, ops).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a turn the server already has is replaced where it is, not added again', () => {
    const edited = overlayCoachThread(server, [coachTurnSave(U, turn('a', 'user', 'q (sent)'))]);
    expect(edited.map((t) => [t.id, t.text])).toEqual([['a', 'q (sent)'], ['b', 'a']]);
  });

  it('a waiting clear empties the thread, and what is saved after it is all that is left', () => {
    expect(overlayCoachThread(server, [coachClear(U)])).toEqual([]);
    const after = overlayCoachThread(server, [coachClear(U), coachTurnSave(U, turn('e', 'user', 'fresh'))]);
    expect(after.map((t) => t.id)).toEqual(['e']);
    const before = overlayCoachThread(server, [coachTurnSave(U, turn('e', 'user', 'fresh')), coachClear(U)]);
    expect(before).toEqual([]);
  });

  it('does not change what it was given', () => {
    const copy = JSON.parse(JSON.stringify(server));
    overlayCoachThread(server, [coachClear(U), coachTurnSave(U, turn('e', 'user', 'x'))]);
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

describe('reading the thread', () => {
  it('is that person’s turns for that day, in the database’s order', async () => {
    const { db, data } = setup();
    db.seed('coach_messages', [
      row(3, 'c', 'user', 'third'),
      row(1, 'a', 'user', 'first'),
      row(2, 'b', 'coach', 'second'),
      row(4, 'old', 'user', 'yesterday', { msg_date: YESTERDAY }),
      row(5, 'x', 'user', 'someone else', { user_id: OTHER }),
    ]);
    expect((await data.fetch.coachThread(DAY)).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('a day with nothing is an empty thread', async () => {
    expect(await setup().data.fetch.coachThread(DAY)).toEqual([]);
  });
});

describe('writing the thread', () => {
  it('a saved turn is queued, sent to the right table once there is signal, and numbered by the database', async () => {
    const { db, data, outbox } = setup();
    await data.actions.saveCoachTurn(turn('t1', 'user', 'Hi'));
    await data.actions.saveCoachTurn(turn('t2', 'assistant', 'Hello'));
    expect(outbox.pending(U)).toHaveLength(2);
    await outbox.flush(U);
    expect(db.rows('coach_messages').map((r) => [r.client_id, r.seq, r.role])).toEqual([['t1', 1, 'user'], ['t2', 2, 'coach']]);
    expect((await data.fetch.coachThread(DAY)).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('a turn that is sent twice is one row', async () => {
    const { db, data, outbox } = setup();
    await data.actions.saveCoachTurn(turn('t1', 'user', 'Hi'));
    await outbox.flush(U);
    await data.actions.saveCoachTurn(turn('t1', 'user', 'Hi'));
    await outbox.flush(U);
    expect(db.rows('coach_messages')).toHaveLength(1);
  });

  it('shows at once in the cached day it belongs to, and not in another day’s', async () => {
    const { data, queryClient } = setup();
    queryClient.setQueryData(keys.coachThread(U, DAY), []);
    queryClient.setQueryData(keys.coachThread(U, YESTERDAY), []);
    await data.actions.saveCoachTurn(turn('t1', 'user', 'Hi'));
    expect(queryClient.getQueryData<ChatTurn[]>(keys.coachThread(U, DAY))?.map((t) => t.id)).toEqual(['t1']);
    expect(queryClient.getQueryData<ChatTurn[]>(keys.coachThread(U, YESTERDAY))).toEqual([]);
  });

  it('clearing removes the person’s turns on every day, and only theirs', async () => {
    const { db, data, outbox } = setup();
    db.seed('coach_messages', [row(1, 'a', 'user', 'q'), row(2, 'old', 'user', 'older', { msg_date: YESTERDAY }), row(3, 'x', 'user', 'theirs', { user_id: OTHER })]);
    await data.actions.clearCoach();
    await outbox.flush(U);
    expect(db.rows('coach_messages').map((r) => r.client_id)).toEqual(['x']);
  });

  it('clearing drops turns still waiting to be sent, so they are not sent after the clear', async () => {
    const { db, data, outbox } = setup();
    await data.actions.saveCoachTurn(turn('t1', 'user', 'Hi'));
    await data.actions.clearCoach();
    const waiting = outbox.pending(U).map((q) => q.op as Operation);
    expect(waiting.map((op) => [op.kind, op.table])).toEqual([['delete', 'coach_messages']]);
    await outbox.flush(U);
    expect(db.rows('coach_messages')).toEqual([]);
  });

  it('a turn made after a clear is kept', async () => {
    const { db, data, outbox, queryClient } = setup();
    queryClient.setQueryData(keys.coachThread(U, DAY), [turn('a', 'user', 'q')]);
    await data.actions.clearCoach();
    expect(queryClient.getQueryData<ChatTurn[]>(keys.coachThread(U, DAY))).toEqual([]);
    await data.actions.saveCoachTurn(turn('b', 'user', 'fresh'));
    await outbox.flush(U);
    expect(db.rows('coach_messages').map((r) => r.client_id)).toEqual(['b']);
  });
});

describe('useCoachThread', () => {
  it('the server’s turns, then a waiting turn from this device', async () => {
    const h = setup();
    h.db.seed('coach_messages', [row(1, 'a', 'user', 'first')]);
    const hook = await renderHook(() => useCoachThread(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.data.map((t) => t.id)).toEqual(['a']));
    await act(async () => {
      await h.data.actions.saveCoachTurn(turn('b', 'assistant', 'second'));
    });
    await hook.rerender({});
    expect(hook.result.current.data.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('a waiting turn from another day is not laid over today’s thread', async () => {
    const h = setup();
    const hook = await renderHook(() => useCoachThread(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await act(async () => {
      await h.data.actions.saveCoachTurn(turn('old', 'user', 'yesterday', { date: YESTERDAY }));
    });
    await hook.rerender({});
    expect(hook.result.current.data).toEqual([]);
  });

  it('a waiting clear hides what the server still has', async () => {
    const h = setup();
    h.db.seed('coach_messages', [row(1, 'a', 'user', 'first')]);
    const hook = await renderHook(() => useCoachThread(DAY), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    h.db.failWhen = (kind) => (kind === 'delete' ? { status: 0, message: 'offline' } : null);
    await act(async () => {
      await h.data.actions.clearCoach();
    });
    await hook.rerender({});
    expect(hook.result.current.data).toEqual([]);
  });
});
