"""Friends, blocks, reports, challenges, leaderboards, HYROX results and activity dates: everything that reads or writes
across people. The app never touches these tables directly (they are server-only under row-level security), so every
rule that protects one person from another lives here.

The rules are the website's (app.py and database.py), with these differences, all deliberate:
  * a person is identified by a UUID, not an integer, so an id cannot be walked one by one;
  * a challenge can be submitted to only if it is the caller's own or a friend's (and not a blocked person's); the
    website accepted any challenge id, which put a stranger's score on the board of someone who never befriended them;
  * a friend-code guess is counted under a per-person lock, so a burst of simultaneous guesses cannot exceed the
    budget, and the 500-row and 200-row ceilings are enforced under a lock too (the website could be raced past them);
  * a HYROX time must also be finite and under a day (the website accepted NaN, which sorts and compares as nothing);
  * a code that is not text is a clean 400, not a crash.
"""

import datetime as dt
import math
import uuid

from psycopg.errors import UniqueViolation

from . import foods

FRIEND_CODE_GUESS_LIMIT = 30              # app.py FRIEND_CODE_LOOKUP_LIMIT: wrong codes one person may try ...
FRIEND_CODE_GUESS_WINDOW = 60 * 60        # ... per hour
MAX_FRIEND_CODE_CHARS = 32                # a real code is 9; anything longer cannot be one
CHALLENGE_LIMIT = 200                     # app.py PER_USER_LIMITS
HYROX_RESULT_LIMIT = 500
CHALLENGE_SECONDS = 25
REPORT_REASONS = ("offensive_name", "impersonation", "spam", "other")       # database.REPORT_REASONS
AI_REPORT_FEATURES = ("coach", "workout_chat", "analyze_chat")
AI_REPORT_REASONS = ("harmful", "inaccurate", "offensive", "other")
MAX_AI_REPORT_TEXT = 4000
MAX_OPEN_AI_REPORTS_PER_USER = 20
MAX_REPORT_FIELD = 40

HYROX_GENDERS = ("men", "women")
HYROX_CATEGORIES = ("open", "pro")
HYROX_FORMATS = ("singles", "doubles")
# Per gender and format (a doubles race really is faster), as app.py HYROX_MIN_PLAUSIBLE_SECONDS; a test pins them to it.
HYROX_MIN_PLAUSIBLE_SECONDS = {
    "men|singles": 50 * 60,
    "women|singles": 53 * 60,
    "men|doubles": 47 * 60,
    "women|doubles": 51 * 60,
}
HYROX_MAX_SECONDS = 24 * 60 * 60
HYROX_LEADERBOARD_ROWS = 50

# Challenges rotate through these, one a day for everybody (rep_form_analyzer.CHALLENGE_EXERCISES order; a test pins it).
CHALLENGE_ROTATION_EPOCH = dt.date(2026, 1, 1)
LEADERBOARD_SCOPES = ("friends", "global")

ACTIVITY_SOURCES = (                      # (action, table, column, whether the column is a UTC instant needing the offset)
    ("challenge", "challenge_submissions", "created_at", True),
    ("analysis", "analyze_results", "created_at", True),
    ("hyrox", "hyrox_results", "created_at", True),
    ("checkin_photo", "progress_photos", "date", False),
)


class Rejected(ValueError):
    """The message is safe to show the user; `status` is the HTTP status to answer with."""

    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.status = status
        self.extra = extra


def parse_user_id(raw):
    """A UUID as its canonical text, or None for anything else (a number, a list, text that is not one)."""
    if not isinstance(raw, str):
        return None
    try:
        return str(uuid.UUID(raw.strip()))
    except ValueError:
        return None


# -- who is hidden from whom -------------------------------------------------------------------------------------------

def hidden_ids(conn, user_id):
    """Every account `user_id` must not see, and that must not see them: a block is read in both directions, so the
    blocked person cannot go on watching the blocker climb a leaderboard. The row itself stays the blocker's alone."""
    rows = conn.execute(
        "select blocked_id as other from public.blocked_users where user_id = %s "
        "union select user_id as other from public.blocked_users where blocked_id = %s", (user_id, user_id)).fetchall()
    return {str(r["other"]) for r in rows}


