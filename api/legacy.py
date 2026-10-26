"""Moving an imported account's password across, at its first sign-in on the new system (MOBILE_APP_PLAN.md, "Passwords").

Supabase Auth cannot import the website's scrypt hashes, so an imported account has a random password nobody knows and its
real hash waits in `legacy_password_hashes`. The app tries Supabase first; when that says the credentials are wrong it asks
THIS, once. If the password matches the old hash, Supabase's password is set to it (the database trigger then drops the old
hash, so a leaked old password can never be put back) and the app signs in normally.

This is an unauthenticated door onto a password check, so:
  * every answer that is not a success is the SAME 401, whether the address is unknown, has no old hash, or the password is
    wrong, and a hash is computed in all three cases so the time does not say which;
  * tries are counted per address and per caller BEFORE any hashing (scrypt is deliberately expensive), atomically, and a
    success gives the address's tries back;
  * the email is NOT confirmed here. The importer created these accounts unconfirmed because the old site never verified an
    address; the app asks for a confirmation email at the next step.
"""

from werkzeug.security import check_password_hash, generate_password_hash

from . import admin, throttle
from .supabase_admin import WeakPassword

MAX_PASSWORD_CHARS = 1000
EMAIL_ATTEMPTS = 10                 # the website's LOGIN_ATTEMPT_LIMIT / WINDOW, per address ...
EMAIL_WINDOW = 15 * 60
CALLER_ATTEMPTS = 30                # ... and per calling address, so one machine cannot walk many accounts
CALLER_WINDOW = 15 * 60

_dummy = None


def _dummy_hash():
    """A real scrypt hash to check against when there is nothing to check, so a miss costs what a hit does."""
    global _dummy
    if _dummy is None:
        _dummy = generate_password_hash("a password nobody has")
    return _dummy


def email_key(email):
    return f"legacy:{email}"


def caller_key(address):
    return "legacyip:" + (address or "unknown")[:64]


def old_hash(conn, email):
    """(user id, scrypt hash) of an imported account that still has one, or None."""
    row = conn.execute(
        "select u.id, h.password_hash from auth.users u join public.legacy_password_hashes h on h.user_id = u.id "
        "where lower(u.email) = %s", (email,)).fetchone()
    return (str(row["id"]), row["password_hash"]) if row else None


class Outcome:
    MIGRATED = "migrated"
    MISMATCH = "mismatch"
    LIMITED = "limited"
    RESET_REQUIRED = "reset-required"


def migrate(conn, auth_admin, raw_email, raw_password, caller, now):
    """Returns (outcome, retry_after_seconds)."""
    # The caller's budget is spent first and by EVERY try, malformed ones included: a malformed try still costs a hash below.
    allowed, wait = throttle.take(conn, caller_key(caller), CALLER_ATTEMPTS, CALLER_WINDOW, now)
    if not allowed:
        return Outcome.LIMITED, wait
    email = admin.clean_email(raw_email)
    password = raw_password if isinstance(raw_password, str) and 0 < len(raw_password) <= MAX_PASSWORD_CHARS else None
    if email is None or password is None:
        conn.commit()
        check_password_hash(_dummy_hash(), "x")                  # a malformed try costs the same as a real one
        return Outcome.MISMATCH, 0

    allowed, wait = throttle.take(conn, email_key(email), EMAIL_ATTEMPTS, EMAIL_WINDOW, now)
    if not allowed:
        return Outcome.LIMITED, wait
    conn.commit()                                   # the tries stay counted whatever happens next

    found = old_hash(conn, email)
    matched = check_password_hash(found[1] if found else _dummy_hash(), password)
    if not found or not matched:
        return Outcome.MISMATCH, 0

    try:
        auth_admin.set_password(found[0], password)
    except WeakPassword:
        return Outcome.RESET_REQUIRED, 0
    conn.execute("delete from public.legacy_password_hashes where user_id = %s", (found[0],))   # the trigger does this too
    throttle.clear(conn, email_key(email))
    return Outcome.MIGRATED, 0
