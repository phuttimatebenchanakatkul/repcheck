"""Per-account AI usage limits, and the lifetime usage counters.

A fixed window per (user, feature): it opens on the first use and lasts `window` seconds; once `limit` uses land in it,
more are refused until it elapses, and the next use opens a fresh one. The website peeked first and recorded after the
work succeeded, so two requests arriving together both passed the peek. Here a use is RESERVED atomically before the
expensive call and REFUNDED if the work fails, which keeps both guarantees: a failed Gemini call never burns a person's
scarce analysis, and concurrent requests can never exceed the limit.
"""

import datetime as dt
import math
import time
from dataclasses import dataclass

DAY = 24 * 60 * 60

# (uses, window in seconds): the website's values (app.py RATE_LIMITS; a test pins them).
RATE_LIMITS = {
    "workout_analysis": (1, DAY),
    "food_analysis": (1, DAY),
    "ai_chat": (3, DAY),               # the coach, analysis follow-ups and workout chat share this one bucket
    "split_generation": (1, DAY),
    "hyrox_analysis": (8, 5 * 60 * 60),
    # NEW here (the website never limited it): the weekly check-in may call the model with photos. Past the limit the
    # check-in still completes with the deterministic adjustment, so a limited person loses only the AI refinement.
    "checkin_analysis": (5, DAY),
}


@dataclass(frozen=True)
class Reservation:
    allowed: bool
    retry_after: int = 0               # seconds until the window resets, when refused
    window_start: int | None = None    # the window the use was charged to (None: exempt, nothing was charged)


EXEMPT = Reservation(True)


def is_exempt(settings, identity):
    return bool(identity.email) and identity.email.lower() in settings.rate_limit_exempt


def friendly_wait(seconds):
    """A short human phrase for how long until the window resets."""
    if seconds >= 3600:
        hours = max(1, round(seconds / 3600))
        return f"about {hours} hour{'s' if hours != 1 else ''}"
    minutes = max(1, round(seconds / 60))
    return f"about {minutes} minute{'s' if minutes != 1 else ''}"


def reserve(conn, user_id, feature, now=None):
    """Spend one use of `feature` if the window has room, in a single statement (the row is locked while it runs, so
    simultaneous calls are serialised). Returns a Reservation; a refused one says how long to wait."""
    limit, window = RATE_LIMITS[feature]
    return _reserve(conn, user_id, feature, limit, window, now)


def _reserve(conn, user_id, feature, limit, window, now=None):
    now = int(time.time()) if now is None else int(now)
    row = conn.execute(
        """insert into public.rate_limits (user_id, feature, window_start, count) values (%(u)s, %(f)s, %(now)s, 1)
           on conflict (user_id, feature) do update set
               window_start = case when %(now)s - rate_limits.window_start >= %(w)s then %(now)s else rate_limits.window_start end,
               count        = case when %(now)s - rate_limits.window_start >= %(w)s then 1 else rate_limits.count + 1 end
           where %(now)s - rate_limits.window_start >= %(w)s or rate_limits.count < %(limit)s
           returning window_start""",
        {"u": user_id, "f": feature, "now": now, "w": window, "limit": limit}).fetchone()
    if row:
        return Reservation(True, 0, row["window_start"])
    current = conn.execute("select window_start from public.rate_limits where user_id = %s and feature = %s",
                           (user_id, feature)).fetchone()
    started = current["window_start"] if current else now
    return Reservation(False, max(1, int(math.ceil(window - (now - started)))))


def refund(conn, user_id, feature, reservation):
    """Give a reserved use back (the work failed). Only if the window is still the one it was charged to: a use
    reserved in a window that has since rolled over is not a use of the new window."""
    if reservation.window_start is None:
        return
    conn.execute(
        "update public.rate_limits set count = greatest(count - 1, 0) "
        "where user_id = %s and feature = %s and window_start = %s",
        (user_id, feature, reservation.window_start))


def _attempt_key(exercise, now=None):
    day = dt.datetime.fromtimestamp(int(time.time()) if now is None else int(now), dt.timezone.utc).date().isoformat()
    return f"challenge:{exercise}:{day}"


def reserve_daily_attempt(conn, user_id, exercise, now=None):
    """The one challenge attempt per exercise per UTC day, held while the clip is graded so that simultaneous submissions
    cannot both reach the model. The key carries the day, so it resets at midnight UTC exactly as the saved-attempt check
    does; earlier days' keys are swept as a new one is taken."""
    now = int(time.time()) if now is None else int(now)
    key = _attempt_key(exercise, now)
    conn.execute("delete from public.rate_limits where user_id = %s and feature like 'challenge:%%' and feature not like %s",
                 (user_id, "%:" + key.rsplit(":", 1)[1]))
    return _reserve(conn, user_id, key, 1, DAY, now)


def release_daily_attempt(conn, user_id, exercise, reservation, now=None):
    """Give the attempt back (the clip could not be graded), so a failed upload does not use up the day's attempt."""
    refund(conn, user_id, _attempt_key(exercise, now), reservation)


def limit_message(feature, retry_after):
    uses = RATE_LIMITS[feature][0]
    if feature == "workout_analysis":
        plural = "analysis" if uses == 1 else "analyses"
        return f"You've used your {uses} workout {plural} for now — try again in {friendly_wait(retry_after)}."
    return f"You've reached your limit for now — try again in {friendly_wait(retry_after)}."


def track_usage(conn, user_id, event):
    """Lifetime counter for the admin activity view; counts every account, exempt ones included."""
    conn.execute(
        "insert into public.usage_events (user_id, event, count, last_at) values (%s, %s, 1, now()) "
        "on conflict (user_id, event) do update set count = usage_events.count + 1, last_at = now()",
        (user_id, event))
