"""The native API's accounts, against the REAL Supabase project: profile creation through the Flask app with real
access tokens, the display-name rules, deletion and restore, and the purge that removes a person's stored files
(through the Storage API) before their Auth user.

Same rules as test_supabase_rls.py: throwaway users only, skipped without SUPABASE_* in .env, everything removed in a
`finally`. Mutation-check any change here (CLAUDE.md).
"""

import datetime as dt
import re
import threading
import time
import types
import uuid

import pytest

from api import accounts
from api.app import create_app
from api.auth import Identity
from api.supabase_admin import SupabaseError
from api_support import (  # noqa: F401 -- the fixtures are used by name
    auth_admin, auth_user_exists, bearer, client, db, objects_of, person, profile_row, settings, storage)
from test_supabase_rls import ENV, Person, _admin_delete_user, needs_api, needs_db

pytestmark = [needs_api, needs_db]

BAD_NAME = None
try:
    import name_filter
    BAD_NAME = sorted(name_filter._BAD_WORDS)[0]
except Exception:                                        # noqa: BLE001
    pass


def identity(person, provider=None, **meta):
    claims = {"app_metadata": {"provider": provider} if provider else {}, "user_metadata": meta}
    return Identity(id=person.id, email=person.email, claims=claims)


# -- creating a profile --------------------------------------------------------------------------------

def test_every_route_refuses_a_forged_token(client, person):
    t = person.client.headers["Authorization"]
    forged = {"Authorization": t[:-6] + ("AAAAAA" if not t.endswith("AAAAAA") else "BBBBBB")}
    for method, path in (("get", "/api/profile"), ("post", "/api/profile"), ("post", "/api/account"),
                         ("delete", "/api/account"), ("post", "/api/account/restore")):
        r = getattr(client, method)(path, headers=forged, json={"name": "X"})
        assert r.status_code == 401, (method, path, r.status_code)


def test_there_is_no_profile_until_one_is_created(client, person):
    assert client.get("/api/profile", headers=bearer(person)).status_code == 404
    assert client.post("/api/account", headers=bearer(person), json={"name": "Nobody"}).status_code == 404
    assert client.delete("/api/account", headers=bearer(person)).status_code == 404


def test_the_first_call_creates_a_profile_with_a_friend_code_and_the_second_changes_nothing(client, person, db):
    r = client.post("/api/profile", headers=bearer(person), json={"name": "  Sam Lifter  "})
    body = r.get_json()
    assert r.status_code == 201 and body["created"] is True
    p = body["profile"]
    assert p["id"] == person.id and p["name"] == "Sam Lifter"
    assert re.fullmatch(r"RC-[0-9A-F]{6}", p["friend_code"])
    assert p["onboarding_completed"] is False and p["ai_consent"] is False and p["deleted_at"] is None

    again = client.post("/api/profile", headers=bearer(person), json={"name": "Someone Else"})
    assert again.status_code == 200 and again.get_json()["created"] is False
    assert again.get_json()["profile"]["name"] == "Sam Lifter" and again.get_json()["profile"]["friend_code"] == p["friend_code"]
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"] == p


def test_an_email_account_must_say_who_it_is(client, person):
    for body in ({}, {"name": None}, {"name": ""}, {"name": "   "}):
        r = client.post("/api/profile", headers=bearer(person), json=body)
        assert r.status_code == 400 and r.get_json()["error"] == "Please enter your name.", body
    assert client.get("/api/profile", headers=bearer(person)).status_code == 404


@pytest.mark.skipif(BAD_NAME is None, reason="name_filter has no blocklist to draw from")
def test_a_name_the_filter_blocks_creates_no_profile(client, person):
    r = client.post("/api/profile", headers=bearer(person), json={"name": BAD_NAME})
    assert r.status_code == 400 and "isn't allowed" in r.get_json()["error"]
    assert client.get("/api/profile", headers=bearer(person)).status_code == 404


@pytest.mark.parametrize("name", ["x" * 61, "a\x00b", "line\nbreak", "tab\there", "evil‮name", "bell\x07", 12345, ["Sam"], {"a": 1}])
def test_a_name_that_cannot_be_shown_to_everyone_is_refused(client, person, name):
    r = client.post("/api/profile", headers=bearer(person), json={"name": name})
    assert r.status_code == 400, name
    assert client.get("/api/profile", headers=bearer(person)).status_code == 404