def blocked_accounts(conn, user_id):
    """Only the caller's own blocks, newest first: being blocked by someone is not theirs to see or undo."""
    return [{"id": str(r["id"]), "name": r["name"]} for r in conn.execute(
        "select p.id, p.name from public.blocked_users b join public.profiles p on p.id = b.blocked_id "
        "where b.user_id = %s order by b.created_at desc, p.id", (user_id,)).fetchall()]


def block(conn, user_id, other_id):
    conn.execute("insert into public.blocked_users (user_id, blocked_id) values (%s, %s) on conflict do nothing",
                 (user_id, other_id))


def unblock(conn, user_id, other_id):
    conn.execute("delete from public.blocked_users where user_id = %s and blocked_id = %s", (user_id, other_id))


def profile_exists(conn, user_id):
    return conn.execute("select 1 as one from public.profiles where id = %s", (user_id,)).fetchone() is not None


# -- friends ---------------------------------------------------------------------------------------------------------------

def friend_code(conn, user_id):
    row = conn.execute("select friend_code from public.profiles where id = %s", (user_id,)).fetchone()
    return row["friend_code"] if row else None


def friends(conn, user_id):
    """The caller's friends by name, blocked accounts left out in both directions."""
    hidden = hidden_ids(conn, user_id)
    rows = conn.execute("select p.id, p.name from public.friends f join public.profiles p on p.id = f.friend_id "
                        "where f.user_id = %s order by p.name, p.id", (user_id,)).fetchall()
    return [{"id": str(r["id"]), "name": r["name"]} for r in rows if str(r["id"]) not in hidden]


def friend_ids(conn, user_id):
    return [str(r["friend_id"]) for r in conn.execute(
        "select friend_id from public.friends where user_id = %s", (user_id,)).fetchall()]


def clean_code(raw):
    """The code as the profile stores it (upper case), or a Rejected for something that cannot be a code."""
    if raw is not None and not isinstance(raw, str):
        raise Rejected("Enter a friend code.")
    code = (raw or "").strip()
    if not code:
        raise Rejected("Enter a friend code.")
    return code.upper()


def guess_wait(conn, user_id, now):
    """Seconds until another wrong code may be tried, or 0 when the budget has room."""
    row = conn.execute("select window_start, count from public.auth_throttle where key = %s",
                       (f"friendcode:{user_id}",)).fetchone()
    if row is None or now - row["window_start"] >= FRIEND_CODE_GUESS_WINDOW or row["count"] < FRIEND_CODE_GUESS_LIMIT:
        return 0
    return max(1, int(FRIEND_CODE_GUESS_WINDOW - (now - row["window_start"])))


def record_miss(conn, user_id, now):
    conn.execute(
        """insert into public.auth_throttle (key, window_start, count) values (%(k)s, %(now)s, 1)
           on conflict (key) do update set
               window_start = case when %(now)s - auth_throttle.window_start >= %(w)s then %(now)s else auth_throttle.window_start end,
               count        = case when %(now)s - auth_throttle.window_start >= %(w)s then 1 else auth_throttle.count + 1 end""",
        {"k": f"friendcode:{user_id}", "now": now, "w": FRIEND_CODE_GUESS_WINDOW})


def add_by_code(conn, user_id, raw_code, now):
    """Make the caller and the owner of `raw_code` friends (both directions). Returns the new friend. Only a code that
    matches nobody counts against the guess budget, and a blocked person is answered exactly like an unknown code
    (saying 'you are blocked' would be a channel back to the person who blocked you)."""
    code = clean_code(raw_code)
    foods.lock(conn, "friendcode", user_id)           # one person's guesses are counted one at a time
    wait = guess_wait(conn, user_id, now)
    if wait:
        raise Rejected(f"Too many friend codes tried. Please wait {wait_phrase(wait)} and try again.", 429, retry_after=wait)
    other = None
    if len(code) <= MAX_FRIEND_CODE_CHARS:
        other = conn.execute("select id, name from public.profiles where friend_code = %s", (code,)).fetchone()
    if other is None:
        record_miss(conn, user_id, now)
        conn.commit()                                  # the miss must outlive the refusal that follows
        raise Rejected("No user found with that code.", 404)
    other_id = str(other["id"])
    if other_id == str(user_id):
        raise Rejected("That's your own code.", 400)
    if other_id in hidden_ids(conn, user_id):
        raise Rejected("No user found with that code.", 404)
    for a, b in ((user_id, other_id), (other_id, user_id)):
        conn.execute("insert into public.friends (user_id, friend_id) values (%s, %s) on conflict do nothing", (a, b))
    return {"id": other_id, "name": other["name"]}


