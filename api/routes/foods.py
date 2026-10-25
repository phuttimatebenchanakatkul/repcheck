"""Food: the AI photo scan, barcode decoding and lookup, online food search, and a person's own foods and exercises."""

import logging

from flask import Blueprint, jsonify, request

from .. import accounts, ai, consent, foods, photos
from ..auth import current_identity, login_required
from ..limits import RATE_LIMITS, friendly_wait
from .account import fail, json_body, services

bp = Blueprint("foods", __name__)
log = logging.getLogger(__name__)

FOOD_PHOTO_BODY_LIMIT = photos.MAX_PHOTO_BYTES + 64 * 1024
MAX_BARCODE_IMAGE_BYTES = 6 * 1024 * 1024         # a barcode frame or photo; the live scanner posts small frames
BARCODE_BODY_LIMIT = MAX_BARCODE_IMAGE_BYTES + 64 * 1024
MAX_NOTE = 300
MAX_SEARCH = 100
ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _profile(svc, user_id):
    with svc.db.connection() as conn:
        return accounts.get_profile(conn, user_id)


def _need_profile(svc, user_id):
    """(profile, early response)."""
    profile = _profile(svc, user_id)
    if not profile:
        return None, fail("No profile yet. Create it first.", 404)
    return profile, None


# -- the AI food photo ---------------------------------------------------------------------------------------------

@bp.post("/api/analyze-food")
@login_required
def analyze_food():
    request.max_content_length = FOOD_PHOTO_BODY_LIMIT
    svc, identity = services(), current_identity()
    user_id = identity.id
    profile, early = _need_profile(svc, user_id)
    if early:
        return early
    if not consent.has_consent(profile):
        return consent.refusal()
    upload = request.files.get("image")
    if upload is None or not upload.filename:
        return fail("Please provide a photo.", 400)
    data = upload.read(photos.MAX_PHOTO_BYTES + 1)
    try:
        _extension, mime_type = photos.inspect_image(data)          # real bytes, a real image, the real type: not the client's word
    except photos.PhotoRejected as rejected:
        return fail(str(rejected), rejected.status)
    note = foods.clean_text(request.form.get("note"), MAX_NOTE) or None

    reservation = ai.reserve(svc, identity, "food_analysis")
    if not reservation.allowed:
        response = fail(f"You've used your {RATE_LIMITS['food_analysis'][0]} food scans for today — "
                        f"try again in {friendly_wait(reservation.retry_after)}.", 429)
        response.headers["Retry-After"] = str(reservation.retry_after)
        return response
    try:
        result = svc.ai.analyze_food(data, mime_type, note)
    except ai.AnalysisFailed as failure:
        log.warning("Food photo analysis failed: %s", failure)
        ai.release(svc, user_id, "food_analysis", reservation)
        return fail("Couldn't analyze that photo. Please try again.", 502)
    except Exception:
        ai.release(svc, user_id, "food_analysis", reservation)
        raise
    ai.track(svc, user_id, "food_scan")
    return jsonify({"ok": True, **result})


# -- barcodes and online search -------------------------------------------------------------------------------------

def _resolve_barcode(svc, user_id, barcode):
    """A person's own food for this exact barcode always wins over an external lookup (their verified data for their
    product), checked before ever calling out. Raises ai.ProductNotFound / ai.LookupFailed from the lookup."""
    with svc.db.connection() as conn:
        mine = foods.food_by_barcode(conn, user_id, barcode)
    if mine:
        return foods.food_as_scan_result(mine)
    return svc.ai.lookup_barcode(barcode)


