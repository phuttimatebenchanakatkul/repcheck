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

import datetime
import json
import os
import re
import secrets
import sqlite3
import time
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


def _add_column_if_missing(conn, table, column, definition):
    """Add a column older databases don't have yet, tolerating another
    process adding it at the same moment.

    The obvious probe-then-ALTER -- read PRAGMA table_info, ALTER if absent
    -- is check-then-act, and gunicorn boots several workers that each run
    init_db() on import. On the first boot after a new column is introduced,
    two workers can both see it missing; the loser raises "duplicate column
    name", and a worker that cannot import the app cannot boot, so the whole
    deploy fails and rolls back. Not hypothetical: that is exactly what
    users.deleted_at did to the v0.4.0.0 deploy.

    Returns True only for the caller that actually added the column, so a
    one-time backfill attached to a migration still runs exactly once.
    """
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column in columns:
        return False
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    except sqlite3.OperationalError as exc:
        # Another worker won the race. The column exists either way, which
        # is all this function promises -- but it was not us that added it,
        # so the caller's backfill belongs to that other worker.
        if "duplicate column name" not in str(exc).lower():
            raise
        return False
    return True


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
        # Account deletion is a 30-day grace period, not an instant wipe:
        # deleted_at stamps when the user asked, and purge_deleted_accounts()
        # below does the irreversible part once the window has passed. NULL
        # means "not scheduled" -- every account that predates this column.
        # Probe-then-ALTER for existing DBs, same reasoning as friend_code.
        _add_column_if_missing(conn, "users", "deleted_at", "TEXT")
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
        _add_column_if_missing(conn, "users", "friend_code", "TEXT")
        # Unconditional and idempotent (IF NOT EXISTS), so it is still
        # created even when another worker added the column itself.
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
        # The backfill hangs off the return value, not off a second probe:
        # only the worker that actually added the column runs it, so it
        # happens exactly once.
        if _add_column_if_missing(
            conn, "users", "onboarding_completed", "INTEGER NOT NULL DEFAULT 0"
        ):
            conn.execute("UPDATE users SET onboarding_completed = 1")
        # VESTIGIAL: rate_limited originally exempted pre-existing accounts
        # from the AI usage limits, but enforcement now applies to every
        # account and ignores this column entirely (see app.py's
        # _limited_user). The migration is kept only so fresh installs get
        # the same schema as databases it already ran against.
        _add_column_if_missing(conn, "users", "rate_limited", "INTEGER NOT NULL DEFAULT 1")
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
        # barcode: links a custom food to a scanned product barcode, so a
        # future scan of that same code (see get_custom_food_by_barcode in
        # app.py's /api/scan-barcode and /api/lookup-barcode) resolves
        # straight to this user's own saved nutrition instead of failing
        # again. NULL for custom foods created without ever going through
        # the barcode-not-found flow. serving_label/serving_grams describe
        # what the entered calories/protein/fat/carbs are FOR (e.g. "1 bar"
        # = 45g) -- previously implicitly "100g", now explicit and
        # user-defined. Probe-then-ALTER, same reasoning as friend_code.
        _add_column_if_missing(conn, "custom_foods", "barcode", "TEXT")
        _add_column_if_missing(
            conn, "custom_foods", "serving_label", "TEXT NOT NULL DEFAULT '1 serving'"
        )
        _add_column_if_missing(
            conn, "custom_foods", "serving_grams", "REAL NOT NULL DEFAULT 100"
        )
        # One barcode maps to at most one custom food per user (SQLite
        # allows multiple NULLs through a UNIQUE index, so foods without a
        # barcode never collide with each other or with this constraint).
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_foods_user_barcode
            ON custom_foods (user_id, barcode) WHERE barcode IS NOT NULL
        """)
        # Additional named serving sizes beyond a custom food's base
        # serving_label/serving_grams above (e.g. base "1 bar" = 45g, plus
        # "1 box" = 270g) -- a separate table rather than a JSON column so
        # each option stays a plain, queryable row, matching the rest of
        # this file's style. Deleted alongside their parent food in
        # delete_custom_food(); never queried on their own.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS custom_food_servings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                custom_food_id INTEGER NOT NULL REFERENCES custom_foods(id),
                label TEXT NOT NULL,
                grams REAL NOT NULL
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
        _add_column_if_missing(conn, "custom_exercises", "emoji", "TEXT")
        _add_column_if_missing(
            conn, "custom_exercises", "mode", "TEXT NOT NULL DEFAULT 'both'"
        )
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
        _add_column_if_missing(conn, "analyze_results", "video_filename", "TEXT")

        # One-time handoff tokens for signing in inside the iOS shell.
        #
        # Google refuses OAuth in an embedded webview, so the native app runs
        # the flow in SFSafariViewController instead. That browser has its own
        # cookie jar, so the session it establishes is useless to the app's
        # webview -- the user comes back "signed in" to a browser they can no
        # longer see. The callback therefore mints a row here and hands the
        # token to the app over a custom URL scheme; the webview redeems it
        # for a session of its own. See auth.py's google_callback and
        # native_complete.
        #
        # Rows are single-use and short-lived, and that is load-bearing rather
        # than tidiness: a custom URL scheme is not exclusive on iOS, so
        # another app that registers repcheck:// could receive the token. It
        # is only useful for the seconds between the browser closing and the
        # webview redeeming it, and only once.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS native_auth_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                next_url TEXT,
                created_at INTEGER NOT NULL
            )
        """)
        # Safety: the two halves of App Store Guideline 1.2 that a display
        # name on a public leaderboard requires. name_filter.py is the third
        # (filtering objectionable names at the point they are set).
        #
        # A block is one-directional as stored -- who blocked whom -- but read
        # in BOTH directions (see hidden_user_ids), so neither account appears
        # on the other's leaderboards. Storing it one way keeps "unblock" the
        # blocker's decision alone.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS blocked_users (
                user_id INTEGER NOT NULL REFERENCES users(id),
                blocked_id INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, blocked_id)
            )
        """)
        # Reports are kept after the reported account is gone would be a lie:
        # _purge_user_rows removes both sides, because the only thing a report
        # names is an account. handled_at is set from the admin view.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS content_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reporter_id INTEGER NOT NULL REFERENCES users(id),
                reported_id INTEGER NOT NULL REFERENCES users(id),
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                handled_at TEXT
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_content_reports_open ON content_reports(handled_at, created_at)"
        )


def _row_to_dict(row):
    return dict(row) if row else None


# How long a native sign-in handoff token stays valid. The app redeems it
# immediately -- this only has to cover the browser closing and one redirect,
# so it is deliberately far shorter than any session.
NATIVE_AUTH_TOKEN_TTL_SECONDS = 120


def create_native_auth_token(user_id, next_url=None):
    """Mint a single-use token the iOS shell can trade for a real session.

    Returns the token string. Expired rows are cleared out on the way past so
    the table cannot grow without bound; there is no other reaper.
    """
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with get_db() as conn:
        conn.execute(
            "DELETE FROM native_auth_tokens WHERE created_at < ?",
            (now - NATIVE_AUTH_TOKEN_TTL_SECONDS,),
        )
        conn.execute(
            "INSERT INTO native_auth_tokens (token, user_id, next_url, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, next_url, now),
        )
    return token


def consume_native_auth_token(token):
    """Redeem a handoff token exactly once.

    Returns {"user_id": ..., "next_url": ...} or None. The DELETE is the
    check: whoever gets rowcount 1 owns the token, so two requests racing the
    same token cannot both be let in. An expired row deletes without being
    honoured, which keeps expiry and consumption in one atomic step instead of
    a read-then-delete that could be raced between the two.
    """
    if not token:
        return None
    cutoff = int(time.time()) - NATIVE_AUTH_TOKEN_TTL_SECONDS
    with get_db() as conn:
        row = conn.execute(
            "SELECT user_id, next_url, created_at FROM native_auth_tokens WHERE token = ?",
            (token,),
        ).fetchone()
        deleted = conn.execute(
            "DELETE FROM native_auth_tokens WHERE token = ?", (token,)
        ).rowcount
    if not row or deleted != 1 or row["created_at"] < cutoff:
        return None
    return {"user_id": row["user_id"], "next_url": row["next_url"]}


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
    # Workout chat history is now date-keyed (one thread per calendar day,
    # kept permanently so past days stay readable) rather than a single
    # rolling array that self-cleared at midnight -- a plain overwrite
    # could now silently wipe WEEKS of chat history from a stale device,
    # not just today's few messages, so it needs the same merge protection
    # as the workout log it's attached to.
    "repcheck_workout_chat_v1",
    # The streak's activity log (date -> [action names], see
    # static/streak.js): for a daily challenge, weekly check-in or coach
    # chat it is the only record the day was ever used, so an overwrite
    # from a device with a stale copy would delete an earned streak.
    "repcheck_activity_log_v1",
}
MERGE_LOG_KEYS = LOG_MERGE_ARRAY_KEYS | LOG_MERGE_DATE_KEYED_KEYS

# Per-analysis AI chat threads. Unlike every other synced key these have no
# fixed name -- there is one per analyze_results row
# (repcheck_analyze_chat_v1_<id>, see static/analyze_chat_widget.js) -- so
# the family is matched by pattern instead of allowlisted individually. The
# trailing id is restricted to digits, with no leading zero (matching how
# SQLite's AUTOINCREMENT ids are actually written), so "007" and "7" can't
# become two different stored rows for what a client would treat as the
# same analyze_results id -- prune_analyze_results() below only ever
# targets the canonical (no-leading-zero) form, so a non-canonical
# duplicate would live forever, immune to pruning.
ANALYZE_CHAT_KEY_RE = re.compile(r"^repcheck_analyze_chat_v1_(0|[1-9]\d*)$")


def is_analyze_chat_key(key):
    return bool(ANALYZE_CHAT_KEY_RE.match(key or ""))


def analyze_chat_key_result_id(key):
    """The analyze_results id encoded in a repcheck_analyze_chat_v1_<id> key,
    or None if `key` isn't one (see is_analyze_chat_key). Used to verify the
    row actually exists -- and is this user's own -- before accepting a
    write, so the key family can't outgrow analyze_results (which is
    already bounded per user by prune_analyze_results) and so a stale or
    replayed write can't resurrect a chat thread whose analysis was already
    pruned."""
    match = ANALYZE_CHAT_KEY_RE.match(key or "")
    return int(match.group(1)) if match else None


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


def _merge_chat_thread(incoming, existing):
    """Union a stored analyze-chat thread ({"createdAtMs", "history": [...]})
    with what's already saved. The widget only ever APPENDS to history (see
    analyze_chat_widget.js: history.push for each user turn and each reply),
    so "the longer transcript wins" is a complete merge rule -- and it's what
    stops a device holding an older copy of the thread (a tab left open on
    the same analysis, a phone that missed a push) from overwriting turns the
    server already has. Mirrors account_sync.js's mergeChatThread."""
    if not isinstance(existing, dict):
        return incoming
    if not isinstance(incoming, dict):
        return existing
    inc_history = incoming.get("history")
    exi_history = existing.get("history")
    inc_history = inc_history if isinstance(inc_history, list) else []
    exi_history = exi_history if isinstance(exi_history, list) else []
    longer, longer_history = (
        (incoming, inc_history) if len(inc_history) >= len(exi_history) else (existing, exi_history)
    )
    merged = dict(longer)
    merged["history"] = longer_history
    # createdAtMs identifies the ANALYSIS (it's the row's created_at), not
    # the write, so the two sides should already agree -- keep the earliest
    # if they somehow don't, since the 24h prompting lock and the client's
    # retention sweep are both anchored to it.
    stamps = [
        v for v in (incoming.get("createdAtMs"), existing.get("createdAtMs"))
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    ]
    if stamps:
        merged["createdAtMs"] = min(stamps)
    return merged


