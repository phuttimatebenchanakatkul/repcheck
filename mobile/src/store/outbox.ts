/**
 * The write queue: the app writes the person's own data straight to Supabase (row-level security protects it), and when
 * there is no signal the write waits here and is sent in order once there is.
 *
 * Rules, each pinned by a test:
 *  - Only IDEMPOTENT operations are queued: an upsert of a whole row with a client-made key, or a delete by key. Sending
 *    one twice (a flush interrupted after the server accepted it) changes nothing, so a retry is always safe.
 *  - Order is preserved (a delete queued after an edit must not run before it), and a newer write to the same row REPLACES
 *    a still-waiting older one (a delete after a waiting upsert cancels both: the server never needs to hear of it).
 *  - A failure that cannot be fixed by waiting (the database refused: 4xx) is moved to `failed` and the queue moves on, so
 *    one bad row never wedges everything behind it. A failure that can (no network, 5xx, 408, 429) stops the flush and is
 *    retried later with a growing delay; after MAX_ATTEMPTS it is treated as unfixable.
 *  - Operations belong to a person. A flush for one never sends another's, and `discardAll()` (sign-out) empties the lot.
 */
import type { Database } from '@/supabase/database.types';

export type TableName = keyof Database['public']['Tables'];

export type Operation =
  | { kind: 'upsert'; table: TableName; /** Column(s) forming the key, comma-separated for a composite. */ key: string; row: Record<string, unknown> }
  | { kind: 'delete'; table: TableName; key: string; match: Record<string, unknown> };

export interface QueuedOperation {
  /** Unique id of this queue entry. */
  id: string;
  userId: string;
  op: Operation;
  queuedAt: number;
  attempts: number;
}

export interface FailedOperation extends QueuedOperation {
  reason: string;
  failedAt: number;
}

export interface ExecutorError {
  /** HTTP status, 0 when the request never completed. */
  status?: number;
  code?: string;
  message?: string;
}

/** Sends one operation. Resolves `null` on success or the error; must not throw for an expected failure. */
export type Executor = (op: Operation) => Promise<ExecutorError | null>;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const STORAGE_KEY = 'repcheck-outbox-v1';
export const MAX_QUEUED = 500;
export const MAX_FAILED = 100;
export const MAX_ATTEMPTS = 20;
export const BASE_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 5 * 60_000;

export class OutboxFullError extends Error {
  constructor() {
    super('Too many changes are waiting to sync. Connect to the internet and try again.');
  }
}

/** `retry`: waiting may fix it. `drop`: the database said no, and saying it again will not change the answer. */
export function classify(error: ExecutorError): 'retry' | 'drop' {
  const status = error.status;
  if (status === undefined || status === 0) return 'retry';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'drop';
}

