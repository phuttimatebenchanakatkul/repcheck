"""AI form analysis through the native API, against the REAL Supabase project: real tokens, real Storage, real rows.
The grader is a fake (no Gemini calls, no money, no flakiness); a real one is exercised separately by hand.

Every refusal and failure is checked for its EFFECT: no row, no stored clip, no use of the daily allowance spent, no
temporary file left behind. Mutation-check any change here (CLAUDE.md).
"""

import dataclasses
import datetime as dt
import io
import threading
import time
from pathlib import Path

import pytest

from api import analyze, consent, feedback, limits
from api.app import create_app
from api.routes import analyze as analyze_route
from api.supabase_admin import Refused, SupabaseError
from api_support import (  # noqa: F401 -- the fixtures are used by name
    bearer, client, db, forget, objects_of, person, settings, storage)
from test_supabase_rls import HTTP, Person, needs_api, needs_db

pytestmark = [needs_api, needs_db]

FEEDBACK = ("## Movement Summary\n- Good depth\n- Knees tracked well\n\n## Positives\n- Strong brace\n\n"
            "## Negatives\n- Chest dropped\n- Hips shot up\n\n## How to Progress\n- Add 2.5 kg\n")
CLIP = b"TRIMMED-CLIP-BYTES" * 100


class FakeAnalyzer:
    """Stands in for the Gemini pipeline: records what it was given, writes a 'trimmed' clip, returns a result."""

    def __init__(self, *, error=None, delay=0.0, clip=CLIP, score=72, write_clip=True, text=FEEDBACK):
        self.calls, self.error, self.delay, self.clip, self.score, self.write_clip, self.text = [], error, delay, clip, score, write_clip, text

    def __call__(self, input_path, exercise, trimmed_path):
        self.calls.append({"exercise": exercise, "input": Path(input_path), "trimmed": Path(trimmed_path),
                           "uploaded": Path(input_path).read_bytes()})
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise self.error
        if self.write_clip:
            Path(trimmed_path).write_bytes(self.clip)
        return {"feedback": self.text, "exercise_label": "Back Squat", "stretch_score": 7, "squeeze_score": 8,
                "overall_score": self.score, "favored": "stretch", "reps": 8, "model": "fake", "duration_seconds": 12.0,
                "trimmed_path": trimmed_path, "api_seconds": 1.0, "api_attempts": 1}


def app_with(settings, db, storage, analyzer, exempt=()):
    s = dataclasses.replace(settings, rate_limit_exempt=frozenset(e.lower() for e in exempt))
    return create_app(s, db=db, storage=storage, analyzer=analyzer, sweep=False).test_client()


def analyze_post(c, who, *, filename="set.mp4", data=b"RAW-UPLOAD" * 50, exercise="Back Squat", video=True):
    form = {}
    if exercise is not None:
        form["exercise"] = exercise
    if video:
        form["video"] = (io.BytesIO(data), filename)
    return c.post("/api/analyze", headers=bearer(who), data=form, content_type="multipart/form-data")


@pytest.fixture
def me(client, person):
    assert client.post("/api/profile", headers=bearer(person), json={"name": "Lifter"}).status_code == 201
    assert client.post("/api/ai-consent", headers=bearer(person), json={"granted": True}).status_code == 200
    return person


def rows(db, uid):
    with db.connection() as conn:
        return conn.execute("select * from public.analyze_results where user_id = %s order by created_at desc, id desc", (uid,)).fetchall()


def limit_row(db, uid):
    with db.connection() as conn:
        return conn.execute("select * from public.rate_limits where user_id = %s and feature = 'workout_analysis'", (uid,)).fetchone()


def usage(db, uid, event):
    with db.connection() as conn:
        r = conn.execute("select count from public.usage_events where user_id = %s and event = %s", (uid, event)).fetchone()
    return r["count"] if r else 0


def assert_untouched(db, uid):
    """A refused or failed request left nothing: no analysis, no clip, no allowance spent."""
    assert rows(db, uid) == [] and objects_of(db, uid) == [], "a refused request left a row or a clip behind"
    row = limit_row(db, uid)
    assert row is None or row["count"] == 0, "a refused request spent the daily allowance"


# -- consent -------------------------------------------------------------------------------------------