def set_user_data(user_id, key, value):
    """Sets a synced key's value. For MERGE_LOG_KEYS (and analyze-chat
    threads), merges with whatever is already stored instead of overwriting
    it outright -- see those constants' comments above for why.

    BEGIN IMMEDIATE for the merge branch, same reasoning as
    set_workout_log_day()'s: this key's dedicated authoritative endpoint
    (e.g. POST /api/workout/log-day) and this generic merge route can both
    be triggered by the same client action (static/account_sync.js's
    wrapped localStorage.setItem fires this route synchronously on every
    write, in parallel with the dedicated endpoint's own debounced call),
    so their SELECTs can race the same way two calls to
    set_workout_log_day() could. This doesn't fully close the gap -- a
    sufficiently STALE merge push (delivered well after the authoritative
    write already committed, not just concurrently with it) can still
    reintroduce a deleted entry, since a union merge has no way to
    represent "this was intentionally removed" -- but it does close the
    same-instant race, which is the more common case in practice."""
    with get_db() as conn:
        if key in MERGE_LOG_KEYS or is_analyze_chat_key(key):
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT value FROM user_data WHERE user_id = ? AND key = ?", (user_id, key)
            ).fetchone()
            existing = json.loads(row["value"]) if row else None
            if is_analyze_chat_key(key):
                value = _merge_chat_thread(value, existing)
            elif key in LOG_MERGE_ARRAY_KEYS:
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
    without a second round trip.

    BEGIN IMMEDIATE, not the connection's default deferred transaction:
    this function is a read-modify-write against the user's WHOLE log
    blob (every date lives in one row), and unlike the other log-entry
    writers in this file, it's called on a 400ms debounce from every
    single keystroke while editing a set's reps/weight -- so two
    concurrent calls for two DIFFERENT dates (e.g. one tab actively
    editing today while another backfills yesterday) are a realistic,
    not just theoretical, scenario. Python's sqlite3 only auto-begins a
    transaction before a DML statement, not before SELECT, so without an
    explicit BEGIN IMMEDIATE here, two overlapping calls could each SELECT
    the same pre-write blob before either commits, and the second commit
    would silently discard whatever date the first one had just written --
    the exact resurrection/lost-update bug class this function exists to
    prevent, just moved from client-side merge to server-side race.
    BEGIN IMMEDIATE acquires SQLite's write lock up front, so the second
    call blocks until the first's SELECT+INSERT+COMMIT is fully done and
    then reads the up-to-date blob."""
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
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


# Server-recorded uses of the app, for the streak's back-fill (see
# get_activity_dates below and static/streak.js). Action id -> the table
# holding one row per use, and the column naming the day it happened.
#
# challenge_submissions is the important one: a daily challenge attempt
# lives ONLY here, so without this the streak simply couldn't see it.
# The rest already have a local mirror, but that mirror is capped to the
# most recent N entries and only exists on the device that created it,
# so reading the server's copy recovers days the client has forgotten.
#
# Table names are interpolated into SQL below, so this dict is the trust
# boundary -- it is fixed, in-source, and must never take user input.
ACTIVITY_DATE_SOURCES = {
    "challenge": ("challenge_submissions", "created_at"),
    "analysis": ("analyze_results", "created_at"),
    "hyrox": ("hyrox_results", "created_at"),
    # progress_photos.date is the check-in's own date, already recorded in
    # the user's local calendar, so it needs no timezone shift.
    "checkin_photo": ("progress_photos", "date"),
}


def get_activity_dates(user_id, tz_offset_minutes=0):
    """Every local calendar day this user did something server-recorded,
    as {"YYYY-MM-DD": ["challenge", ...]}.

    created_at columns are UTC (datetime('now')), while a streak is counted
    in the user's own days -- so the caller passes its UTC offset in minutes
    (the conventional sign: UTC+7 is +420) and the timestamps are shifted
    into local time before being reduced to a date. A bad or missing offset
    degrades to UTC rather than failing the request; the range clamp keeps
    the value inside real-world timezones."""
    try:
        offset = int(tz_offset_minutes)
    except (TypeError, ValueError):
        offset = 0
    offset = max(-14 * 60, min(14 * 60, offset))
    modifier = f"{offset:+d} minutes"

    dates = {}
    with get_db() as conn:
        for action, (table, column) in ACTIVITY_DATE_SOURCES.items():
            if column == "date":
                sql = f"SELECT DISTINCT date({column}) AS day FROM {table} WHERE user_id = ?"
                params = (user_id,)
            else:
                sql = f"SELECT DISTINCT date({column}, ?) AS day FROM {table} WHERE user_id = ?"
                params = (modifier, user_id)
            for row in conn.execute(sql, params).fetchall():
                if row["day"]:
                    dates.setdefault(row["day"], []).append(action)
    return {day: sorted(actions) for day, actions in sorted(dates.items())}


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
    """This user's friends, with blocked accounts left out in both
    directions -- a block has to hold everywhere the other account's name
    would otherwise appear, not only on the leaderboard."""
    hidden = hidden_user_ids(user_id)
    with get_db() as conn:
        rows = conn.execute(
            """SELECT u.id, u.name, u.email FROM friends f
               JOIN users u ON u.id = f.friend_id
               WHERE f.user_id = ? ORDER BY u.name""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows if r["id"] not in hidden]


