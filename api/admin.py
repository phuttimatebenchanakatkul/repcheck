"""The owner's side: the pre-launch waitlist, the moderation queue (reports against accounts and AI replies) and a look at
who signed up and what they use. The website served these as HTML pages; here they are JSON, for the app or a script, and
every one answers 404 to anyone who is not in ADMIN_EMAILS (a 403 would admit the page exists).

Differences from the website, all deliberate:
  * the waitlist endpoint counts a visitor's tries atomically (the website read the count, then wrote it, so a burst
    could slip past the hourly limit), refuses an address with a control character (Postgres cannot store a NUL, and the
    website answered that with a 500), and refuses a body whose email or source is not text (the website crashed);
  * the waitlist CSV neutralises a cell that starts like a spreadsheet formula (`=cmd@evil.com` is a valid address, and the
    owner opens this file in a spreadsheet);
  * `/admin/export-db` is gone: there is no database file to hand over. Supabase keeps the backups, and `pg_dump` against the
    project is the export.
"""

import datetime as dt
import re

THAILAND_TZ = dt.timezone(dt.timedelta(hours=7))
RANGES = ("today", "week", "month", "all")
MODERATED_DISPLAY_NAME = "RepCheck User"          # database.MODERATED_DISPLAY_NAME
REPORT_PAGE_LIMIT = 100

WAITLIST_LIMIT = 5                                # app.py WAITLIST_LIMIT / WAITLIST_WINDOW: per visitor address per hour
WAITLIST_WINDOW = 3600
MAX_EMAIL = 254
MAX_SOURCE = 64
WAITLIST_ORIGINS = frozenset({                    # app.py WAITLIST_ORIGINS: the marketing site's two hostnames, echoed one at a time
    "https://repcheck-marketing.onrender.com",
    "https://repcheckofficials.onrender.com",
})
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

PAGE_LABELS = {
    "home": "Home", "analyze_page": "Analyze", "analyze_latest": "Analyze (latest result)",
    "workouts": "Workouts", "nutrition": "Nutrition", "coach": "Coach", "hyrox": "HYROX",
    "friends": "Friends", "settings": "Settings", "weight_history": "Weight History",
    "logging_history": "Logging History", "streaks": "Streaks", "onboarding": "Onboarding",
}
FEATURE_LABELS = {
    "workout_analysis": "Workout analyses (AI)", "food_scan": "Food photo scans (AI)",
    "coach_chat_message": "Coach chat messages", "analyze_chat_message": "Analysis chat messages",
    "workout_chat_message": "Workout chat messages",
    "hyrox_ai_analysis": "HYROX race analyses (AI)", "challenge_submission": "Challenge submissions",
    "food_logged": "Foods logged", "weight_logged": "Weigh-ins logged", "barcode_scan": "Barcode scans",
    "split_ai_suggested": "Split plans suggested (AI)", "checkin_ai_analysis": "Weekly check-ins refined (AI)",
    "friend_added": "Friends added", "block_user": "Accounts blocked", "report_user": "Accounts reported",
    "report_ai_reply": "AI replies reported",
}


def is_admin(settings, identity):
    return bool(identity.email) and identity.email.lower() in settings.admin_emails


# -- the waitlist -------------------------------------------------------------------------------------------------------------

def clean_email(raw):
    """The address lower-cased and trimmed, or None for anything that is not one."""
    if not isinstance(raw, str):
        return None
    email = raw.strip().lower()
    if len(email) > MAX_EMAIL or any(ord(c) < 32 or ord(c) == 127 for c in email) or not _EMAIL.match(email):
        return None
    return email


def clean_source(raw):
    if not isinstance(raw, str):
        return None
    return "".join(c for c in raw if ord(c) >= 32 and ord(c) != 127)[:MAX_SOURCE] or None


