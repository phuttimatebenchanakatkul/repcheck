import type { Supabase } from '@/supabase/client';

import { supabaseExecutor } from '../executor';
import { shouldRetry } from '../queryClient';

function fakeSupabase(result: { error: { code?: string; message?: string } | null; status: number } | Error) {
  const calls: unknown[][] = [];
  const settle = () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result));
  const client = {
    from: (table: string) => ({
      upsert: (row: unknown, options: unknown) => (calls.push(['upsert', table, row, options]), settle()),
      delete: () => ({ match: (filter: unknown) => (calls.push(['delete', table, filter]), settle()) }),
    }),
  };
  return { supabase: client as unknown as Supabase, calls };
}

describe('supabaseExecutor', () => {
  it('upserts the whole row on its key columns', async () => {
    const { supabase, calls } = fakeSupabase({ error: null, status: 201 });
    const row = { user_id: 'u1', log_date: '2026-01-01', kg: 80 };
    expect(await supabaseExecutor(supabase)({ kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date', row })).toBeNull();
    expect(calls).toEqual([['upsert', 'weight_entries', row, { onConflict: 'user_id,log_date' }]]);
  });

  it('deletes by the matching columns only', async () => {
    const { supabase, calls } = fakeSupabase({ error: null, status: 204 });
    const match = { user_id: 'u1', log_date: '2026-01-01' };
    expect(await supabaseExecutor(supabase)({ kind: 'delete', table: 'weight_entries', key: 'user_id,log_date', match })).toBeNull();
    expect(calls).toEqual([['delete', 'weight_entries', match]]);
  });

  it('reports the database’s refusal with its status, code and message', async () => {
    const { supabase } = fakeSupabase({ error: { code: '42501', message: 'row-level security' }, status: 403 });
    const op = { kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date', row: {} } as const;
    expect(await supabaseExecutor(supabase)(op)).toEqual({ status: 403, code: '42501', message: 'row-level security' });
  });

  it('turns a thrown network error into status 0 (retry), never an exception', async () => {
    const { supabase } = fakeSupabase(new TypeError('Network request failed'));
    const op = { kind: 'delete', table: 'weight_entries', key: 'user_id,log_date', match: {} } as const;
    expect(await supabaseExecutor(supabase)(op)).toEqual({ status: 0, message: 'Network request failed' });
  });

  it('copes with a thrown value that is not an Error', async () => {
    const client = { from: () => ({ upsert: () => Promise.reject('nope'), delete: () => ({ match: () => Promise.reject('nope') }) }) } as unknown as Supabase;
    expect(await supabaseExecutor(client)({ kind: 'upsert', table: 'weight_entries', key: 'k', row: {} })).toEqual({ status: 0, message: 'request failed' });
  });
});

describe('shouldRetry (React Query)', () => {
  it('retries a network failure or a server error up to three times', () => {
    for (const error of [{ status: 0 }, { status: 500 }, { status: 503 }, new Error('x'), null, undefined]) {
      expect(shouldRetry(0, error)).toBe(true);
      expect(shouldRetry(2, error)).toBe(true);
      expect(shouldRetry(3, error)).toBe(false);
    }
  });

  it('does not retry an answer that will not change', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) expect(shouldRetry(0, { status })).toBe(false);
  });

  it('does retry a timeout or a rate limit', () => {
    expect(shouldRetry(0, { status: 408 })).toBe(true);
    expect(shouldRetry(0, { status: 429 })).toBe(true);
  });
});
