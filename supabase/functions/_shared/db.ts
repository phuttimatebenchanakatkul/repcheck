/** Postgres access, through the connection string Supabase gives every function.
 *
 * Like the Flask API before it, this connects as the `postgres` owner, which BYPASSES row-level security. That is the
 * point (cross-user reads, rate limits and moderation live here) and the risk: every query must scope itself to the
 * caller (`where user_id = $1`) by hand, because nothing underneath will. Placeholders are `$1, $2, ...` only.
 *
 * Routes see only the `Db` / `Tx` shapes below, so tests hand in an in-memory fake and need no network.
 */
import postgres from "postgres";

export type Params = readonly unknown[];
export type Row = Record<string, unknown>;

export interface Tx {
  /** Every row. */
  all<T = Row>(sql: string, params?: Params): Promise<T[]>;
  /** The first row, or null. */
  one<T = Row>(sql: string, params?: Params): Promise<T | null>;
  /** Run a statement and return how many rows it touched. */
  exec(sql: string, params?: Params): Promise<number>;
}

export interface Db {
  /** One transaction: committed when `fn` returns, rolled back if it throws. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

// deno-lint-ignore no-explicit-any
const adapt = (sql: any): Tx => ({
  async all(text, params = []) {
    return [...await sql.unsafe(text, params as unknown[])];
  },
  async one(text, params = []) {
    const rows = await sql.unsafe(text, params as unknown[]);
    return rows.length ? rows[0] : null;
  },
  async exec(text, params = []) {
    const result = await sql.unsafe(text, params as unknown[]);
    return result.count ?? 0;
  },
});

/** The pooled database. The transaction pooler hands a connection back after each transaction, so prepared statements
 *  are off and session state (SET, advisory locks, temp tables) must not be relied on. */
export function connect(url: string, max = 3): Db {
  const sql = postgres(url, {
    prepare: false,
    max,
    ssl: "require",
    connect_timeout: 15,
    idle_timeout: 20,
    // bigint columns (rate_limits.window_start) come back as numbers: epoch seconds are far inside 2^53.
    types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) } },
  });
  return {
    // deno-lint-ignore no-explicit-any
    transaction: (fn) => sql.begin((tx: any) => fn(adapt(tx))) as Promise<never>,
  };
}
