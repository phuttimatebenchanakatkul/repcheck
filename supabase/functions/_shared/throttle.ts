/** A fixed-window attempt counter keyed on an opaque string (an address, an email), for things that happen before there
 *  is a signed-in person. One row per key in `auth_throttle`. A try is TAKEN in a single statement before the work it
 *  guards, so a burst of simultaneous tries cannot all slip under the limit; the caller gives the key back with `clear`
 *  on success.
 */
import type { Tx } from "./db.ts";

/** Spend one try. Returns [allowed, seconds until the window resets when refused]. */
export async function take(tx: Tx, key: string, limit: number, window: number, now: number): Promise<[boolean, number]> {
  const row = await tx.one(
    `insert into public.auth_throttle (key, window_start, count) values ($1, $2::bigint, 1)
     on conflict (key) do update set
         window_start = case when $2::bigint - auth_throttle.window_start >= $3::bigint then $2::bigint else auth_throttle.window_start end,
         count        = case when $2::bigint - auth_throttle.window_start >= $3::bigint then 1 else auth_throttle.count + 1 end
     where $2::bigint - auth_throttle.window_start >= $3::bigint or auth_throttle.count < $4::integer
     returning window_start`,
    [key, now, window, limit],
  );
  if (row) return [true, 0];
  const current = await tx.one<{ window_start: number }>("select window_start from public.auth_throttle where key = $1", [key]);
  const started = current ? Number(current.window_start) : now;
  return [false, Math.max(1, window - (now - started))];
}

/** Forget a key's tries (a successful login must not keep counting toward a lockout). */
export async function clear(tx: Tx, key: string): Promise<void> {
  await tx.exec("delete from public.auth_throttle where key = $1", [key]);
}
