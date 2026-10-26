"""A fixed-window attempt counter keyed on an opaque string (an address, an email), for things that happen before there is a
signed-in person. One row per key in `auth_throttle`. A try is TAKEN in a single statement before the work it guards, so a
burst of simultaneous tries cannot all slip under the limit; the caller gives the key back with `clear` on success.

(The waitlist and the friend-code guess budget predate this and keep their own copies; same table, same rule.)
"""

import math


def take(conn, key, limit, window, now):
    """Spend one try. Returns (allowed, seconds until the window resets when refused)."""
    row = conn.execute(
        """insert into public.auth_throttle (key, window_start, count) values (%(k)s, %(now)s, 1)
           on conflict (key) do update set
               window_start = case when %(now)s - auth_throttle.window_start >= %(w)s then %(now)s else auth_throttle.window_start end,
               count        = case when %(now)s - auth_throttle.window_start >= %(w)s then 1 else auth_throttle.count + 1 end
           where %(now)s - auth_throttle.window_start >= %(w)s or auth_throttle.count < %(limit)s
           returning window_start""", {"k": key, "now": now, "w": window, "limit": limit}).fetchone()
    if row:
        return True, 0
    current = conn.execute("select window_start from public.auth_throttle where key = %s", (key,)).fetchone()
    started = current["window_start"] if current else now
    return False, max(1, int(math.ceil(window - (now - started))))


def clear(conn, key):
    """Forget a key's tries (a successful login must not keep counting toward a lockout)."""
    conn.execute("delete from public.auth_throttle where key = %s", (key,))
