import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Supabase } from '@/supabase/client';

import type { ChatTurn } from '../../logic/chat';
import { supabaseExecutor } from '../../store/executor';
import { Outbox, rowIdentity, type KeyValueStorage } from '../../store/outbox';
import { FakeDatabase } from '../../testing/fakeSupabase';
import { createData, type DataApi } from '../access';
import { DataContext, useAnalysisThread } from '../hooks';
import { keys } from '../keys';
import { analysisTurnFromRow, analysisTurnToRow, type Row } from '../mappers';
import { analysisTurnSave } from '../ops';
import { overlayAnalysisThread } from '../overlay';

const U = 'user-1';
const OTHER = 'user-2';
const SOURCE = { title: 'ISSN position stand', publisher: 'ISSN', url: 'https://example.org/issn' };

const turn = (id: string, role: ChatTurn['role'], text: string, over: Partial<ChatTurn> = {}): ChatTurn => ({
  id, role, text, sources: role === 'assistant' ? [SOURCE] : null, date: '2026-10-26', ...over,
});
const row = (seq: number, id: string, analysis: number, role: string, body: string, over: Record<string, unknown> = {}) => ({
  seq, user_id: U, analyze_result_id: analysis, client_id: id, role, body, sources: role === 'assistant' ? [SOURCE] : null, extra: { date: '2026-10-26' }, ...over,
});

describe('the row mapping', () => {
  it('reads the role, the key, the sources and the day it was made on', () => {
    expect(analysisTurnFromRow(row(1, 't1', 7, 'assistant', 'Because.') as Row<'analyze_chat_messages'>)).toEqual(turn('t1', 'assistant', 'Because.'));
    expect(analysisTurnFromRow(row(2, 't2', 7, 'user', 'Why?') as Row<'analyze_chat_messages'>)).toEqual(turn('t2', 'user', 'Why?'));
  });

  it('a turn the website wrote has no day, an unreadable one has none either, and a null source list is no footer', () => {
    expect(analysisTurnFromRow(row(1, 'a', 7, 'user', 'x', { extra: {} }) as Row<'analyze_chat_messages'>).date).toBe('');
    expect(analysisTurnFromRow(row(1, 'a', 7, 'user', 'x', { extra: { date: 'yesterday' } }) as Row<'analyze_chat_messages'>).date).toBe('');
    expect(analysisTurnFromRow(row(1, 'a', 7, 'user', 'x', { extra: [] }) as Row<'analyze_chat_messages'>).date).toBe('');
    expect(analysisTurnFromRow(row(1, 'a', 7, 'assistant', 'x', { sources: null }) as Row<'analyze_chat_messages'>).sources).toBeNull();
    expect(analysisTurnFromRow(row(1, 'a', 7, 'assistant', 'x', { sources: [{ title: 'bad', url: 'http://x' }] }) as Row<'analyze_chat_messages'>).sources).toEqual([]);
  });

  it('any role but "user" is the assistant', () => {
    expect(analysisTurnFromRow(row(1, 'a', 7, 'model', 'x') as Row<'analyze_chat_messages'>).role).toBe('assistant');
  });

  it('writes the whole row for that analysis, without a seq', () => {
    const written = analysisTurnToRow(U, 7, turn('t1', 'assistant', 'Because.'));
    expect(written).toEqual({ user_id: U, analyze_result_id: 7, client_id: 't1', role: 'assistant', body: 'Because.', sources: [SOURCE], extra: { date: '2026-10-26' } });
    expect(written).not.toHaveProperty('seq');
    expect(analysisTurnToRow(U, 7, turn('t2', 'user', 'Why?'))).toMatchObject({ role: 'user', sources: null });
  });

  it('a row written and read back is the same turn', () => {
    for (const t of [turn('a', 'user', 'q'), turn('b', 'assistant', 'a'), turn('c', 'assistant', 'none', { sources: [] })]) {
      expect(analysisTurnFromRow({ seq: 1, ...analysisTurnToRow(U, 7, t) } as Row<'analyze_chat_messages'>)).toEqual(t);
    }
  });
});

describe('the operation', () => {
  it('is an upsert on (user, client id); one turn sent twice is one waiting write', () => {
    const op = analysisTurnSave(U, 7, turn('t1', 'user', 'Why?'));
    expect(op).toMatchObject({ kind: 'upsert', table: 'analyze_chat_messages', key: 'user_id,client_id' });
    expect(rowIdentity(op)).toBe(rowIdentity(analysisTurnSave(U, 7, turn('t1', 'user', 'Why? (sent)'))));
    expect(rowIdentity(op)).not.toBe(rowIdentity(analysisTurnSave(U, 7, turn('t2', 'user', 'Why?'))));
  });
});

