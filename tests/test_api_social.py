"""Friends, blocks, reports, the streak's dates, challenges, the leaderboards and HYROX results through the native API,
against the REAL Supabase project. The rep counter is a fake (no Gemini). Every refusal is checked for its EFFECT: no row,
no model call, no allowance spent. Mutation-check any change here (CLAUDE.md)."""

import contextlib
import dataclasses
import datetime as dt
import io
import threading
import time
from collections import defaultdict

import pytest

from api import ai, foods, limits, social
from api.app import create_app
from api_support import bearer, client, db, forget, person, settings, storage  # noqa: F401 -- the fixtures are used by name
from test_supabase_rls import Person, needs_api, needs_db

pytestmark = [needs_api, needs_db]

PUSHUPS = "pushups"


class RepFake:
    def __init__(self):
        self.calls, self.raises, self.delay = [], None, 0.0
        self.result = {"reps": 12, "rejected": 3, "notes": "Good depth."}

    def count_reps(self, video_path, exercise, trimmed_path):
        self.calls.append((exercise, video_path.read_bytes()))
        if self.delay:
            time.sleep(self.delay)
        if self.raises:
            raise self.raises
        return dict(self.result)


def app_with(settings, db, storage, fake=None):
    return create_app(settings, db=db, storage=storage, ai=fake or RepFake(), sweep=False).test_client()


@contextlib.contextmanager
def circle(c, *labels, profile=True, consent=True):
    """Throwaway people, each with a profile (and AI consent), removed afterwards."""
    people = []
    try:
        for label in labels:
            p = Person(label)
            people.append(p)
            if profile:
                assert c.post("/api/profile", headers=bearer(p), json={"name": label.title()}).status_code == 201
                if consent:
                    assert c.post("/api/ai-consent", headers=bearer(p), json={"granted": True}).status_code == 200
        yield people
    finally:
        for p in people:
            forget(p)


def code_of(db, uid):
    with db.connection() as conn:
        return conn.execute("select friend_code from public.profiles where id = %s", (uid,)).fetchone()["friend_code"]


def befriend(c, db, a, b):
    r = c.post("/api/friends/add", headers=bearer(a), json={"code": code_of(db, b.id)})
    assert r.status_code == 200, r.get_json()


def blocks(c, a, b):
    r = c.post("/api/safety/block", headers=bearer(a), json={"user_id": b.id})
    assert r.status_code == 200, r.get_json()


def sql(db, query, params=()):
    with db.connection() as conn:
        cur = conn.execute(query, params)
        return cur.fetchall() if cur.description else None


def friend_rows(db, uid):
    return sql(db, "select friend_id from public.friends where user_id = %s", (uid,))


def misses(db, uid):
    rows = sql(db, "select count from public.auth_throttle where key = %s", (f"friendcode:{uid}",))
    return rows[0]["count"] if rows else 0


# -- friends --------------------------------------------------------------------------------------------------------------------

def test_the_friends_list_needs_a_profile_and_starts_empty_with_the_callers_code(client, db, person):
    assert client.get("/api/friends", headers=bearer(person)).status_code == 404
    with circle(client, "solo") as (solo,):
        body = client.get("/api/friends", headers=bearer(solo)).get_json()
        assert body == {"ok": True, "code": code_of(db, solo.id), "friends": []} and body["code"].startswith("RC-")


def test_adding_by_code_makes_both_people_friends_and_a_second_add_changes_nothing(client, db):
    with circle(client, "ann", "bob") as (ann, bob):
        r = client.post("/api/friends/add", headers=bearer(ann), json={"code": "  " + code_of(db, bob.id).lower() + " "})
        assert r.status_code == 200 and r.get_json() == {"ok": True, "friend": {"id": bob.id, "name": "Bob"}}
        assert [f["name"] for f in client.get("/api/friends", headers=bearer(bob)).get_json()["friends"]] == ["Ann"], "Bob never added anyone: it is mutual"
        assert client.post("/api/friends/add", headers=bearer(ann), json={"code": code_of(db, bob.id)}).status_code == 200
        assert client.post("/api/friends/add", headers=bearer(bob), json={"code": code_of(db, ann.id)}).status_code == 200
        assert [f["name"] for f in client.get("/api/friends", headers=bearer(ann)).get_json()["friends"]] == ["Bob"]
        assert [f["name"] for f in client.get("/api/friends", headers=bearer(bob)).get_json()["friends"]] == ["Ann"]
        assert len(friend_rows(db, ann.id)) == 1 and len(friend_rows(db, bob.id)) == 1
        counted = sql(db, "select count from public.usage_events where user_id = %s and event = 'feature:friend_added'", (ann.id,))
        assert counted[0]["count"] == 2, "each successful add is counted"


def test_friends_are_listed_by_name(client, db):
    with circle(client, "zed", "amy", "kim") as (zed, amy, kim):
        befriend(client, db, zed, kim)
        befriend(client, db, zed, amy)
        assert [f["name"] for f in client.get("/api/friends", headers=bearer(zed)).get_json()["friends"]] == ["Amy", "Kim"]


@pytest.mark.parametrize("payload,status,message", [
    ({}, 400, "Enter a friend code."), ({"code": ""}, 400, "Enter a friend code."), ({"code": "   "}, 400, "Enter a friend code."),
    ({"code": None}, 400, "Enter a friend code."), ({"code": 12345}, 400, "Enter a friend code."), ({"code": ["RC-AAAAAA"]}, 400, "Enter a friend code."),
    ({"code": {"a": 1}}, 400, "Enter a friend code."), ({"code": "RC-NOSUCH"}, 404, "No user found with that code."),
    ({"code": "R" * 500}, 404, "No user found with that code."),
])
def test_a_bad_code_is_refused_and_creates_no_friendship(client, db, payload, status, message):
    with circle(client, "picky") as (me,):
        r = client.post("/api/friends/add", headers=bearer(me), json=payload)
        assert r.status_code == status and r.get_json() == {"ok": False, "error": message} and friend_rows(db, me.id) == []


def test_your_own_code_is_refused_and_does_not_count_as_a_guess(client, db):
    with circle(client, "narcissus") as (me,):
        r = client.post("/api/friends/add", headers=bearer(me), json={"code": code_of(db, me.id)})
        assert r.status_code == 400 and r.get_json()["error"] == "That's your own code." and misses(db, me.id) == 0


def test_adding_needs_a_profile(client, person):
    assert client.post("/api/friends/add", headers=bearer(person), json={"code": "RC-AAAAAA"}).status_code == 404


def test_a_wrong_code_is_counted_even_though_the_request_fails_and_a_right_one_is_not(client, db):
    with circle(client, "counter", "target") as (me, target):
        client.post("/api/friends/add", headers=bearer(me), json={"code": "RC-WRONG1"})
        client.post("/api/friends/add", headers=bearer(me), json={"code": "RC-WRONG2"})
        assert misses(db, me.id) == 2
        befriend(client, db, me, target)
        assert misses(db, me.id) == 2, "finding a real code is not a guess"


