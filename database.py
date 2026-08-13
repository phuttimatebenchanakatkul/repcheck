"""SQLite-backed user accounts, preferences, and account-synced app data.

Deliberately plain (stdlib sqlite3, no ORM) to match the rest of this
app's style.

`user_data` is a generic per-user key/value JSON store: every piece of
state that used to live *only* in the browser's localStorage (workouts,
nutrition log, coaching profile, weight log, streaks, split plans, etc.)
is mirrored here, keyed by the same localStorage key name, so it follows
a logged-in user's account instead of being stranded on whichever
browser origin (127.0.0.1 vs localhost vs a LAN IP) happened to write
it. See static/account_sync.js for the client side of this.
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from name_filter import validate_display_name

# DATA_DIR lets deployment point this at a persistent volume (e.g. a
# Render disk) instead of the app's own source directory, which is wiped
# on every deploy. Defaults to the old local-dev behavior when unset.
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
DB_PATH = DATA_DIR / "repcheck.db"


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                name TEXT NOT NULL,
                auth_provider TEXT NOT NULL DEFAULT 'local',
                provider_user_id TEXT,
                avatar_url TEXT,
                theme TEXT NOT NULL DEFAULT 'light',
                language TEXT NOT NULL DEFAULT 'en',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Two Google accounts can't share a provider_user_id, but plenty of
        # local/email users will all have NULL there, so the uniqueness
        # only makes sense excluding NULLs (SQLite partial index).
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider
            ON users (auth_provider, provider_user_id)
            WHERE provider_user_id IS NOT NULL
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_data (
                user_id INTEGER NOT NULL REFERENCES users(id),
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, key)
            )
        """)
        # Short shareable code (shown as text + QR) friends use to add you.
        # ALTER TABLE ... IF NOT EXISTS doesn't exist in SQLite, so probe first.
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
        if "friend_code" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN friend_code TEXT")
            conn.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_friend_code
                ON users (friend_code) WHERE friend_code IS NOT NULL
            """)
        # Gates the combined nutrition+workout-split onboarding wizard to
        # once per account, right after a brand-new signup. New rows get 0
        # from the column default below; accounts that already existed
        # before this feature shipped are backfilled to 1 (already
        # "onboarded" in spirit) so they aren't suddenly interrupted by a
        # wizard that didn't exist when they signed up.
        if "onboarding_completed" not in cols:
            conn.execute(
                "ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0"
            )
            conn.execute("UPDATE users SET onboarding_completed = 1")
        # VESTIGIAL: rate_limited originally exempted pre-existing accounts
        # from the AI usage limits, but enforcement now applies to every
        # account and ignores this column entirely (see app.py's
        # _limited_user). The migration is kept only so fresh installs get
        # the same schema as databases it already ran against.
        if "rate_limited" not in cols:
            conn.execute(
                "ALTER TABLE users ADD COLUMN rate_limited INTEGER NOT NULL DEFAULT 1"
            )
        # Per-user AI usage counters (workout/food analysis, chatbot). One
        # row per user per feature, holding a fixed-window count -- see
        # rate_limit_peek / rate_limit_consume below.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rate_limits (
                user_id INTEGER NOT NULL REFERENCES users(id),
                feature TEXT NOT NULL,
                window_start INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, feature)
            )
        """)
        # Lifetime per-user usage counters for the admin activity view:
        # one row per (user, event), where event is "page:<endpoint>" for
        # page views or "feature:<name>" for feature uses (AI analysis,
        # food scan, chat message, ...). Deliberately aggregate counters,
        # not an event log -- the admin page needs "how many times", not a
        # full clickstream, and counters can't grow unbounded per user.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS usage_events (
                user_id INTEGER NOT NULL REFERENCES users(id),
                event TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                last_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, event)
            )
        """)
        # Friendships are stored one row per direction (both inserted on
        # add) so "my friends" is always a single indexed lookup.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS friends (
                user_id INTEGER NOT NULL REFERENCES users(id),
                friend_id INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, friend_id)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                creator_id INTEGER NOT NULL REFERENCES users(id),
                exercise TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL DEFAULT 25,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # One row per user per challenge — resubmitting keeps the best reps.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS challenge_submissions (
                challenge_id INTEGER NOT NULL REFERENCES challenges(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                reps INTEGER NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (challenge_id, user_id)
            )
        """)
        # Foods a user typed in themselves (name/emoji/macros, no barcode or
        # AI estimate) — scoped to user_id, so these only ever show up in
        # that one user's own search results, never anyone else's and never
        # the shared FOOD_LIBRARY/DISHES data in food_library.py.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS custom_foods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                emoji TEXT NOT NULL,
                calories REAL NOT NULL,
                protein REAL NOT NULL,
                fat REAL NOT NULL,
                carbs REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Exercises a user invented themselves (not in workout_library.py's
        # shared EXERCISE_CATEGORIES) -- scoped to user_id so these only ever
        # show up in that one user's own split-builder search, never anyone
        # else's and never the shared library.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS custom_exercises (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                emoji TEXT,
                mode TEXT NOT NULL DEFAULT 'both',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # emoji (chosen icon) and mode (how sets are logged: 'both' sides at
        # once, 'each' side individually, or 'either' -- user picks per set)
        # were added after this table first shipped name-only. Probe-then-
        # ALTER for existing DBs, same reasoning as friend_code above.
        ce_cols = {row["name"] for row in conn.execute("PRAGMA table_info(custom_exercises)")}
        if "emoji" not in ce_cols:
            conn.execute("ALTER TABLE custom_exercises ADD COLUMN emoji TEXT")
        if "mode" not in ce_cols:
            conn.execute("ALTER TABLE custom_exercises ADD COLUMN mode TEXT NOT NULL DEFAULT 'both'")
        # Weekly check-in progress photos (front/back). A dedicated table
        # rather than the generic user_data JSON-blob pattern, since these
        # need to be queried/listed per user and each row points at a real
        # file on disk (see PROGRESS_PHOTOS_DIR in app.py) instead of being
        # a value that's meaningful to just stuff inline as JSON. Every
        # route touching these MUST check row.user_id against the logged-in
        # user before ever serving or deleting a photo -- these are
        # deliberately private, never public.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS progress_photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                date TEXT NOT NULL,
                angle TEXT NOT NULL,
                filename TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Finished HYROX race times, one row per completed race -- a
        # dedicated table (not the generic user_data blob) because the
        # global leaderboard needs to rank across every user's times for a
        # given gender/category/format combo, which a per-user JSON blob
        # can't do. Mirrors static/hyrox.js's local-history record shape
        # (gender/category/format/totalSeconds) but only the fields the
        # leaderboard actually needs to rank and display.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS hyrox_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                gender TEXT NOT NULL,
                category TEXT NOT NULL,
                format TEXT NOT NULL,
                total_seconds REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Analyze (video form-check) results, one row per completed analysis.
        # The uploaded video itself is always deleted right after analysis
        # (see app.py's /analyze route) -- this only stores the *outcome*
        # (scores/feedback text/reps), not the video, and only for a
        # logged-in user. Lets a user's most recent result be looked back
        # up later (e.g. "jump straight to my latest analysis") instead of
        # it being gone the moment they navigate away, which was true of
        # every analysis before this table existed.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS analyze_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                exercise_label TEXT NOT NULL,
                overall_score INTEGER,
                stretch_score INTEGER,
                squeeze_score INTEGER,
                favored TEXT,
                reps INTEGER,
                feedback_text TEXT NOT NULL,
                video_filename TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # The analyzed (trimmed) clip is now kept on disk per result so the
        # history view can replay it -- rows from before this column simply
        # have no video. Probe-then-ALTER, same reasoning as friend_code.
        ar_cols = {row["name"] for row in conn.execute("PRAGMA table_info(analyze_results)")}
        if "video_filename" not in ar_cols:
            conn.execute("ALTER TABLE analyze_results ADD COLUMN video_filename TEXT")


def _row_to_dict(row):
    return dict(row) if row else None


def get_user_by_id(user_id):
    with get_db() as conn:
        return _row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def get_user_by_email(email):
    with get_db() as conn:
        return _row_to_dict(
            conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
        )


def get_user_by_provider(provider, provider_user_id):
    with get_db() as conn:
        return _row_to_dict(conn.execute(
            "SELECT * FROM users WHERE auth_provider = ? AND provider_user_id = ?",
            (provider, provider_user_id),
        ).fetchone())


def list_users(since=None):
    """All users, newest first -- for the admin signups page. `since` (an
    ISO datetime string) restricts to accounts created at or after that
    moment; omit for every account. created_at is stored as SQLite's
    default UTC `datetime('now')`, so `since` must be UTC too for the
    comparison to line up (see app.py's admin route, which builds it from
    datetime.utcnow())."""
    with get_db() as conn:
        if since:
            rows = conn.execute(
                "SELECT id, name, email, auth_provider, created_at FROM users "
                "WHERE created_at >= ? ORDER BY created_at DESC",
                (since,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, email, auth_provider, created_at FROM users "
                "ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]


def create_local_user(email, password, name):
    from werkzeug.security import generate_password_hash

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO users (email, password_hash, name, auth_provider) VALUES (?, ?, ?, 'local')",
            (email.lower().strip(), generate_password_hash(password), name.strip()),
        )
        return cur.lastrowid


def mark_onboarding_completed(user_id):
    with get_db() as conn:
        conn.execute("UPDATE users SET onboarding_completed = 1 WHERE id = ?", (user_id,))


def create_oauth_user(email, name, provider, provider_user_id, avatar_url=None):
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO users (email, name, auth_provider, provider_user_id, avatar_url)
               VALUES (?, ?, ?, ?, ?)""",
            (
                (email or f"{provider}-{provider_user_id}@no-email.repcheck.local").lower().strip(),
                name.strip(),
                provider,
                provider_user_id,
                avatar_url,
            ),
        )
        return cur.lastrowid


def verify_password(email, password):
    """Returns the user dict if the email/password combo is correct, else
    None. Also returns None (rather than raising) for OAuth-only accounts
    that have no password set."""
    from werkzeug.security import check_password_hash

    user = get_user_by_email(email)
    if not user or not user["password_hash"]:
        return None
    return user if check_password_hash(user["password_hash"], password) else None


def get_all_user_data(user_id):
    """{key: value} for every synced key this user has, values JSON-decoded."""
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM user_data WHERE user_id = ?", (user_id,)).fetchall()
    return {row["key"]: json.loads(row["value"]) for row in rows}


# Keys representing append-only logs of dated/identified entries (workouts,
# nutrition, weigh-ins, day statuses, HYROX races, lift analyses). The
# generic sync route (POST/PUT /api/sync/<key> in app.py) used to overwrite
# a user's whole blob for these keys with whatever the client last pushed --
# fine for most keys, but for these it meant a client push racing behind a
# newer write (from another device, or just a stale in-memory copy in a tab
# that had been open a while) could silently DELETE entries the server
# already had, since a plain overwrite has no way to tell "the client meant
# to remove this" from "the client just doesn't know about it yet" (this is
# the real cause behind entries like a logged meal quietly vanishing).
# set_user_data() below now merges (union by date + id) with whatever's
# already stored for these keys instead, so this route can only ever GAIN
# entries, never lose them. Deletions still work: they go through their own
# atomic per-entry endpoint instead (see remove_nutrition_log_entry() below
# and DELETE /api/nutrition/log-entry in app.py), which edits the stored
# value directly rather than depending on a diff against a possibly-stale
# client blob. Mirrors static/account_sync.js's identical client-side merge
# (MERGE_LOG_KEYS/mergeLog) -- keep both lists in sync.
LOG_MERGE_ARRAY_KEYS = {"repcheck_hyrox_history_v1", "repcheck_analyze_log_v1"}
LOG_MERGE_DATE_KEYED_KEYS = {
    "repcheck_workout_log_v2",
    "repcheck_nutrition_log_v1",
    "repcheck_weight_log_v1",
    "repcheck_day_status_v1",
}
MERGE_LOG_KEYS = LOG_MERGE_ARRAY_KEYS | LOG_MERGE_DATE_KEYED_KEYS


def _merge_by_id(incoming, existing):
    """Union two lists of entries by 'id' (falling back to full-value
    identity for entries without one), incoming taking precedence on an id
    collision -- mirrors account_sync.js's mergeById exactly."""
    seen = set()
    out = []
    for item in list(incoming) + list(existing):
        if isinstance(item, dict) and item.get("id") is not None:
            marker = ("id", item["id"])
        else:
            marker = ("json", json.dumps(item, sort_keys=True))
        if marker not in seen:
            seen.add(marker)
            out.append(item)
    return out


def _merge_date_keyed(incoming, existing):
    """Union a date-keyed dict (date -> entry array, e.g. nutrition/workout
    logs; or date -> scalar, e.g. weight/day-status). Every date on either
    side is kept; arrays are id-merged, scalars prefer the incoming value on
    a conflict. Mirrors account_sync.js's mergeDateKeyed exactly."""
    incoming = incoming if isinstance(incoming, dict) else {}
    existing = existing if isinstance(existing, dict) else {}
    out = {}
    for date_key in set(incoming) | set(existing):
        iv, ev = incoming.get(date_key), existing.get(date_key)
        if isinstance(iv, list) or isinstance(ev, list):
            out[date_key] = _merge_by_id(iv if isinstance(iv, list) else [], ev if isinstance(ev, list) else [])
        elif date_key in incoming:
            out[date_key] = iv
        else:
            out[date_key] = ev
    return out


def set_user_data(user_id, key, value):
    """Sets a synced key's value. For MERGE_LOG_KEYS, merges with whatever
    is already stored instead of overwriting it outright -- see that
    constant's comment above for why."""
    with get_db() as conn:
        if key in MERGE_LOG_KEYS:
            row = conn.execute(
                "SELECT value FROM user_data WHERE user_id = ? AND key = ?", (user_id, key)
            ).fetchone()
            existing = json.loads(row["value"]) if row else None
            if key in LOG_MERGE_ARRAY_KEYS:
                value = _merge_by_id(
                    value if isinstance(value, list) else [],
                    existing if isinstance(existing, list) else [],
                )
            else:
                value = _merge_date_keyed(value, existing)
        payload = json.dumps(value)
        conn.execute(
            """INSERT INTO user_data (user_id, key, value, updated_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (user_id, key, payload),
        )


def delete_user_data(user_id, key):
    with get_db() as conn:
        conn.execute("DELETE FROM user_data WHERE user_id = ? AND key = ?", (user_id, key))


NUTRITION_LOG_KEY = "repcheck_nutrition_log_v1"


def append_nutrition_log_entry(user_id, date_iso, entry):
    """Atomically appends one entry to a user's nutrition log for a given
    date, entirely server-side -- the authoritative write path for "add
    food to log" (see POST /api/nutrition/log-entry in app.py), used
    instead of relying only on the generic localStorage-blob sync
    (static/account_sync.js). That sync is fire-and-forget from the
    browser's side and, being a whole-blob overwrite, was also vulnerable
    to silently dropping an entry if two saves raced (last write wins).
    This does a real read-modify-write inside one transaction, so the
    entry is durably recorded (or the caller gets a clear failure) before
    the client considers the food "logged". Returns the updated log for
    that one date so the caller can hand it straight back to the browser
    to resync localStorage without a second round trip.

    Idempotent by entry id: the generic account_sync.js blob sync (see
    MERGE_LOG_KEYS) can land concurrently with this call and merge the same
    entry into the stored log first, since it's fire-and-forget off the
    same localStorage.setItem() that queues this request. Without a check
    here, that race produces two copies of the identical entry (same id,
    same addedAt) for the date -- a plain append can't tell "this is new"
    from "the other write path already put this here".
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM user_data WHERE user_id = ? AND key = ?",
            (user_id, NUTRITION_LOG_KEY),
        ).fetchone()
        log = json.loads(row["value"]) if row else {}
        day_entries = log.setdefault(date_iso, [])
        if not any(isinstance(e, dict) and e.get("id") == entry.get("id") for e in day_entries):
            day_entries.append(entry)
        payload = json.dumps(log)
        conn.execute(
            """INSERT INTO user_data (user_id, key, value, updated_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (user_id, NUTRITION_LOG_KEY, payload),
        )
        return day_entries


def remove_nutrition_log_entry(user_id, date_iso, entry_id):
    """Atomically removes one entry (by id) from a user's nutrition log for
    a given date -- the authoritative counterpart to
    append_nutrition_log_entry() above (see DELETE /api/nutrition/log-entry
    in app.py). Needed as its own endpoint now that set_user_data() merges
    rather than overwrites for this key (see MERGE_LOG_KEYS): a merge can
    only ever add entries back from an older stored copy, never remove one,
    so a deletion has to edit the stored value directly instead of relying
    on the generic sync route noticing an entry is now missing from a
    pushed blob. Returns the updated list for that date."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM user_data WHERE user_id = ? AND key = ?",
            (user_id, NUTRITION_LOG_KEY),
        ).fetchone()
        log = json.loads(row["value"]) if row else {}
        day_entries = [e for e in log.get(date_iso, []) if e.get("id") != entry_id]
        log[date_iso] = day_entries
        payload = json.dumps(log)
        conn.execute(
            """INSERT INTO user_data (user_id, key, value, updated_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (user_id, NUTRITION_LOG_KEY, payload),
        )
        return day_entries


WORKOUT_LOG_KEY = "repcheck_workout_log_v2"


def set_workout_log_day(user_id, date_iso, entries):
    """Atomically replaces one date's entries in the workout log with
    exactly what's given -- the authoritative write path for every
    workout-log mutation (add an exercise, delete one, edit its sets/reps/
    weight), entirely server-side (see POST /api/workout/log-day in
    app.py). repcheck_workout_log_v2 is in database.py's MERGE_LOG_KEYS, so
    the generic /api/sync/<key> route merges rather than overwrites it --
    that route can therefore only ever GAIN entries back from an older
    stored copy, never remove or change one, so a deleted or edited
    exercise pushed through that route alone would resurrect or revert on
    the next sync (this was the actual bug: a workout logged on one device
    and deleted there would still show on another, because the merge
    doesn't know the difference between "never existed" and "we removed
    this"). This instead replaces the entry list for the ONE date given, so
    additions, edits, and deletions are all represented correctly by a
    single write, the same way set_weight_log_entry() above already does
    for weigh-ins. Scoped to one date (not the whole log) so a write here
    can't clobber a different date's entries even if this request lands
    out of order relative to another device's edit on a different day.
    Returns the full updated log so the caller can resync localStorage
    without a second round trip."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM user_data WHERE user_id = ? AND key = ?",
            (user_id, WORKOUT_LOG_KEY),
        ).fetchone()
        log = json.loads(row["value"]) if row else {}
        log[date_iso] = entries
        payload = json.dumps(log)
        conn.execute(
            """INSERT INTO user_data (user_id, key, value, updated_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (user_id, WORKOUT_LOG_KEY, payload),
        )
        return log


WEIGHT_LOG_KEY = "repcheck_weight_log_v1"


def set_weight_log_entry(user_id, date_iso, entry):
    """Atomically sets a user's weigh-in for one date, entirely server-side --
    same authoritative-write pattern as append_nutrition_log_entry above (see
    POST /api/weight/log-entry in app.py), used instead of only relying on
    the generic localStorage-blob sync. A weigh-in was going through that
    fire-and-forget sync alone and could vanish if the browser navigated
    away before the write landed and a stale hydration pull overwrote it.
    Unlike the nutrition log this is a set (one entry per date, overwriting
    same-day re-logs) rather than an append, matching how coaching.js's
    logWeight() already treats the log client-side. Returns the updated log
    so the caller can resync localStorage without a second round trip.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM user_data WHERE user_id = ? AND key = ?",
            (user_id, WEIGHT_LOG_KEY),
        ).fetchone()
        log = json.loads(row["value"]) if row else {}
        log[date_iso] = entry
        payload = json.dumps(log)
        conn.execute(
            """INSERT INTO user_data (user_id, key, value, updated_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (user_id, WEIGHT_LOG_KEY, payload),
        )
        return log


HYROX_HISTORY_KEY = "repcheck_hyrox_history_v1"


def append_hyrox_history_entry(user_id, entry):
    """Atomically appends one finished race to a user's HYROX history,
    entirely server-side -- same authoritative-write pattern as
    append_nutrition_log_entry() above (see POST /api/hyrox/history-entry
    in app.py). Until now a finished race went through the generic
    localStorage-blob sync alone (hyrox.js's saveHistory() is a plain
    localStorage.setItem, with no per-race server write of its own), which
    is fire-and-forget and, being a whole-blob overwrite, could silently
    lose a race if two saves raced (last write wins) -- exactly how a
    logged time could vanish. This does a real read-modify-write inside
    one transaction, so the race is durably recorded before the client
    treats it as saved. Returns the updated history list."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM user_data WHERE user_id = ? AND key = ?",
            (user_id, HYROX_HISTORY_KEY),
        ).fetchone()
        history = json.loads(row["value"]) if row else []
        if not isinstance(history, list):
            history = []
        history.append(entry)
        payload = json.dumps(history)
        conn.execute(
            """INSERT INTO user_data (user_id, key, value, updated_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (user_id, HYROX_HISTORY_KEY, payload),
        )
        return history


def remove_hyrox_history_entry(user_id, entry_id):
    """Atomically removes one race (by id) from a user's HYROX history --
    the authoritative counterpart to append_hyrox_history_entry() above
    (see DELETE /api/hyrox/history-entry in app.py). Needed as its own
    endpoint now that set_user_data() merges rather than overwrites this
    key (see MERGE_LOG_KEYS): a merge can only ever bring entries back
    from an older stored copy, never remove one, so a deletion has to edit
    the stored value directly. Returns the updated history list."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM user_data WHERE user_id = ? AND key = ?",
            (user_id, HYROX_HISTORY_KEY),
        ).fetchone()
        history = json.loads(row["value"]) if row else []
        if not isinstance(history, list):
            history = []
        history = [r for r in history if r.get("id") != entry_id]
        payload = json.dumps(history)
        conn.execute(
            """INSERT INTO user_data (user_id, key, value, updated_at)
               VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (user_id, HYROX_HISTORY_KEY, payload),
        )
        return history


def update_account(user_id, name=None, email=None):
    """Update account fields. Returns None on success, or an error string
    (e.g. the email is already taken by another account)."""
    fields, values = [], []
    if name is not None and name.strip():
        # Same display-name check as signup (see name_filter.py) -- this is
        # the other place a user can set the name shown to everyone else,
        # so an inappropriate one shouldn't be able to sneak in by renaming
        # after account creation.
        name_error = validate_display_name(name)
        if name_error:
            return name_error
        fields.append("name = ?")
        values.append(name.strip())
    if email is not None and email.strip():
        fields.append("email = ?")
        values.append(email.lower().strip())
    if not fields:
        return "Nothing to update."
    values.append(user_id)
    try:
        with get_db() as conn:
            conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    except sqlite3.IntegrityError:
        return "That email is already in use by another account."
    return None


# ---------- Per-user AI usage rate limits ----------
# A fixed-window counter per (user, feature): the window opens on the first
# use and lasts window_seconds; once `limit` uses land inside it, further
# uses are blocked until it elapses, then the next use opens a fresh window.
# Split into a read-only peek and a separate consume so the caller can check
# the limit up front but only spend a use once the work actually succeeds
# (a failed Gemini call shouldn't burn one of a user's scarce analyses).
def rate_limit_peek(user_id, feature, limit, window_seconds, now):
    """Read-only: (allowed, retry_after_seconds) for one more use of `feature`
    by this user right now. Does not record anything."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT window_start, count FROM rate_limits WHERE user_id = ? AND feature = ?",
            (user_id, feature),
        ).fetchone()
    if row is None or now - row["window_start"] >= window_seconds:
        return True, 0
    if row["count"] >= limit:
        return False, int(window_seconds - (now - row["window_start"]))
    return True, 0


def rate_limit_consume(user_id, feature, window_seconds, now):
    """Record one use of `feature` for this user, opening a fresh window if the
    previous one has fully elapsed (or none exists yet)."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT window_start, count FROM rate_limits WHERE user_id = ? AND feature = ?",
            (user_id, feature),
        ).fetchone()
        if row is None or now - row["window_start"] >= window_seconds:
            window_start, count = now, 0
        else:
            window_start, count = row["window_start"], row["count"]
        conn.execute(
            "INSERT INTO rate_limits (user_id, feature, window_start, count) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(user_id, feature) DO UPDATE SET "
            "window_start = excluded.window_start, count = excluded.count",
            (user_id, feature, window_start, count + 1),
        )


# ---------- Admin activity tracking ----------
def track_usage(user_id, event):
    """Increment the lifetime counter for one (user, event) pair -- events
    are "page:<endpoint>" or "feature:<name>", see app.py's tracker."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO usage_events (user_id, event, count, last_at) "
            "VALUES (?, ?, 1, datetime('now')) "
            "ON CONFLICT(user_id, event) DO UPDATE SET "
            "count = count + 1, last_at = datetime('now')",
            (user_id, event),
        )


def get_usage_events(user_id):
    """All of one user's usage counters, most-used first."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT event, count, last_at FROM usage_events "
            "WHERE user_id = ? ORDER BY count DESC, event",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_user_activity_counts(user_id):
    """Row counts of everything this user has stored server-side, for the
    admin per-user detail page."""
    queries = {
        "workout_analyses": "SELECT COUNT(*) FROM analyze_results WHERE user_id = ?",
        "hyrox_races": "SELECT COUNT(*) FROM hyrox_results WHERE user_id = ?",
        "challenge_submissions": "SELECT COUNT(*) FROM challenge_submissions WHERE user_id = ?",
        "custom_foods": "SELECT COUNT(*) FROM custom_foods WHERE user_id = ?",
        "custom_exercises": "SELECT COUNT(*) FROM custom_exercises WHERE user_id = ?",
        "progress_photos": "SELECT COUNT(*) FROM progress_photos WHERE user_id = ?",
        "friends": "SELECT COUNT(*) FROM friends WHERE user_id = ?",
    }
    with get_db() as conn:
        return {name: conn.execute(sql, (user_id,)).fetchone()[0] for name, sql in queries.items()}


def get_or_create_friend_code(user_id):
    import secrets

    with get_db() as conn:
        row = conn.execute("SELECT friend_code FROM users WHERE id = ?", (user_id,)).fetchone()
        if row and row["friend_code"]:
            return row["friend_code"]
        # Loop on the (astronomically unlikely) collision instead of crashing.
        while True:
            code = "RC-" + secrets.token_hex(3).upper()
            try:
                conn.execute("UPDATE users SET friend_code = ? WHERE id = ?", (code, user_id))
                return code
            except sqlite3.IntegrityError:
                continue


def get_user_by_friend_code(code):
    with get_db() as conn:
        return _row_to_dict(
            conn.execute("SELECT * FROM users WHERE friend_code = ?", (code.strip().upper(),)).fetchone()
        )


def add_friendship(user_id, friend_id):
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)", (user_id, friend_id)
        )
        conn.execute(
            "INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)", (friend_id, user_id)
        )


def get_friends(user_id):
    with get_db() as conn:
        rows = conn.execute(
            """SELECT u.id, u.name, u.email FROM friends f
               JOIN users u ON u.id = f.friend_id
               WHERE f.user_id = ? ORDER BY u.name""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def create_challenge(creator_id, exercise, duration_seconds=25):
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO challenges (creator_id, exercise, duration_seconds) VALUES (?, ?, ?)",
            (creator_id, exercise, duration_seconds),
        )
        return cur.lastrowid


def get_visible_challenges(user_id):
    """Challenges created by the user or any of their friends, newest first,
    each with its leaderboard (submissions sorted by reps)."""
    with get_db() as conn:
        challenges = [dict(r) for r in conn.execute(
            """SELECT c.*, u.name AS creator_name FROM challenges c
               JOIN users u ON u.id = c.creator_id
               WHERE c.creator_id = ?
                  OR c.creator_id IN (SELECT friend_id FROM friends WHERE user_id = ?)
               ORDER BY c.created_at DESC""",
            (user_id, user_id),
        ).fetchall()]
        for c in challenges:
            c["leaderboard"] = [dict(r) for r in conn.execute(
                """SELECT s.user_id, s.reps, s.notes, s.created_at, u.name
                   FROM challenge_submissions s JOIN users u ON u.id = s.user_id
                   WHERE s.challenge_id = ? ORDER BY s.reps DESC, s.created_at ASC""",
                (c["id"],),
            ).fetchall()]
    return challenges


def get_challenge(challenge_id):
    with get_db() as conn:
        return _row_to_dict(
            conn.execute("SELECT * FROM challenges WHERE id = ?", (challenge_id,)).fetchone()
        )


def save_submission(challenge_id, user_id, reps, notes):
    """Insert or improve a submission — resubmitting only keeps a HIGHER rep
    count, so a bad retake can't wipe out a better earlier score."""
    with get_db() as conn:
        conn.execute(
            """INSERT INTO challenge_submissions (challenge_id, user_id, reps, notes)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(challenge_id, user_id) DO UPDATE SET
                 reps = excluded.reps, notes = excluded.notes, created_at = excluded.created_at
               WHERE excluded.reps > challenge_submissions.reps""",
            (challenge_id, user_id, reps, notes),
        )


def has_submitted_today(user_id, exercise):
    """Whether this user has already recorded an attempt (any challenge) for
    this exercise today — the one-attempt-per-day limit checks this before
    letting a new challenge/submission through, regardless of which
    specific challenge_id the earlier attempt went to."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT 1 FROM challenge_submissions s
               JOIN challenges c ON c.id = s.challenge_id
               WHERE s.user_id = ? AND c.exercise = ?
                 AND date(s.created_at) = date('now')
               LIMIT 1""",
            (user_id, exercise),
        ).fetchone()
        return row is not None