def take_attempt(conn, key, now):
    """Spend one of the visitor's tries in a single statement; (allowed, seconds until the window resets)."""
    row = conn.execute(
        """insert into public.auth_throttle (key, window_start, count) values (%(k)s, %(now)s, 1)
           on conflict (key) do update set
               window_start = case when %(now)s - auth_throttle.window_start >= %(w)s then %(now)s else auth_throttle.window_start end,
               count        = case when %(now)s - auth_throttle.window_start >= %(w)s then 1 else auth_throttle.count + 1 end
           where %(now)s - auth_throttle.window_start >= %(w)s or auth_throttle.count < %(limit)s
           returning window_start""", {"k": key, "now": now, "w": WAITLIST_WINDOW, "limit": WAITLIST_LIMIT}).fetchone()
    if row:
        return True, 0
    current = conn.execute("select window_start from public.auth_throttle where key = %s", (key,)).fetchone()
    return False, max(1, WAITLIST_WINDOW - (now - current["window_start"]))


def add_waitlist_email(conn, email, source):
    """True when the address is new, False when it was already there (the caller must answer both alike)."""
    row = conn.execute("insert into public.waitlist (email, source) values (%s, %s) on conflict (email) do nothing returning id",
                       (email, source)).fetchone()
    return row is not None


def waitlist_entries(conn):
    return [{"email": r["email"], "source": r["source"], "created_at": r["created_at"].isoformat()}
            for r in conn.execute("select email, source, created_at from public.waitlist order by created_at desc, id desc").fetchall()]


def delete_waitlist_email(conn, raw):
    """Erase an address on request (the privacy notice promises it within a month). True when something was removed."""
    email = (raw if isinstance(raw, str) else "").strip().lower()
    return bool(email) and conn.execute("delete from public.waitlist where email = %s returning id", (email,)).fetchone() is not None