# ---------- Blocking and reporting (App Store Guideline 1.2) ----------
#
# Display names are user-generated content: every account sees every other
# account's chosen name on the global leaderboards. Guideline 1.2 wants three
# things for that -- filtering (name_filter.py, applied when a name is set), a
# way to REPORT a name, and a way to BLOCK an account. These are the last two.


def hidden_user_ids(user_id):
    """Every account `user_id` must not see, and that must not see them.

    Read in both directions on purpose. A one-way read would let the account
    someone blocked go on watching them climb the leaderboard, which is the
    behaviour blocking exists to stop. The row itself stays one-way so that
    unblocking is the blocker's decision alone.
    """
    if not user_id:
        return set()
    with get_db() as conn:
        rows = conn.execute(
            """SELECT blocked_id AS other FROM blocked_users WHERE user_id = ?
               UNION
               SELECT user_id AS other FROM blocked_users WHERE blocked_id = ?""",
            (user_id, user_id),
        ).fetchall()
    return {r["other"] for r in rows}


def block_user(user_id, blocked_id):
    """Idempotent. Blocking yourself is a no-op rather than an error -- the UI
    never offers it, and a client that asks anyway should not get a 500."""
    if not user_id or not blocked_id or user_id == blocked_id:
        return False
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO blocked_users (user_id, blocked_id) VALUES (?, ?)",
            (user_id, blocked_id),
        )
    return True


