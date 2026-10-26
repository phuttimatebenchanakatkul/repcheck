import type { Supabase } from '@/supabase/client';

import type { Executor, ExecutorError } from './outbox';

/** A client that does not know the table at compile time: the outbox carries table names as data. */
interface LooseClient {
  from(table: string): {
    upsert(row: Record<string, unknown>, options: { onConflict: string }): PromiseLike<LooseResult>;
    delete(): { match(filter: Record<string, unknown>): PromiseLike<LooseResult> };
  };
}

interface LooseResult {
  error: { code?: string; message?: string } | null;
  status: number;
}

/**
 * Sends a queued operation to Supabase as the signed-in person (row-level security decides whether it is allowed).
 * supabase-js reports a request that never completed as status 0; a thrown error is treated the same.
 */
export function supabaseExecutor(supabase: Supabase): Executor {
  const client = supabase as unknown as LooseClient;
  return async (op): Promise<ExecutorError | null> => {
    try {
      const result =
        op.kind === 'upsert'
          ? await client.from(op.table).upsert(op.row, { onConflict: op.key })
          : await client.from(op.table).delete().match(op.match);
      return result.error ? { status: result.status, code: result.error.code, message: result.error.message } : null;
    } catch (error) {
      return { status: 0, message: error instanceof Error ? error.message : 'request failed' };
    }
  };
}