def get_exercise_leaderboard(exercise, user_ids=None, limit=None):
    """Each user's BEST (max) rep count across every challenge attempt
    they've ever submitted for `exercise`, ranked highest first.

    Built on top of the existing challenges/challenge_submissions tables
    (rather than a dedicated per-exercise leaderboard table) — a
    "leaderboard for push-ups" is just every submission across every
    push-up challenge anyone's ever started, grouped by user and taking
    each person's personal best.

    user_ids=None means every user who has a submission (the global
    leaderboard); pass a list to scope it to a friend circle.
    """
    query = """
        SELECT s.user_id, u.name, MAX(s.reps) AS best_reps, MAX(s.created_at) AS last_at
        FROM challenge_submissions s
        JOIN challenges c ON c.id = s.challenge_id
        JOIN users u ON u.id = s.user_id
        WHERE c.exercise = ?
    """
    params = [exercise]
    if user_ids is not None:
        if not user_ids:
            return []
        placeholders = ",".join("?" for _ in user_ids)
        query += f" AND s.user_id IN ({placeholders})"
        params.extend(user_ids)
    query += " GROUP BY s.user_id ORDER BY best_reps DESC, last_at ASC"
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def get_total_reps_leaderboard(user_ids=None, limit=None):
    """Each user's TOTAL reps summed across every challenge submission
    they've ever made, across every exercise combined (push-ups + sit-ups +
    pull-ups all count toward the same running total), ranked highest
    first. Replaces get_exercise_leaderboard as the main leaderboard now
    that the daily challenge rotates through one exercise at a time rather
    than the user picking one — that function is kept as-is (per-exercise
    data still lives in challenge_submissions/challenges, nothing here
    aggregates it away) for whenever a per-category breakdown is needed.
    """
    query = """
        SELECT s.user_id, u.name, SUM(s.reps) AS total_reps, MAX(s.created_at) AS last_at
        FROM challenge_submissions s
        JOIN users u ON u.id = s.user_id
    """
    params = []
    if user_ids is not None:
        if not user_ids:
            return []
        placeholders = ",".join("?" for _ in user_ids)
        query += f" WHERE s.user_id IN ({placeholders})"
        params.extend(user_ids)
    query += " GROUP BY s.user_id ORDER BY total_reps DESC, last_at ASC"
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def create_hyrox_result(user_id, gender, category, format_, total_seconds):
    with get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO hyrox_results (user_id, gender, category, format, total_seconds)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, gender, category, format_, total_seconds),
        )
        return cursor.lastrowid