def test_consent_is_recorded_kept_from_the_first_yes_and_withdrawn(client, person, db):
    client.post("/api/profile", headers=bearer(person), json={"name": "Consenter"})
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["ai_consent"] is False
    assert client.post("/api/ai-consent", headers=bearer(person), json={"granted": True}).get_json() == {"ok": True, "granted": True}
    with db.connection() as conn:
        first = conn.execute("select ai_consent_at from public.profiles where id = %s", (person.id,)).fetchone()["ai_consent_at"]
    assert first is not None and client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["ai_consent"] is True
    time.sleep(1.1)
    client.post("/api/ai-consent", headers=bearer(person), json={"granted": True})
    with db.connection() as conn:
        assert conn.execute("select ai_consent_at from public.profiles where id = %s", (person.id,)).fetchone()["ai_consent_at"] == first, \
            "agreeing again must keep the time they first agreed"
    assert client.post("/api/ai-consent", headers=bearer(person), json={"granted": False}).get_json() == {"ok": True, "granted": False}
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["ai_consent"] is False
    assert usage(db, person.id, "feature:ai_consent_granted") == 2 and usage(db, person.id, "feature:ai_consent_withdrawn") == 1


@pytest.mark.parametrize("body", [{"granted": "true"}, {"granted": 1}, {"granted": None}, {}, {"granted": [True]}, {"granted": "yes"}])
def test_only_a_literal_true_grants_consent(client, person, db, body):
    client.post("/api/profile", headers=bearer(person), json={"name": "Careful"})
    client.post("/api/ai-consent", headers=bearer(person), json={"granted": True})
    assert client.post("/api/ai-consent", headers=bearer(person), json=body).get_json() == {"ok": True, "granted": False}
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["ai_consent"] is False


def test_consent_needs_a_profile(client, person):
    assert client.post("/api/ai-consent", headers=bearer(person), json={"granted": True}).status_code == 404


def test_one_persons_consent_never_touches_anothers(client, me, db):
    other = Person("nonconsenting")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Other"})
        client.post("/api/ai-consent", headers=bearer(me), json={"granted": False})
        assert client.get("/api/profile", headers=bearer(other)).get_json()["profile"]["ai_consent"] is False
        client.post("/api/ai-consent", headers=bearer(other), json={"granted": True})
        assert client.get("/api/profile", headers=bearer(me)).get_json()["profile"]["ai_consent"] is False
    finally:
        forget(other)


# -- a good analysis -----------------------------------------------------------------------------------

def test_a_set_is_graded_its_clip_stored_the_result_saved_and_the_use_spent(settings, db, storage, me):
    grader = FakeAnalyzer()
    c = app_with(settings, db, storage, grader)
    r = analyze_post(c, me, data=b"the raw upload", exercise="  Back Squat ")
    body = r.get_json()
    assert r.status_code == 200 and body["ok"] is True
    assert (body["exercise_label"], body["overall_score"], body["stretch_score"], body["squeeze_score"], body["favored"], body["reps"]) == \
        ("Back Squat", 72, 7, 8, "stretch", 8)
    assert grader.calls[0]["exercise"] == "Back Squat" and grader.calls[0]["uploaded"] == b"the raw upload"
    assert body["feedback_text"] == FEEDBACK and body["sections"] == feedback.split_feedback_sections(FEEDBACK, 72)
    assert abs(body["created_at_ms"] - time.time() * 1000) < 120_000

    (row,) = rows(db, me.id)
    assert row["id"] == body["id"] and row["video_filename"].endswith(".mp4") and row["feedback_text"] == FEEDBACK
    assert objects_of(db, me.id) == [("analyze-videos", f"{me.id}/{row['video_filename']}")]
    assert storage.download("analyze-videos", f"{me.id}/{row['video_filename']}") == CLIP
    with db.connection() as conn:
        stored = conn.execute("select metadata->>'mimetype' as m from storage.objects where name = %s", (f"{me.id}/{row['video_filename']}",)).fetchone()
    assert stored["m"] == "video/mp4"
    played = HTTP.get(body["video_url"], timeout=60)
    assert played.status_code == 200 and played.content == CLIP
    assert limit_row(db, me.id)["count"] == 1 and usage(db, me.id, "feature:workout_analysis") == 1


@pytest.mark.parametrize("filename,suffix,mime", [("a.mp4", ".mp4", "video/mp4"), ("A.MOV", ".mov", "video/quicktime"), ("a.m4v", ".m4v", "video/x-m4v"),
                                                  ("a.avi", ".avi", "video/x-msvideo"), ("a.mkv", ".mkv", "video/x-matroska"),
                                                  ("a.webm", ".webm", "video/webm")])