def test_the_longest_allowed_name_and_an_emoji_name_are_kept(client, person):
    r = client.post("/api/profile", headers=bearer(person), json={"name": "Z" * 60})
    assert r.status_code == 201 and r.get_json()["profile"]["name"] == "Z" * 60


def test_an_emoji_name_with_joiners_is_allowed(client, person):
    name = "Sam \U0001F3CB️ \U0001F468‍\U0001F469‍\U0001F467"
    assert client.post("/api/profile", headers=bearer(person), json={"name": name}).get_json()["profile"]["name"] == name


def test_a_provider_account_without_a_typed_name_gets_the_providers_name(db, person):
    with db.connection() as conn:
        profile, created = accounts.ensure_profile(conn, identity(person, "google", full_name="Gina Google"))
    assert created and profile["name"] == "Gina Google"


@pytest.mark.skipif(BAD_NAME is None, reason="name_filter has no blocklist to draw from")
def test_a_provider_name_that_fails_the_filter_becomes_a_neutral_fallback_instead_of_blocking_sign_in(db, person):
    with db.connection() as conn:
        profile, _ = accounts.ensure_profile(conn, identity(person, "google", full_name=BAD_NAME))
    assert profile["name"] == "Google User"


@pytest.mark.parametrize("meta", [{}, {"full_name": ""}, {"full_name": 7}, {"name": None}])
def test_a_provider_account_with_no_usable_name_gets_the_fallback(db, person, meta):
    with db.connection() as conn:
        profile, _ = accounts.ensure_profile(conn, identity(person, "apple", **meta))
    assert profile["name"] == "Apple User"


def test_a_typed_name_wins_over_the_providers_and_is_still_filtered(db, person):
    with db.connection() as conn:
        profile, _ = accounts.ensure_profile(conn, identity(person, "google", full_name="Gina Google"), "Typed Name")
    assert profile["name"] == "Typed Name"


def test_two_simultaneous_first_calls_make_exactly_one_profile(settings, person, db):
    results, barrier = [], threading.Barrier(4)

    def call():
        barrier.wait()
        with db.connection() as conn:
            results.append(accounts.ensure_profile(conn, identity(person, "google", full_name="Race Runner")))
    threads = [threading.Thread(target=call) for _ in range(4)]
    [t.start() for t in threads]
    [t.join(60) for t in threads]
    assert len(results) == 4
    assert sum(1 for _p, created in results if created) == 1
    assert len({r[0]["friend_code"] for r in results}) == 1
    with db.connection() as conn:
        assert conn.execute("select count(*) as n from public.profiles where id = %s", (person.id,)).fetchone()["n"] == 1


def test_a_friend_code_collision_draws_another_instead_of_failing(db, person, monkeypatch):
    other = Person("code")
    try:
        with db.connection() as conn:
            taken, _ = accounts.ensure_profile(conn, identity(other, "google", full_name="Taken Code"))
        draws = iter([taken["friend_code"][3:].lower(), taken["friend_code"][3:].lower(), "abcdef"])
        monkeypatch.setattr(accounts.secrets, "token_hex", lambda n: next(draws))
        with db.connection() as conn:
            mine, created = accounts.ensure_profile(conn, identity(person, "google", full_name="Me Too"))
        assert created and mine["friend_code"] == "RC-ABCDEF" and mine["friend_code"] != taken["friend_code"]
    finally:
        _admin_delete_user(other.id)


# -- renaming ------------------------------------------------------------------------------------------

def test_a_name_can_be_changed_under_the_same_rules(client, person):
    client.post("/api/profile", headers=bearer(person), json={"name": "First Name"})
    assert client.post("/api/account", headers=bearer(person), json={"name": " Second Name "}).status_code == 200
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["name"] == "Second Name"
    for bad in ("", "  ", "x" * 61, "a\x00", None, 5):
        r = client.post("/api/account", headers=bearer(person), json={"name": bad})
        assert r.status_code == 400, bad
    assert client.post("/api/account", headers=bearer(person), json={}).status_code == 400
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["name"] == "Second Name"