def get_hyrox_leaderboard(gender, category, format_):
    """Every user's PB (fastest time) for one exact gender/category/format
    combo, fastest first -- a Pro Singles time isn't comparable to an Open
    Doubles one, so the four combos are always ranked separately, never
    mixed together. Returns the full ranked list (no limit); callers slice
    for display and can find any one user's rank by their position in it.
    """
    with get_db() as conn:
        rows = conn.execute(
            """SELECT r.user_id, u.name, MIN(r.total_seconds) AS best_seconds
               FROM hyrox_results r
               JOIN users u ON u.id = r.user_id
               WHERE r.gender = ? AND r.category = ? AND r.format = ?
               GROUP BY r.user_id
               ORDER BY best_seconds ASC""",
            (gender, category, format_),
        ).fetchall()
    return [dict(r) for r in rows]


def save_analyze_result(user_id, exercise_label, overall_score, stretch_score, squeeze_score, favored, reps, feedback_text, video_filename=None):
    with get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO analyze_results
               (user_id, exercise_label, overall_score, stretch_score, squeeze_score, favored, reps, feedback_text, video_filename)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, exercise_label, overall_score, stretch_score, squeeze_score, favored, reps, feedback_text, video_filename),
        )
        return cursor.lastrowid


def get_latest_analyze_result(user_id):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM analyze_results WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def get_analyze_results(user_id, limit=20):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM analyze_results WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_analyze_result(user_id, result_id):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM analyze_results WHERE user_id = ? AND id = ?",
            (user_id, result_id),
        ).fetchone()
    return dict(row) if row else None