@bp.post("/api/scan-barcode")
@login_required
def scan_barcode():
    request.max_content_length = BARCODE_BODY_LIMIT
    svc, user_id = services(), current_identity().id
    upload = request.files.get("image")
    if upload is None or not upload.filename:
        return fail("Please provide a photo of the barcode.", 400)
    data = upload.read(MAX_BARCODE_IMAGE_BYTES + 1)
    if len(data) > MAX_BARCODE_IMAGE_BYTES:
        return fail("That photo is too large.", 413)
    live_frame = request.form.get("live") == "1"           # routine misses from the live camera loop are not worth logging
    try:
        barcode = svc.ai.decode_barcode(data)
    except ai.LookupFailed as failure:
        if not live_frame:
            log.warning("Barcode decode failed: %s", failure)
        return fail(str(failure), 502)
    try:
        result = _resolve_barcode(svc, user_id, barcode)
    except ai.ProductNotFound as missing:
        return jsonify({"ok": False, "not_found": True, "barcode": barcode, "error": str(missing)})
    except ai.LookupFailed as failure:
        log.warning("Barcode scan failed: %s", failure)
        # Carry the barcode though this failed: the read worked and only the lookup behind it didn't, which the live scanner
        # needs to tell apart from 'this frame had no barcode in it'.
        response = jsonify({"ok": False, "barcode": barcode, "error": str(failure)})
        response.status_code = 502
        return response
    if _profile(svc, user_id):
        ai.track(svc, user_id, "barcode_scan")
    return jsonify({"ok": True, **result})


@bp.post("/api/lookup-barcode")
@login_required
def lookup_barcode():
    svc, user_id = services(), current_identity().id
    barcode = foods.digits_only(json_body().get("barcode"))[:foods.MAX_BARCODE]
    if not barcode:
        return fail("No barcode value given.", 400)
    try:
        result = _resolve_barcode(svc, user_id, barcode)
    except ai.ProductNotFound as missing:
        return jsonify({"ok": False, "not_found": True, "barcode": barcode, "error": str(missing)})     # a normal outcome, not an error
    except ai.LookupFailed as failure:
        log.warning("Barcode lookup failed: %s", failure)
        return fail(str(failure), 502)
    return jsonify({"ok": True, **result})


@bp.get("/api/search-food-online")
@login_required
def search_food_online():
    query = foods.clean_text(request.args.get("q", ""), MAX_SEARCH)
    try:
        results = services().ai.search_foods(query)
    except ai.LookupFailed as failure:
        log.warning("Open Food Facts search failed: %s", failure)
        return fail(str(failure), 502)
    return jsonify({"ok": True, "results": results})


# -- a person's own foods and exercises -----------------------------------------------------------------------------

@bp.get("/api/custom-foods")
@login_required
def list_custom_foods():
    with services().db.connection() as conn:
        return jsonify({"ok": True, "foods": foods.list_foods(conn, current_identity().id)})


@bp.post("/api/custom-foods")
@login_required
def create_custom_food():
    svc, user_id = services(), current_identity().id
    _profile_row, early = _need_profile(svc, user_id)
    if early:
        return early
    try:
        with svc.db.connection() as conn:
            food = foods.create_food(conn, user_id, json_body())
    except foods.Rejected as rejected:
        return fail(str(rejected), rejected.status)
    return jsonify({"ok": True, "food": food})


@bp.delete("/api/custom-foods/<int:food_id>")
@login_required
def delete_custom_food(food_id):
    with services().db.connection() as conn:
        foods.delete_food(conn, current_identity().id, food_id)
    return jsonify({"ok": True})


@bp.get("/api/custom-exercises")
@login_required
def list_custom_exercises():
    with services().db.connection() as conn:
        return jsonify({"ok": True, "exercises": foods.list_exercises(conn, current_identity().id)})


@bp.post("/api/custom-exercises")
@login_required
def create_custom_exercise():
    svc, user_id = services(), current_identity().id
    _profile_row, early = _need_profile(svc, user_id)
    if early:
        return early
    try:
        with svc.db.connection() as conn:
            exercise = foods.create_exercise(conn, user_id, json_body())
    except foods.Rejected as rejected:
        return fail(str(rejected), rejected.status)
    return jsonify({"ok": True, "exercise": exercise})


@bp.delete("/api/custom-exercises/<int:exercise_id>")
@login_required
def delete_custom_exercise(exercise_id):
    with services().db.connection() as conn:
        foods.delete_exercise(conn, current_identity().id, exercise_id)
    return jsonify({"ok": True})
