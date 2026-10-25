"""Friends, blocking and reporting, challenges, the leaderboards, HYROX results and the streak's server-side dates."""

import logging
import tempfile
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from .. import accounts, ai, analyze, consent, limits, social
from ..auth import current_identity, login_required
from .account import fail, json_body, services

bp = Blueprint("social", __name__)
log = logging.getLogger(__name__)

# One exercise a day, cycling in this order (rep_form_analyzer.CHALLENGE_EXERCISES; a test pins keys and labels to it).
CHALLENGE_EXERCISES = {"pushups": "Push-ups", "situps": "Sit-ups", "pullups": "Pull-ups"}
CHALLENGE_ORDER = list(CHALLENGE_EXERCISES)
CLIP_BODY_LIMIT = analyze.MAX_UPLOAD_BYTES + 1024 * 1024


def _need_profile(svc, user_id):
    with svc.db.connection() as conn:
        profile = accounts.get_profile(conn, user_id)
    if not profile:
        return None, fail("No profile yet. Create it first.", 404)
    return profile, None


def _refused(rejected):
    response = jsonify({"ok": False, "error": str(rejected), **{k: v for k, v in rejected.extra.items() if k != "retry_after"}})
    response.status_code = rejected.status
    if "retry_after" in rejected.extra:
        response.headers["Retry-After"] = str(rejected.extra["retry_after"])
    return response


# -- friends ---------------------------------------------------------------------------------------------------------------

@bp.get("/api/friends")
@login_required
def list_friends():
    svc, user_id = services(), current_identity().id
    with svc.db.connection() as conn:
        code = social.friend_code(conn, user_id)
        if code is None:
            return fail("No profile yet. Create it first.", 404)
        return jsonify({"ok": True, "code": code, "friends": social.friends(conn, user_id)})


@bp.post("/api/friends/add")
@login_required
def add_friend():
    svc, user_id = services(), current_identity().id
    _profile, early = _need_profile(svc, user_id)
    if early:
        return early
    try:
        with svc.db.connection() as conn:
            friend = social.add_by_code(conn, user_id, json_body().get("code"), int(time.time()))
    except social.Rejected as rejected:
        return _refused(rejected)
    ai.track(svc, user_id, "friend_added")
    return jsonify({"ok": True, "friend": friend})


# -- blocking and reporting ----------------------------------------------------------------------------------------------------

def _target(svc, payload):
    """The id of an account that exists, from a posted `user_id`, or None. A row is only ever written for an account
    that exists, so a bad client cannot fill these tables."""
    target = social.parse_user_id(payload.get("user_id"))
    if target is None:
        return None
    with svc.db.connection() as conn:
        return target if social.profile_exists(conn, target) else None


@bp.get("/api/safety/blocks")
@login_required
def list_blocks():
    with services().db.connection() as conn:
        return jsonify({"ok": True, "blocked": social.blocked_accounts(conn, current_identity().id)})


@bp.post("/api/safety/block")
@login_required
def block_account():
    svc, user_id = services(), current_identity().id
    _profile, early = _need_profile(svc, user_id)
    if early:
        return early
    target = _target(svc, json_body())
    if not target:
        return fail("That account no longer exists.", 404)
    if target == user_id:
        return fail("You can't block yourself.", 400)
    with svc.db.connection() as conn:
        social.block(conn, user_id, target)
    ai.track(svc, user_id, "block_user")
    # No name in the reply: ids are not secret enough to let this become an oracle that walks them and reads every name.
    return jsonify({"ok": True, "blocked": {"id": target}})


@bp.delete("/api/safety/block")
@login_required
def unblock_account():
    target = social.parse_user_id(json_body().get("user_id"))
    if target is None:
        return fail("Which account?", 400)
    # Not gated on the account still existing: a block on an account deleted since must stay removable.
    with services().db.connection() as conn:
        social.unblock(conn, current_identity().id, target)
    return jsonify({"ok": True})


@bp.post("/api/safety/report")
@login_required
def report_account():
    svc, user_id = services(), current_identity().id
    _profile, early = _need_profile(svc, user_id)
    if early:
        return early
    payload = json_body()
    target = _target(svc, payload)
    if not target:
        return fail("That account no longer exists.", 404)
    if target == user_id:
        return fail("You can't report yourself.", 400)
    with svc.db.connection() as conn:
        social.report_user(conn, user_id, target, payload.get("reason"))
    ai.track(svc, user_id, "report_user")
    return jsonify({"ok": True, "blocked": {"id": target}})


@bp.post("/api/ai-report")
@login_required
def report_ai_reply():
    svc, user_id = services(), current_identity().id
    _profile, early = _need_profile(svc, user_id)
    if early:
        return early
    payload = json_body()
    reply = payload.get("reply")
    if not isinstance(reply, str) or not reply.strip():
        return fail("Nothing to report.", 400)
    with svc.db.connection() as conn:
        filed = social.report_ai_reply(conn, user_id, payload.get("feature"), payload.get("reason"), reply)
    if not filed:
        return fail("You have too many reports waiting for review.", 429)
    ai.track(svc, user_id, "report_ai_reply")
    return jsonify({"ok": True})


# -- the streak ------------------------------------------------------------------------------------------------------------------

@bp.get("/api/activity/dates")
@login_required
def activity_dates():
    with services().db.connection() as conn:
        return jsonify({"ok": True, "dates": social.activity_dates(conn, current_identity().id, request.args.get("tz_offset_minutes", 0))})


# -- challenges ----------------------------------------------------------------------------------------------------------------------

def todays_exercise():
    return social.todays_exercise(CHALLENGE_ORDER)


