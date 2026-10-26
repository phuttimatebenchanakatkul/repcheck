import {
  BASE_DELAY_MS,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  MAX_FAILED,
  MAX_QUEUED,
  Outbox,
  OutboxFullError,
  STORAGE_KEY,
  backoffDelay,
  classify,
  rowIdentity,
  type Executor,
  type ExecutorError,
  type KeyValueStorage,
  type Operation,
} from '../outbox';

function memoryStorage(initial?: string): KeyValueStorage & { data: Map<string, string>; writes: number } {
  const data = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  const storage = {
    data,
    writes: 0,
    async getItem(key: string) {
      return data.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      storage.writes++;
      data.set(key, value);
    },
    async removeItem(key: string) {
      data.delete(key);
    },
  };
  return storage;
}

type Upsert = Extract<Operation, { kind: 'upsert' }>;
const rowOf = (op: Operation) => (op as Upsert).row;
const entry = (id: string, extra: Record<string, unknown> = {}): Upsert => ({ kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date', row: { user_id: 'u1', log_date: id, kg: 80, ...extra } });
const remove = (id: string): Operation => ({ kind: 'delete', table: 'weight_entries', key: 'user_id,log_date', match: { user_id: 'u1', log_date: id } });

/** An executor that records what it was sent and answers from a script (null = success). */
function scripted(...answers: (ExecutorError | null)[]) {
  const sent: Operation[] = [];
  const execute: Executor = jest.fn(async (op) => {
    sent.push(op);
    return answers.length ? (answers.shift() ?? null) : null;
  });
  return { execute, sent };
}

let clock = 1_000;
const now = () => clock++;
const make = (storage = memoryStorage(), executor = scripted()) => ({ outbox: new Outbox(storage, executor.execute, now), storage, ...executor });

describe('classify and backoff', () => {
  it.each([
    [{ status: 0 }, 'retry'],
    [{}, 'retry'],
    [{ status: 408 }, 'retry'],
    [{ status: 429 }, 'retry'],
    [{ status: 500 }, 'retry'],
    [{ status: 503 }, 'retry'],
    [{ status: 400 }, 'drop'],
    [{ status: 401 }, 'drop'],
    [{ status: 403, code: '42501' }, 'drop'],
    [{ status: 404 }, 'drop'],
    [{ status: 409, code: '23505' }, 'drop'],
    [{ status: 422 }, 'drop'],
  ] as const)('%j -> %s', (error, expected) => {
    expect(classify(error)).toBe(expected);
  });

  it('doubles from 2 s and stops at 5 minutes', () => {
    expect([1, 2, 3, 4].map(backoffDelay)).toEqual([BASE_DELAY_MS, 2 * BASE_DELAY_MS, 4 * BASE_DELAY_MS, 8 * BASE_DELAY_MS]);
    expect(backoffDelay(0)).toBe(BASE_DELAY_MS);
    expect(backoffDelay(50)).toBe(MAX_DELAY_MS);
  });

  it('identifies a row by its table and key columns, whatever else the row holds', () => {
    expect(rowIdentity(entry('2026-01-01'))).toBe(rowIdentity(entry('2026-01-01', { kg: 99 })));
    expect(rowIdentity(entry('2026-01-01'))).not.toBe(rowIdentity(entry('2026-01-02')));
    expect(rowIdentity(entry('2026-01-01'))).toBe(rowIdentity(remove('2026-01-01')));
    expect(rowIdentity({ kind: 'delete', table: 'weight_entries', key: 'user_id,log_date', match: { user_id: 'u2', log_date: '2026-01-01' } })).not.toBe(rowIdentity(remove('2026-01-01')));
  });
});

describe('queueing', () => {
  it('keeps operations in the order they were queued and sends them in that order', async () => {
    const { outbox, sent } = make();
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u1', entry('b'));
    await outbox.enqueue('u1', remove('c'));
    expect(await outbox.flush('u1')).toEqual({ sent: 3, dropped: 0, retryInMs: null });
    expect(sent.map((o) => (o.kind === 'upsert' ? o.row.log_date : o.match.log_date))).toEqual(['a', 'b', 'c']);
    expect(outbox.pending()).toEqual([]);
  });

  it('a newer write to a waiting row replaces it in place', async () => {
    const { outbox, sent } = make();
    await outbox.enqueue('u1', entry('a', { kg: 80 }));
    await outbox.enqueue('u1', entry('b'));
    await outbox.enqueue('u1', entry('a', { kg: 79 }));
    expect(outbox.pending()).toHaveLength(2);
    await outbox.flush('u1');
    expect(sent[0]).toMatchObject({ row: { log_date: 'a', kg: 79 } });
    expect(sent).toHaveLength(2);
  });

  it('a delete after a waiting upsert cancels both: the server never hears of the row', async () => {
    const { outbox, sent } = make();
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u1', remove('a'));
    expect(outbox.pending()).toEqual([]);
    await outbox.flush('u1');
    expect(sent).toEqual([]);
  });

  it('an upsert after a waiting delete replaces the delete', async () => {
    const { outbox, sent } = make();
    await outbox.enqueue('u1', remove('a'));
    await outbox.enqueue('u1', entry('a', { kg: 70 }));
    await outbox.flush('u1');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'upsert', row: { kg: 70 } });
  });

  it('two people never coalesce into each other', async () => {
    const { outbox } = make();
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u2', entry('a'));
    expect(outbox.pending()).toHaveLength(2);
    expect(outbox.pending('u1')).toHaveLength(1);
  });

  it('a different table with the same key does not coalesce', async () => {
    const { outbox } = make();
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u1', { kind: 'upsert', table: 'day_status_overrides', key: 'user_id,log_date', row: { user_id: 'u1', log_date: 'a', status: 'fasting' } });
    expect(outbox.pending()).toHaveLength(2);
  });

  it('refuses to grow without bound', async () => {
    const { outbox } = make();
    for (let i = 0; i < MAX_QUEUED; i++) await outbox.enqueue('u1', entry(`d${i}`));
    await expect(outbox.enqueue('u1', entry('one-more'))).rejects.toBeInstanceOf(OutboxFullError);
    await outbox.enqueue('u1', entry('d0', { kg: 1 })); // replacing a waiting row needs no room
    expect(outbox.pending()).toHaveLength(MAX_QUEUED);
  });

  it('saves after every change so a crash loses nothing', async () => {
    const { outbox, storage } = make();
    await outbox.enqueue('u1', entry('a'));
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!).queue).toHaveLength(1);
  });
});

