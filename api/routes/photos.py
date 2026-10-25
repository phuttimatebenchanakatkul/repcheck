"""Weekly check-in photos. See api/photos.py for the rules."""

from flask import Blueprint, current_app, jsonify, request

from .. import accounts, photos
from ..auth import current_identity, login_required
from ..supabase_admin import Refused, SupabaseError
from .account import fail

bp = Blueprint("photos", __name__)
SIGNED_URL_SECONDS = 300
# The request body is a photo plus two short fields. Stated per request: the app-wide limit is for JSON bodies.
UPLOAD_BODY_LIMIT = photos.MAX_PHOTO_BYTES + 64 * 1024


def services():
    return current_app.extensions["api"]


def _no_profile():
    return fail("No profile yet. Create it first.", 404)


def _day_json(value):
    return value.isoformat()


@bp.post("/api/checkin/photo")
@login_required
def upload_photo():
    request.max_content_length = UPLOAD_BODY_LIMIT        # before the body is read: larger is a 413, never buffered
    svc, user_id = services(), current_identity().id
    angle = request.form.get("angle")
    if angle not in photos.ANGLES:
        return fail("angle must be 'front' or 'back'.", 400)
    upload = request.files.get("photo")
    if upload is None:
        return fail("No photo uploaded.", 400)
    data = upload.read(photos.MAX_PHOTO_BYTES + 1)
    try:
        with svc.db.connection() as conn:
            profile = accounts.get_profile(conn, user_id)
            if not profile:
                return _no_profile()
            day = photos.check_date(request.form.get("date"), photos.account_day(profile))
            full = photos.count(conn, user_id) >= photos.PHOTO_LIMIT
        if full:                                           # cheap early refusal; the real, race-free check is below
            return fail(photos.over_limit_message(), 429)
        extension, content_type = photos.inspect_image(data)
    except photos.PhotoRejected as rejected:
        return fail(str(rejected), rejected.status)

    name = photos.new_name(extension)
    key = photos.object_key(user_id, name)
    try:
        svc.storage.upload(photos.BUCKET, key, data, content_type, upsert=False)
    except Refused:
        return fail("That photo can't be saved. Please try a different one.", 400)
    except SupabaseError:
        return fail("We couldn't save your photo. Please try again.", 502)

    try:
        with svc.db.connection() as conn:
            photo_id = photos.insert_if_room(conn, user_id, day, angle, name)
    except Exception:
        svc.storage.remove(photos.BUCKET, [key])            # never leave a file no row points at
        raise
    if photo_id is None:
        svc.storage.remove(photos.BUCKET, [key])
        return fail(photos.over_limit_message(), 429)
    return jsonify({"ok": True, "id": photo_id})


@bp.get("/api/checkin/photos")
@login_required
def list_photos():
    with services().db.connection() as conn:
        rows = photos.list_photos(conn, current_identity().id)
    return jsonify({"ok": True, "photos": [{"id": r["id"], "date": _day_json(r["date"]), "angle": r["angle"]} for r in rows]})


@bp.get("/api/checkin/photo/<int:photo_id>")
@login_required
def get_photo(photo_id):
    """A short-lived link to the caller's own photo (the file is private; the link is the permission)."""
    svc = services()
    with svc.db.connection() as conn:
        row = photos.get_photo(conn, current_identity().id, photo_id)
    if not row:
        return fail("Not found.", 404)
    try:
        url = svc.storage.sign(photos.BUCKET, photos.object_key(current_identity().id, row["filename"]), SIGNED_URL_SECONDS)
    except SupabaseError:
        return fail("We couldn't load your photo. Please try again.", 502)
    if url is None:
        return fail("Not found.", 404)
    return jsonify({"ok": True, "url": url, "expires_in": SIGNED_URL_SECONDS})


@bp.delete("/api/checkin/photo/<int:photo_id>")
@login_required
def delete_photo(photo_id):
    svc, user_id = services(), current_identity().id
    with svc.db.connection() as conn:
        row = photos.get_photo(conn, user_id, photo_id)
    if not row:
        return fail("Not found.", 404)
    # The file first: if it cannot be removed the photo stays listed and the delete can simply be retried.
    if svc.storage.remove(photos.BUCKET, [photos.object_key(user_id, row["filename"])]):
        return fail("We couldn't delete your photo. Please try again.", 502)
    with svc.db.connection() as conn:
        photos.delete_row(conn, user_id, photo_id)
    return jsonify({"ok": True})
