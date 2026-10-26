"""An imported account's old password, moved across at its first sign-in, against the REAL Supabase project: a throwaway
account with a random Auth password and an old scrypt hash waiting in `legacy_password_hashes`, the route, and then a real
Supabase password sign-in with the old password. Mutation-check any change here (CLAUDE.md)."""

import secrets
import threading
import time
import uuid

import pytest
import requests
from werkzeug.security import generate_password_hash

from api import legacy
from api.app import create_app
from api_support import bearer, client, db, forget, person, settings, storage  # noqa: F401 -- the fixtures are used by name
from test_supabase_rls import ENV, HTTP, Person, _admin_create_user, _admin_delete_user, _sign_in, _url, needs_api, needs_db

pytestmark = [needs_api, needs_db]

OLD = "Old-Password-123"
CALLER = "legacy-test-" + secrets.token_hex(4)


def sql(db, query, params=()):
    with db.connection() as conn:
        cur = conn.execute(query, params)
        return cur.fetchall() if cur.description else None


class Imported:
    """An account as the importer leaves it: a random Auth password nobody knows, a profile, and the old hash on the side."""

    def __init__(self, db, client, *, password=OLD, confirmed=True):
        self.email = f"rls-legacy-{uuid.uuid4().hex[:10]}@example.invalid"
        self.password = password
        response = HTTP.post(_url("/auth/v1/admin/users"), headers={"apikey": ENV["SUPABASE_SERVICE_ROLE_KEY"], "Content-Type": "application/json"},
                             json={"email": self.email, "password": secrets.token_urlsafe(24), "email_confirm": confirmed}, timeout=30)
        response.raise_for_status()
        self.id = response.json()["id"]
        self.db = db
        sql(db, "insert into public.profiles (id, name) values (%s, 'Imported')", (self.id,))
        sql(db, "insert into public.legacy_password_hashes (user_id, password_hash) values (%s, %s)", (self.id, generate_password_hash(password)))

    def has_old_hash(self):
        return bool(sql(self.db, "select 1 as one from public.legacy_password_hashes where user_id = %s", (self.id,)))

    def attempts(self, key=None):
        rows = sql(self.db, "select count from public.auth_throttle where key = %s", (key or legacy.email_key(self.email),))
        return rows[0]["count"] if rows else 0

    def drop(self):
        sql(self.db, "delete from public.auth_throttle where key in (%s, %s)", (legacy.email_key(self.email), legacy.caller_key(CALLER)))
        _admin_delete_user(self.id)


@pytest.fixture
def imported(db, client):
    account = Imported(db, client)
    try:
        yield account
    finally:
        account.drop()


@pytest.fixture(autouse=True)
def fresh_caller(db):
    sql(db, "delete from public.auth_throttle where key = %s", (legacy.caller_key(CALLER),))
    yield
    sql(db, "delete from public.auth_throttle where key = %s", (legacy.caller_key(CALLER),))


def attempt(c, email, password, caller=CALLER):
    return c.post("/api/auth/legacy-login", json={"email": email, "password": password}, headers={"X-Forwarded-For": caller})


def sign_in_works(email, password):
    try:
        _sign_in(email, password)
        return True
    except requests.HTTPError:
        return False


def test_the_old_password_becomes_the_real_one_and_the_old_hash_is_gone(client, db, imported):
    assert not sign_in_works(imported.email, imported.password), "before: nobody can sign in"
    r = attempt(client, imported.email, imported.password)
    assert r.status_code == 200 and r.get_json() == {"ok": True}
    assert sign_in_works(imported.email, imported.password), "after: the old password signs in through Supabase itself"
    assert not imported.has_old_hash()
    assert imported.attempts() == 0, "a success gives the address's tries back"


def test_the_address_may_be_typed_in_any_case(client, imported):
    assert attempt(client, imported.email.upper(), imported.password).status_code == 200
    assert sign_in_works(imported.email, imported.password)


def test_a_wrong_password_changes_nothing(client, imported):
    r = attempt(client, imported.email, "Not-The-Password-1")
    assert r.status_code == 401 and r.get_json() == {"ok": False, "error": "That email and password don't match."}
    assert imported.has_old_hash() and not sign_in_works(imported.email, "Not-The-Password-1") and not sign_in_works(imported.email, imported.password)
    assert imported.attempts() == 1, "a failed try stays counted"


def test_unknown_address_wrong_password_and_no_old_hash_all_answer_identically(client, db, imported):
    other = Person("plain")
    try:
        answers = {
            attempt(client, f"nobody-{uuid.uuid4().hex[:8]}@example.invalid", OLD).get_data(as_text=True),
            attempt(client, imported.email, "wrong-password-9").get_data(as_text=True),
            attempt(client, other.email, OLD).get_data(as_text=True),          # a normal account: no old hash
        }
        assert len(answers) == 1
    finally:
        forget(other)


def test_an_account_can_only_be_migrated_once(client, imported):
    assert attempt(client, imported.email, imported.password).status_code == 200
    again = attempt(client, imported.email, imported.password)
    assert again.status_code == 401, "the old hash is gone: the old password is just an ordinary password now, handled by Supabase"