def prune_analyze_results(user_id, keep=20):
    """Delete this user's oldest analyze results beyond the newest `keep`,
    returning the deleted rows' video filenames so the caller can remove
    the clips from disk too (the DB doesn't own those files)."""
    with get_db() as conn:
        stale = conn.execute(
            """SELECT id, video_filename FROM analyze_results
               WHERE user_id = ?
               ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?""",
            (user_id, keep),
        ).fetchall()
        if stale:
            conn.executemany(
                "DELETE FROM analyze_results WHERE id = ?",
                [(row["id"],) for row in stale],
            )
    return [row["video_filename"] for row in stale if row["video_filename"]]


def update_preferences(user_id, theme=None, language=None):
    fields, values = [], []
    if theme is not None:
        fields.append("theme = ?")
        values.append(theme)
    if language is not None:
        fields.append("language = ?")
        values.append(language)
    if not fields:
        return
    values.append(user_id)
    with get_db() as conn:
        conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)


def create_custom_food(user_id, name, emoji, calories, protein, fat, carbs):
    with get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO custom_foods (user_id, name, emoji, calories, protein, fat, carbs)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, name, emoji, calories, protein, fat, carbs),
        )
        return cursor.lastrowid


def get_custom_foods(user_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM custom_foods WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def delete_custom_food(user_id, food_id):
    with get_db() as conn:
        conn.execute("DELETE FROM custom_foods WHERE user_id = ? AND id = ?", (user_id, food_id))


def create_custom_exercise(user_id, name, emoji=None, mode="both"):
    if mode not in ("both", "each", "either"):
        mode = "both"
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO custom_exercises (user_id, name, emoji, mode) VALUES (?, ?, ?, ?)",
            (user_id, name, emoji or None, mode),
        )
        return cursor.lastrowid


def get_custom_exercises(user_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM custom_exercises WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def delete_custom_exercise(user_id, exercise_id):
    with get_db() as conn:
        conn.execute("DELETE FROM custom_exercises WHERE user_id = ? AND id = ?", (user_id, exercise_id))


def create_progress_photo(user_id, date, angle, filename):
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO progress_photos (user_id, date, angle, filename) VALUES (?, ?, ?, ?)",
            (user_id, date, angle, filename),
        )
        return cursor.lastrowid


def get_progress_photos(user_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM progress_photos WHERE user_id = ? ORDER BY date DESC, angle ASC", (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_progress_photo(photo_id):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM progress_photos WHERE id = ?", (photo_id,)).fetchone()
    return dict(row) if row else None


def delete_progress_photo(user_id, photo_id):
    with get_db() as conn:
        conn.execute("DELETE FROM progress_photos WHERE user_id = ? AND id = ?", (user_id, photo_id))