@bp.get("/api/challenges")
@login_required
def list_challenges():
    svc, user_id = services(), current_identity().id
    with svc.db.connection() as conn:
        return jsonify({"ok": True, "challenges": social.visible_challenges(conn, user_id), "me": user_id})


@bp.post("/api/challenges")
@login_required
def create_challenge():
    svc, user_id = services(), current_identity().id
    _profile, early = _need_profile(svc, user_id)
    if early:
        return early
    exercise = todays_exercise()
    try:
        with svc.db.connection() as conn:
            challenge_id = social.create_challenge(conn, user_id, exercise)
    except social.Rejected as rejected:
        return _refused(rejected)
    return jsonify({"ok": True, "id": challenge_id, "exercise": exercise})


@bp.get("/api/challenges/today")
@login_required
def todays_challenge():
    svc, user_id = services(), current_identity().id
    exercise = todays_exercise()
    with svc.db.connection() as conn:
        attempted = social.has_submitted_today(conn, user_id, exercise)
    return jsonify({"ok": True, "exercise": exercise, "label": CHALLENGE_EXERCISES[exercise], "attempted": attempted})


@bp.post("/api/challenges/<int:challenge_id>/submit")
@login_required
def submit_challenge(challenge_id):
    request.max_content_length = CLIP_BODY_LIMIT
    svc, identity = services(), current_identity()
    user_id = identity.id
    profile, early = _need_profile(svc, user_id)
    if early:
        return early
    if not consent.has_consent(profile):
        return consent.refusal()
    with svc.db.connection() as conn:
        challenge = social.visible_challenge(conn, user_id, challenge_id)
        if not challenge:
            return fail("Challenge not found.", 404)
        exercise = challenge["exercise"]
        done = social.has_submitted_today(conn, user_id, exercise)
    if done:
        return jsonify({"ok": False, "limitReached": True,
                        "error": "You've already recorded an attempt for this exercise today — try again tomorrow."}), 429
    upload = request.files.get("video")
    if upload is None or not upload.filename:
        return fail("No video uploaded.", 400)
    suffix = Path(upload.filename).suffix.lower()
    if suffix not in analyze.ALLOWED_EXTENSIONS | analyze.RECORDED_EXTENSIONS:
        return fail("Unsupported video format.", 400)

    # One attempt per exercise per day, held across the minute-long grading so two simultaneous submissions cannot both
    # reach the model; given back if the grading does not produce a result.
    with svc.db.connection() as conn:
        reservation = limits.reserve_daily_attempt(conn, user_id, exercise)
    if not reservation.allowed:
        return jsonify({"ok": False, "limitReached": True,
                        "error": "You've already recorded an attempt for this exercise today — try again tomorrow."}), 429
    try:
        with tempfile.TemporaryDirectory(prefix="rc-challenge-") as work:
            raw_path, trimmed_path = Path(work) / f"upload{suffix}", Path(work) / "trimmed.mp4"
            upload.save(raw_path)
            try:
                result = svc.ai.count_reps(raw_path, exercise, trimmed_path)
            except ai.RepCountFailed as failure:
                _give_back(svc, user_id, exercise, reservation)
                return fail(str(failure), 400)
        with svc.db.connection() as conn:
            social.save_submission(conn, challenge_id, user_id, result["reps"], result["notes"])
    except Exception:
        _give_back(svc, user_id, exercise, reservation)
        raise
    ai.track(svc, user_id, "challenge_submission")
    rejected = result.get("rejected", 0)
    return jsonify({"ok": True, "exercise": exercise, "reps": result["reps"], "rejected": rejected,
                    "total": result["reps"] + rejected, "notes": result["notes"]})


def _give_back(svc, user_id, exercise, reservation):
    try:
        with svc.db.connection() as conn:
            limits.release_daily_attempt(conn, user_id, exercise, reservation)
    except Exception:                                    # noqa: BLE001 -- a failed refund must not mask the failure that caused it
        log.exception("could not give back a challenge attempt for %s", user_id)


# -- leaderboards -------------------------------------------------------------------------------------------------------------------

@bp.get("/api/leaderboard")
@login_required
def reps_leaderboard():
    svc, user_id = services(), current_identity().id
    scope = request.args.get("scope", "friends")
    limit = request.args.get("limit", type=int)
    with svc.db.connection() as conn:
        rows = social.reps_board(conn, user_id, scope)
    return jsonify({"ok": True, "scope": scope, "me": user_id, "leaderboard": rows[:limit] if limit else rows,
                    "totalEntries": len(rows), "myRank": social.my_rank(rows, user_id, "total_reps")})


@bp.post("/api/hyrox/results")
@login_required
def create_hyrox_result():
    svc, user_id = services(), current_identity().id
    _profile, early = _need_profile(svc, user_id)
    if early:
        return early
    try:
        gender, category, format_, seconds = social.clean_hyrox_result(json_body())
        with svc.db.connection() as conn:
            result_id = social.create_hyrox_result(conn, user_id, gender, category, format_, seconds)
    except social.Rejected as rejected:
        return _refused(rejected)
    return jsonify({"ok": True, "id": result_id})


@bp.get("/api/hyrox/leaderboard")
@login_required
def hyrox_leaderboard():
    svc, user_id = services(), current_identity().id
    gender, category, format_ = (request.args.get(k, "") for k in ("gender", "category", "format"))
    if not social.hyrox_combo(gender, category, format_):
        return fail("Invalid gender, category, or format.", 400)
    with svc.db.connection() as conn:
        rows = social.hyrox_board(conn, user_id, gender, category, format_)
    return jsonify({"ok": True, "leaderboard": rows[:social.HYROX_LEADERBOARD_ROWS], "totalEntries": len(rows),
                    "me": social.my_rank(rows, user_id, "best_seconds")})