def test_every_accepted_extension_is_stored_with_its_own_type(settings, db, storage, me, filename, suffix, mime):
    grader = FakeAnalyzer()
    c = app_with(settings, db, storage, grader)
    assert analyze_post(c, me, filename=filename).status_code == 200
    (row,) = rows(db, me.id)
    assert row["video_filename"].endswith(suffix)
    with db.connection() as conn:
        assert conn.execute("select metadata->>'mimetype' as m from storage.objects where name = %s",
                            (f"{me.id}/{row['video_filename']}",)).fetchone()["m"] == mime
    assert grader.calls[0]["input"].suffix == suffix and grader.calls[0]["trimmed"].suffix == suffix, "the grader must see the real extension"


def test_no_temporary_file_survives_a_request_whether_it_succeeds_or_fails(settings, db, storage, me):
    ok, bad = FakeAnalyzer(), FakeAnalyzer(error=RuntimeError("boom"))
    analyze_post(app_with(settings, db, storage, ok, exempt=[me.email]), me)
    analyze_post(app_with(settings, db, storage, bad, exempt=[me.email]), me)
    for call in ok.calls + bad.calls:
        assert not call["input"].exists() and not call["trimmed"].exists() and not call["input"].parent.exists()


def test_a_nul_character_in_the_models_text_is_dropped_instead_of_failing_the_save(settings, db, storage, me):
    """Postgres cannot store NUL in text, and model output is untrusted: one stray byte must not lose a paid analysis."""
    dirty, clean = "## Positives" + chr(10) + "- good" + chr(0) + " depth" + chr(10), "## Positives" + chr(10) + "- good depth" + chr(10)
    r = analyze_post(app_with(settings, db, storage, FakeAnalyzer(text=dirty)), me)
    assert r.status_code == 200
    assert rows(db, me.id)[0]["feedback_text"] == clean


# -- refusals: nothing is graded, saved, stored or spent ------------------------------------------------

def test_no_profile_is_a_404_and_the_grader_is_never_called(settings, db, storage, person):
    grader = FakeAnalyzer()
    r = analyze_post(app_with(settings, db, storage, grader), person)
    assert r.status_code == 404 and grader.calls == []


def test_without_consent_nothing_is_read_graded_or_spent(settings, db, storage, client, person):
    client.post("/api/profile", headers=bearer(person), json={"name": "Unconsenting"})
    grader = FakeAnalyzer()
    c = app_with(settings, db, storage, grader)
    r = analyze_post(c, person)
    assert r.status_code == 403 and r.get_json() == {"ok": False, "needs_ai_consent": True, "error": consent.CONSENT_ERROR}
    assert grader.calls == [] and r.get_json()["error"] == "AI features are off for your account. Turn them on in Settings, under AI features, to use this."
    assert analyze_post(c, person, video=False, exercise=None).status_code == 403, "consent is checked before the form is even read"
    assert_untouched(db, person.id)


def test_withdrawing_consent_stops_the_next_analysis(settings, db, storage, client, me):
    grader = FakeAnalyzer()
    c = app_with(settings, db, storage, grader, exempt=[me.email])
    assert analyze_post(c, me).status_code == 200
    client.post("/api/ai-consent", headers=bearer(me), json={"granted": False})
    assert analyze_post(c, me).status_code == 403 and len(grader.calls) == 1


@pytest.mark.parametrize("kwargs,message", [
    ({"video": False}, "Please choose a video file."),
    ({"filename": ""}, "Please choose a video file."),
    ({"exercise": None}, "Please choose an exercise."),
    ({"exercise": ""}, "Please choose an exercise."),
    ({"exercise": "   "}, "Please choose an exercise."),
    ({"exercise": "bad\x00name"}, "Please choose an exercise."),
    ({"exercise": "x" * 101}, "That exercise name is too long."),
    ({"filename": "set.txt"}, "Unsupported file type '.txt'. Allowed: .avi, .m4v, .mkv, .mov, .mp4"),
    ({"filename": "set"}, "Unsupported file type ''. Allowed: .avi, .m4v, .mkv, .mov, .mp4"),
    ({"filename": "set.mp4.exe"}, "Unsupported file type '.exe'. Allowed: .avi, .m4v, .mkv, .mov, .mp4"),
    ({"filename": "photo.jpg"}, "Unsupported file type '.jpg'. Allowed: .avi, .m4v, .mkv, .mov, .mp4"),
])
def test_bad_input_is_a_400_before_anything_is_spent(settings, db, storage, me, kwargs, message):
    grader = FakeAnalyzer()
    r = analyze_post(app_with(settings, db, storage, grader), me, **kwargs)
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": message}
    assert grader.calls == []
    assert_untouched(db, me.id)


