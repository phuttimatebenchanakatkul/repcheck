"""Shared setup for the native API's live tests (test_api_accounts.py, test_api_photos.py, ...): the real project's
clients as module-scoped fixtures, a throwaway signed-in person per test, and a few readers.

Import the fixtures you need into your test module (`from api_support import client, db, person`); pytest treats them
as that module's own. Same rules as test_supabase_rls.py: throwaway users only, everything removed in a `finally`.
"""

import pytest

from api import accounts
from api.app import create_app
from api.db import Database
from api.settings import from_env
from api.supabase_admin import AuthAdmin, Storage
from test_supabase_rls import ENV, HTTP, Person, _admin_delete_user, _url, needs_api, needs_db

LIVE = [needs_api, needs_db]


@pytest.fixture(scope="module")
def settings():
    return from_env()


@pytest.fixture(scope="module")
def db(settings):
    database = Database(settings.db_url)
    yield database
    database.close()


@pytest.fixture(scope="module")
def storage(settings):
    return Storage(settings)


@pytest.fixture(scope="module")
def auth_admin(settings):
    return AuthAdmin(settings)


@pytest.fixture(scope="module")
def client(settings, db):
    return create_app(settings, db=db, sweep=False).test_client()


@pytest.fixture
def person():
    p = Person("api")
    try:
        yield p
    finally:
        forget(p)


def forget(p, _storage=None):
    """Remove a throwaway person: their stored files (Auth deletion does not), then the Auth user."""
    from api.db import Database as _Db
    database = _Db(from_env().db_url)
    try:
        with database.connection() as conn:
            objects = accounts.stored_objects(conn, p.id)
    finally:
        database.close()
    if objects:
        store = _storage or Storage(from_env())
        for bucket in {b for b, _k in objects}:
            store.remove(bucket, [k for b, k in objects if b == bucket])
    _admin_delete_user(p.id)


def bearer(p):
    return {"Authorization": p.client.headers["Authorization"]}


def profile_row(db, uid):
    with db.connection() as conn:
        return conn.execute("select * from public.profiles where id = %s", (uid,)).fetchone()


def objects_of(db, uid):
    with db.connection() as conn:
        return accounts.stored_objects(conn, uid)


def auth_user_exists(uid):
    r = HTTP.get(_url(f"/auth/v1/admin/users/{uid}"), headers={"apikey": ENV["SUPABASE_SERVICE_ROLE_KEY"]}, timeout=30)
    return r.status_code == 200