def unblock_user(user_id, blocked_id):
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM blocked_users WHERE user_id = ? AND blocked_id = ?",
            (user_id, blocked_id),
        )
        return cur.rowcount > 0


def get_blocked_accounts(user_id):
    """The accounts this user blocked, for the Settings list that undoes it.
    Only their own blocks -- being blocked by someone else is not something
    they are shown, let alone something they can undo."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT u.id, u.name, b.created_at FROM blocked_users b
               JOIN users u ON u.id = b.blocked_id
               WHERE b.user_id = ? ORDER BY b.created_at DESC""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


REPORT_REASONS = ("offensive_name", "impersonation", "spam", "other")


def create_content_report(reporter_id, reported_id, reason):
    """Record a report for review. Returns the row id, or None for a report
    that names nobody or names the reporter."""
    if not reporter_id or not reported_id or reporter_id == reported_id:
        return None
    if reason not in REPORT_REASONS:
        reason = "other"
    with get_db() as conn:
        # One OPEN report per (reporter, subject). Reporting the same account
        # twice before anyone has looked at the first is the same complaint,
        # and without this an automated client can flood the review queue
        # against one victim. A new report after the first was handled is a
        # genuinely new complaint and is allowed.
        existing = conn.execute(
            """SELECT id FROM content_reports
               WHERE reporter_id = ? AND reported_id = ? AND handled_at IS NULL""",
            (reporter_id, reported_id),
        ).fetchone()
        if existing:
            return existing["id"]
        cur = conn.execute(
            "INSERT INTO content_reports (reporter_id, reported_id, reason) VALUES (?, ?, ?)",
            (reporter_id, reported_id, reason),
        )
        return cur.lastrowid


def get_open_reports(limit=100):
    """Unhandled reports, oldest first, for the admin review screen. Oldest
    first because the commitment made to users is a response time."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT r.id, r.reason, r.created_at,
                      r.reporter_id, rep.name AS reporter_name,
                      r.reported_id, sub.name AS reported_name
               FROM content_reports r
               JOIN users rep ON rep.id = r.reporter_id
               JOIN users sub ON sub.id = r.reported_id
               WHERE r.handled_at IS NULL
               ORDER BY r.created_at ASC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def mark_report_handled(report_id):
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE content_reports SET handled_at = datetime('now') WHERE id = ? AND handled_at IS NULL",
            (report_id,),
        )
        return cur.rowcount > 0