def test_a_signed_out_or_forged_caller_cannot_analyze(settings, db, storage, me):
    grader = FakeAnalyzer()
    c = app_with(settings, db, storage, grader)
    form = {"exercise": "Squat", "video": (io.BytesIO(b"x"), "a.mp4")}
    assert c.post("/api/analyze", data=form, content_type="multipart/form-data").status_code == 401
    forged = {"Authorization": bearer(me)["Authorization"][:-5] + "AAAAA"}
    form["video"] = (io.BytesIO(b"x"), "a.mp4")
    assert c.post("/api/analyze", headers=forged, data=form, content_type="multipart/form-data").status_code == 401
    assert grader.calls == []


def test_the_upload_limit_is_the_websites_with_headroom_and_an_oversized_body_is_a_413(settings, db, storage, me, monkeypatch):
    assert analyze.MAX_UPLOAD_BYTES < analyze_route.UPLOAD_BODY_LIMIT <= analyze.MAX_UPLOAD_BYTES + 2 * 1024 * 1024
    monkeypatch.setattr(analyze_route, "UPLOAD_BODY_LIMIT", 1024 * 1024)
    grader = FakeAnalyzer()
    r = analyze_post(app_with(settings, db, storage, grader), me, data=b"\x00" * (2 * 1024 * 1024))
    assert r.status_code == 413 and r.get_json()["ok"] is False and grader.calls == []
    assert_untouched(db, me.id)


# -- the daily allowance -------------------------------------------------------------------------------

def test_a_second_analysis_the_same_day_is_a_429_with_the_wait_and_no_grading(settings, db, storage, me):
    grader = FakeAnalyzer()
    c = app_with(settings, db, storage, grader)
    assert analyze_post(c, me).status_code == 200
    r = analyze_post(c, me)
    assert r.status_code == 429
    assert r.get_json()["error"] == "You've used your 1 workout analysis for now — try again in about 24 hours."
    assert 86000 <= int(r.headers["Retry-After"]) <= 86400
    assert len(grader.calls) == 1 and len(rows(db, me.id)) == 1 and limit_row(db, me.id)["count"] == 1


def test_the_allowance_comes_back_when_the_window_has_passed(settings, db, storage, me):
    grader = FakeAnalyzer()
    c = app_with(settings, db, storage, grader)
    analyze_post(c, me)
    with db.connection() as conn:
        conn.execute("update public.rate_limits set window_start = %s where user_id = %s and feature = 'workout_analysis'",
                     (int(time.time()) - 86400 - 5, me.id))
    assert analyze_post(c, me).status_code == 200
    assert limit_row(db, me.id)["count"] == 1 and len(rows(db, me.id)) == 2


def test_an_allowance_one_second_short_of_a_day_old_still_blocks(settings, db, storage, me):
    c = app_with(settings, db, storage, FakeAnalyzer())
    analyze_post(c, me)
    with db.connection() as conn:
        conn.execute("update public.rate_limits set window_start = %s where user_id = %s and feature = 'workout_analysis'",
                     (int(time.time()) - 86400 + 30, me.id))
    r = analyze_post(c, me)
    assert r.status_code == 429 and 1 <= int(r.headers["Retry-After"]) <= 31


def test_the_owner_and_app_review_are_never_limited_but_are_still_counted(settings, db, storage, me):
    grader = FakeAnalyzer()
    c = app_with(settings, db, storage, grader, exempt=[me.email.upper()])
    for _ in range(3):
        assert analyze_post(c, me).status_code == 200
    assert limit_row(db, me.id) is None, "an exempt account spends no allowance"
    assert usage(db, me.id, "feature:workout_analysis") == 3 and len(grader.calls) == 3


def test_someone_elses_exemption_does_not_help_you(settings, db, storage, me):
    c = app_with(settings, db, storage, FakeAnalyzer(), exempt=["somebody.else@example.com"])
    assert analyze_post(c, me).status_code == 200
    assert analyze_post(c, me).status_code == 429


def test_one_persons_allowance_is_not_anothers(settings, db, storage, client, me):
    other = Person("neighbour")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Neighbour"})
        client.post("/api/ai-consent", headers=bearer(other), json={"granted": True})
        c = app_with(settings, db, storage, FakeAnalyzer())
        assert analyze_post(c, me).status_code == 200
        assert analyze_post(c, other).status_code == 200
        assert analyze_post(c, me).status_code == 429 and analyze_post(c, other).status_code == 429
    finally:
        forget(other)


