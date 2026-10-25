"""AI form analysis: validate an uploaded set, grade it, keep the trimmed clip in the private `analyze-videos` bucket and
the result in `analyze_results`, and keep only each person's newest HISTORY_KEEP of them.

The rules are the website's (app.py, analyze), with these differences, all deliberate:
  * a use is reserved before the Gemini call and refunded if anything fails (api/limits.py), so simultaneous requests
    cannot exceed the daily limit and a failed analysis never burns it;
  * the exercise name is length- and character-checked (it goes into the model's prompt);
  * pruning removes a stale analysis's clip through the Storage API BEFORE its row, and keeps the row if the clip will
    not go, so the next analysis retries instead of orphaning a video nobody can see or delete;
  * storing the clip is best-effort exactly as before (the analysis is saved without a replayable clip if storage
    fails), but a clip larger than the bucket's limit is not even attempted.
"""

import re
import uuid
from pathlib import Path

from .feedback import split_feedback_sections

BUCKET = "analyze-videos"
HISTORY_KEEP = 20                     # app.py ANALYZE_HISTORY_KEEP
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}          # advertised
RECORDED_EXTENSIONS = {".webm"}                                         # what the in-app recorder can produce
CONTENT_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".avi": "video/x-msvideo",
                 ".mkv": "video/x-matroska", ".webm": "video/webm"}
MAX_UPLOAD_BYTES = 300 * 1024 * 1024   # app.py MAX_CONTENT_LENGTH: the raw upload
MAX_CLIP_BYTES = 50 * 1024 * 1024      # the bucket's own limit; a trimmed clip over it is not stored
MAX_EXERCISE_LENGTH = 100
FEATURE = "workout_analysis"


class AnalyzeRejected(ValueError):
    """The message is safe to show the user."""


def clean_exercise(raw):
    exercise = raw.strip() if isinstance(raw, str) else ""
    if not exercise or any(ord(c) < 32 or ord(c) == 127 for c in exercise):
        raise AnalyzeRejected("Please choose an exercise.")
    if len(exercise) > MAX_EXERCISE_LENGTH:
        raise AnalyzeRejected("That exercise name is too long.")
    return exercise


def check_suffix(filename):
    """The lower-cased extension of an upload we accept, or AnalyzeRejected."""
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS | RECORDED_EXTENSIONS:
        shown = re.sub(r"[^\x21-\x7e]", "?", suffix)[:16]       # echo something short and printable, never the raw input
        raise AnalyzeRejected(f"Unsupported file type '{shown}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")
    return suffix


def default_analyzer(input_path, exercise, trimmed_path):
    """Trim and grade with the existing pipeline (ffmpeg + Gemini). Imported on first use: it pulls in OpenCV and the
    Gemini client, which a process that never analyzes should not pay for."""
    from pipeline import run_pipeline
    return run_pipeline(input_path, exercise, trimmed_path=trimmed_path)


def new_clip_name(suffix):
    return f"{uuid.uuid4().hex}{suffix}"


def clip_key(user_id, name):
    return f"{user_id}/{name}"


def save_result(conn, user_id, result, video_filename):
    """Record a graded set. Returns the new row (id, created_at)."""
    return conn.execute(
        """insert into public.analyze_results
               (user_id, exercise_label, overall_score, stretch_score, squeeze_score, favored, reps, feedback_text, video_filename)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id, created_at""",
        (user_id, result["exercise_label"], result["overall_score"], result["stretch_score"], result["squeeze_score"],
         result["favored"], result["reps"], result["feedback"].replace("\x00", ""), video_filename)).fetchone()


def history(conn, user_id, limit=HISTORY_KEEP):
    return conn.execute(
        "select id, exercise_label, overall_score, reps, created_at, video_filename from public.analyze_results "
        "where user_id = %s order by created_at desc, id desc limit %s", (user_id, limit)).fetchall()


def get_result(conn, user_id, result_id):
    return conn.execute("select * from public.analyze_results where user_id = %s and id = %s", (user_id, result_id)).fetchone()


def latest_result(conn, user_id):
    return conn.execute("select * from public.analyze_results where user_id = %s order by created_at desc, id desc limit 1",
                        (user_id,)).fetchone()


def created_ms(created_at):
    return int(created_at.timestamp() * 1000)


def entry_json(row):
    return {"id": row["id"], "exercise_label": row["exercise_label"], "overall_score": row["overall_score"],
            "reps": row["reps"], "created_at": row["created_at"].isoformat(), "has_video": bool(row["video_filename"])}


def result_json(row, video_url):
    """One stored analysis, in the shape a fresh analysis answers with."""
    return {
        "ok": True, "id": row["id"], "exercise_label": row["exercise_label"], "overall_score": row["overall_score"],
        "stretch_score": row["stretch_score"], "squeeze_score": row["squeeze_score"], "favored": row["favored"],
        "reps": row["reps"], "sections": split_feedback_sections(row["feedback_text"], row["overall_score"]),
        "feedback_text": row["feedback_text"], "created_at": row["created_at"].isoformat(),
        "created_at_ms": created_ms(row["created_at"]), "video_url": video_url,
    }


def prune(db, storage, user_id, keep=HISTORY_KEEP):
    """Delete this person's analyses beyond the newest `keep`, their clips first. A clip that will not go keeps its row
    (the next analysis retries). A pruned analysis takes its chat thread with it (a cascade). Returns how many went."""
    with db.connection() as conn:
        stale = conn.execute(
            "select id, video_filename from public.analyze_results where user_id = %s "
            "order by created_at desc, id desc offset %s", (user_id, keep)).fetchall()
    if not stale:
        return 0
    keys = {r["id"]: clip_key(user_id, r["video_filename"]) for r in stale if r["video_filename"]}
    stuck = set(storage.remove(BUCKET, list(keys.values()))) if keys else set()
    deletable = [r["id"] for r in stale if keys.get(r["id"]) not in stuck]
    if deletable:
        with db.connection() as conn:
            conn.execute("delete from public.analyze_results where user_id = %s and id = any(%s)", (user_id, deletable))
    return len(deletable)