def create_challenge(creator_id, exercise, duration_seconds=25):
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO challenges (creator_id, exercise, duration_seconds) VALUES (?, ?, ?)",
            (creator_id, exercise, duration_seconds),
        )
        return cur.lastrowid


def get_visible_challenges(user_id):
    """Challenges created by the user or any of their friends, newest first,
    each with its leaderboard (submissions sorted by reps).

    Blocked accounts are excluded from both halves. This query reaches the
    `friends` table directly rather than going through get_friends(), so it
    does not inherit that function's filtering and has to do its own -- and
    the submissions carry `notes`, free text another account wrote, which is
    more exposed than a display name and is not covered by name_filter.py at
    all. A block that holds on the leaderboards but leaks here is not a block.
    """
    hidden = hidden_user_ids(user_id)
    with get_db() as conn:
        challenges = [dict(r) for r in conn.execute(
            """SELECT c.*, u.name AS creator_name FROM challenges c
               JOIN users u ON u.id = c.creator_id
               WHERE c.creator_id = ?
                  OR c.creator_id IN (SELECT friend_id FROM friends WHERE user_id = ?)
               ORDER BY c.created_at DESC""",
            (user_id, user_id),
        ).fetchall()]
        challenges = [c for c in challenges if c["creator_id"] not in hidden]
        for c in challenges:
            c["leaderboard"] = [
                dict(r) for r in conn.execute(
                    """SELECT s.user_id, s.reps, s.notes, s.created_at, u.name
                       FROM challenge_submissions s JOIN users u ON u.id = s.user_id
                       WHERE s.challenge_id = ? ORDER BY s.reps DESC, s.created_at ASC""",
                    (c["id"],),
                ).fetchall()
                if r["user_id"] not in hidden
            ]
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