def test_thirty_wrong_codes_lock_further_tries_for_the_window_with_the_websites_message(client, db):
    with circle(client, "guesser", "victim") as (me, victim):
        sql(db, "insert into public.auth_throttle (key, window_start, count) values (%s, %s, %s)",
            (f"friendcode:{me.id}", int(time.time()) - 600, social.FRIEND_CODE_GUESS_LIMIT - 1))
        assert client.post("/api/friends/add", headers=bearer(me), json={"code": "RC-WRONG1"}).status_code == 404
        r = client.post("/api/friends/add", headers=bearer(me), json={"code": code_of(db, victim.id)})
        assert r.status_code == 429 and r.get_json() == {"ok": False, "error": "Too many friend codes tried. Please wait about 50 minutes and try again."}
        assert 2900 <= int(r.headers["Retry-After"]) <= 3010 and friend_rows(db, me.id) == [], "a locked person cannot add even a real code"
        assert misses(db, me.id) == 30, "a refused try is not another miss"


def test_the_guess_budget_is_per_person_and_resets_when_the_window_ends(client, db):
    with circle(client, "locked", "free", "target") as (locked, free, target):
        sql(db, "insert into public.auth_throttle (key, window_start, count) values (%s, %s, %s)",
            (f"friendcode:{locked.id}", int(time.time()) - 60, 30))
        assert client.post("/api/friends/add", headers=bearer(locked), json={"code": code_of(db, target.id)}).status_code == 429
        assert client.post("/api/friends/add", headers=bearer(free), json={"code": code_of(db, target.id)}).status_code == 200
        sql(db, "update public.auth_throttle set window_start = %s where key = %s", (int(time.time()) - social.FRIEND_CODE_GUESS_WINDOW, f"friendcode:{locked.id}"))
        assert client.post("/api/friends/add", headers=bearer(locked), json={"code": code_of(db, target.id)}).status_code == 200
        client.post("/api/friends/add", headers=bearer(locked), json={"code": "RC-WRONG1"})
        assert misses(db, locked.id) == 1, "a new window starts from one"
        client.post("/api/friends/add", headers=bearer(locked), json={"code": "RC-WRONG2"})
        assert misses(db, locked.id) == 2, "and counts up from there: the window start must have moved"
        start = sql(db, "select window_start from public.auth_throttle where key = %s", (f"friendcode:{locked.id}",))[0]["window_start"]
        assert start > int(time.time()) - 120


def test_simultaneous_wrong_guesses_are_all_counted(settings, db, storage):
    c = app_with(settings, db, storage)
    with circle(c, "burst") as (me,):
        gate = threading.Barrier(6)

        def guess(n):
            gate.wait()
            c.post("/api/friends/add", headers=bearer(me), json={"code": f"RC-NOPE{n}"})
        threads = [threading.Thread(target=guess, args=(n,)) for n in range(6)]
        [t.start() for t in threads]
        [t.join(120) for t in threads]
        assert misses(db, me.id) == 6


def test_a_guess_waits_for_the_persons_other_guesses_so_the_budget_cannot_be_raced(db, client):
    with circle(client, "serial") as (me,):
        outcome = {}

        def second():
            with db.connection() as conn:
                try:
                    social.add_by_code(conn, me.id, "RC-NOPE00", int(time.time()))
                except social.Rejected as rejected:
                    outcome["status"] = rejected.status
        with db.connection() as first:
            foods.lock(first, "friendcode", me.id)
            worker = threading.Thread(target=second)
            worker.start()
            worker.join(2.5)
            assert worker.is_alive() and "status" not in outcome, "the second guess did not wait for the lock"
        worker.join(30)
        assert outcome == {"status": 404}


def test_a_blocked_person_is_answered_like_an_unknown_code_from_either_side(client, db):
    with circle(client, "blocker", "blocked") as (a, b):
        blocks(client, a, b)
        for who, other in ((a, b), (b, a)):
            r = client.post("/api/friends/add", headers=bearer(who), json={"code": code_of(db, other.id)})
            assert r.status_code == 404 and r.get_json() == {"ok": False, "error": "No user found with that code."}
        assert friend_rows(db, a.id) == [] and friend_rows(db, b.id) == []


def test_blocking_a_friend_hides_each_from_the_other_and_unblocking_brings_the_friendship_back(client, db):
    with circle(client, "pal", "other") as (a, b):
        befriend(client, db, a, b)
        blocks(client, a, b)
        assert client.get("/api/friends", headers=bearer(a)).get_json()["friends"] == []
        assert client.get("/api/friends", headers=bearer(b)).get_json()["friends"] == [], "the blocked side must not see the blocker either"
        client.delete("/api/safety/block", headers=bearer(a), json={"user_id": b.id})
        assert [f["name"] for f in client.get("/api/friends", headers=bearer(a)).get_json()["friends"]] == ["Other"], "the friendship itself was never removed"


# -- blocks ------------------------------------------------------------------------------------------------------------------------

def test_blocking_records_one_row_for_the_caller_and_never_echoes_a_name(client, db):
    with circle(client, "wall", "target") as (a, b):
        for _ in range(2):
            r = client.post("/api/safety/block", headers=bearer(a), json={"user_id": b.id.upper()})
            assert r.status_code == 200 and r.get_json() == {"ok": True, "blocked": {"id": b.id}}
        assert [str(r["blocked_id"]) for r in sql(db, "select blocked_id from public.blocked_users where user_id = %s", (a.id,))] == [b.id]
        assert sql(db, "select 1 as one from public.blocked_users where user_id = %s", (b.id,)) == []
        assert sql(db, "select count from public.usage_events where user_id = %s and event = 'feature:block_user'", (a.id,))[0]["count"] == 2


@pytest.mark.parametrize("target,status,message", [
    (None, 404, "That account no longer exists."), ("nope", 404, "That account no longer exists."), (5, 404, "That account no longer exists."),
    ([1], 404, "That account no longer exists."), ("00000000-0000-0000-0000-000000000000", 404, "That account no longer exists."),
])
def test_blocking_an_account_that_does_not_exist_is_a_404_and_writes_nothing(client, db, target, status, message):
    with circle(client, "aimer") as (a,):
        r = client.post("/api/safety/block", headers=bearer(a), json={"user_id": target})
        assert r.status_code == status and r.get_json() == {"ok": False, "error": message}
        assert sql(db, "select 1 as one from public.blocked_users where user_id = %s", (a.id,)) == []


def test_you_cannot_block_or_report_yourself_and_both_need_a_profile(client, db, person):
    assert client.post("/api/safety/block", headers=bearer(person), json={"user_id": person.id}).status_code == 404
    with circle(client, "self") as (a,):
        r = client.post("/api/safety/block", headers=bearer(a), json={"user_id": a.id})
        assert r.status_code == 400 and r.get_json()["error"] == "You can't block yourself."
        r = client.post("/api/safety/report", headers=bearer(a), json={"user_id": a.id})
        assert r.status_code == 400 and r.get_json()["error"] == "You can't report yourself."
        assert sql(db, "select 1 as one from public.blocked_users where user_id = %s", (a.id,)) == []
        assert sql(db, "select 1 as one from public.content_reports where reporter_id = %s", (a.id,)) == []
        assert client.post("/api/safety/report", headers=bearer(person), json={"user_id": a.id}).status_code == 404