def wait_phrase(seconds):
    from .limits import friendly_wait
    return friendly_wait(seconds)


# -- reports -----------------------------------------------------------------------------------------------------------------

def report_user(conn, reporter_id, reported_id, reason):
    """File a report and block the reported account in the same step. One OPEN report per (reporter, reported): the same
    complaint twice before anyone looked is one complaint, and a new one after it was handled is allowed."""
    reason = reason.strip() if isinstance(reason, str) and reason.strip() in REPORT_REASONS else "other"
    existing = conn.execute("select id from public.content_reports where reporter_id = %s and reported_id = %s "
                            "and handled_at is null", (reporter_id, reported_id)).fetchone()
    if not existing:
        conn.execute("insert into public.content_reports (reporter_id, reported_id, reason) values (%s, %s, %s)",
                     (reporter_id, reported_id, reason))
    block(conn, reporter_id, reported_id)


def report_ai_reply(conn, user_id, feature, reason, reply_text):
    """Record a report against one AI reply. Returns False when the reporter is over their open-report cap. The reply
    text is clipped to MAX_AI_REPORT_TEXT, and the same text reported twice before review is one report."""
    reply = (reply_text if isinstance(reply_text, str) else "").strip()[:MAX_AI_REPORT_TEXT]
    feature = feature.strip() if isinstance(feature, str) and feature.strip() in AI_REPORT_FEATURES else "coach"
    reason = reason.strip() if isinstance(reason, str) and reason.strip() in AI_REPORT_REASONS else "other"
    foods.lock(conn, "ai_reports", user_id)
    if conn.execute("select 1 as one from public.ai_reports where user_id = %s and reply_text = %s and handled_at is null",
                    (user_id, reply)).fetchone():
        return True
    open_count = conn.execute("select count(*) as n from public.ai_reports where user_id = %s and handled_at is null",
                              (user_id,)).fetchone()["n"]
    if open_count >= MAX_OPEN_AI_REPORTS_PER_USER:
        return False
    conn.execute("insert into public.ai_reports (user_id, feature, reason, reply_text) values (%s, %s, %s, %s)",
                 (user_id, feature, reason, reply))
    return True


# -- activity dates ------------------------------------------------------------------------------------------------------------

def offset_minutes(raw):
    """The caller's UTC offset in minutes (UTC+7 is +420), clamped to real timezones; a bad value means UTC."""
    try:
        number = int(raw)
    except (TypeError, ValueError):
        return 0
    return max(-14 * 60, min(14 * 60, number))


def activity_dates(conn, user_id, raw_offset):
    """Every local calendar day the caller did something only the server records, as {"YYYY-MM-DD": ["challenge", ...]}.
    Instants are shifted into the caller's day before being cut to a date; a progress photo's date already is one."""
    offset = offset_minutes(raw_offset)
    days = {}
    for action, table, column, instant in ACTIVITY_SOURCES:      # table and column are constants of ours, never input
        if instant:
            sql = (f"select distinct (({column} at time zone 'UTC') + make_interval(mins => %s))::date as day "
                   f"from public.{table} where user_id = %s")
            params = (offset, user_id)
        else:
            sql = f"select distinct {column} as day from public.{table} where user_id = %s"
            params = (user_id,)
        for row in conn.execute(sql, params).fetchall():
            if row["day"]:
                days.setdefault(row["day"].isoformat(), []).append(action)
    return {day: sorted(actions) for day, actions in sorted(days.items())}


# -- challenges --------------------------------------------------------------------------------------------------------------

def todays_exercise(order, today=None):
    """The one exercise everybody is challenged on today: a pure function of the UTC calendar date."""
    today = today or dt.datetime.now(dt.timezone.utc).date()
    return order[(today - CHALLENGE_ROTATION_EPOCH).days % len(order)]


