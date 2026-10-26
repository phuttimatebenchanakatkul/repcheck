/**
 * An in-memory stand-in for the slice of supabase-js the app uses, so the data layer can be tested end to end (read, queue, flush,
 * read again) without a network. It deliberately does NOT enforce row-level security: the app filters by user itself, and a test that
 * seeds another person's rows proves that filter is really there.
 */
import type { QueryResult, ReadQuery, Reader } from '../data/access';

export type Row = Record<string, unknown>;

interface Failure {
  status: number;
  message: string;
  code?: string;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

export class FakeDatabase {
  private tables = new Map<string, Row[]>();
  /** Every read and write that reached the "server", in order: `read:table`, `upsert:table`, `delete:table`. */
  calls: string[] = [];
  /** Return a failure to make that call fail the way supabase-js reports it (status 0 = the request never completed). */
  failWhen: ((kind: 'read' | 'upsert' | 'delete', table: string) => Failure | null) | null = null;
  /** Rows a single read may return, like PostgREST's max-rows. */
  maxRows = 1000;

  seed(table: string, rows: Row[]): this {
    this.tables.set(table, [...(this.tables.get(table) ?? []), ...clone(rows)]);
    return this;
  }

  rows(table: string): Row[] {
    return clone(this.tables.get(table) ?? []);
  }

  private raw(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table) as Row[];
  }

  private failure(kind: 'read' | 'upsert' | 'delete', table: string): QueryResult | null {
    const failure = this.failWhen?.(kind, table);
    return failure ? { data: null, error: { message: failure.message, code: failure.code }, status: failure.status } : null;
  }

  /** Both the reader the app queries through and the client the outbox's executor writes through. */
  client(): Reader & {
    from(table: string): ReadQuery & {
      upsert(row: Row, options: { onConflict: string }): PromiseLike<QueryResult>;
      delete(): { match(filter: Row): PromiseLike<QueryResult> };
    };
  } {
    return { from: (table: string) => this.from(table) } as never;
  }

  private from(table: string) {
    const builder = new Builder(this, table);
    return Object.assign(builder, {
      upsert: async (row: Row, options: { onConflict: string }): Promise<QueryResult> => {
        this.calls.push(`upsert:${table}`);
        const failed = this.failure('upsert', table);
        if (failed) return failed;
        const columns = options.onConflict.split(',').map((c) => c.trim());
        const rows = this.raw(table);
        const at = rows.findIndex((existing) => columns.every((c) => existing[c] === row[c]));
        if (at >= 0) rows[at] = { ...rows[at], ...clone(row) };
        else rows.push(clone(row));
        return { data: null, error: null, status: 201 };
      },
      delete: () => ({
        match: async (filter: Row): Promise<QueryResult> => {
          this.calls.push(`delete:${table}`);
          const failed = this.failure('delete', table);
          if (failed) return failed;
          const hits = (row: Row) => Object.entries(filter).every(([k, v]) => row[k] === v);
          const removed = this.raw(table).filter(hits);
          this.tables.set(table, this.raw(table).filter((row) => !hits(row)));
          if (table === 'workout_entries') {
            // the foreign key cascades: a workout's sets go with it
            const gone = new Set(removed.map((r) => `${String(r.user_id)}|${String(r.id)}`));
            this.tables.set('workout_sets', this.raw('workout_sets').filter((s) => !gone.has(`${String(s.user_id)}|${String(s.entry_id)}`)));
          }
          return { data: null, error: null, status: 204 };
        },
      }),
    });
  }

  /** Called by a finished query builder. */
  run(table: string, query: Query): QueryResult {
    this.calls.push(`read:${table}`);
    const failed = this.failure('read', table);
    if (failed) return failed;
    let rows = this.raw(table).filter((row) => query.filters.every((test) => test(row)));
    if (query.order) {
      const { column, ascending } = query.order;
      rows = rows.slice().sort((a, b) => (ascending ? 1 : -1) * compare(a[column], b[column]));
    }
    const cap = Math.min(this.maxRows, query.limit ?? Infinity);
    const start = query.range ? query.range[0] : 0;
    const end = query.range ? Math.min(query.range[1] + 1, start + cap) : start + cap;
    rows = rows.slice(start, end);
    const picked = rows.map((row) => (query.columns === '*' ? clone(row) : Object.fromEntries(query.columns.split(',').map((c) => [c.trim(), clone(row[c.trim()])]))));
    if (query.single) return { data: picked[0] ?? null, error: null, status: 200 };
    return { data: picked, error: null, status: 200 };
  }
}

interface Query {
  columns: string;
  filters: ((row: Row) => boolean)[];
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
  range: [number, number] | null;
  single: boolean;
}

class Builder implements ReadQuery {
  private query: Query = { columns: '*', filters: [], order: null, limit: null, range: null, single: false };

  constructor(
    private readonly db: FakeDatabase,
    private readonly table: string,
  ) {}

  select(columns = '*'): ReadQuery {
    this.query.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): ReadQuery {
    this.query.filters.push((row) => row[column] === value);
    return this;
  }

  gte(column: string, value: unknown): ReadQuery {
    this.query.filters.push((row) => compare(row[column], value) >= 0);
    return this;
  }

  lte(column: string, value: unknown): ReadQuery {
    this.query.filters.push((row) => compare(row[column], value) <= 0);
    return this;
  }

  in(column: string, values: readonly unknown[]): ReadQuery {
    this.query.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): ReadQuery {
    this.query.order = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number): ReadQuery {
    this.query.limit = count;
    return this;
  }

  range(from: number, to: number): ReadQuery {
    this.query.range = [from, to];
    return this;
  }

  maybeSingle(): ReadQuery {
    this.query.single = true;
    return this;
  }

  then<R1 = QueryResult, R2 = never>(
    onfulfilled?: ((value: QueryResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.db.run(this.table, this.query)).then(onfulfilled, onrejected);
  }
}