def test_the_block_list_shows_only_the_callers_own_blocks_newest_first(client, db):
    with circle(client, "lister", "first", "second", "stalker") as (a, first, second, stalker):
        blocks(client, a, first)
        time.sleep(0.05)
        blocks(client, a, second)
        blocks(client, stalker, a)
        listed = client.get("/api/safety/blocks", headers=bearer(a)).get_json()
        assert listed == {"ok": True, "blocked": [{"id": second.id, "name": "Second"}, {"id": first.id, "name": "First"}]}
        assert client.get("/api/safety/blocks", headers=bearer(first)).get_json() == {"ok": True, "blocked": []}


def test_unblocking_removes_only_the_callers_block_and_asks_which_account_when_unclear(client, db):
    with circle(client, "undo", "target", "other") as (a, b, c):
        blocks(client, a, b)
        blocks(client, b, a)
        for bad in ({}, {"user_id": "x"}, {"user_id": 3}, {"user_id": None}):
            r = client.delete("/api/safety/block", headers=bearer(a), json=bad)
            assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "Which account?"}
        assert client.delete("/api/safety/block", headers=bearer(a), json={"user_id": c.id}).get_json() == {"ok": True}
        assert client.delete("/api/safety/block", headers=bearer(a), json={"user_id": "11111111-2222-3333-4444-555555555555"}).get_json() == {"ok": True}
        assert len(sql(db, "select 1 as one from public.blocked_users where user_id = %s", (a.id,))) == 1
        assert client.delete("/api/safety/block", headers=bearer(a), json={"user_id": b.id}).get_json() == {"ok": True}
        assert sql(db, "select 1 as one from public.blocked_users where user_id = %s", (a.id,)) == []
        assert len(sql(db, "select 1 as one from public.blocked_users where user_id = %s", (b.id,))) == 1, "the other side's block must survive"


# -- reports -------------------------------------------------------------------------------------------------------------------------

def reports_by(db, uid):
    return sql(db, "select reporter_id, reported_id, reason, handled_at from public.content_reports where reporter_id = %s order by id", (uid,))


@pytest.mark.parametrize("reason,stored", [("offensive_name", "offensive_name"), ("impersonation", "impersonation"), ("spam", "spam"), ("other", "other"),
                                          ("  spam ", "spam"), ("made-up", "other"), (None, "other"), (5, "other"), (["spam"], "other"), ("", "other")])
def test_a_report_is_recorded_with_a_known_reason_and_blocks_the_account(client, db, reason, stored):
    with circle(client, "reporter", "culprit") as (a, b):
        r = client.post("/api/safety/report", headers=bearer(a), json={"user_id": b.id, "reason": reason})
        assert r.status_code == 200 and r.get_json() == {"ok": True, "blocked": {"id": b.id}}
        rows = reports_by(db, a.id)
        assert [(str(x["reported_id"]), x["reason"]) for x in rows] == [(b.id, stored)]
        assert sql(db, "select count from public.usage_events where user_id = %s and event = 'feature:report_user'", (a.id,))[0]["count"] == 1
        assert [x["id"] for x in client.get("/api/safety/blocks", headers=bearer(a)).get_json()["blocked"]] == [b.id]


def test_the_same_open_report_twice_is_one_report_but_a_new_one_after_it_was_handled_is_allowed(client, db):
    with circle(client, "repeat", "culprit", "third") as (a, b, c):
        for _ in range(3):
            client.post("/api/safety/report", headers=bearer(a), json={"user_id": b.id, "reason": "spam"})
        assert len(reports_by(db, a.id)) == 1
        client.post("/api/safety/report", headers=bearer(a), json={"user_id": c.id, "reason": "spam"})
        assert len(reports_by(db, a.id)) == 2, "a different account is a different report"
        sql(db, "update public.content_reports set handled_at = now() where reporter_id = %s", (a.id,))
        client.post("/api/safety/report", headers=bearer(a), json={"user_id": b.id, "reason": "spam"})
        assert len(reports_by(db, a.id)) == 3


def test_reporting_an_account_that_does_not_exist_files_nothing(client, db):
    with circle(client, "ghosthunter") as (a,):
        r = client.post("/api/safety/report", headers=bearer(a), json={"user_id": "00000000-0000-0000-0000-000000000001", "reason": "spam"})
        assert r.status_code == 404 and reports_by(db, a.id) == []


# -- AI reports -----------------------------------------------------------------------------------------------------------------------

def ai_reports(db, uid):
    return sql(db, "select feature, reason, reply_text, handled_at from public.ai_reports where user_id = %s order by id", (uid,))


@pytest.mark.parametrize("payload", [{}, {"reply": ""}, {"reply": "   "}, {"reply": None}, {"reply": 5}, {"reply": ["x"]}, {"reply": {"a": 1}}])
def test_an_empty_ai_report_is_refused(client, db, payload):
    with circle(client, "emptyhanded") as (a,):
        r = client.post("/api/ai-report", headers=bearer(a), json=payload)
        assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "Nothing to report."} and ai_reports(db, a.id) == []


@pytest.mark.parametrize("feature,reason,f_stored,r_stored", [
    ("coach", "harmful", "coach", "harmful"), ("workout_chat", "inaccurate", "workout_chat", "inaccurate"), ("analyze_chat", "offensive", "analyze_chat", "offensive"),
    ("  coach ", " other ", "coach", "other"), ("nonsense", "nonsense", "coach", "other"), (None, None, "coach", "other"), (5, 5, "coach", "other"), (["coach"], ["harmful"], "coach", "other"),
])
def test_an_ai_report_is_recorded_with_known_values(client, db, feature, reason, f_stored, r_stored):
    with circle(client, "ai") as (a,):
        r = client.post("/api/ai-report", headers=bearer(a), json={"reply": "  a bad answer ", "feature": feature, "reason": reason})
        assert r.status_code == 200 and r.get_json() == {"ok": True}
        assert [(x["feature"], x["reason"], x["reply_text"]) for x in ai_reports(db, a.id)] == [(f_stored, r_stored, "a bad answer")]
        assert sql(db, "select count from public.usage_events where user_id = %s and event = 'feature:report_ai_reply'", (a.id,))[0]["count"] == 1


def test_a_long_reply_is_clipped_and_the_same_reply_twice_is_one_report(client, db):
    with circle(client, "wordy") as (a,):
        for _ in range(2):
            client.post("/api/ai-report", headers=bearer(a), json={"reply": "y" * 9000})
        assert [len(x["reply_text"]) for x in ai_reports(db, a.id)] == [4000]
        client.post("/api/ai-report", headers=bearer(a), json={"reply": "another"})
        assert len(ai_reports(db, a.id)) == 2