describe('the overlay', () => {
  const server = [turn('a', 'user', 'q'), turn('b', 'assistant', 'a')];

  it('adds waiting turns for this analysis after the server’s, in order', () => {
    const ops = [analysisTurnSave(U, 7, turn('c', 'user', 'q2')), analysisTurnSave(U, 7, turn('d', 'assistant', 'a2'))];
    expect(overlayAnalysisThread(server, ops, 7).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores a waiting turn that belongs to another analysis', () => {
    expect(overlayAnalysisThread(server, [analysisTurnSave(U, 8, turn('c', 'user', 'other'))], 7).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('replaces a turn the server already has, in its place', () => {
    const next = overlayAnalysisThread(server, [analysisTurnSave(U, 7, turn('a', 'user', 'q (sent)'))], 7);
    expect(next.map((t) => [t.id, t.text])).toEqual([['a', 'q (sent)'], ['b', 'a']]);
  });

  it('ignores deletes (a thread goes with its analysis, never turn by turn) and does not change its input', () => {
    const copy = JSON.parse(JSON.stringify(server));
    const out = overlayAnalysisThread(server, [{ kind: 'delete', table: 'analyze_chat_messages', key: 'user_id,client_id', match: { user_id: U, client_id: 'a' } }], 7);
    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
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

describe('reading and writing a thread', () => {
  it('reads that person’s turns for that analysis, in the database’s order', async () => {
    const { db, data } = setup();
    db.seed('analyze_chat_messages', [
      row(3, 'c', 7, 'user', 'third'),
      row(1, 'a', 7, 'user', 'first'),
      row(2, 'b', 7, 'assistant', 'second'),
      row(4, 'x', 8, 'user', 'another analysis'),
      row(5, 'y', 7, 'user', 'someone else', { user_id: OTHER }),
    ]);
    expect((await data.fetch.analysisThread(7)).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(await data.fetch.analysisThread(99)).toEqual([]);
  });

  it('a saved turn is queued, then sent to its analysis and numbered by the database', async () => {
    const { db, data, outbox } = setup();
    await data.actions.saveAnalysisTurn(7, turn('t1', 'user', 'Why?'));
    await data.actions.saveAnalysisTurn(7, turn('t2', 'assistant', 'Because.'));
    expect(outbox.pending(U)).toHaveLength(2);
    await outbox.flush(U);
    expect(db.rows('analyze_chat_messages').map((r) => [r.client_id, r.seq, r.role, r.analyze_result_id])).toEqual([['t1', 1, 'user', 7], ['t2', 2, 'assistant', 7]]);
  });

  it('shows at once in the thread of that analysis only', async () => {
    const { data, queryClient } = setup();
    queryClient.setQueryData(keys.analysisThread(U, 7), []);
    queryClient.setQueryData(keys.analysisThread(U, 8), []);
    await data.actions.saveAnalysisTurn(7, turn('t1', 'user', 'Why?'));
    expect(queryClient.getQueryData<ChatTurn[]>(keys.analysisThread(U, 7))?.map((t) => t.id)).toEqual(['t1']);
    expect(queryClient.getQueryData<ChatTurn[]>(keys.analysisThread(U, 8))).toEqual([]);
  });
});

describe('useAnalysisThread', () => {
  it('the server’s turns, then a waiting turn from this device, and not another analysis’s', async () => {
    const h = setup();
    h.db.seed('analyze_chat_messages', [row(1, 'a', 7, 'user', 'first')]);
    const hook = await renderHook(() => useAnalysisThread(7), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.data.map((t) => t.id)).toEqual(['a']));
    await act(async () => {
      await h.data.actions.saveAnalysisTurn(7, turn('b', 'assistant', 'second'));
      await h.data.actions.saveAnalysisTurn(8, turn('z', 'user', 'elsewhere'));
    });
    await hook.rerender({});
    expect(hook.result.current.data.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it.each([[NaN], [0], [-3], [1.5]])('asks nothing for %s, which is not a real analysis', async (id) => {
    const h = setup();
    const hook = await renderHook(() => useAnalysisThread(id), { wrapper: h.wrapper });
    await act(async () => undefined);
    expect(hook.result.current.data).toEqual([]);
    expect(h.db.calls).toEqual([]);
  });

  it('asks for the smallest real id', async () => {
    const h = setup();
    h.db.seed('analyze_chat_messages', [row(1, 'a', 1, 'user', 'first')]);
    const hook = await renderHook(() => useAnalysisThread(1), { wrapper: h.wrapper });
    await waitFor(() => expect(hook.result.current.data.map((t) => t.id)).toEqual(['a']));
  });
});