def get_total_reps_leaderboard(user_ids=None, limit=None, exclude_ids=None):
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
    # Blocked accounts are filtered in SQL, not after the fact, so the ranks
    # the caller computes from this list are the ranks the viewer actually
    # sees -- filtering afterwards would leave gaps at every hidden position.
    if exclude_ids:
        placeholders = ",".join("?" for _ in exclude_ids)
        query += (" AND " if user_ids is not None else " WHERE ") + f"s.user_id NOT IN ({placeholders})"
        params.extend(exclude_ids)
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


def get_hyrox_leaderboard(gender, category, format_, exclude_ids=None):
    """Every user's PB (fastest time) for one exact gender/category/format
    combo, fastest first -- a Pro Singles time isn't comparable to an Open
    Doubles one, so the four combos are always ranked separately, never
    mixed together. Returns the full ranked list (no limit); callers slice
    for display and can find any one user's rank by their position in it.
    """
    query = """SELECT r.user_id, u.name, MIN(r.total_seconds) AS best_seconds
               FROM hyrox_results r
               JOIN users u ON u.id = r.user_id
               WHERE r.gender = ? AND r.category = ? AND r.format = ?"""
    params = [gender, category, format_]
    # Same reason as the reps board: excluded in SQL so the caller's
    # position-in-list rank matches what the viewer is shown.
    if exclude_ids:
        placeholders = ",".join("?" for _ in exclude_ids)
        query += f" AND r.user_id NOT IN ({placeholders})"
        params.extend(exclude_ids)
    query += " GROUP BY r.user_id ORDER BY best_seconds ASC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
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
    the clips from disk too (the DB doesn't own those files).

    Also deletes each pruned row's repcheck_analyze_chat_v1_<id> entry from
    user_data (see is_analyze_chat_key/set_user_data above) in the same
    transaction. Without this, an analysis's chat thread outlives the
    analysis itself -- analyze_results is bounded to `keep` rows per user,
    but the chat-thread family in user_data has no bound of its own, so it
    would grow by one row per analysis ever run, forever, and get returned
    on every account's /api/sync hydration GET regardless of age."""
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
            conn.executemany(
                "DELETE FROM user_data WHERE user_id = ? AND key = ?",
                [(user_id, f"repcheck_analyze_chat_v1_{row['id']}") for row in stale],
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


def create_custom_food(
    user_id, name, emoji, calories, protein, fat, carbs,
    barcode=None, serving_label="1 serving", serving_grams=100, extra_servings=None,
):
    """extra_servings, if given, is a list of {"label": str, "grams": float}
    dicts for additional named serving sizes beyond serving_label/
    serving_grams (see custom_food_servings above)."""
    with get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO custom_foods
               (user_id, name, emoji, calories, protein, fat, carbs, barcode, serving_label, serving_grams)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, name, emoji, calories, protein, fat, carbs, barcode, serving_label, serving_grams),
        )
        food_id = cursor.lastrowid
        for serving in (extra_servings or []):
            conn.execute(
                "INSERT INTO custom_food_servings (custom_food_id, label, grams) VALUES (?, ?, ?)",
                (food_id, serving["label"], serving["grams"]),
            )
        return food_id