@pytest.mark.skipif(BAD_NAME is None, reason="name_filter has no blocklist to draw from")
def test_renaming_to_a_blocked_name_is_refused(client, person):
    client.post("/api/profile", headers=bearer(person), json={"name": "Fine Name"})
    r = client.post("/api/account", headers=bearer(person), json={"name": BAD_NAME})
    assert r.status_code == 400
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["name"] == "Fine Name"


# -- scheduling and restoring a deletion ----------------------------------------------------------------

def test_deleting_an_account_starts_the_grace_period_once_and_restore_ends_it(client, person, db):
    client.post("/api/profile", headers=bearer(person), json={"name": "Leaving Soon"})
    first = client.delete("/api/account", headers=bearer(person)).get_json()
    assert first["ok"] and first["grace_days"] == accounts.GRACE_DAYS == 30
    started = dt.datetime.fromisoformat(first["deleted_at"])
    assert abs((dt.datetime.now(dt.timezone.utc) - started).total_seconds()) < 60
    assert first["due_at"] == (started + dt.timedelta(days=30)).astimezone(dt.timezone.utc).date().isoformat()

    time.sleep(1.1)
    second = client.delete("/api/account", headers=bearer(person)).get_json()
    assert second["deleted_at"] == first["deleted_at"], "asking again must not push the purge back"
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["deleted_at"] == first["deleted_at"]

    assert client.post("/api/account/restore", headers=bearer(person)).get_json() == {"ok": True}
    assert client.get("/api/profile", headers=bearer(person)).get_json()["profile"]["deleted_at"] is None
    assert client.post("/api/account/restore", headers=bearer(person)).status_code == 200, "restoring nothing is harmless"


def test_the_account_keeps_working_during_the_grace_period(client, person):
    client.post("/api/profile", headers=bearer(person), json={"name": "Still Here"})
    client.delete("/api/account", headers=bearer(person))
    assert client.get("/api/profile", headers=bearer(person)).status_code == 200
    assert client.post("/api/account", headers=bearer(person), json={"name": "Still Here 2"}).status_code == 200


def test_the_grace_period_here_equals_the_websites(settings):
    import re as _re
    from pathlib import Path
    source = (Path(__file__).resolve().parent.parent / "database.py").read_text(encoding="utf-8")
    assert int(_re.search(r"^ACCOUNT_DELETION_GRACE_DAYS = (\d+)", source, _re.M).group(1)) == accounts.GRACE_DAYS


# -- one account's actions never touch another's -------------------------------------------------------

def test_renaming_scheduling_and_restoring_one_account_leaves_every_other_account_alone(client, person, db):
    pending, idle = Person("pending"), Person("idle")
    try:
        client.post("/api/profile", headers=bearer(person), json={"name": "Actor"})
        client.post("/api/profile", headers=bearer(pending), json={"name": "Pending"})
        client.post("/api/profile", headers=bearer(idle), json={"name": "Idle"})
        with db.connection() as conn:
            conn.execute("update public.profiles set deleted_at = now() where id = %s", (pending.id,))
        before = {p.id: profile_row(db, p.id) for p in (pending, idle)}

        def untouched():
            return all(profile_row(db, p.id) == before[p.id] for p in (pending, idle))
        client.post("/api/account", headers=bearer(person), json={"name": "Actor Renamed"})
        assert untouched(), "renaming one account changed another"
        client.delete("/api/account", headers=bearer(person))
        assert untouched() and profile_row(db, person.id)["deleted_at"] is not None, "scheduling one deletion touched another"
        client.post("/api/account/restore", headers=bearer(person))
        assert untouched(), "restoring one account restored another"
        assert profile_row(db, person.id)["deleted_at"] is None
    finally:
        _admin_delete_user(pending.id)
        _admin_delete_user(idle.id)


# -- the purge -----------------------------------------------------------------------------------------

PHOTO, CLIP = b"\xff\xd8photo", b"\x00\x00\x00\x18ftypmp42clip"