describe('persistence', () => {
  it('a new Outbox picks up what the last one saved', async () => {
    const storage = memoryStorage();
    await new Outbox(storage, scripted().execute, now).enqueue('u1', entry('a'));
    const { outbox, sent } = make(storage);
    expect(outbox.pending()).toEqual([]); // not loaded yet
    await outbox.flush('u1');
    expect(sent).toHaveLength(1);
  });

  it.each(['not json', '{"queue": 5}', 'null', '[]', '{"queue": null, "failed": "x"}'])('unreadable or odd saved data (%s) starts empty instead of crashing', async (raw) => {
    const { outbox } = make(memoryStorage(raw));
    await expect(outbox.flush('u1')).resolves.toEqual({ sent: 0, dropped: 0, retryInMs: null });
    await outbox.enqueue('u1', entry('a'));
    expect(outbox.pending()).toHaveLength(1);
  });

  it('survives storage that refuses to be read', async () => {
    const storage = memoryStorage();
    storage.getItem = async () => {
      throw new Error('disk');
    };
    const { outbox } = make(storage);
    await expect(outbox.enqueue('u1', entry('a'))).resolves.toBeUndefined();
  });
});

describe('flushing', () => {
  it('a failure that waiting may fix stops the flush, keeps the operation and says when to try again', async () => {
    const { outbox, sent } = make(undefined, scripted(null, { status: 0 }));
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u1', entry('b'));
    await outbox.enqueue('u1', entry('c'));
    expect(await outbox.flush('u1')).toEqual({ sent: 1, dropped: 0, retryInMs: BASE_DELAY_MS });
    expect(sent).toHaveLength(2); // c was not attempted: order matters
    expect(outbox.pending().map((q) => [rowOf(q.op).log_date, q.attempts])).toEqual([['b', 1], ['c', 0]]);
  });

  it('the attempt count survives a restart, so the backoff and the give-up point do too', async () => {
    const storage = memoryStorage();
    const first = new Outbox(storage, scripted({ status: 503 }).execute, now);
    await first.enqueue('u1', entry('a'));
    await first.flush('u1');
    const second = new Outbox(storage, scripted({ status: 503 }).execute, now);
    expect(await second.flush('u1')).toMatchObject({ retryInMs: 2 * BASE_DELAY_MS });
    expect(second.pending()[0].attempts).toBe(2);
  });

  it('the delay grows with each failed attempt at the same operation', async () => {
    const { outbox } = make(undefined, scripted({ status: 503 }, { status: 503 }, { status: 503 }));
    await outbox.enqueue('u1', entry('a'));
    const delays = [(await outbox.flush('u1')).retryInMs, (await outbox.flush('u1')).retryInMs, (await outbox.flush('u1')).retryInMs];
    expect(delays).toEqual([BASE_DELAY_MS, 2 * BASE_DELAY_MS, 4 * BASE_DELAY_MS]);
  });

  it('a retried operation is eventually sent and removed', async () => {
    const { outbox, sent } = make(undefined, scripted({ status: 0 }, null));
    await outbox.enqueue('u1', entry('a'));
    await outbox.flush('u1');
    expect(await outbox.flush('u1')).toEqual({ sent: 1, dropped: 0, retryInMs: null });
    expect(sent).toHaveLength(2);
    expect(outbox.pending()).toEqual([]);
  });

  it('a refusal moves that operation to failures and carries on with the rest', async () => {
    const { outbox, sent } = make(undefined, scripted({ status: 403, code: '42501', message: 'new row violates row-level security policy' }, null));
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u1', entry('b'));
    expect(await outbox.flush('u1')).toEqual({ sent: 1, dropped: 1, retryInMs: null });
    expect(sent).toHaveLength(2);
    expect(outbox.pending()).toEqual([]);
    expect(outbox.failures()).toHaveLength(1);
    expect(outbox.failures()[0]).toMatchObject({ reason: 'new row violates row-level security policy', userId: 'u1' });
  });

  it('describes a failure without a message by its code, then its status', async () => {
    const { outbox } = make(undefined, scripted({ status: 409, code: '23505' }, { status: 422 }));
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u1', entry('b'));
    await outbox.flush('u1');
    expect(outbox.failures().map((f) => f.reason)).toEqual(['23505', 'status 422']);
  });

  it(`gives up on a retryable failure after ${MAX_ATTEMPTS} attempts rather than blocking the queue forever`, async () => {
    const { outbox } = make(undefined, scripted(...Array.from({ length: MAX_ATTEMPTS }, () => ({ status: 500 }))));
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u1', entry('b'));
    let last = await outbox.flush('u1');
    for (let i = 1; i < MAX_ATTEMPTS - 1; i++) last = await outbox.flush('u1');
    expect(last.retryInMs).not.toBeNull();
    const final = await outbox.flush('u1');
    expect(final).toEqual({ sent: 1, dropped: 1, retryInMs: null }); // a dropped, b sent
    expect(outbox.failures()).toHaveLength(1);
  });

  it('sends only the signed-in person’s operations', async () => {
    const { outbox, sent } = make();
    await outbox.enqueue('u1', entry('mine'));
    await outbox.enqueue('u2', { ...entry('theirs'), row: { user_id: 'u2', log_date: 'theirs', kg: 1 } });
    await outbox.flush('u1');
    expect(sent).toHaveLength(1);
    expect(outbox.pending('u2')).toHaveLength(1);
    await outbox.flush('u2');
    expect(sent).toHaveLength(2);
  });

  it('flush calls made together share one run (no double sends)', async () => {
    const { outbox, execute } = make();
    await outbox.enqueue('u1', entry('a'));
    const [first, second] = await Promise.all([outbox.flush('u1'), outbox.flush('u1')]);
    expect(first).toBe(second);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('a write queued while an operation is on the wire waits behind it instead of replacing it', async () => {
    let release!: (value: null) => void;
    const sent: Operation[] = [];
    const execute: Executor = async (op) => {
      sent.push(op);
      if (sent.length === 1) await new Promise<null>((resolve) => (release = resolve));
      return null;
    };
    const outbox = new Outbox(memoryStorage(), execute, now);
    await outbox.enqueue('u1', entry('a', { kg: 80 }));
    const flushing = outbox.flush('u1');
    await Promise.resolve();
    await Promise.resolve();
    await outbox.enqueue('u1', entry('a', { kg: 70 })); // same row, while the first is in flight
    release(null);
    await flushing;
    expect(sent.map((o) => rowOf(o).kg)).toEqual([80, 70]); // both reached the server, in order
    expect(outbox.pending()).toEqual([]);
  });

  it('an executor that throws is not swallowed into a lost operation', async () => {
    const execute: Executor = async () => {
      throw new Error('bug');
    };
    const outbox = new Outbox(memoryStorage(), execute, now);
    await outbox.enqueue('u1', entry('a'));
    await expect(outbox.flush('u1')).rejects.toThrow('bug');
    expect(outbox.pending()).toHaveLength(1); // still queued
    await expect(outbox.flush('u1')).rejects.toThrow('bug'); // and a later flush is not stuck behind a dead one
  });

  it(`keeps at most ${MAX_FAILED} failures, newest last`, async () => {
    const answers = Array.from({ length: MAX_FAILED + 5 }, () => ({ status: 400 }));
    const { outbox } = make(undefined, scripted(...answers));
    for (let i = 0; i < MAX_FAILED + 5; i++) {
      await outbox.enqueue('u1', entry(`d${i}`));
      await outbox.flush('u1');
    }
    const failures = outbox.failures();
    expect(failures).toHaveLength(MAX_FAILED);
    expect(rowOf(failures[failures.length - 1].op).log_date).toBe(`d${MAX_FAILED + 4}`);
  });

  it('a dismissed failure is gone', async () => {
    const { outbox } = make(undefined, scripted({ status: 400 }));
    await outbox.enqueue('u1', entry('a'));
    await outbox.flush('u1');
    await outbox.dismissFailure(outbox.failures()[0].id);
    expect(outbox.failures()).toEqual([]);
  });
});

describe('signing out', () => {
  it('discardAll empties the queue, the failures and the saved copy, and tells subscribers', async () => {
    const { outbox, storage } = make(undefined, scripted({ status: 400 }));
    const listener = jest.fn();
    outbox.subscribe(listener);
    await outbox.enqueue('u1', entry('a'));
    await outbox.enqueue('u1', entry('b'));
    await outbox.flush('u1');
    await outbox.discardAll();
    expect(outbox.pending()).toEqual([]);
    expect(outbox.failures()).toEqual([]);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('after discarding, a restart finds nothing', async () => {
    const storage = memoryStorage();
    const first = new Outbox(storage, scripted().execute, now);
    await first.enqueue('u1', entry('a'));
    await first.discardAll();
    const second = new Outbox(storage, scripted().execute, now);
    await second.load();
    expect(second.pending()).toEqual([]);
  });

  it('unsubscribing stops notifications', async () => {
    const { outbox } = make();
    const listener = jest.fn();
    const unsubscribe = outbox.subscribe(listener);
    unsubscribe();
    await outbox.enqueue('u1', entry('a'));
    expect(listener).not.toHaveBeenCalled();
  });
});