def test_simultaneous_requests_cannot_get_around_the_allowance(settings, db, storage, me):
    grader = FakeAnalyzer(delay=1.5)
    c_for = lambda: app_with(settings, db, storage, grader)           # noqa: E731
    results, gate = [], threading.Barrier(4)

    def go():
        c = c_for()
        gate.wait()
        results.append(analyze_post(c, me).status_code)
    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join(120) for t in threads]
    assert sorted(results) == [200, 429, 429, 429], "only one of four simultaneous analyses may run"
    assert len(grader.calls) == 1 and len(rows(db, me.id)) == 1 and limit_row(db, me.id)["count"] == 1


# -- failures give the allowance back and leave nothing -------------------------------------------------

def test_when_the_video_cannot_be_graded_the_person_is_told_why_and_keeps_their_allowance(settings, db, storage, me):
    grader = FakeAnalyzer(error=SystemExit("We couldn't analyze that video — no one in frame. Please upload a clear clip of your full set and try again."))
    c = app_with(settings, db, storage, grader)
    r = analyze_post(c, me)
    assert r.status_code == 400 and r.get_json()["error"].startswith("We couldn't analyze that video — no one in frame.")
    assert_untouched(db, me.id)
    grader.error = None
    assert analyze_post(c, me).status_code == 200, "the failed attempt must not have used up today's analysis"


@pytest.mark.parametrize("code", [2, None, ""])
def test_a_failure_without_a_message_still_gets_a_plain_one(settings, db, storage, me, code):
    r = analyze_post(app_with(settings, db, storage, FakeAnalyzer(error=SystemExit(code))), me)
    assert r.status_code == 400 and r.get_json()["error"] == "We couldn't analyze that video."
    assert_untouched(db, me.id)


def test_an_unexpected_crash_is_a_generic_500_that_leaks_nothing_and_refunds_the_allowance(settings, db, storage, me):
    c = app_with(settings, db, storage, FakeAnalyzer(error=RuntimeError("secret internal detail: key=abc")))
    r = analyze_post(c, me)
    assert r.status_code == 500 and "secret" not in r.get_data(as_text=True)
    assert_untouched(db, me.id)