def test_twenty_open_ai_reports_is_the_ceiling_and_handled_ones_make_room(client, db):
    with circle(client, "flooder", "other") as (a, b):
        for n in range(social.MAX_OPEN_AI_REPORTS_PER_USER):
            assert client.post("/api/ai-report", headers=bearer(a), json={"reply": f"r{n}"}).status_code == 200
        r = client.post("/api/ai-report", headers=bearer(a), json={"reply": "one more"})
        assert r.status_code == 429 and r.get_json() == {"ok": False, "error": "You have too many reports waiting for review."}
        assert len(ai_reports(db, a.id)) == 20
        assert client.post("/api/ai-report", headers=bearer(a), json={"reply": "r3"}).status_code == 200, "repeating an open report is not a new one"
        assert client.post("/api/ai-report", headers=bearer(b), json={"reply": "mine"}).status_code == 200, "the ceiling is per person"
        sql(db, "update public.ai_reports set handled_at = now() where user_id = %s and reply_text = 'r0'", (a.id,))
        assert client.post("/api/ai-report", headers=bearer(a), json={"reply": "one more"}).status_code == 200


def test_filing_reports_needs_a_profile(client, person):
    assert client.post("/api/ai-report", headers=bearer(person), json={"reply": "x"}).status_code == 404


def test_an_ai_report_waits_for_the_persons_other_reports_so_the_ceiling_cannot_be_raced(db, client):
    with circle(client, "queued") as (me,):
        outcome = {}

        def second():
            with db.connection() as conn:
                outcome["filed"] = social.report_ai_reply(conn, me.id, "coach", "other", "waiting")
        with db.connection() as first:
            foods.lock(first, "ai_reports", me.id)
            worker = threading.Thread(target=second)
            worker.start()
            worker.join(2.5)
            assert worker.is_alive() and "filed" not in outcome
        worker.join(30)
        assert outcome == {"filed": True}


def test_simultaneous_ai_reports_cannot_pass_the_ceiling(settings, db, storage):
    c = app_with(settings, db, storage)
    with circle(c, "swarm") as (a,):
        for n in range(social.MAX_OPEN_AI_REPORTS_PER_USER - 2):
            c.post("/api/ai-report", headers=bearer(a), json={"reply": f"seed{n}"})
        results, gate = [], threading.Barrier(5)

        def go(n):
            gate.wait()
            results.append(c.post("/api/ai-report", headers=bearer(a), json={"reply": f"racer{n}"}).status_code)
        threads = [threading.Thread(target=go, args=(n,)) for n in range(5)]
        [t.start() for t in threads]
        [t.join(120) for t in threads]
        assert sorted(results) == [200, 200, 429, 429, 429] and len(ai_reports(db, a.id)) == 20


# -- the streak's dates ---------------------------------------------------------------------------------------------------------------------

def seed_challenge(db, creator, exercise=PUSHUPS, created_at=None):
    return sql(db, "insert into public.challenges (creator_id, exercise, created_at) values (%s, %s, coalesce(%s, now())) returning id",
               (creator, exercise, created_at))[0]["id"]


def seed_submission(db, challenge_id, uid, reps, created_at=None, notes=None):
    sql(db, "insert into public.challenge_submissions (challenge_id, user_id, reps, notes, created_at) values (%s, %s, %s, %s, coalesce(%s, now()))",
        (challenge_id, uid, reps, notes, created_at))


def at(text):
    return dt.datetime.fromisoformat(text).replace(tzinfo=dt.timezone.utc)


def test_activity_dates_shift_server_times_into_the_callers_day_and_leave_photo_dates_alone(client, db):
    with circle(client, "streaker", "stranger") as (me, other):
        cid = seed_challenge(db, me.id)
        seed_submission(db, cid, me.id, 5, at("2026-03-01T23:30:00"))
        sql(db, "insert into public.analyze_results (user_id, exercise_label, feedback_text, created_at) values (%s, 'Squat', 'f', %s)", (me.id, at("2026-03-01T23:30:00")))
        sql(db, "insert into public.hyrox_results (user_id, gender, category, format, total_seconds, created_at) values (%s, 'men', 'open', 'singles', 4000, %s)", (me.id, at("2026-03-05T01:00:00")))
        sql(db, "insert into public.progress_photos (user_id, date, angle, filename) values (%s, '2026-03-01', 'front', 'x.jpg')", (me.id,))
        cid2 = seed_challenge(db, other.id)
        seed_submission(db, cid2, other.id, 9, at("2026-03-09T10:00:00"))
        sql(db, "insert into public.progress_photos (user_id, date, angle, filename) values (%s, '2026-03-09', 'front', 'theirs.jpg')", (other.id,))
        utc = client.get("/api/activity/dates", headers=bearer(me)).get_json()
        assert utc == {"ok": True, "dates": {"2026-03-01": ["analysis", "challenge", "checkin_photo"], "2026-03-05": ["hyrox"]}}
        plus7 = client.get("/api/activity/dates?tz_offset_minutes=420", headers=bearer(me)).get_json()["dates"]
        assert plus7 == {"2026-03-01": ["checkin_photo"], "2026-03-02": ["analysis", "challenge"], "2026-03-05": ["hyrox"]}
        minus5 = client.get("/api/activity/dates?tz_offset_minutes=-300", headers=bearer(me)).get_json()["dates"]
        assert minus5 == {"2026-03-01": ["analysis", "challenge", "checkin_photo"], "2026-03-04": ["hyrox"]}


@pytest.mark.parametrize("offset,expected_day", [("9999", "2026-03-02"), ("-9999", "2026-02-28"), ("abc", "2026-03-01"), ("", "2026-03-01"), ("60.5", "2026-03-01"), ("840", "2026-03-02"), ("-840", "2026-02-28")])
def test_a_wild_offset_is_clamped_to_real_timezones_or_means_utc(client, db, offset, expected_day):
    with circle(client, "clamped") as (me,):
        seed_submission(db, seed_challenge(db, me.id), me.id, 1, at("2026-03-01T12:00:00"))
        dates = client.get("/api/activity/dates?tz_offset_minutes=" + offset, headers=bearer(me)).get_json()["dates"]
        assert list(dates) == [expected_day]


def test_no_activity_is_an_empty_object(client, person):
    assert client.get("/api/activity/dates", headers=bearer(person)).get_json() == {"ok": True, "dates": {}}


# -- challenges: today's exercise, creating, listing -----------------------------------------------------------------------------------------

def test_today_names_the_rotating_exercise_and_whether_the_caller_attempted_it(client, db):
    with circle(client, "today") as (me,):
        body = client.get("/api/challenges/today", headers=bearer(me)).get_json()
        exercise = social.todays_exercise(["pushups", "situps", "pullups"])
        assert body == {"ok": True, "exercise": exercise, "label": {"pushups": "Push-ups", "situps": "Sit-ups", "pullups": "Pull-ups"}[exercise], "attempted": False}
        with circle(client, "rival") as (rival,):
            seed_submission(db, seed_challenge(db, rival.id, exercise), rival.id, 3)
            assert client.get("/api/challenges/today", headers=bearer(me)).get_json()["attempted"] is False, "someone else's attempt is not mine"
        seed_submission(db, seed_challenge(db, me.id, exercise), me.id, 3)
        assert client.get("/api/challenges/today", headers=bearer(me)).get_json()["attempted"] is True