def has_submitted_today(conn, user_id, exercise):
    """Whether the caller already recorded an attempt for this exercise today (UTC), on any challenge."""
    return conn.execute(
        "select 1 as one from public.challenge_submissions s join public.challenges c on c.id = s.challenge_id "
        "where s.user_id = %s and c.exercise = %s and (s.created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date "
        "limit 1", (user_id, exercise)).fetchone() is not None


def create_challenge(conn, user_id, exercise):
    """A new challenge for today's exercise, or a Rejected: at the ceiling, or already attempted today."""
    foods.lock(conn, "challenges", user_id)
    count = conn.execute("select count(*) as n from public.challenges where creator_id = %s", (user_id,)).fetchone()["n"]
    if count >= CHALLENGE_LIMIT:
        raise Rejected(foods.over_limit_message(CHALLENGE_LIMIT), 429)
    if has_submitted_today(conn, user_id, exercise):
        raise Rejected("You've already recorded today's attempt — come back tomorrow.", 429, limitReached=True)
    return conn.execute("insert into public.challenges (creator_id, exercise, duration_seconds) values (%s, %s, %s) returning id",
                        (user_id, exercise, CHALLENGE_SECONDS)).fetchone()["id"]


def visible_challenge(conn, user_id, challenge_id):
    """The challenge if it is the caller's own or a friend's and its creator is not hidden from them, else None."""
    row = conn.execute("select * from public.challenges where id = %s", (challenge_id,)).fetchone()
    if not row:
        return None
    creator = str(row["creator_id"])
    if creator == str(user_id):
        return row
    if creator in hidden_ids(conn, user_id):
        return None
    mine = conn.execute("select 1 as one from public.friends where user_id = %s and friend_id = %s", (user_id, creator)).fetchone()
    return row if mine else None


def challenge_json(row, creator_name, board):
    return {"id": row["id"], "creator_id": str(row["creator_id"]), "exercise": row["exercise"],
            "duration_seconds": row["duration_seconds"], "created_at": row["created_at"].isoformat(),
            "creator_name": creator_name, "leaderboard": board}


def visible_challenges(conn, user_id):
    """Challenges the caller or one of their friends created, newest first, each with its board (most reps first, the
    earlier attempt first on a tie). Blocked accounts are left out of both halves: submissions carry free-text notes
    another account wrote, which is more exposed than a display name."""
    hidden = hidden_ids(conn, user_id)
    rows = conn.execute(
        "select c.*, p.name as creator_name from public.challenges c join public.profiles p on p.id = c.creator_id "
        "where c.creator_id = %(u)s or c.creator_id in (select friend_id from public.friends where user_id = %(u)s) "
        "order by c.created_at desc, c.id desc", {"u": user_id}).fetchall()
    rows = [r for r in rows if str(r["creator_id"]) not in hidden]
    boards = {r["id"]: [] for r in rows}
    if rows:
        for s in conn.execute(
                "select s.challenge_id, s.user_id, s.reps, s.notes, s.created_at, p.name from public.challenge_submissions s "
                "join public.profiles p on p.id = s.user_id where s.challenge_id = any(%s) "
                "order by s.reps desc, s.created_at asc, s.user_id", ([r["id"] for r in rows],)).fetchall():
            if str(s["user_id"]) not in hidden:
                boards[s["challenge_id"]].append({"user_id": str(s["user_id"]), "reps": s["reps"], "notes": s["notes"],
                                                  "created_at": s["created_at"].isoformat(), "name": s["name"]})
    return [challenge_json(r, r["creator_name"], boards[r["id"]]) for r in rows]


def save_submission(conn, challenge_id, user_id, reps, notes):
    """Insert, or improve: a retake keeps only a HIGHER rep count, so a bad second try cannot wipe a better first one."""
    conn.execute(
        "insert into public.challenge_submissions (challenge_id, user_id, reps, notes) values (%s, %s, %s, %s) "
        "on conflict (challenge_id, user_id) do update set reps = excluded.reps, notes = excluded.notes, created_at = now() "
        "where excluded.reps > challenge_submissions.reps", (challenge_id, user_id, reps, notes))


# -- leaderboards --------------------------------------------------------------------------------------------------------------