def seed_person(db, storage, label, *, objects=2):
    """A person with a profile, rows in several tables, a photo and a clip that rows point at, and stray files that
    no row points at. Returns the Person and the list of (bucket, key)."""
    p = Person(label)
    with db.connection() as conn:
        conn.execute("insert into public.profiles (id, name) values (%s, %s)", (p.id, f"Purge {label}"))
        conn.execute("insert into public.progress_photos (user_id, date, angle, filename) values (%s, current_date, 'front', 'p.jpg')", (p.id,))
        conn.execute("insert into public.analyze_results (user_id, exercise_label, feedback_text, video_filename) values (%s, 'Squat', 'f', 'v.mp4')", (p.id,))
        conn.execute("insert into public.user_settings (user_id, theme) values (%s, 'dark')", (p.id,))
        conn.execute("insert into public.weight_entries (user_id, log_date, kg, logged_at) values (%s, current_date, 80, now())", (p.id,))
    stored = [("progress-photos", f"{p.id}/p.jpg"), ("analyze-videos", f"{p.id}/v.mp4")]
    storage.upload(*stored[0], PHOTO, "image/jpeg")
    storage.upload(*stored[1], CLIP, "video/mp4")
    for i in range(objects - 2):
        key = f"{p.id}/stray-{i}.jpg"
        storage.upload("progress-photos", key, PHOTO, "image/jpeg")
        stored.append(("progress-photos", key))
    return p, stored


def expire(db, uid, days=31):
    with db.connection() as conn:
        conn.execute("update public.profiles set deleted_at = now() - make_interval(days => %s) where id = %s", (days, uid))


def cleanup(db, storage, people):
    for p in people:
        for bucket, key in objects_of(db, p.id):
            storage.remove(bucket, [key])
        _admin_delete_user(p.id)


def test_a_purge_removes_the_files_the_auth_user_and_every_row_of_the_person_and_only_theirs(db, storage, auth_admin):
    gone, stays = None, None
    try:
        gone, gone_objects = seed_person(db, storage, "gone", objects=4)
        stays, stays_objects = seed_person(db, storage, "stays")
        with db.connection() as conn:
            conn.execute("insert into public.friends (user_id, friend_id) values (%s, %s), (%s, %s)", (gone.id, stays.id, stays.id, gone.id))
            conn.execute("insert into public.blocked_users (user_id, blocked_id) values (%s, %s)", (stays.id, gone.id))
            conn.execute("insert into public.content_reports (reporter_id, reported_id, reason) values (%s, %s, 'spam')", (stays.id, gone.id))
        assert len(objects_of(db, gone.id)) == 4
        expire(db, gone.id)

        purged, failed = accounts.purge_due(db, storage, auth_admin, only=[gone.id, stays.id])
        assert purged == [gone.id] and not failed
        assert objects_of(db, gone.id) == [] and not auth_user_exists(gone.id)
        assert profile_row(db, gone.id) is None
        with db.connection() as conn:
            for table, col in (("progress_photos", "user_id"), ("analyze_results", "user_id"), ("user_settings", "user_id"),
                               ("weight_entries", "user_id"), ("friends", "friend_id"), ("blocked_users", "blocked_id"),
                               ("content_reports", "reported_id")):
                assert conn.execute(f"select count(*) as n from public.{table} where {col} = %s", (gone.id,)).fetchone()["n"] == 0, table
            # the other person lost nothing but the links to the one who left
            assert conn.execute("select count(*) as n from public.friends where user_id = %s or friend_id = %s", (stays.id, stays.id)).fetchone()["n"] == 0
            assert conn.execute("select count(*) as n from public.progress_photos where user_id = %s", (stays.id,)).fetchone()["n"] == 1
        assert sorted(objects_of(db, stays.id)) == sorted(stays_objects) and auth_user_exists(stays.id)
        assert storage.download("progress-photos", stays_objects[0][1]) == PHOTO
    finally:
        cleanup(db, storage, [p for p in (gone, stays) if p])