def test_if_saving_the_result_fails_the_stored_clip_is_removed_and_the_allowance_refunded(settings, db, storage, me, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("database fell over")
    monkeypatch.setattr(analyze, "save_result", boom)
    r = analyze_post(app_with(settings, db, storage, FakeAnalyzer()), me)
    assert r.status_code == 500 and "fell over" not in r.get_data(as_text=True)
    assert_untouched(db, me.id)


def test_a_refund_only_applies_to_the_window_it_was_charged_to(db, me):
    with db.connection() as conn:
        reservation = limits.reserve(conn, me.id, "workout_analysis")
        assert reservation.allowed
        conn.execute("update public.rate_limits set window_start = window_start + 1 where user_id = %s", (me.id,))   # the window moved on
        limits.refund(conn, me.id, "workout_analysis", reservation)
        assert conn.execute("select count from public.rate_limits where user_id = %s and feature = 'workout_analysis'", (me.id,)).fetchone()["count"] == 1


def test_a_refund_never_goes_below_zero_and_refunding_an_exempt_use_does_nothing(db, me):
    with db.connection() as conn:
        reservation = limits.reserve(conn, me.id, "workout_analysis")
        limits.refund(conn, me.id, "workout_analysis", reservation)
        limits.refund(conn, me.id, "workout_analysis", reservation)
        limits.refund(conn, me.id, "workout_analysis", limits.EXEMPT)
        assert conn.execute("select count from public.rate_limits where user_id = %s and feature = 'workout_analysis'", (me.id,)).fetchone()["count"] == 0


def test_the_limits_for_the_other_features_work_the_same_way(db, me):
    with db.connection() as conn:
        outcomes = [limits.reserve(conn, me.id, "ai_chat", now=1000 + i) for i in range(4)]
        assert [o.allowed for o in outcomes] == [True, True, True, False]
        assert outcomes[3].retry_after == 86400 - 3
        assert limits.reserve(conn, me.id, "ai_chat", now=1000 + 86400).allowed, "a new window opens after the old one ends"


# -- the clip is best-effort ---------------------------------------------------------------------------

class SpyStorage:
    def __init__(self, real, fail_upload=None, fail_remove=False):
        self.real, self.fail_upload, self.fail_remove = real, fail_upload, fail_remove
        self.uploads, self.removed = [], []

    def upload(self, *a, **k):
        self.uploads.append(a[1])
        if self.fail_upload:
            raise self.fail_upload
        return self.real.upload(*a, **k)

    def remove(self, bucket, keys):
        self.removed += list(keys)
        return list(keys) if self.fail_remove else self.real.remove(bucket, keys)

    def sign(self, *a, **k):
        return self.real.sign(*a, **k)


@pytest.mark.parametrize("failure", [SupabaseError("storage is down"), Refused("mime type not supported")])
def test_if_the_clip_cannot_be_stored_the_analysis_is_still_saved_without_one(settings, db, storage, me, failure):
    r = analyze_post(app_with(settings, db, SpyStorage(storage, fail_upload=failure), FakeAnalyzer()), me)
    body = r.get_json()
    assert r.status_code == 200 and body["video_url"] is None and body["overall_score"] == 72
    (row,) = rows(db, me.id)
    assert row["video_filename"] is None and objects_of(db, me.id) == []
    assert limit_row(db, me.id)["count"] == 1, "the analysis happened, so its allowance is spent"


def test_a_clip_larger_than_the_bucket_allows_is_not_even_attempted(settings, db, storage, me):
    spy = SpyStorage(storage)
    big = FakeAnalyzer(clip=b"\x00" * (analyze.MAX_CLIP_BYTES + 1))
    r = analyze_post(app_with(settings, db, spy, big), me)
    assert r.status_code == 200 and spy.uploads == [] and rows(db, me.id)[0]["video_filename"] is None


@pytest.mark.parametrize("grader", [FakeAnalyzer(clip=b""), FakeAnalyzer(write_clip=False)])
def test_an_empty_or_missing_trimmed_clip_is_not_stored(settings, db, storage, me, grader):
    spy = SpyStorage(storage)
    r = analyze_post(app_with(settings, db, spy, grader), me)
    assert r.status_code == 200 and spy.uploads == [] and rows(db, me.id)[0]["video_filename"] is None


# -- history, detail, latest, playback ----------------------------------------------------------------------

def seed(db, uid, n, *, clip_for=(), age=10):
    """n analyses, oldest first by index, created one minute apart and `age` minutes before now (the newest is 1 + age minutes
    old); rows listed in clip_for get a video_filename."""
    with db.connection() as conn:
        for i in range(n):
            conn.execute(
                "insert into public.analyze_results (user_id, exercise_label, overall_score, reps, feedback_text, video_filename, created_at) "
                "values (%s, %s, %s, %s, %s, %s, now() - make_interval(mins => %s))",
                (uid, f"Move {i}", 50 + i, i, FEEDBACK, f"seed-{i}.mp4" if i in clip_for else None, (n - i) + age))


def test_history_lists_the_newest_twenty_with_their_basics_and_only_the_callers(client, me, db):
    other = Person("historian")
    try:
        client.post("/api/profile", headers=bearer(other), json={"name": "Historian"})
        seed(db, me.id, 25, clip_for={24})
        seed(db, other.id, 3)
        entries = client.get("/api/analyze/history", headers=bearer(me)).get_json()["entries"]
        assert len(entries) == 20
        assert [e["exercise_label"] for e in entries][:3] == ["Move 24", "Move 23", "Move 22"], "newest first"
        assert entries[0]["has_video"] is True and entries[1]["has_video"] is False
        assert set(entries[0]) == {"id", "exercise_label", "overall_score", "reps", "created_at", "has_video"}
        assert dt.datetime.fromisoformat(entries[0]["created_at"]).tzinfo is not None
        assert len(client.get("/api/analyze/history", headers=bearer(other)).get_json()["entries"]) == 3
    finally:
        forget(other)


def test_history_is_empty_for_someone_who_has_never_analyzed(client, me):
    assert client.get("/api/analyze/history", headers=bearer(me)).get_json() == {"ok": True, "entries": []}


def test_ties_in_time_are_broken_newest_id_first(client, me, db):
    with db.connection() as conn:
        for i in range(3):
            conn.execute("insert into public.analyze_results (user_id, exercise_label, feedback_text, created_at) values (%s, %s, 'f', '2026-01-01T00:00:00Z')",
                         (me.id, f"Tie {i}"))
    assert [e["exercise_label"] for e in client.get("/api/analyze/history", headers=bearer(me)).get_json()["entries"]] == ["Tie 2", "Tie 1", "Tie 0"]
    assert client.get("/api/analyze/latest", headers=bearer(me)).get_json()["exercise_label"] == "Tie 2"


def test_one_stored_analysis_comes_back_in_the_shape_a_fresh_one_does_with_a_playable_clip(settings, db, storage, client, me):
    c = app_with(settings, db, storage, FakeAnalyzer())
    fresh = analyze_post(c, me).get_json()
    detail = client.get(f"/api/analyze/history/{fresh['id']}", headers=bearer(me)).get_json()
    assert set(detail) == set(fresh)
    assert {k: v for k, v in detail.items() if k != "video_url"} == {k: v for k, v in fresh.items() if k != "video_url"}
    assert HTTP.get(detail["video_url"], timeout=60).content == CLIP
    assert client.get("/api/analyze/latest", headers=bearer(me)).get_json()["id"] == fresh["id"]


def test_an_analysis_without_a_clip_has_no_video_link_and_no_playback(client, me, db):
    seed(db, me.id, 1)
    (row,) = rows(db, me.id)
    detail = client.get(f"/api/analyze/history/{row['id']}", headers=bearer(me)).get_json()
    assert detail["video_url"] is None
    assert client.get(f"/api/analyze/video/{row['id']}", headers=bearer(me)).status_code == 404


def test_a_row_whose_clip_has_vanished_degrades_to_no_video_instead_of_a_dead_link(client, me, db):
    seed(db, me.id, 1, clip_for={0})
    (row,) = rows(db, me.id)
    detail = client.get(f"/api/analyze/history/{row['id']}", headers=bearer(me))
    assert detail.status_code == 200 and detail.get_json()["video_url"] is None
    assert client.get(f"/api/analyze/video/{row['id']}", headers=bearer(me)).status_code == 404


def test_nobody_can_open_or_play_someone_elses_analysis_or_one_that_does_not_exist(settings, db, storage, client, me):
    snoop = Person("snoop")
    try:
        client.post("/api/profile", headers=bearer(snoop), json={"name": "Snoop"})
        fresh = analyze_post(app_with(settings, db, storage, FakeAnalyzer()), me).get_json()
        for path in (f"/api/analyze/history/{fresh['id']}", f"/api/analyze/video/{fresh['id']}", "/api/analyze/history/0",
                     f"/api/analyze/history/{fresh['id'] + 10**6}", f"/api/analyze/video/{fresh['id'] + 10**6}"):
            r = client.get(path, headers=bearer(snoop))
            assert r.status_code == 404 and "url" not in r.get_json() and "feedback_text" not in r.get_json(), path
        assert client.get("/api/analyze/latest", headers=bearer(snoop)).status_code == 404
        assert client.get("/api/analyze/history", headers=bearer(snoop)).get_json()["entries"] == []
    finally:
        forget(snoop)


def test_playback_gives_a_short_lived_link_to_the_callers_own_clip(settings, db, storage, client, me):
    fresh = analyze_post(app_with(settings, db, storage, FakeAnalyzer()), me).get_json()
    body = client.get(f"/api/analyze/video/{fresh['id']}", headers=bearer(me)).get_json()
    assert body["expires_in"] == 300 and body["url"].startswith("https://")
    assert HTTP.get(body["url"], timeout=60).content == CLIP
    ranged = HTTP.get(body["url"], headers={"Range": "bytes=0-9"}, timeout=60)
    assert ranged.status_code == 206 and ranged.content == CLIP[:10], "a player must be able to seek"


# -- keeping only the newest twenty --------------------------------------------------------------------

def put_clip(storage, uid, name):
    storage.upload("analyze-videos", f"{uid}/{name}", b"old clip", "video/mp4")


def test_the_twenty_first_analysis_pushes_out_the_oldest_with_its_clip_and_its_chat(settings, db, storage, me):
    seed(db, me.id, 20, clip_for={0, 1, 19})
    for i in (0, 1, 19):
        put_clip(storage, me.id, f"seed-{i}.mp4")
    with db.connection() as conn:
        oldest = conn.execute("select id from public.analyze_results where user_id = %s and exercise_label = 'Move 0'", (me.id,)).fetchone()["id"]
        conn.execute("insert into public.analyze_chat_messages (user_id, client_id, analyze_result_id, role, body) values (%s, 'c1', %s, 'user', 'hi')",
                     (me.id, oldest))
    r = analyze_post(app_with(settings, db, storage, FakeAnalyzer()), me)
    assert r.status_code == 200
    labels = [x["exercise_label"] for x in rows(db, me.id)]
    assert len(labels) == 20 and "Move 0" not in labels and "Back Squat" in labels and "Move 1" in labels
    keys = sorted(k for _b, k in objects_of(db, me.id))
    assert f"{me.id}/seed-0.mp4" not in keys, "the pruned analysis's clip must go with it"
    assert f"{me.id}/seed-1.mp4" in keys and f"{me.id}/seed-19.mp4" in keys and len(keys) == 3
    with db.connection() as conn:
        assert conn.execute("select count(*) as n from public.analyze_chat_messages where user_id = %s", (me.id,)).fetchone()["n"] == 0, \
            "a pruned analysis takes its chat thread with it"


def test_exactly_twenty_is_kept_in_full_and_the_prune_is_only_for_the_one_over(settings, db, storage, me):
    seed(db, me.id, 19)
    assert analyze_post(app_with(settings, db, storage, FakeAnalyzer()), me).status_code == 200
    assert len(rows(db, me.id)) == 20, "19 + 1 = 20: nothing is pruned"
    assert analyze_post(app_with(settings, db, storage, FakeAnalyzer(), exempt=[me.email]), me).status_code == 200
    labels = [x["exercise_label"] for x in rows(db, me.id)]
    assert len(labels) == 20 and "Move 0" not in labels


@pytest.mark.parametrize("mine_age,theirs_age", [(10, 5000), (5000, 0)], ids=["theirs-older", "theirs-newer"])
def test_pruning_never_touches_another_persons_analyses_or_clips_whoever_is_newer(settings, db, storage, me, mine_age, theirs_age):
    """If the other person's analyses are NEWER, a prune that ordered everyone together would call all of mine stale and
    wipe my history; if they are older it would reach for theirs. Neither may happen."""
    other = Person("bystander")
    try:
        with db.connection() as conn:
            conn.execute("insert into public.profiles (id, name) values (%s, 'Bystander')", (other.id,))
        seed(db, other.id, 30, clip_for={0}, age=theirs_age)
        put_clip(storage, other.id, "seed-0.mp4")
        seed(db, me.id, 20, age=mine_age)
        analyze_post(app_with(settings, db, storage, FakeAnalyzer()), me)
        assert len(rows(db, other.id)) == 30 and objects_of(db, other.id) == [("analyze-videos", f"{other.id}/seed-0.mp4")]
        mine = [x["exercise_label"] for x in rows(db, me.id)]
        assert len(mine) == 20 and "Move 0" not in mine and "Back Squat" in mine, "my history was not pruned to exactly my newest 20"
    finally:
        forget(other)


def test_a_clip_that_will_not_delete_keeps_its_analysis_for_the_next_prune_to_retry(settings, db, storage, me):
    seed(db, me.id, 21, clip_for={0})              # 21 stored + 1 new = 22: two are over (Move 0 with a clip, Move 1 without)
    put_clip(storage, me.id, "seed-0.mp4")
    stuck = SpyStorage(storage, fail_remove=True)
    assert analyze_post(app_with(settings, db, stuck, FakeAnalyzer()), me).status_code == 200
    labels = [x["exercise_label"] for x in rows(db, me.id)]
    assert "Move 0" in labels and "Move 1" not in labels, "the analysis whose clip is stuck stays; the clip-less one goes"
    assert len(labels) == 21
    assert any(k.endswith("seed-0.mp4") for _b, k in objects_of(db, me.id))
    # a later analysis, with storage healthy again, finishes the job
    assert analyze_post(app_with(settings, db, storage, FakeAnalyzer(), exempt=[me.email]), me).status_code == 200
    labels = [x["exercise_label"] for x in rows(db, me.id)]
    assert len(labels) == 20 and "Move 0" not in labels
    assert not any(k.endswith("seed-0.mp4") for _b, k in objects_of(db, me.id))


def test_analyses_without_clips_are_pruned_without_asking_storage_to_delete_anything(settings, db, storage, me):
    seed(db, me.id, 22)
    spy = SpyStorage(storage)
    analyze_post(app_with(settings, db, spy, FakeAnalyzer()), me)
    assert len(rows(db, me.id)) == 20 and spy.removed == []


def test_a_failure_while_pruning_never_fails_the_analysis_that_triggered_it(settings, db, storage, me, monkeypatch):
    seed(db, me.id, 20)
    monkeypatch.setattr(analyze, "prune", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("prune failed")))
    r = analyze_post(app_with(settings, db, storage, FakeAnalyzer()), me)
    assert r.status_code == 200 and len(rows(db, me.id)) == 21