def test_creating_a_challenge_uses_todays_exercise_and_is_refused_after_an_attempt(client, db):
    with circle(client, "maker") as (me,):
        exercise = social.todays_exercise(["pushups", "situps", "pullups"])
        r = client.post("/api/challenges", headers=bearer(me), json={"exercise": "pullups"})
        body = r.get_json()
        assert r.status_code == 200 and body["exercise"] == exercise and isinstance(body["id"], int)
        row = sql(db, "select exercise, duration_seconds, creator_id from public.challenges where id = %s", (body["id"],))[0]
        assert (row["exercise"], row["duration_seconds"], str(row["creator_id"])) == (exercise, 25, me.id), "the client cannot choose the exercise"
        seed_submission(db, body["id"], me.id, 4)
        r = client.post("/api/challenges", headers=bearer(me))
        assert r.status_code == 429 and r.get_json() == {"ok": False, "error": "You've already recorded today's attempt — come back tomorrow.", "limitReached": True}
        assert len(sql(db, "select 1 as one from public.challenges where creator_id = %s", (me.id,))) == 1


def test_creating_a_challenge_needs_a_profile(client, person):
    assert client.post("/api/challenges", headers=bearer(person)).status_code == 404


def test_the_challenge_ceiling_is_200_and_a_full_account_does_not_block_another(client, db):
    with circle(client, "packrat", "tidy") as (full, tidy):
        sql(db, "insert into public.challenges (creator_id, exercise) select %s, 'pushups' from generate_series(1, %s)", (full.id, social.CHALLENGE_LIMIT - 1))
        assert client.post("/api/challenges", headers=bearer(full)).status_code == 200
        r = client.post("/api/challenges", headers=bearer(full))
        assert r.status_code == 429 and r.get_json()["error"] == "You've reached the maximum of 200 saved items here. Delete some to add more."
        assert client.post("/api/challenges", headers=bearer(tidy)).status_code == 200


def test_creating_a_challenge_waits_for_the_persons_other_creates(client, db):
    with circle(client, "queue") as (me,):
        outcome = {}

        def second():
            with db.connection() as conn:
                outcome["id"] = social.create_challenge(conn, me.id, PUSHUPS)
        with db.connection() as first:
            foods.lock(first, "challenges", me.id)
            worker = threading.Thread(target=second)
            worker.start()
            worker.join(2.5)
            assert worker.is_alive() and "id" not in outcome
        worker.join(30)
        assert "id" in outcome


def test_challenges_list_mine_and_my_friends_newest_first_with_boards_and_nobody_else(client, db):
    with circle(client, "viewer", "friend", "stranger") as (me, friend, stranger):
        befriend(client, db, me, friend)
        old = seed_challenge(db, friend.id, "situps", at("2026-02-01T10:00:00"))
        new = seed_challenge(db, me.id, PUSHUPS, at("2026-02-03T10:00:00"))
        seed_challenge(db, stranger.id, PUSHUPS, at("2026-02-05T10:00:00"))
        seed_submission(db, new, me.id, 10, at("2026-02-03T11:00:00"), "mine")
        seed_submission(db, new, friend.id, 10, at("2026-02-03T10:30:00"))
        seed_submission(db, new, stranger.id, 99, at("2026-02-03T10:45:00"))
        seed_submission(db, old, friend.id, 7)
        body = client.get("/api/challenges", headers=bearer(me)).get_json()
        assert body["me"] == me.id and [c["id"] for c in body["challenges"]] == [new, old]
        first = body["challenges"][0]
        assert (first["exercise"], first["creator_name"], first["creator_id"], first["duration_seconds"]) == (PUSHUPS, "Viewer", me.id, 25)
        assert [(s["name"], s["reps"], s["notes"]) for s in first["leaderboard"]] == \
            [("Stranger", 99, None), ("Friend", 10, None), ("Viewer", 10, "mine")], "most reps first, the earlier attempt first on a tie"


def test_a_block_hides_the_creator_and_the_submitters_in_both_directions(client, db):
    with circle(client, "viewer", "friend", "pest") as (me, friend, pest):
        befriend(client, db, me, friend)
        befriend(client, db, me, pest)
        theirs = seed_challenge(db, pest.id)
        mine = seed_challenge(db, me.id)
        seed_submission(db, mine, pest.id, 50, notes="rude words")
        seed_submission(db, mine, friend.id, 5)
        blocks(client, me, pest)
        for who in (me, pest):
            body = client.get("/api/challenges", headers=bearer(who)).get_json()
            ids = [c["id"] for c in body["challenges"]]
            if who is me:
                assert ids == [mine] and [s["name"] for s in body["challenges"][0]["leaderboard"]] == ["Friend"] and theirs not in ids
                assert "rude words" not in str(body)
            else:
                assert theirs in ids and mine not in ids


# -- challenges: submitting a clip ------------------------------------------------------------------------------------------------------------

def submit(c, who, challenge_id, data=b"video-bytes", filename="clip.mp4", **kw):
    files = {} if data is None else {"video": (io.BytesIO(data), filename)}
    return c.post(f"/api/challenges/{challenge_id}/submit", headers=bearer(who), data=files, content_type="multipart/form-data", **kw)


def attempts(db, uid):
    return sql(db, "select challenge_id, reps, notes from public.challenge_submissions where user_id = %s order by created_at", (uid,))


def test_a_clip_is_counted_and_the_result_saved_with_the_websites_response(settings, db, storage):
    fake = RepFake()
    c = app_with(settings, db, storage, fake)
    with circle(c, "lifter") as (me,):
        cid = c.post("/api/challenges", headers=bearer(me)).get_json()["id"]
        r = submit(c, me, cid, b"the clip")
        assert r.status_code == 200 and r.get_json() == {"ok": True, "exercise": social.todays_exercise(["pushups", "situps", "pullups"]),
                                                          "reps": 12, "rejected": 3, "total": 15, "notes": "Good depth."}
        assert fake.calls == [(social.todays_exercise(["pushups", "situps", "pullups"]), b"the clip")]
        assert [(a["challenge_id"], a["reps"], a["notes"]) for a in attempts(db, me.id)] == [(cid, 12, "Good depth.")]
        assert sql(db, "select count from public.usage_events where user_id = %s and event = 'feature:challenge_submission'", (me.id,))[0]["count"] == 1
        assert client_today(c, me)["attempted"] is True
        assert sql(db, "select count from public.rate_limits where user_id = %s and feature like 'challenge:%%'", (me.id,))[0]["count"] == 1, "a graded attempt keeps the day's hold"


def client_today(c, who):
    return c.get("/api/challenges/today", headers=bearer(who)).get_json()