/** The delay before the next try after `attempts` failures: 2 s, 4 s, 8 s ... capped at 5 minutes. */
export function backoffDelay(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

/** The identity of the row an operation touches, for coalescing. */
export function rowIdentity(op: Operation): string {
  const source = op.kind === 'upsert' ? op.row : op.match;
  const columns = op.key.split(',').map((c) => c.trim());
  return `${op.table}|${columns.map((c) => `${c}=${JSON.stringify(source[c])}`).join('|')}`;
}

interface Persisted {
  queue: QueuedOperation[];
  failed: FailedOperation[];
}

export class Outbox {
  private queue: QueuedOperation[] = [];
  private failed: FailedOperation[] = [];
  private loaded = false;
  private flushing: Promise<FlushResult> | null = null;
  private counter = 0;
  /** The entry being sent right now: a newer write to its row must queue behind it, not replace it (it is already on the wire). */
  private inFlight: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly execute: Executor,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => `${this.now().toString(36)}-${(this.counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  ) {}

  /** Reads the saved queue. Call once at startup; every other method calls it if it has not run. */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await this.storage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
      this.queue = Array.isArray(parsed.queue) ? parsed.queue : [];
      this.failed = Array.isArray(parsed.failed) ? parsed.failed : [];
    } catch {
      this.queue = [];
      this.failed = []; // unreadable: better an empty queue than a crash at startup
    }
  }

  private async save(): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify({ queue: this.queue, failed: this.failed } satisfies Persisted));
    this.listeners.forEach((notify) => notify());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pending(userId?: string): QueuedOperation[] {
    return userId ? this.queue.filter((q) => q.userId === userId) : [...this.queue];
  }

  failures(userId?: string): FailedOperation[] {
    return userId ? this.failed.filter((q) => q.userId === userId) : [...this.failed];
  }

  /** Puts one operation in the queue (coalescing with a waiting write to the same row). Throws OutboxFullError; saves nothing. */
  private place(userId: string, op: Operation): void {
    const identity = rowIdentity(op);
    const at = this.queue.findIndex((q) => q.userId === userId && rowIdentity(q.op) === identity && q.id !== this.inFlight);
    if (at >= 0) {
      const waiting = this.queue[at];
      if (op.kind === 'delete' && waiting.op.kind === 'upsert') {
        this.queue.splice(at, 1); // created and deleted while offline: the server never needs to hear of either
      } else {
        this.queue[at] = { ...waiting, op, queuedAt: this.now() };
      }
    } else {
      if (this.queue.length >= MAX_QUEUED) throw new OutboxFullError();
      this.queue.push({ id: this.newId(), userId, op, queuedAt: this.now(), attempts: 0 });
    }
  }

  /** Removes this person's waiting operations that match, except the one on the wire. Returns how many. */
  private drop(userId: string, matches: (op: Operation) => boolean): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.userId !== userId || q.id === this.inFlight || !matches(q.op));
    return before - this.queue.length;
  }

  /** Queue an operation for `userId`. A newer write to a row replaces an older waiting one. */
  async enqueue(userId: string, op: Operation): Promise<void> {
    await this.replace(userId, () => false, [op]);
  }

  /**
   * Drops this person's WAITING operations that match (except the one on the wire) and queues `ops` in their place, ALL OR NOTHING:
   * if the queue would overflow, it is left exactly as it was. For a change that replaces a whole group of rows (a workout's sets):
   * coalescing only replaces the same row, so without the drop a shorter new version would leave the longer old version's extra rows
   * queued and sent after it. Saved with one write.
   */
  async replace(userId: string, matches: (op: Operation) => boolean, ops: readonly Operation[]): Promise<void> {
    await this.load();
    const snapshot = this.queue.slice();
    try {
      this.drop(userId, matches);
      for (const op of ops) this.place(userId, op);
    } catch (error) {
      this.queue = snapshot;
      throw error;
    }
    await this.save();
  }

  /** `replace` with nothing queued afterwards. Returns how many were dropped. */
  async purge(userId: string, matches: (op: Operation) => boolean): Promise<number> {
    await this.load();
    const dropped = this.drop(userId, matches);
    if (dropped) await this.save();
    return dropped;
  }

  /**
   * Sends this person's waiting operations in order. Stops at the first one that should be retried later and reports when.
   * Only one flush runs at a time; a second call joins it.
   */
  flush(userId: string): Promise<FlushResult> {
    if (!this.flushing) {
      this.flushing = this.runFlush(userId).finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async runFlush(userId: string): Promise<FlushResult> {
    await this.load();
    let sent = 0;
    let dropped = 0;
    for (;;) {
      const next = this.queue.find((q) => q.userId === userId);
      if (!next) return { sent, dropped, retryInMs: null };
      this.inFlight = next.id;
      let error: ExecutorError | null;
      try {
        error = await this.execute(next.op);
      } finally {
        this.inFlight = null;
      }
      const index = this.queue.findIndex((q) => q.id === next.id);
      if (!error) {
        if (index >= 0) this.queue.splice(index, 1);
        sent++;
        await this.save();
        continue;
      }
      const attempts = next.attempts + 1;
      if (classify(error) === 'retry' && attempts < MAX_ATTEMPTS) {
        if (index >= 0) this.queue[index] = { ...next, attempts };
        await this.save();
        return { sent, dropped, retryInMs: backoffDelay(attempts) };
      }
      if (index >= 0) this.queue.splice(index, 1);
      this.failed = [...this.failed, { ...next, attempts, reason: error.message ?? error.code ?? `status ${error.status ?? '?'}`, failedAt: this.now() }].slice(-MAX_FAILED);
      dropped++;
      await this.save();
    }
  }

  async dismissFailure(id: string): Promise<void> {
    await this.load();
    this.failed = this.failed.filter((f) => f.id !== id);
    await this.save();
  }

  /** Sign-out: nothing of anyone's stays on the device. */
  async discardAll(): Promise<void> {
    this.queue = [];
    this.failed = [];
    this.loaded = true;
    await this.storage.removeItem(STORAGE_KEY);
    this.listeners.forEach((notify) => notify());
  }
}

export interface FlushResult {
  sent: number;
  /** Operations the database refused and that were moved to `failures()`. */
  dropped: number;
  /** When a retryable failure stopped the flush, how long to wait before calling flush again; otherwise null. */
  retryInMs: number | null;
}
