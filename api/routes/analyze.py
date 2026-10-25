"""AI form analysis and its history. See api/analyze.py for the rules."""

import logging
import tempfile
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request

from .. import accounts, ai, analyze, consent, limits
from ..auth import current_identity, login_required
from ..supabase_admin import SupabaseError
from .account import fail, services

bp = Blueprint("analyze", __name__)
log = logging.getLogger(__name__)
SIGNED_URL_SECONDS = 300
# The raw clip plus form fields. Stated per request: the app-wide limit is for JSON bodies.
UPLOAD_BODY_LIMIT = analyze.MAX_UPLOAD_BYTES + 1024 * 1024


def _signed_clip_url(svc, user_id, row):
    """A short-lived link to the stored clip, or None if there is none (or it cannot be signed right now)."""
    if not row["video_filename"]:
        return None
    try:
        return svc.storage.sign(analyze.BUCKET, analyze.clip_key(user_id, row["video_filename"]), SIGNED_URL_SECONDS)
    except SupabaseError:
        return None


@bp.post("/api/analyze")
@login_required
def run_analysis():
    request.max_content_length = UPLOAD_BODY_LIMIT           # raised before the body is read; larger is a 413
    svc, identity = services(), current_identity()
    user_id = identity.id

    # Consent first, and before the upload is touched: with it withdrawn nothing is read, saved or sent to Gemini.
    with svc.db.connection() as conn:
        profile = accounts.get_profile(conn, user_id)
    if not profile:
        return fail("No profile yet. Create it first.", 404)
    if not consent.has_consent(profile):
        return consent.refusal()

    upload = request.files.get("video")
    if upload is None or not upload.filename:
        return fail("Please choose a video file.", 400)
    try:
        exercise = analyze.clean_exercise(request.form.get("exercise"))
        suffix = analyze.check_suffix(upload.filename)
    except analyze.AnalyzeRejected as rejected:
        return fail(str(rejected), 400)

    # Spend the use now, before the slow and expensive part; give it back if the work does not produce a result.
    exempt = limits.is_exempt(svc.settings, identity)
    reservation = limits.EXEMPT
    if not exempt:
        with svc.db.connection() as conn:
            reservation = limits.reserve(conn, user_id, analyze.FEATURE)
        if not reservation.allowed:
            response = fail(limits.limit_message(analyze.FEATURE, reservation.retry_after), 429)
            response.headers["Retry-After"] = str(reservation.retry_after)
            return response

    stored_name = None
    try:
        with tempfile.TemporaryDirectory(prefix="rc-analyze-") as work:
            raw_path, trimmed_path = Path(work) / f"upload{suffix}", Path(work) / f"trimmed{suffix}"
            upload.save(raw_path)
            try:
                result = svc.analyzer(raw_path, exercise, trimmed_path)
            except SystemExit as failure:                       # the pipeline reports user-facing failures this way
                _refund(svc, user_id, reservation)
                reservation = limits.EXEMPT
                message = str(failure.code) if isinstance(failure.code, str) and failure.code else "We couldn't analyze that video."
                return fail(message, 400)
            stored_name = _store_clip(svc, user_id, trimmed_path, suffix)

        with svc.db.connection() as conn:
            row = analyze.save_result(conn, user_id, result, stored_name)
            limits.track_usage(conn, user_id, "feature:" + analyze.FEATURE)
    except Exception:
        if stored_name:
            svc.storage.remove(analyze.BUCKET, [analyze.clip_key(user_id, stored_name)])    # never leave an unreferenced clip
        _refund(svc, user_id, reservation)
        raise

    try:
        analyze.prune(svc.db, svc.storage, user_id)
    except Exception:                                    # noqa: BLE001 -- the analysis is saved; pruning retries next time
        log.exception("could not prune analysis history for %s", user_id)

    log.info("analyzed %s: %s reps, clip stored: %s", result["exercise_label"], result["reps"], bool(stored_name))
    body = analyze.result_json({**row, "exercise_label": result["exercise_label"], "overall_score": result["overall_score"],
                                "stretch_score": result["stretch_score"], "squeeze_score": result["squeeze_score"],
                                "favored": result["favored"], "reps": result["reps"], "feedback_text": result["feedback"],
                                "video_filename": stored_name}, _signed_clip_url(svc, user_id, {"video_filename": stored_name}))
    return jsonify(body)


def _store_clip(svc, user_id, trimmed_path, suffix):
    """Keep the trimmed clip for replay. Best-effort, as on the website: any failure returns None and the analysis is
    saved without a clip. Returns the stored file name or None."""
    try:
        size = trimmed_path.stat().st_size
    except OSError:
        return None
    if size == 0 or size > analyze.MAX_CLIP_BYTES:
        return None
    name = analyze.new_clip_name(suffix)
    try:
        svc.storage.upload(analyze.BUCKET, analyze.clip_key(user_id, name), trimmed_path.read_bytes(),
                           analyze.CONTENT_TYPES[suffix], upsert=False)
    except SupabaseError:                                 # includes the bucket refusing it
        return None
    return name


def _refund(svc, user_id, reservation):
    ai.release(svc, user_id, analyze.FEATURE, reservation)


@bp.get("/api/analyze/history")
@login_required
def analysis_history():
    with services().db.connection() as conn:
        rows = analyze.history(conn, current_identity().id)
    return jsonify({"ok": True, "entries": [analyze.entry_json(r) for r in rows]})


@bp.get("/api/analyze/history/<int:result_id>")
@login_required
def analysis_detail(result_id):
    svc, user_id = services(), current_identity().id
    with svc.db.connection() as conn:
        row = analyze.get_result(conn, user_id, result_id)
    if not row:
        return fail("Not found.", 404)
    return jsonify(analyze.result_json(row, _signed_clip_url(svc, user_id, row)))


@bp.get("/api/analyze/latest")
@login_required
def analysis_latest():
    svc, user_id = services(), current_identity().id
    with svc.db.connection() as conn:
        row = analyze.latest_result(conn, user_id)
    if not row:
        return fail("Not found.", 404)
    return jsonify(analyze.result_json(row, _signed_clip_url(svc, user_id, row)))


@bp.get("/api/analyze/video/<int:result_id>")
@login_required
def analysis_video(result_id):
    """A short-lived link that plays the clip an analysis was run on (Range requests work, so a player can seek)."""
    svc, user_id = services(), current_identity().id
    with svc.db.connection() as conn:
        row = analyze.get_result(conn, user_id, result_id)
    url = _signed_clip_url(svc, user_id, row) if row else None
    if not url:
        return fail("Not found.", 404)
    return jsonify({"ok": True, "url": url, "expires_in": SIGNED_URL_SECONDS})
