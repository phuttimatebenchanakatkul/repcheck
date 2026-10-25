"""Profiles and the life of an account: create, rename, schedule deletion, restore, purge.

A profile row is created ONLY here (the app has no INSERT right on `profiles`), and every table a user owns points
at it, so a person who signs up straight against Supabase Auth, skipping this API, has an account with nowhere to put
data. That is what keeps the display-name filter (App Review 1.2) unbypassable without routing sign-up through Flask.

Deleting an account (App Review 5.1.1(v)): scheduled now, purged after GRACE_DAYS. The purge removes the person's
stored files through the Storage API FIRST and only then deletes the Auth user, which cascades through every table.
Neither Auth deletion nor SQL removes Storage objects, so that order is the whole guarantee; if a file will not go,
the user is left in place and the next sweep tries again.
"""

import datetime as dt
import logging
import secrets

from psycopg.errors import UniqueViolation

from name_filter import validate_display_name

from .supabase_admin import SupabaseError

log = logging.getLogger(__name__)

GRACE_DAYS = 30                              # must equal database.ACCOUNT_DELETION_GRACE_DAYS (a test pins it)
BUCKETS = ("progress-photos", "analyze-videos")
MAX_NAME_LENGTH = 60                         # the website had no limit; a name is shown to every other user
FRIEND_CODE_ATTEMPTS = 8
BIDI_CONTROLS = frozenset(chr(c) for c in (0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069))
PROFILE_COLUMNS = "id, name, friend_code, onboarding_completed, ai_consent_at, deleted_at, created_at"


class NameRejected(ValueError):
    """The message is safe to show the user."""


class PurgeIncomplete(RuntimeError):
    pass


def clean_name(raw):
    """A display name fit to store and show to everyone, or NameRejected."""
    name = raw.strip() if isinstance(raw, str) else ""
    error = validate_display_name(name)
    if error:
        raise NameRejected(error)
    if len(name) > MAX_NAME_LENGTH:
        raise NameRejected(f"Please keep your name to {MAX_NAME_LENGTH} characters or fewer.")
    # Control characters break rows and lists (and Postgres cannot store NUL at all); the bidi overrides let a
    # name pose as a different one. Emoji joiners and ordinary punctuation are fine.
    if any(ord(c) < 32 or ord(c) == 127 or c in BIDI_CONTROLS for c in name):
        raise NameRejected("That name contains characters that aren't allowed.")
    return name


def provider_name(claims):
    """The name an OAuth provider sent, or a neutral fallback if it is missing or not allowed. Lenient on purpose: a
    Google account with a blocked word in its name still gets in, as 'Google User', where a typed name is refused."""
    app_meta = claims.get("app_metadata") or {}
    meta = claims.get("user_metadata") or {}
    provider = app_meta.get("provider") if isinstance(app_meta.get("provider"), str) else None
    candidate = meta.get("full_name") or meta.get("name")
    fallback = f"{(provider or 'App').capitalize()} User"
    try:
        return clean_name(candidate) if isinstance(candidate, str) else fallback
    except NameRejected:
        return fallback


def get_profile(conn, uid):
    return conn.execute(f"select {PROFILE_COLUMNS} from public.profiles where id = %s", (uid,)).fetchone()


def ensure_profile(conn, identity, requested_name=None):
    """The caller's profile, created on first use. Returns (profile, created). A typed name is held to the filter and
    refused if it fails; with none, an OAuth provider's name is used, and an email account must supply one.
    An existing profile is returned untouched (a second call can never rename or reset anyone)."""
    existing = get_profile(conn, identity.id)
    if existing:
        return existing, False
    if requested_name is not None:
        name = clean_name(requested_name)
    else:
        provider = ((identity.claims.get("app_metadata") or {}).get("provider"))
        if provider in (None, "email", "phone"):
            raise NameRejected("Please enter your name.")
        name = provider_name(identity.claims)
    for _ in range(FRIEND_CODE_ATTEMPTS):
        code = "RC-" + secrets.token_hex(3).upper()
        try:
            with conn.transaction():
                row = conn.execute(
                    f"insert into public.profiles (id, name, friend_code) values (%s, %s, %s) "
                    f"on conflict (id) do nothing returning {PROFILE_COLUMNS}", (identity.id, name, code)).fetchone()
        except UniqueViolation:            # the friend code collided (one in 16 million): draw another
            continue
        if row:
            return row, True
        return get_profile(conn, identity.id), False        # a concurrent call created it first
    raise RuntimeError("could not allocate a friend code")