def test_a_second_attempt_the_same_day_is_refused_without_calling_the_model(settings, db, storage):
    fake = RepFake()
    c = app_with(settings, db, storage, fake)
    with circle(c, "eager") as (me,):
        cid = c.post("/api/challenges", headers=bearer(me)).get_json()["id"]
        assert submit(c, me, cid).status_code == 200
        r = submit(c, me, cid)
        assert r.status_code == 429 and r.get_json() == {"ok": False, "limitReached": True,
                                                          "error": "You've already recorded an attempt for this exercise today — try again tomorrow."}
        assert len(fake.calls) == 1 and len(attempts(db, me.id)) == 1


def test_a_submission_needs_a_profile_and_consent_and_reads_nothing_without_them(settings, db, storage, person):
    fake = RepFake()
    c = app_with(settings, db, storage, fake)
    assert submit(c, person, 1).status_code == 404
    with circle(c, "unconsented", consent=False) as (me,):
        cid = seed_challenge(db, me.id)
        r = submit(c, me, cid)
        assert r.status_code == 403 and r.get_json()["needs_ai_consent"] is True and fake.calls == [] and attempts(db, me.id) == []


def test_a_challenge_that_does_not_exist_or_is_not_visible_is_a_404_and_costs_nothing(settings, db, storage):
    fake = RepFake()
    c = app_with(settings, db, storage, fake)
    with circle(c, "snoop", "stranger") as (me, stranger):
        theirs = seed_challenge(db, stranger.id)
        for target in (987654321, theirs):
            r = submit(c, me, target)
            assert r.status_code == 404 and r.get_json() == {"ok": False, "error": "Challenge not found."}
        assert fake.calls == [] and attempts(db, me.id) == []
        assert limits_rows(db, me.id) == []


def limits_rows(db, uid):
    return sql(db, "select feature, count from public.rate_limits where user_id = %s and feature like 'challenge:%%'", (uid,))


def test_a_friends_challenge_can_be_submitted_to_but_not_once_they_are_blocked(settings, db, storage):
    fake = RepFake()
    c = app_with(settings, db, storage, fake)
    with circle(c, "joiner", "host") as (me, host):
        befriend(c, db, me, host)
        theirs = seed_challenge(db, host.id, PUSHUPS)
        blocks(c, host, me)
        assert submit(c, me, theirs).status_code == 404
        c.delete("/api/safety/block", headers=bearer(host), json={"user_id": me.id})
        assert submit(c, me, theirs).status_code == 200 and [a["challenge_id"] for a in attempts(db, me.id)] == [theirs]


@pytest.mark.parametrize("data,name,message", [(None, "", "No video uploaded."), (b"x", "", "No video uploaded."),
                                               (b"x", "clip.exe", "Unsupported video format."), (b"x", "clip", "Unsupported video format."),
                                               (b"x", "clip.mp4.txt", "Unsupported video format.")])
def test_a_missing_or_wrong_kind_of_file_is_a_400_before_anything_is_spent(settings, db, storage, data, name, message):
    fake = RepFake()
    c = app_with(settings, db, storage, fake)
    with circle(c, "fumbler") as (me,):
        cid = seed_challenge(db, me.id)
        r = submit(c, me, cid, data, name)
        assert r.status_code == 400 and r.get_json() == {"ok": False, "error": message} and fake.calls == [] and limits_rows(db, me.id) == []


@pytest.mark.parametrize("name", ["a.mp4", "a.MOV", "a.m4v", "a.avi", "a.mkv", "a.webm"])
def test_every_video_type_the_website_accepts_is_accepted(settings, db, storage, name):
    c = app_with(settings, db, storage)
    with circle(c, "format") as (me,):
        assert submit(c, me, seed_challenge(db, me.id), b"x", name).status_code == 200


def test_a_clip_the_counter_refuses_is_a_400_with_its_message_and_the_attempt_is_given_back(settings, db, storage):
    from api import ai as ai_module
    fake = RepFake()
    fake.raises = ai_module.RepCountFailed("We couldn't find anyone doing push-ups.")
    c = app_with(settings, db, storage, fake)
    with circle(c, "unlucky") as (me,):
        cid = seed_challenge(db, me.id)
        r = submit(c, me, cid)
        assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "We couldn't find anyone doing push-ups."}
        assert attempts(db, me.id) == [] and sum(x["count"] for x in limits_rows(db, me.id)) == 0
        fake.raises = None
        assert submit(c, me, cid).status_code == 200, "a failed attempt must not use up the day's attempt"


def test_a_crash_is_a_generic_500_that_leaks_nothing_and_gives_the_attempt_back(settings, db, storage):
    fake = RepFake()
    fake.raises = RuntimeError("secret detail")
    c = app_with(settings, db, storage, fake)
    with circle(c, "crashy") as (me,):
        cid = seed_challenge(db, me.id)
        r = submit(c, me, cid)
        assert r.status_code == 500 and "secret" not in r.get_data(as_text=True) and attempts(db, me.id) == []
        fake.raises = None
        assert submit(c, me, cid).status_code == 200


def test_simultaneous_submissions_reach_the_model_once(settings, db, storage):
    fake = RepFake()
    fake.delay = 1.2
    c = app_with(settings, db, storage, fake)
    with circle(c, "doubleclick") as (me,):
        cid = seed_challenge(db, me.id)
        results, gate = [], threading.Barrier(4)

        def go():
            gate.wait()
            results.append(submit(c, me, cid).status_code)
        threads = [threading.Thread(target=go) for _ in range(4)]
        [t.start() for t in threads]
        [t.join(120) for t in threads]
        assert sorted(results) == [200, 429, 429, 429] and len(fake.calls) == 1 and len(attempts(db, me.id)) == 1


def test_each_exercise_has_its_own_attempt_for_the_day_and_yesterdays_does_not_count(settings, db, storage):
    fake = RepFake()
    c = app_with(settings, db, storage, fake)
    with circle(c, "allrounder") as (me,):
        a = seed_challenge(db, me.id, "pushups")
        b = seed_challenge(db, me.id, "situps")
        assert submit(c, me, a).status_code == 200
        assert submit(c, me, b).status_code == 200, "a different exercise is a different attempt"
        assert submit(c, me, a).status_code == 429
        yesterday = seed_challenge(db, me.id, "pullups")
        seed_submission(db, yesterday, me.id, 4, dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1, hours=1))
        assert submit(c, me, seed_challenge(db, me.id, "pullups")).status_code == 200


def test_taking_the_days_attempt_sweeps_old_days_keys_but_not_todays_other_exercises(db, client):
    with circle(client, "sweeper") as (me,):
        today = dt.datetime.now(dt.timezone.utc).date().isoformat()
        for feature in ("challenge:pushups:2020-01-01", "challenge:situps:2020-01-01", f"challenge:situps:{today}"):
            sql(db, "insert into public.rate_limits (user_id, feature, window_start, count) values (%s, %s, 1, 1)", (me.id, feature))
        sql(db, "insert into public.rate_limits (user_id, feature, window_start, count) values (%s, 'workout_analysis', 1, 1)", (me.id,))
        with db.connection() as conn:
            assert limits.reserve_daily_attempt(conn, me.id, "pushups").allowed
        kept = sorted(r["feature"] for r in sql(db, "select feature from public.rate_limits where user_id = %s", (me.id,)))
        assert kept == sorted([f"challenge:pushups:{today}", f"challenge:situps:{today}", "workout_analysis"])


