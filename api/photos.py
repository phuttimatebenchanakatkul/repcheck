"""Weekly check-in progress photos: validate, store in the private `progress-photos` bucket, record in `progress_photos`.

The rules are the website's (app.py, api_checkin_photo_upload), with three deliberate differences:
  * the stored type and extension come from what the bytes VERIFY as, not from the filename the caller chose;
  * the 500-photo ceiling is enforced under a per-user lock, so two uploads racing at 499 cannot both land;
  * deleting removes the file BEFORE the row, so a removal that fails leaves the photo visible and retryable instead of
    an invisible file nobody can delete.

Object key: '<user id>/<32 hex>.<jpg|png|webp>'. The database row is the only index of it; the app reads its own rows
and files directly (row-level security) and uses Flask only to write.
"""

import datetime as dt
import io
import re
import uuid

PHOTO_LIMIT = 500                     # database.py PER_USER_LIMITS["progress_photos"]
MAX_PHOTO_BYTES = 12 * 1024 * 1024    # app.py MAX_PHOTO_BYTES; also the bucket's own limit
BUCKET = "progress-photos"
ANGLES = ("front", "back")
FORMATS = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"), "WEBP": (".webp", "image/webp")}
_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class PhotoRejected(ValueError):
    """The message is safe to show the user; `status` is the HTTP status to answer with."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def utc_today():
    return dt.datetime.now(dt.timezone.utc).date()


def account_day(profile):
    """The UTC calendar day the account was created."""
    return profile["created_at"].astimezone(dt.timezone.utc).date()


def check_date(raw, account_created):
    """The check-in day, or PhotoRejected. This field feeds the streak (every distinct photo date is an active day), so
    an unbounded value would let a user invent streak history: no later than tomorrow (the client's local day can run
    a day ahead of the server's), no earlier than the day the account was created."""
    text = str(raw or "").strip()
    if not _DAY.fullmatch(text):
        raise PhotoRejected("Invalid date.")
    try:
        day = dt.date.fromisoformat(text)
    except ValueError:
        raise PhotoRejected("Invalid date.") from None
    if day > utc_today() + dt.timedelta(days=1):
        raise PhotoRejected("Invalid date.")
    if account_created and day < account_created:
        raise PhotoRejected("Invalid date.")
    return day


def inspect_image(data):
    """(extension, content type) of an image this app accepts, from the bytes alone, or PhotoRejected."""
    if not data:
        raise PhotoRejected("No photo uploaded.")
    if len(data) > MAX_PHOTO_BYTES:
        raise PhotoRejected(f"That photo is too large. Please keep it under {MAX_PHOTO_BYTES // (1024 * 1024)} MB.", 413)
    try:
        from PIL import Image
        probe = Image.open(io.BytesIO(data))
        image_format = probe.format
        probe.verify()          # parses structure without decoding the pixels; Pillow's own pixel ceiling guards bombs
    except Exception:           # noqa: BLE001 -- anything unparseable is "not an image"
        raise PhotoRejected("That file isn't a readable image.") from None
    if image_format not in FORMATS:
        raise PhotoRejected("Unsupported image format.")
    return FORMATS[image_format]


def new_name(extension):
    return f"{uuid.uuid4().hex}{extension}"


def object_key(user_id, name):
    return f"{user_id}/{name}"


def count(conn, user_id):
    return conn.execute("select count(*) as n from public.progress_photos where user_id = %s", (user_id,)).fetchone()["n"]


def over_limit_message():
    return f"You've reached the maximum of {PHOTO_LIMIT:,} saved items here. Delete some to add more."


def lock_user(conn, user_id):
    """Serialise one user's photo writes. Held until the end of this transaction, which is the only kind of lock the
    transaction pooler allows."""
    conn.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"progress_photos:{user_id}",))


def insert_if_room(conn, user_id, day, angle, name):
    """Record the photo unless the user is at the ceiling. Returns the new id or None."""
    lock_user(conn, user_id)
    if count(conn, user_id) >= PHOTO_LIMIT:
        return None
    row = conn.execute(
        "insert into public.progress_photos (user_id, date, angle, filename) values (%s, %s, %s, %s) returning id",
        (user_id, day, angle, name)).fetchone()
    return row["id"]


def list_photos(conn, user_id):
    return conn.execute(
        "select id, date, angle from public.progress_photos where user_id = %s order by date desc, angle asc",
        (user_id,)).fetchall()


def get_photo(conn, user_id, photo_id):
    """The caller's own photo row, or None. (Scoped by user in SQL: this connection bypasses row-level security.)"""
    return conn.execute("select id, date, angle, filename from public.progress_photos where id = %s and user_id = %s",
                        (photo_id, user_id)).fetchone()


def delete_row(conn, user_id, photo_id):
    conn.execute("delete from public.progress_photos where id = %s and user_id = %s", (photo_id, user_id))