def rename(conn, uid, raw_name):
    name = clean_name(raw_name)
    updated = conn.execute("update public.profiles set name = %s where id = %s returning id", (name, uid)).fetchone()
    return bool(updated)


def due_at(deleted_at):
    """The UTC calendar day a deletion scheduled at `deleted_at` becomes a purge; None if not scheduled."""
    if not deleted_at:
        return None
    return (deleted_at.astimezone(dt.timezone.utc) + dt.timedelta(days=GRACE_DAYS)).date().isoformat()


def schedule_deletion(conn, uid):
    """Start the grace period and return when it started. Idempotent: asking again does not push the purge back, so
    nobody keeps an account alive by re-clicking."""
    conn.execute("update public.profiles set deleted_at = now() where id = %s and deleted_at is null", (uid,))
    row = conn.execute("select deleted_at from public.profiles where id = %s", (uid,)).fetchone()
    return row["deleted_at"] if row else None


def cancel_deletion(conn, uid):
    """Undo a scheduled deletion (no-op if none was). Impossible once the purge has run: the profile is gone."""
    conn.execute("update public.profiles set deleted_at = null where id = %s", (uid,))


def stored_objects(conn, uid):
    """[(bucket, key)] for every object under this user's folder in either bucket (the database's own list, so a
    file no row points at is found too)."""
    rows = conn.execute(
        "select bucket_id, name from storage.objects where bucket_id = any(%s) and split_part(name, '/', 1) = %s",
        (list(BUCKETS), uid)).fetchall()
    return [(r["bucket_id"], r["name"]) for r in rows]


def delete_stored_files(db, store, uid):
    """Remove every stored file of `uid` through the Storage API and prove none is left. Raises PurgeIncomplete."""
    with db.connection() as conn:
        objects = stored_objects(conn, uid)
    failed = []
    for bucket in BUCKETS:
        failed += store.remove(bucket, [k for b, k in objects if b == bucket])
    with db.connection() as conn:
        left = stored_objects(conn, uid)
    if failed or left:
        raise PurgeIncomplete(f"{len(left)} stored files remain")
    return len(objects)


def purge_user(db, store, auth_admin, uid):
    """Irreversibly remove one person: their files first, then the Auth user (which cascades through every table)."""
    delete_stored_files(db, store, uid)
    auth_admin.delete_user(uid)


def purge_due(db, store, auth_admin, grace_days=GRACE_DAYS, only=None):
    """Purge every account whose grace period has run out. Returns (purged, failed) as lists of ids. There is no
    scheduler (Render web service, no cron), so the app calls this at startup and again at most hourly on a request:
    the guarantee to the user is 'not before day 30', and a late purge is fine. Idempotent, so two workers sweeping
    at once only repeat each other. One person's failure never stops the rest. `only` restricts the sweep to those
    ids (tests use it so they can never touch a real account that happens to be due)."""
    with db.connection() as conn:
        due = [r["id"] for r in conn.execute(
            "select id from public.profiles where deleted_at is not null "
            "and deleted_at <= now() - make_interval(days => %s) and (%s::uuid[] is null or id = any(%s::uuid[]))",
            (int(grace_days), None if only is None else list(only), None if only is None else list(only))).fetchall()]
    purged, failed = [], []
    for uid in due:
        uid = str(uid)
        try:
            purge_user(db, store, auth_admin, uid)
            purged.append(uid)
        except (PurgeIncomplete, SupabaseError):
            log.exception("could not purge account %s; it will be retried", uid)
            failed.append(uid)
    return purged, failed