def test_the_days_attempt_is_taken_once_given_back_and_taken_again(db, client):
    with circle(client, "attempt") as (me,):
        with db.connection() as conn:
            first = limits.reserve_daily_attempt(conn, me.id, "pullups")
            assert first.allowed and not limits.reserve_daily_attempt(conn, me.id, "pullups").allowed
        with db.connection() as conn:
            assert limits.reserve_daily_attempt(conn, me.id, "situps").allowed, "another exercise is another attempt"
            limits.release_daily_attempt(conn, me.id, "pullups", first)
            assert limits.reserve_daily_attempt(conn, me.id, "pullups").allowed
            assert not limits.reserve_daily_attempt(conn, me.id, "pullups").allowed


def test_a_retake_keeps_the_better_score_in_the_database(client, db):
    with circle(client, "retaker") as (me,):
        cid = seed_challenge(db, me.id)
        with db.connection() as conn:
            social.save_submission(conn, cid, me.id, 10, "first")
            social.save_submission(conn, cid, me.id, 6, "worse")
        assert [(a["reps"], a["notes"]) for a in attempts(db, me.id)] == [(10, "first")]
        with db.connection() as conn:
            social.save_submission(conn, cid, me.id, 11, "better")
            social.save_submission(conn, cid, me.id, 11, "same")
        assert [(a["reps"], a["notes"]) for a in attempts(db, me.id)] == [(11, "better")]


# -- the reps leaderboard ----------------------------------------------------------------------------------------------------------------

def board(c, who, query=""):
    return c.get("/api/leaderboard" + query, headers=bearer(who)).get_json()


def test_the_friends_board_ranks_me_and_my_friends_by_total_reps_across_every_challenge(client, db):
    with circle(client, "me", "pal", "outsider") as (me, pal, outsider):
        befriend(client, db, me, pal)
        a, b = seed_challenge(db, me.id, "pushups"), seed_challenge(db, pal.id, "situps")
        seed_submission(db, a, me.id, 10, at("2026-02-01T10:00:00"))
        seed_submission(db, b, me.id, 5, at("2026-02-02T10:00:00"))
        seed_submission(db, b, pal.id, 20, at("2026-02-01T10:00:00"))
        seed_submission(db, a, outsider.id, 999, at("2026-02-01T10:00:00"))
        body = board(client, me)
        assert body["scope"] == "friends" and body["me"] == me.id and body["totalEntries"] == 2
        assert [(r["name"], r["total_reps"]) for r in body["leaderboard"]] == [("Pal", 20), ("Me", 15)]
        assert body["myRank"] == {"rank": 2, "total_reps": 15, "name": "Me"}


def test_a_tie_goes_to_whoever_got_there_first(client, db):
    with circle(client, "late", "early") as (late, early):
        befriend(client, db, late, early)
        c = seed_challenge(db, late.id)
        seed_submission(db, c, late.id, 8, at("2026-02-02T10:00:00"))
        seed_submission(db, c, early.id, 8, at("2026-02-01T10:00:00"))
        assert [r["name"] for r in board(client, late)["leaderboard"]] == ["Early", "Late"]


def test_the_global_board_includes_strangers_and_the_limit_does_not_change_my_rank(client, db):
    with circle(client, "low", "mid", "high") as (low, mid, high):
        c = seed_challenge(db, high.id)
        for who, reps in ((high, 2_000_000_000), (mid, 1_900_000_000), (low, 1_800_000_000)):
            seed_submission(db, c, who.id, reps)
        body = board(client, low, "?scope=global&limit=1")
        assert [r["name"] for r in body["leaderboard"]] == ["High"] and body["myRank"]["rank"] == 3 and body["totalEntries"] == 3
        assert body["scope"] == "global"
        mine_only = board(client, low, "?scope=bogus")
        assert [r["name"] for r in mine_only["leaderboard"]] == ["Low"], "any scope but global is the friends board"


def test_blocked_accounts_are_left_out_of_the_query_so_ranks_have_no_gaps(client, db):
    with circle(client, "viewer", "pest", "next") as (me, pest, nxt):
        c = seed_challenge(db, me.id)
        for who, reps in ((pest, 2_000_000_000), (nxt, 1_900_000_000), (me, 1_800_000_000)):
            seed_submission(db, c, who.id, reps)
        assert board(client, me, "?scope=global")["myRank"]["rank"] == 3
        blocks(client, me, pest)
        for who in (me, pest):
            body = board(client, who, "?scope=global")
            names = [r["name"] for r in body["leaderboard"]]
            assert ("Pest" not in names) if who is me else ("Viewer" not in names)
        assert board(client, me, "?scope=global")["myRank"]["rank"] == 2


def test_an_empty_board_has_no_rank(client, person):
    assert board(client, person) == {"ok": True, "scope": "friends", "me": person.id, "leaderboard": [], "totalEntries": 0, "myRank": None}


# -- HYROX results and their board -------------------------------------------------------------------------------------------------------------------

def post_result(c, who, **fields):
    return c.post("/api/hyrox/results", headers=bearer(who), json=fields)


def result_rows(db, uid):
    return sql(db, "select gender, category, format, total_seconds from public.hyrox_results where user_id = %s order by id", (uid,))


GOOD = dict(gender="men", category="open", format="singles", total_seconds=3600)


def test_a_plausible_result_is_recorded(client, db):
    with circle(client, "racer") as (me,):
        r = post_result(client, me, **GOOD)
        assert r.status_code == 200 and isinstance(r.get_json()["id"], int)
        assert [(x["gender"], x["category"], x["format"], x["total_seconds"]) for x in result_rows(db, me.id)] == [("men", "open", "singles", 3600.0)]
        assert post_result(client, me, **dict(GOOD, total_seconds="3601.5")).status_code == 200, "numbers as text are accepted like the website"


@pytest.mark.parametrize("seconds", [None, "x", "", [], {}, True, "nan", "inf", "-inf", "1e999"])
def test_an_unreadable_time_is_invalid(client, db, seconds):
    with circle(client, "badtime") as (me,):
        r = post_result(client, me, **dict(GOOD, total_seconds=seconds))
        assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "Invalid time."} and result_rows(db, me.id) == []


@pytest.mark.parametrize("literal", ["Infinity", "-Infinity", "NaN"])
def test_a_json_infinity_or_nan_is_not_a_time(client, db, literal):
    with circle(client, "literal") as (me,):
        body = '{"gender":"men","category":"open","format":"singles","total_seconds":' + literal + "}"
        r = client.post("/api/hyrox/results", headers=bearer(me), data=body, content_type="application/json")
        assert r.status_code == 400 and r.get_json()["error"] == "Invalid time." and result_rows(db, me.id) == []


@pytest.mark.parametrize("fields", [dict(gender="x"), dict(category="x"), dict(format="x"), dict(gender=None), dict(gender=["men"]), dict(format="single"), dict(gender="MEN")])
def test_an_unknown_gender_category_or_format_is_invalid(client, db, fields):
    with circle(client, "badcombo") as (me,):
        r = post_result(client, me, **dict(GOOD, **fields))
        assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "Invalid gender, category, or format."} and result_rows(db, me.id) == []