def test_changing_the_password_any_other_way_also_drops_the_old_hash(client, imported):
    """The database trigger: a leaked old password must not be re-accepted after a reset."""
    response = HTTP.put(_url(f"/auth/v1/admin/users/{imported.id}"), headers={"apikey": ENV["SUPABASE_SERVICE_ROLE_KEY"], "Content-Type": "application/json"},
                        json={"password": "Reset-Password-456"}, timeout=30)
    response.raise_for_status()
    assert not imported.has_old_hash()
    assert attempt(client, imported.email, imported.password).status_code == 401


def test_the_email_is_not_confirmed_by_the_migration(client, db):
    account = Imported(db, client, confirmed=False)
    try:
        assert attempt(client, account.email, account.password).status_code == 200
        with pytest.raises(requests.HTTPError) as refused:
            _sign_in(account.email, account.password)
        assert "email_not_confirmed" in refused.value.response.text, "the importer left it unconfirmed on purpose: the app asks for a confirmation next"
    finally:
        account.drop()


def test_a_password_the_project_refuses_asks_for_a_reset_and_keeps_the_old_hash(client, db):
    account = Imported(db, client, password="abc")                       # shorter than the project's minimum
    try:
        r = attempt(client, account.email, "abc")
        assert r.status_code == 409 and r.get_json()["reset_required"] is True
        assert account.has_old_hash()
    finally:
        account.drop()


def test_ten_wrong_tries_lock_the_address_and_even_the_right_password_waits(client, imported):
    for n in range(legacy.EMAIL_ATTEMPTS):
        assert attempt(client, imported.email, f"wrong-{n}-password", caller=f"{CALLER}-{n}").status_code == 401
    r = attempt(client, imported.email, imported.password, caller=f"{CALLER}-late")
    assert r.status_code == 429 and 800 <= int(r.headers["Retry-After"]) <= 900
    assert imported.has_old_hash() and not sign_in_works(imported.email, imported.password)
    sql(imported.db, "delete from public.auth_throttle where key like %s", (legacy.caller_key(CALLER) + "-%",))


def test_the_lock_ends_with_its_window(client, imported):
    sql(imported.db, "insert into public.auth_throttle (key, window_start, count) values (%s, %s, %s)",
        (legacy.email_key(imported.email), int(time.time()) - legacy.EMAIL_WINDOW, legacy.EMAIL_ATTEMPTS))
    assert attempt(client, imported.email, imported.password).status_code == 200


def test_a_reopened_window_starts_counting_again_from_one(client, imported):
    sql(imported.db, "insert into public.auth_throttle (key, window_start, count) values (%s, %s, %s)",
        (legacy.email_key(imported.email), int(time.time()) - legacy.EMAIL_WINDOW - 5, legacy.EMAIL_ATTEMPTS))
    assert attempt(client, imported.email, "wrong-password-1").status_code == 401        # allowed: the old window is over
    assert attempt(client, imported.email, "wrong-password-2", caller=CALLER + "-b").status_code == 401
    row = sql(imported.db, "select count, window_start from public.auth_throttle where key = %s", (legacy.email_key(imported.email),))[0]
    assert row["count"] == 2 and row["window_start"] > int(time.time()) - 120, "the new window opened now and counts up from there"
    sql(imported.db, "delete from public.auth_throttle where key = %s", (legacy.caller_key(CALLER + "-b"),))


def test_one_caller_cannot_walk_many_addresses(client, db, imported):
    sql(db, "insert into public.auth_throttle (key, window_start, count) values (%s, %s, %s)",
        (legacy.caller_key(CALLER), int(time.time()) - 60, legacy.CALLER_ATTEMPTS))
    r = attempt(client, imported.email, imported.password)
    assert r.status_code == 429
    assert imported.attempts() == 0, "a caller refused up front does not spend the address's budget"
    assert attempt(client, imported.email, imported.password, caller=CALLER + "-elsewhere").status_code == 200


def test_malformed_tries_count_against_the_caller(client, db):
    for body in ({}, {"email": "x"}, {"email": "a@b.co", "password": ""}, {"email": 5, "password": 5}):
        assert client.post("/api/auth/legacy-login", json=body, headers={"X-Forwarded-For": CALLER}).status_code == 401
    assert sql(db, "select count from public.auth_throttle where key = %s", (legacy.caller_key(CALLER),))[0]["count"] == 4


def test_simultaneous_tries_are_all_counted(settings, db, storage):

    app = create_app(settings, db=db, storage=storage, sweep=False).test_client()
    account = Imported(db, app)
    try:
        gate, results = threading.Barrier(6), []

        def go(n):
            gate.wait()
            results.append(attempt(app, account.email, f"wrong-{n}-password", caller=f"{CALLER}-{n}").status_code)
        threads = [threading.Thread(target=go, args=(n,)) for n in range(6)]
        [t.start() for t in threads]
        [t.join(120) for t in threads]
        assert results == [401] * 6 and account.attempts() == 6
        sql(db, "delete from public.auth_throttle where key like %s", (legacy.caller_key(CALLER) + "-%",))
    finally:
        account.drop()


def test_it_needs_no_session_and_ignores_one(client, imported, person):
    r = client.post("/api/auth/legacy-login", json={"email": imported.email, "password": imported.password}, headers={**bearer(person), "X-Forwarded-For": CALLER})
    assert r.status_code == 200