def _attach_custom_food_servings(conn, foods):
    """Mutates each food dict in place, adding a "servings" list of this
    food's extra named serving sizes (beyond its own serving_label/
    serving_grams). One query for the whole batch rather than one per food."""
    if not foods:
        return foods
    food_ids = [f["id"] for f in foods]
    placeholders = ",".join("?" * len(food_ids))
    rows = conn.execute(
        f"SELECT * FROM custom_food_servings WHERE custom_food_id IN ({placeholders})",
        food_ids,
    ).fetchall()
    servings_by_food = {}
    for row in rows:
        servings_by_food.setdefault(row["custom_food_id"], []).append(
            {"label": row["label"], "grams": row["grams"]}
        )
    for food in foods:
        food["servings"] = servings_by_food.get(food["id"], [])
    return foods


def get_custom_foods(user_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM custom_foods WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
        foods = [dict(r) for r in rows]
        return _attach_custom_food_servings(conn, foods)


def get_custom_food_by_barcode(user_id, barcode):
    """This user's own saved custom food for a scanned barcode, or None --
    checked by app.py's barcode-lookup routes before ever hitting Open Food
    Facts/FatSecret, so a barcode a user has already created a food for
    always resolves to that saved data instead of an external lookup."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM custom_foods WHERE user_id = ? AND barcode = ?", (user_id, barcode)
        ).fetchone()
        if not row:
            return None
        food = dict(row)
        return _attach_custom_food_servings(conn, [food])[0]


def delete_custom_food(user_id, food_id):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM custom_food_servings WHERE custom_food_id IN "
            "(SELECT id FROM custom_foods WHERE user_id = ? AND id = ?)",
            (user_id, food_id),
        )
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


# ---------- Account deletion (Apple App Store Guideline 5.1.1(v)) ----------
# Deleting an account is a two-step, 30-day process rather than an instant
# wipe: schedule_account_deletion() stamps users.deleted_at, the user can
# still log back in and cancel_account_deletion() the whole time, and
# purge_deleted_accounts() does the irreversible part once the window has
# passed. Apple accepts a grace period as long as it is disclosed, so the
# 30 days is stated in the settings confirm dialog and in /privacy -- if you
# change this constant, change that copy too.
ACCOUNT_DELETION_GRACE_DAYS = 30

# Every table holding rows that belong to a user, as (table, user column).
# Ordered so children go before the rows they point at. Tables that need a
# subquery (custom_food_servings, challenge_submissions on someone else's
# challenge) are handled separately in _purge_user_rows below.
_USER_OWNED_TABLES = (
    ("user_data", "user_id"),
    ("rate_limits", "user_id"),
    ("usage_events", "user_id"),
    ("challenge_submissions", "user_id"),
    ("custom_exercises", "user_id"),
    ("progress_photos", "user_id"),
    ("hyrox_results", "user_id"),
    ("analyze_results", "user_id"),
)


def schedule_account_deletion(user_id):
    """Start the grace period. Idempotent -- asking twice does not push the
    purge date back, so a user cannot keep an account alive by re-clicking."""
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
            (user_id,),
        )
        row = conn.execute("SELECT deleted_at FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["deleted_at"] if row else None


def cancel_account_deletion(user_id):
    """Undo a scheduled deletion. No-op if the account was never scheduled;
    impossible once purge_deleted_accounts() has run, because by then the
    user row is gone."""
    with get_db() as conn:
        conn.execute("UPDATE users SET deleted_at = NULL WHERE id = ?", (user_id,))


def account_deletion_due_at(deleted_at):
    """The ISO date a given deleted_at stamp becomes an actual purge, for
    showing the user when their data goes. None if not scheduled."""
    if not deleted_at:
        return None
    # deleted_at is a UTC stamp (SQLite datetime('now')), so the date this
    # produces is a UTC date. Close enough for "your data goes on the 24th".
    stamp = datetime.datetime.fromisoformat(deleted_at)
    return (stamp + datetime.timedelta(days=ACCOUNT_DELETION_GRACE_DAYS)).date().isoformat()


def _purge_user_rows(conn, user_id):
    """Irreversibly remove one user and everything of theirs. Returns the
    on-disk filenames the caller still has to unlink -- this module owns the
    database, app.py owns PROGRESS_PHOTOS_DIR and ANALYZE_VIDEOS_DIR, so the
    two halves of "delete their photos" are split along that line."""
    photos = [
        row["filename"]
        for row in conn.execute("SELECT filename FROM progress_photos WHERE user_id = ?", (user_id,))
    ]
    videos = [
        row["video_filename"]
        for row in conn.execute(
            "SELECT video_filename FROM analyze_results WHERE user_id = ? AND video_filename IS NOT NULL",
            (user_id,),
        )
    ]

    # Servings hang off custom_foods, which hangs off the user.
    conn.execute(
        """DELETE FROM custom_food_servings
           WHERE custom_food_id IN (SELECT id FROM custom_foods WHERE user_id = ?)""",
        (user_id,),
    )
    conn.execute("DELETE FROM custom_foods WHERE user_id = ?", (user_id,))

    # Challenges this user created are removed along with everyone else's
    # submissions to them -- otherwise those rows would point at a
    # challenges row that no longer exists.
    conn.execute(
        """DELETE FROM challenge_submissions
           WHERE challenge_id IN (SELECT id FROM challenges WHERE creator_id = ?)""",
        (user_id,),
    )
    conn.execute("DELETE FROM challenges WHERE creator_id = ?", (user_id,))

    # Friendship is stored as one row per direction, so this user appears as
    # both user_id and friend_id and both sides have to go.
    conn.execute("DELETE FROM friends WHERE user_id = ? OR friend_id = ?", (user_id, user_id))

    # Blocks and reports name an account on each side, so a purge has to take
    # the rows where this user is the subject as well as the ones where they
    # are the actor. A report whose reported account no longer exists has
    # nothing left to moderate.
    conn.execute("DELETE FROM blocked_users WHERE user_id = ? OR blocked_id = ?", (user_id, user_id))
    conn.execute(
        "DELETE FROM content_reports WHERE reporter_id = ? OR reported_id = ?", (user_id, user_id)
    )

    for table, column in _USER_OWNED_TABLES:
        conn.execute(f"DELETE FROM {table} WHERE {column} = ?", (user_id,))

    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"photos": photos, "videos": videos}


def purge_deleted_accounts(grace_days=ACCOUNT_DELETION_GRACE_DAYS):
    """Purge every account whose grace period has run out. Returns the
    filenames the caller must unlink, pooled across all purged users.

    There is no scheduler in this project (Render web service, no cron), so
    app.py calls this on startup and again on login -- a lazy sweep. That
    means a purge can land late if nobody visits the app for a while, which
    is fine: the guarantee to the user is "not before day 30", and the
    settings copy says "after 30 days" rather than naming an exact moment."""
    # The cutoff is computed by SQLite, not Python, because deleted_at was
    # written by SQLite's datetime('now') -- which is UTC. Building the
    # cutoff from datetime.now() instead would compare a local-time bound
    # against UTC stamps and purge early by the machine's UTC offset (seven
    # hours, on the timezone this app is mostly used in). Same clock in,
    # same clock out.
    files = {"photos": [], "videos": []}
    with get_db() as conn:
        due = [
            row["id"]
            for row in conn.execute(
                """SELECT id FROM users
                   WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', ?)""",
                ("-" + str(int(grace_days)) + " days",),
            )
        ]
        for user_id in due:
            purged = _purge_user_rows(conn, user_id)
            files["photos"].extend(purged["photos"])
            files["videos"].extend(purged["videos"])
    return files