@pytest.mark.parametrize("gender,format_,floor", [("men", "singles", 3000), ("women", "singles", 3180), ("men", "doubles", 2820), ("women", "doubles", 3060)])
def test_the_plausibility_floor_depends_on_gender_and_format(client, db, gender, format_, floor):
    with circle(client, "floor") as (me,):
        base = dict(gender=gender, category="pro", format=format_)
        too_fast = post_result(client, me, **base, total_seconds=floor - 0.01)
        assert too_fast.status_code == 400 and too_fast.get_json() == {"ok": False, "error": "That time isn't a plausible race finish."}
        assert post_result(client, me, **base, total_seconds=floor).status_code == 200
        assert len(result_rows(db, me.id)) == 1


def test_a_time_over_a_day_is_not_a_race(client, db):
    with circle(client, "marathon") as (me,):
        assert post_result(client, me, **dict(GOOD, total_seconds=86400)).status_code == 200
        r = post_result(client, me, **dict(GOOD, total_seconds=86400.5))
        assert r.status_code == 400 and r.get_json()["error"] == "That time isn't a plausible race finish."


def test_results_need_a_profile(client, person):
    assert post_result(client, person, **GOOD).status_code == 404


def test_the_result_ceiling_is_500_and_per_person(client, db):
    with circle(client, "serial", "fresh") as (full, fresh):
        sql(db, "insert into public.hyrox_results (user_id, gender, category, format, total_seconds) select %s, 'men', 'open', 'singles', 4000 from generate_series(1, %s)",
            (full.id, social.HYROX_RESULT_LIMIT - 1))
        assert post_result(client, full, **GOOD).status_code == 200
        r = post_result(client, full, **GOOD)
        assert r.status_code == 429 and r.get_json()["error"] == "You've reached the maximum of 500 saved items here. Delete some to add more."
        assert post_result(client, fresh, **GOOD).status_code == 200


def test_recording_a_result_waits_for_the_persons_other_results(client, db):
    with circle(client, "queued") as (me,):
        outcome = {}

        def second():
            with db.connection() as conn:
                outcome["id"] = social.create_hyrox_result(conn, me.id, "men", "open", "singles", 4000.0)
        with db.connection() as first:
            foods.lock(first, "hyrox_results", me.id)
            worker = threading.Thread(target=second)
            worker.start()
            worker.join(2.5)
            assert worker.is_alive() and "id" not in outcome
        worker.join(30)
        assert "id" in outcome


def hyrox_board(c, who, gender="men", category="open", format_="singles"):
    return c.get(f"/api/hyrox/leaderboard?gender={gender}&category={category}&format={format_}", headers=bearer(who))


@pytest.mark.parametrize("query", ["", "?gender=men", "?gender=men&category=open", "?gender=x&category=open&format=singles", "?gender=men&category=open&format=single"])
def test_the_hyrox_board_needs_a_real_combination(client, person, query):
    r = client.get("/api/hyrox/leaderboard" + query, headers=bearer(person))
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "Invalid gender, category, or format."}


def test_the_hyrox_board_ranks_each_persons_best_for_that_exact_combination(client, db):
    with circle(client, "fast", "slow", "other") as (fast, slow, other):
        sql(db, "insert into public.hyrox_results (user_id, gender, category, format, total_seconds) values "
                "(%s,'men','open','singles',3300),(%s,'men','open','singles',3500),(%s,'men','open','singles',4100),"
                "(%s,'men','pro','singles',3100),(%s,'women','open','singles',3300),(%s,'men','open','doubles',3000)",
            (fast.id, fast.id, slow.id, slow.id, slow.id, slow.id))
        body = hyrox_board(client, slow).get_json()
        assert body["ok"] is True and body["totalEntries"] == 2
        assert [(r["name"], r["best_seconds"]) for r in body["leaderboard"]] == [("Fast", 3300.0), ("Slow", 4100.0)]
        assert body["me"] == {"rank": 2, "best_seconds": 4100.0, "name": "Slow"}
        assert hyrox_board(client, other).get_json()["me"] is None
        assert [r["name"] for r in hyrox_board(client, slow, "men", "pro").get_json()["leaderboard"]] == ["Slow"]
        assert [r["name"] for r in hyrox_board(client, slow, "men", "open", "doubles").get_json()["leaderboard"]] == ["Slow"]


def test_an_impossible_time_cannot_top_the_board_but_the_same_persons_real_time_still_ranks(client, db):
    with circle(client, "cheat", "honest", "ghost") as (cheat, honest, ghost):
        sql(db, "insert into public.hyrox_results (user_id, gender, category, format, total_seconds) values "
                "(%s,'men','open','singles',1200),(%s,'men','open','singles',3400),(%s,'men','open','singles',3300),(%s,'men','open','singles',1000),(%s,'men','open','singles',999999)",
            (cheat.id, cheat.id, honest.id, ghost.id, ghost.id))
        rows = hyrox_board(client, honest).get_json()["leaderboard"]
        assert [(r["name"], r["best_seconds"]) for r in rows] == [("Honest", 3300.0), ("Cheat", 3400.0)], "the floor applies before the best is taken; a person with only impossible times is absent"


def test_blocked_accounts_vanish_from_the_hyrox_board_in_both_directions_without_leaving_gaps(client, db):
    with circle(client, "viewer", "pest", "third") as (me, pest, third):
        sql(db, "insert into public.hyrox_results (user_id, gender, category, format, total_seconds) values "
                "(%s,'men','open','singles',3100),(%s,'men','open','singles',3200),(%s,'men','open','singles',3300)", (pest.id, third.id, me.id))
        assert hyrox_board(client, me).get_json()["me"]["rank"] == 3
        blocks(client, me, pest)
        for who in (me, pest):
            names = [r["name"] for r in hyrox_board(client, who).get_json()["leaderboard"]]
            assert ("Pest" not in names) if who is me else ("Viewer" not in names)
        assert hyrox_board(client, me).get_json()["me"]["rank"] == 2


def test_only_the_fastest_few_are_listed_but_the_total_and_my_rank_cover_everyone(client, db, monkeypatch):
    monkeypatch.setattr(social, "HYROX_LEADERBOARD_ROWS", 2)
    with circle(client, "first", "second", "last") as (first, second, last):
        sql(db, "insert into public.hyrox_results (user_id, gender, category, format, total_seconds) values "
                "(%s,'men','open','singles',3100),(%s,'men','open','singles',3200),(%s,'men','open','singles',20000)", (first.id, second.id, last.id))
        body = hyrox_board(client, last).get_json()
        assert [r["name"] for r in body["leaderboard"]] == ["First", "Second"] and body["totalEntries"] == 3
        assert body["me"] == {"rank": 3, "best_seconds": 20000.0, "name": "Last"}


def test_the_board_lists_fifty_unless_told_otherwise():
    assert social.HYROX_LEADERBOARD_ROWS == 50