def test_nobody_is_purged_before_the_grace_period_is_over_or_after_restoring(db, storage, auth_admin):
    fresh = early = restored = None
    try:
        fresh, _ = seed_person(db, storage, "fresh")
        early, _ = seed_person(db, storage, "early")
        restored, _ = seed_person(db, storage, "restored")
        with db.connection() as conn:
            accounts.schedule_deletion(conn, fresh.id)
        expire(db, early.id, days=29)
        expire(db, restored.id, days=60)
        with db.connection() as conn:
            accounts.cancel_deletion(conn, restored.id)
        ids = [fresh.id, early.id, restored.id]
        assert accounts.purge_due(db, storage, auth_admin, only=ids) == ([], [])
        for p in (fresh, early, restored):
            assert profile_row(db, p.id) is not None and auth_user_exists(p.id) and len(objects_of(db, p.id)) == 2
    finally:
        cleanup(db, storage, [p for p in (fresh, early, restored) if p])


def test_the_cutoff_is_exact_to_the_second(db, storage, auth_admin):
    p = None
    try:
        p, _ = seed_person(db, storage, "edge")
        with db.connection() as conn:
            conn.execute("update public.profiles set deleted_at = now() - interval '30 days' + interval '20 seconds' where id = %s", (p.id,))
        assert accounts.purge_due(db, storage, auth_admin, only=[p.id]) == ([], [])
        with db.connection() as conn:
            conn.execute("update public.profiles set deleted_at = now() - interval '30 days' - interval '1 second' where id = %s", (p.id,))
        assert accounts.purge_due(db, storage, auth_admin, only=[p.id]) == ([p.id], [])
    finally:
        if p:
            cleanup(db, storage, [p])


class FlakyStorage:
    """Delegates to the real Storage but refuses to remove chosen keys."""

    def __init__(self, real, refuse=()):
        self.real, self.refuse = real, set(refuse)

    def remove(self, bucket, keys):
        blocked = [k for k in keys if k in self.refuse]
        self.real.remove(bucket, [k for k in keys if k not in self.refuse])
        return blocked


class LyingStorage:
    """Says every delete worked and deletes nothing."""

    def remove(self, bucket, keys):
        return []


def test_a_storage_service_that_claims_success_but_leaves_files_does_not_get_the_person_deleted(db, storage, auth_admin):
    p = None
    try:
        p, _ = seed_person(db, storage, "liar")
        expire(db, p.id)
        assert accounts.purge_due(db, LyingStorage(), auth_admin, only=[p.id]) == ([], [p.id])
        assert auth_user_exists(p.id) and profile_row(db, p.id) is not None and len(objects_of(db, p.id)) == 2
    finally:
        if p:
            cleanup(db, storage, [p])


def test_if_a_file_will_not_go_the_person_is_left_in_place_and_the_next_sweep_finishes_the_job(db, storage, auth_admin):
    p = None
    try:
        p, stored = seed_person(db, storage, "stuck", objects=3)
        expire(db, p.id)
        flaky = FlakyStorage(storage, refuse=[stored[1][1]])
        purged, failed = accounts.purge_due(db, flaky, auth_admin, only=[p.id])
        assert failed == [p.id] and p.id not in purged
        assert auth_user_exists(p.id) and profile_row(db, p.id) is not None, "the account must survive a half-done purge"
        assert [k for _b, k in objects_of(db, p.id)] == [stored[1][1]], "the files that could go, went"
        assert accounts.purge_due(db, storage, auth_admin, only=[p.id]) == ([p.id], [])
        assert not auth_user_exists(p.id) and objects_of(db, p.id) == []
    finally:
        if p:
            cleanup(db, storage, [p])


class BrokenAuthAdmin:
    def __init__(self, real, fail_for):
        self.real, self.fail_for = real, set(fail_for)

    def delete_user(self, uid):
        if uid in self.fail_for:
            raise SupabaseError("simulated outage")
        return self.real.delete_user(uid)


def test_one_persons_failure_never_stops_the_others_and_a_failed_auth_delete_is_retried(db, storage, auth_admin):
    a = b = None
    try:
        a, _ = seed_person(db, storage, "first")
        b, _ = seed_person(db, storage, "second")
        expire(db, a.id)
        expire(db, b.id)
        purged, failed = accounts.purge_due(db, storage, BrokenAuthAdmin(auth_admin, {a.id}), only=[a.id, b.id])
        assert failed == [a.id] and purged == [b.id]
        assert objects_of(db, a.id) == [], "a's files are already gone; only the Auth delete is outstanding"
        assert auth_user_exists(a.id) and not auth_user_exists(b.id)
        assert accounts.purge_due(db, storage, auth_admin, only=[a.id, b.id]) == ([a.id], [])
        assert not auth_user_exists(a.id)
    finally:
        cleanup(db, storage, [p for p in (a, b) if p])