def spreadsheet_safe(value):
    """Text a spreadsheet will not run as a formula: a leading = + - @ tab or CR is defused with an apostrophe."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def waitlist_csv(entries):
    lines = ["email,source,joined_utc"]
    for entry in entries:
        lines.append(",".join('"' + spreadsheet_safe(entry[col]).replace('"', '""') + '"' for col in ("email", "source", "created_at")))
    return "\r\n".join(lines) + "\r\n"


# -- moderation ------------------------------------------------------------------------------------------------------------------

def open_reports(conn, limit=REPORT_PAGE_LIMIT):
    """Unhandled reports against accounts, oldest first: the response time promised to reporters is what matters."""
    return [{"id": r["id"], "reason": r["reason"], "created_at": r["created_at"].isoformat(),
             "reporter_id": str(r["reporter_id"]), "reporter_name": r["reporter_name"],
             "reported_id": str(r["reported_id"]), "reported_name": r["reported_name"]}
            for r in conn.execute(
                "select r.id, r.reason, r.created_at, r.reporter_id, rep.name as reporter_name, r.reported_id, sub.name as reported_name "
                "from public.content_reports r join public.profiles rep on rep.id = r.reporter_id join public.profiles sub on sub.id = r.reported_id "
                "where r.handled_at is null order by r.created_at asc, r.id asc limit %s", (limit,)).fetchall()]


def open_ai_reports(conn, limit=REPORT_PAGE_LIMIT):
    return [{"id": r["id"], "feature": r["feature"], "reason": r["reason"], "reply_text": r["reply_text"],
             "created_at": r["created_at"].isoformat(), "reporter_name": r["reporter_name"]}
            for r in conn.execute(
                "select a.id, a.feature, a.reason, a.reply_text, a.created_at, p.name as reporter_name from public.ai_reports a "
                "join public.profiles p on p.id = a.user_id where a.handled_at is null order by a.created_at asc, a.id asc limit %s", (limit,)).fetchall()]


def mark_report_handled(conn, report_id):
    return conn.execute("update public.content_reports set handled_at = now() where id = %s and handled_at is null returning id",
                        (report_id,)).fetchone() is not None


def mark_ai_report_handled(conn, report_id):
    return conn.execute("update public.ai_reports set handled_at = now() where id = %s and handled_at is null returning id",
                        (report_id,)).fetchone() is not None


def reset_reported_name(conn, report_id):
    """Act on a report: replace the reported account's display name (the one thing a user writes that others see) with a
    neutral one and close every open report against that account. Returns the account id, or None if the report is gone."""
    row = conn.execute("select reported_id from public.content_reports where id = %s", (report_id,)).fetchone()
    if not row:
        return None
    reported = row["reported_id"]
    conn.execute("update public.profiles set name = %s where id = %s", (MODERATED_DISPLAY_NAME, reported))
    conn.execute("update public.content_reports set handled_at = now() where reported_id = %s and handled_at is null", (reported,))
    return str(reported)


# -- who signed up ------------------------------------------------------------------------------------------------------------------

def signup_cutoff(range_key, now=None):
    """The instant a signup list starts at (None for all). 'today' is Bangkok's calendar day for the owner, a fixed UTC+7
    offset because Thailand has no daylight saving, so it needs no timezone database."""
    now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(THAILAND_TZ)
    if range_key == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if range_key == "week":
        return now - dt.timedelta(days=7)
    if range_key == "month":
        return now - dt.timedelta(days=30)
    return None


def list_users(conn, since):
    rows = conn.execute(
        "select p.id, p.name, u.email, p.created_at from public.profiles p left join auth.users u on u.id = p.id "
        "where %(since)s::timestamptz is null or p.created_at >= %(since)s::timestamptz order by p.created_at desc, p.id", {"since": since}).fetchall()
    return [{"id": str(r["id"]), "name": r["name"], "email": r["email"], "created_at": r["created_at"].isoformat()} for r in rows]


COUNTED_TABLES = (                                # (label, table, column): constants of ours, never input
    ("foods_logged", "nutrition_entries", "user_id"), ("exercises_logged", "workout_entries", "user_id"),
    ("weigh_ins", "weight_entries", "user_id"), ("analyses", "analyze_results", "user_id"),
    ("progress_photos", "progress_photos", "user_id"), ("custom_foods", "custom_foods", "user_id"),
    ("challenge_submissions", "challenge_submissions", "user_id"), ("hyrox_results", "hyrox_results", "user_id"),
    ("friends", "friends", "user_id"),
)


def usage_split(events):
    pages, features = [], []
    for event in events:
        kind, _, name = event["event"].partition(":")
        entry = {"event": event["event"], "label": (PAGE_LABELS if kind == "page" else FEATURE_LABELS).get(name, name),
                 "count": event["count"], "last_at": event["last_at"].isoformat()}
        (pages if kind == "page" else features).append(entry)
    return pages, features


def user_detail(conn, user_id):
    profile = conn.execute("select p.id, p.name, u.email, p.created_at, p.deleted_at, p.ai_consent_at from public.profiles p "
                           "left join auth.users u on u.id = p.id where p.id = %s", (user_id,)).fetchone()
    if not profile:
        return None
    events = conn.execute("select event, count, last_at from public.usage_events where user_id = %s order by count desc, event", (user_id,)).fetchall()
    pages, features = usage_split(events)
    counts = {label: conn.execute(f"select count(*) as n from public.{table} where {column} = %s", (user_id,)).fetchone()["n"]
              for label, table, column in COUNTED_TABLES}
    latest = conn.execute("select log_date, kg from public.weight_entries where user_id = %s order by log_date desc limit 1", (user_id,)).fetchone()
    analyses = conn.execute("select id, exercise_label, overall_score, created_at from public.analyze_results where user_id = %s "
                            "order by created_at desc, id desc limit 10", (user_id,)).fetchall()
    return {
        "id": str(profile["id"]), "name": profile["name"], "email": profile["email"],
        "created_at": profile["created_at"].isoformat(),
        "deleted_at": profile["deleted_at"].isoformat() if profile["deleted_at"] else None,
        "ai_consent": profile["ai_consent_at"] is not None,
        "page_views": pages, "feature_uses": features, "counts": counts,
        "latest_weight": {"date": latest["log_date"].isoformat(), "kg": latest["kg"]} if latest else None,
        "analyses": [{"id": a["id"], "exercise_label": a["exercise_label"], "overall_score": a["overall_score"],
                      "created_at": a["created_at"].isoformat()} for a in analyses],
    }