def reps_board(conn, user_id, scope):
    """Everyone's total reps across every challenge, most first (the earlier last attempt first on a tie). The scope is the
    caller plus their friends, or everybody. Blocked accounts are left out IN THE QUERY so the ranks the caller computes
    from this list are the ranks they are shown; filtering afterwards would leave gaps at every hidden position."""
    hidden = list(hidden_ids(conn, user_id))
    params = {"hidden": hidden}
    scope_sql = ""
    if scope != "global":
        params["circle"] = [str(user_id)] + friend_ids(conn, user_id)
        scope_sql = " and s.user_id = any(%(circle)s::uuid[])"
    rows = conn.execute(
        "select s.user_id, p.name, sum(s.reps)::bigint as total_reps, max(s.created_at) as last_at "
        "from public.challenge_submissions s join public.profiles p on p.id = s.user_id "
        f"where not (s.user_id = any(%(hidden)s::uuid[])){scope_sql} "
        "group by s.user_id, p.name order by total_reps desc, last_at asc, s.user_id", params).fetchall()
    return [{"user_id": str(r["user_id"]), "name": r["name"], "total_reps": r["total_reps"], "last_at": r["last_at"].isoformat()}
            for r in rows]


def my_rank(rows, user_id, key):
    for position, row in enumerate(rows, 1):
        if row["user_id"] == str(user_id):
            return {"rank": position, key: row[key], "name": row["name"]}
    return None


# -- HYROX results ---------------------------------------------------------------------------------------------------------------

def hyrox_combo(gender, category, format_):
    """True when all three are known values."""
    return gender in HYROX_GENDERS and category in HYROX_CATEGORIES and format_ in HYROX_FORMATS


def clean_hyrox_result(payload):
    """(gender, category, format, total_seconds) from a posted result, or a Rejected."""
    gender, category, format_ = (str(payload.get(k) or "").strip() for k in ("gender", "category", "format"))
    try:
        seconds = float(payload.get("total_seconds"))
    except (TypeError, ValueError):
        raise Rejected("Invalid time.")
    if not math.isfinite(seconds) or isinstance(payload.get("total_seconds"), bool):
        raise Rejected("Invalid time.")
    if not hyrox_combo(gender, category, format_):
        raise Rejected("Invalid gender, category, or format.")
    if seconds < HYROX_MIN_PLAUSIBLE_SECONDS[f"{gender}|{format_}"] or seconds > HYROX_MAX_SECONDS:
        raise Rejected("That time isn't a plausible race finish.")
    return gender, category, format_, seconds


def create_hyrox_result(conn, user_id, gender, category, format_, seconds):
    foods.lock(conn, "hyrox_results", user_id)
    count = conn.execute("select count(*) as n from public.hyrox_results where user_id = %s", (user_id,)).fetchone()["n"]
    if count >= HYROX_RESULT_LIMIT:
        raise Rejected(foods.over_limit_message(HYROX_RESULT_LIMIT), 429)
    return conn.execute("insert into public.hyrox_results (user_id, gender, category, format, total_seconds) "
                        "values (%s, %s, %s, %s, %s) returning id", (user_id, gender, category, format_, seconds)).fetchone()["id"]


def hyrox_board(conn, user_id, gender, category, format_):
    """Everyone's fastest time for one exact gender/category/format, fastest first. The plausibility floor applies on the
    way OUT as well, before the MIN(), so a person with one impossible time and one real one ranks on the real one, and
    rows stored before the floor was raised cannot sit at the top for good. Hidden accounts are excluded in the query."""
    rows = conn.execute(
        "select r.user_id, p.name, min(r.total_seconds) as best_seconds from public.hyrox_results r "
        "join public.profiles p on p.id = r.user_id "
        "where r.gender = %s and r.category = %s and r.format = %s and r.total_seconds >= %s "
        "and r.total_seconds <= %s and not (r.user_id = any(%s::uuid[])) "
        "group by r.user_id, p.name order by best_seconds asc, r.user_id",
        (gender, category, format_, HYROX_MIN_PLAUSIBLE_SECONDS[f"{gender}|{format_}"], HYROX_MAX_SECONDS,
         list(hidden_ids(conn, user_id)))).fetchall()
    return [{"user_id": str(r["user_id"]), "name": r["name"], "best_seconds": r["best_seconds"]} for r in rows]