def test_purging_a_person_with_no_files_works(db, storage, auth_admin):
    p = Person("nofiles")
    try:
        with db.connection() as conn:
            conn.execute("insert into public.profiles (id, name) values (%s, 'No Files')", (p.id,))
        expire(db, p.id)
        assert accounts.purge_due(db, storage, auth_admin, only=[p.id]) == ([p.id], [])
        assert not auth_user_exists(p.id) and profile_row(db, p.id) is None
    finally:
        _admin_delete_user(p.id)


def test_deleting_an_auth_user_that_is_already_gone_is_not_an_error(auth_admin):
    assert auth_admin.delete_user(str(uuid.uuid4())) is True


def test_a_sweep_restricted_to_some_ids_leaves_other_due_accounts_alone(db, storage, auth_admin):
    a = b = None
    try:
        a, _ = seed_person(db, storage, "scoped-a")
        b, _ = seed_person(db, storage, "scoped-b")
        expire(db, a.id)
        expire(db, b.id)
        assert accounts.purge_due(db, storage, auth_admin, only=[a.id]) == ([a.id], [])
        assert profile_row(db, b.id) is not None and auth_user_exists(b.id) and len(objects_of(db, b.id)) == 2
        assert accounts.purge_due(db, storage, auth_admin, only=[]) == ([], [])
    finally:
        cleanup(db, storage, [p for p in (a, b) if p])


def test_a_signed_in_client_cannot_make_itself_due_for_purge_or_skip_the_grace_period(client, person, db):
    """deleted_at is server-only: the DELETE route stamps it with the server's clock, whatever the body says."""
    client.post("/api/profile", headers=bearer(person), json={"name": "Sneaky"})
    r = client.delete("/api/account", headers=bearer(person), json={"deleted_at": "2000-01-01T00:00:00Z", "grace_days": 0})
    stamp = dt.datetime.fromisoformat(r.get_json()["deleted_at"])
    assert abs((dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()) < 60 and r.get_json()["grace_days"] == 30
    with db.connection() as conn:
        due = conn.execute("select count(*) as n from public.profiles where id = %s and deleted_at <= now() - interval '30 days'",
                           (person.id,)).fetchone()["n"]
    assert due == 0


# -- the lazy sweep ------------------------------------------------------------------------------------

def test_the_sweep_runs_at_startup_then_at_most_hourly_and_never_takes_a_request_down(settings, db, monkeypatch):
    calls = []
    gate = threading.Event()

    def fake_purge(*_a, **_k):
        calls.append(time.monotonic())
        gate.wait(timeout=3)              # a sweep that takes a while: callers must not wait for it
        if len(calls) == 2:
            raise RuntimeError("purge blew up")
        return [], []
    monkeypatch.setattr(accounts, "purge_due", fake_purge)
    clock = {"now": 1000.0}
    monkeypatch.setattr("api.app.time", types.SimpleNamespace(monotonic=lambda: clock["now"]))

    def wait_for(n):
        deadline = time.time() + 10
        while len(calls) < n and time.time() < deadline:
            time.sleep(0.05)
        return len(calls)
    started = time.time()
    app = create_app(settings, db=db, sweep=True)
    assert time.time() - started < 2, "the sweep ran on the caller's thread"
    assert wait_for(1) == 1, "one sweep at startup, before any request has arrived"
    c = app.test_client()
    assert c.get("/nope").status_code == 404
    gate.set()
    for _ in range(3):
        c.get("/nope")
    time.sleep(0.3)
    assert len(calls) == 1, "requests within the hour do not sweep again"
    clock["now"] += 3601
    assert c.get("/nope").status_code == 404
    assert wait_for(2) == 2
    clock["now"] += 3601
    assert c.get("/nope").status_code == 404, "a sweep that raised never reaches the caller"
    assert wait_for(3) == 3
