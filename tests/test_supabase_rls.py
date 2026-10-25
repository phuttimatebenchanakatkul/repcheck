"""Two-user isolation tests for the Supabase schema (supabase/migrations/).

These run against the REAL project, through the same path the native app will
use: sign in with Supabase Auth, then call the Data API (PostgREST) with that
user's JWT. A test that called the database as its owner would pass no matter
what the policies said, so none of them do.

Why this suite exists: with "automatically expose new tables" off and RLS on,
a mistake in a grant or a policy is the difference between "user A cannot see
user B's meals" and "every signed-in user can read every user's health data".
Nothing else in the repo would notice.

Skipped, not failed, when SUPABASE_* is not configured -- an ordinary
`pytest -q` on a machine without the project keys must still pass. They need
network access and create (then delete) throwaway Auth users.

When you add a table: add it to EXPECTED_ACCESS, and if the app can reach it,
to SEED_ORDER / the isolation cases below.
test_every_public_table_has_a_reviewed_access_contract fails until you do,
which is the point.

Mutation-check any change here (CLAUDE.md): loosen the policy it guards, e.g.
`create policy ... using (true)`, and confirm the matching test goes red.
"""

import os
import re
import secrets
import time
import uuid
import warnings
from datetime import date
from pathlib import Path

import pytest
import requests

_REPO_ROOT = Path(__file__).resolve().parent.parent

# One connection pool for the whole module: a fresh TLS handshake per request
# was most of this suite's run time.
HTTP = requests.Session()


def _load_env():
    """SUPABASE_* from the process, else from the repo's gitignored .env."""
    wanted = ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL")
    found = {k: os.environ[k] for k in wanted if os.environ.get(k)}
    env_file = _REPO_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*(SUPABASE_[A-Z_]+)\s*=\s*(.*?)\s*$", line)
            if m and m.group(1) in wanted:
                found.setdefault(m.group(1), m.group(2))
    return found


ENV = _load_env()
_HAVE_API = all(k in ENV for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"))
_HAVE_DB = "SUPABASE_DB_URL" in ENV

needs_api = pytest.mark.skipif(not _HAVE_API, reason="SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY not set")
needs_db = pytest.mark.skipif(not _HAVE_DB, reason="SUPABASE_DB_URL not set")

TODAY = date.today().isoformat()
STAMP = "2026-10-24T10:00:00Z"

# ---------------------------------------------------------------------------
# The access contract: exactly what the app role may do, per table.
# Anything not listed here must be unreachable from the app.
# ---------------------------------------------------------------------------

_NONE = set()
_READ = {"SELECT"}
_CRUD = {"SELECT", "INSERT", "UPDATE", "DELETE"}
_CRUD_NO_DELETE = {"SELECT", "INSERT", "UPDATE"}

# table -> privileges `authenticated` holds. `anon` holds NONE on any table.
EXPECTED_ACCESS = {
    # server-only: no app access at all
    "ai_reports": _NONE,
    "auth_throttle": _NONE,
    "challenge_submissions": _NONE,
    "challenges": _NONE,
    "content_reports": _NONE,
    "friends": _NONE,
    "import_quarantine": _NONE,
    "legacy_password_hashes": _NONE,
    "rate_limits": _NONE,
    "usage_events": _NONE,
    "waitlist": _NONE,
    # the app reads its own rows; writes stay behind Flask
    "analyze_results": _READ,
    "custom_exercises": _READ,
    "custom_food_servings": _READ,
    "custom_foods": _READ,
    "hyrox_results": _READ,
    "profiles": _READ,  # plus UPDATE on onboarding_completed only (checked below)
    "progress_photos": _READ,
    # the app manages its own blocks
    "blocked_users": {"SELECT", "INSERT", "DELETE"},
    # the app reads and writes its own data directly
    "activity_days": _CRUD,
    "analyze_chat_messages": _CRUD,
    "analyze_log_entries": _CRUD,
    "coach_messages": _CRUD,
    "coaching_profiles": _CRUD_NO_DELETE,  # the row goes only with its profile (see the hardening migration)
    "day_status_overrides": _CRUD,
    "exercise_favorites": _CRUD,
    "hyrox_race_splits": _CRUD,
    "hyrox_races": _CRUD,
    "nutrition_entries": _CRUD,
    "nutrition_favorites": _CRUD,
    "nutrition_goals": _CRUD,
    "split_plans": _CRUD,
    "user_settings": _CRUD,
    "weight_entries": _CRUD,
    "workout_chat_messages": _CRUD,
    "workout_entries": _CRUD,
    "workout_sets": _CRUD,
}

READ_ONLY_OWN_TABLES = sorted(t for t, p in EXPECTED_ACCESS.items() if p == _READ and t not in ("profiles", "custom_food_servings"))
CRUD_TABLES = sorted(t for t, p in EXPECTED_ACCESS.items() if p in (_CRUD, _CRUD_NO_DELETE))
SERVER_ONLY_TABLES = sorted(t for t, p in EXPECTED_ACCESS.items() if not p)
ALL_TABLES = sorted(EXPECTED_ACCESS)


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------

def _url(path):
    return ENV["SUPABASE_URL"].rstrip("/") + path


class Client:
    """One identity talking to PostgREST: anon, a signed-in user, or service.

    `minimal=True` sends `Prefer: return=minimal`, PostgREST's default and what a
    real caller sends. Tests that FORGE a write must use it: with
    return=representation the row has to pass the SELECT policy to be returned,
    which makes a broken INSERT/UPDATE policy fail anyway and hides it."""

    def __init__(self, apikey, bearer=None):
        self.headers = {"apikey": apikey, "Content-Type": "application/json"}
        if bearer:
            self.headers["Authorization"] = "Bearer " + bearer

    def _prefer(self, minimal):
        return dict(self.headers, Prefer="return=minimal" if minimal else "return=representation")

    def get(self, table, **params):
        return HTTP.get(_url(f"/rest/v1/{table}"), headers=self.headers, params=params, timeout=30)

    def insert(self, table, row, minimal=False):
        return HTTP.post(_url(f"/rest/v1/{table}"), headers=self._prefer(minimal), json=row, timeout=30)

    def patch(self, table, row, minimal=False, **filters):
        return HTTP.patch(_url(f"/rest/v1/{table}"), headers=self._prefer(minimal), params=filters, json=row, timeout=30)

    def delete(self, table, minimal=False, **filters):
        return HTTP.delete(_url(f"/rest/v1/{table}"), headers=self._prefer(minimal), params=filters, timeout=30)

    def upsert(self, table, row, on_conflict):
        h = dict(self.headers, Prefer="resolution=merge-duplicates,return=minimal")
        return HTTP.post(_url(f"/rest/v1/{table}"), headers=h, params={"on_conflict": on_conflict}, json=row, timeout=30)


def _rows(resp):
    """Rows a response actually handed back; [] for any refusal."""
    if resp.status_code >= 400:
        return []
    body = resp.json()
    return body if isinstance(body, list) else []


def _ok_rows(resp):
    """Rows from a read whose success the test depends on (ground truth read
    with the service key). Unlike _rows, an HTTP error fails the test instead of
    reading as "no rows" -- otherwise a transient 5xx makes a leak look absent
    or an intact row look missing."""
    assert resp.status_code == 200, f"ground-truth read failed: {resp.status_code} {resp.text[:200]}"
    return resp.json()


def _admin_create_user(email, password):
    key = ENV["SUPABASE_SERVICE_ROLE_KEY"]
    resp = HTTP.post(
        _url("/auth/v1/admin/users"),
        headers={"apikey": key, "Content-Type": "application/json"},
        json={"email": email, "password": password, "email_confirm": True},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def _admin_delete_user(user_id):
    key = ENV["SUPABASE_SERVICE_ROLE_KEY"]
    resp = HTTP.delete(_url(f"/auth/v1/admin/users/{user_id}"), headers={"apikey": key}, timeout=30)
    if resp.status_code not in (200, 404):
        warnings.warn(f"could not delete throwaway test user {user_id}: {resp.status_code} (delete it by hand)")


def _admin_update_user(user_id, **fields):
    key = ENV["SUPABASE_SERVICE_ROLE_KEY"]
    resp = HTTP.put(_url(f"/auth/v1/admin/users/{user_id}"), headers={"apikey": key, "Content-Type": "application/json"},
                    json=fields, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _sign_in(email, password):
    """Supabase Auth throttles password sign-ins per address; a whole test run signs in hundreds of throwaway people, so a
    429 means wait and try again (the response says how long), not fail the test that happened to hit it."""
    for attempt in range(8):
        resp = HTTP.post(
            _url("/auth/v1/token?grant_type=password"),
            headers={"apikey": ENV["SUPABASE_ANON_KEY"], "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=30,
        )
        if resp.status_code != 429:
            break
        time.sleep(min(60, float(resp.headers.get("Retry-After") or 0) or 5 * (attempt + 1)))
    resp.raise_for_status()
    return resp.json()["access_token"]


class Person:
    def __init__(self, label):
        self.email = f"rls-{label}-{uuid.uuid4().hex[:10]}@example.invalid"
        password = secrets.token_urlsafe(18)
        self.id = _admin_create_user(self.email, password)
        self.client = Client(ENV["SUPABASE_ANON_KEY"], _sign_in(self.email, password))
        self.rows = {}  # table -> the row seeded for this person, as stored


# Every table a user owns rows in, in dependency order. Each entry builds the
# row from (user id, label, rows seeded so far).
SEED_ORDER = [
    ("profiles", lambda u, L, r: {"id": u, "name": f"User {L}"}),
    ("legacy_password_hashes", lambda u, L, r: {"user_id": u, "password_hash": f"scrypt:secret-{L}"}),
    ("rate_limits", lambda u, L, r: {"user_id": u, "feature": "food", "window_start": 1, "count": 3}),
    ("usage_events", lambda u, L, r: {"user_id": u, "event": "page:home", "count": 4}),
    ("ai_reports", lambda u, L, r: {"user_id": u, "feature": "coach", "reason": "other", "reply_text": f"reply {L}"}),
    ("custom_foods", lambda u, L, r: {"user_id": u, "name": f"Food {L}", "emoji": "x", "calories": 100, "protein": 1, "fat": 1, "carbs": 1}),
    ("custom_food_servings", lambda u, L, r: {"custom_food_id": r["custom_foods"]["id"], "label": f"Serving {L}", "grams": 50}),
    ("custom_exercises", lambda u, L, r: {"user_id": u, "name": f"Move {L}"}),
    ("progress_photos", lambda u, L, r: {"user_id": u, "date": TODAY, "angle": "front", "filename": f"{L}.jpg"}),
    ("analyze_results", lambda u, L, r: {"user_id": u, "exercise_label": f"Squat {L}", "feedback_text": f"feedback {L}"}),
    ("hyrox_results", lambda u, L, r: {"user_id": u, "gender": "m", "category": "open", "format": "single", "total_seconds": 3600}),
    ("user_settings", lambda u, L, r: {"user_id": u, "theme": "dark"}),
    ("nutrition_goals", lambda u, L, r: {"user_id": u, "protein": 150, "fat": 65, "carbs": 200}),
    ("nutrition_favorites", lambda u, L, r: {"user_id": u, "food_name": f"Fav {L}"}),
    ("exercise_favorites", lambda u, L, r: {"user_id": u, "exercise_name": f"Lift {L}"}),
    ("coaching_profiles", lambda u, L, r: {
        "user_id": u, "aspiration": "lose", "gender": "male", "weight_kg": 80, "body_fat_range_id": "m3",
        "activity_level": "lift_only", "protein_preference": "high"}),
    ("split_plans", lambda u, L, r: {"user_id": u, "split_type": "ppl", "days_per_week": 3}),
    ("nutrition_entries", lambda u, L, r: {"user_id": u, "id": f"n-{L}", "log_date": TODAY, "food": f"Meal {L}", "added_at": STAMP}),
    ("workout_entries", lambda u, L, r: {"user_id": u, "id": f"w-{L}", "log_date": TODAY, "exercise": f"Squat {L}", "added_at": STAMP}),
    ("workout_sets", lambda u, L, r: {"user_id": u, "entry_id": f"w-{L}", "position": 0, "reps": 5}),
    ("weight_entries", lambda u, L, r: {"user_id": u, "log_date": TODAY, "kg": 80, "logged_at": STAMP}),
    ("day_status_overrides", lambda u, L, r: {"user_id": u, "log_date": TODAY, "status": "fasting"}),
    ("activity_days", lambda u, L, r: {"user_id": u, "log_date": TODAY, "action": "coach_chat"}),
    ("analyze_log_entries", lambda u, L, r: {"user_id": u, "exercise": f"Squat {L}", "analyzed_at": STAMP}),
    ("hyrox_races", lambda u, L, r: {"user_id": u, "id": f"r-{L}", "raced_at": STAMP, "category": "open", "total_seconds": 3600}),
    ("hyrox_race_splits", lambda u, L, r: {"user_id": u, "race_id": f"r-{L}", "position": 0, "key": "run1", "at_seconds": 240}),
    ("coach_messages", lambda u, L, r: {"user_id": u, "client_id": f"c-{L}", "role": "user", "body": f"hi {L}", "msg_date": TODAY}),
    ("workout_chat_messages", lambda u, L, r: {"user_id": u, "client_id": f"wc-{L}", "role": "user", "body": f"hi {L}", "msg_date": TODAY}),
    ("analyze_chat_messages", lambda u, L, r: {
        "user_id": u, "client_id": f"ac-{L}", "analyze_result_id": r["analyze_results"]["id"], "role": "user", "body": f"hi {L}"}),
]

# A harmless column to change on a user's own row, per table, to prove UPDATE
# works (tables with only key columns are absent).
UPDATE_PAYLOAD = {
    "user_settings": {"theme": "light"},
    "nutrition_goals": {"protein": 151},
    "coaching_profiles": {"weight_kg": 81},
    "split_plans": {"goal": "bulk"},
    "nutrition_entries": {"food": "renamed"},
    "workout_entries": {"exercise": "renamed"},
    "workout_sets": {"reps": 6},
    "weight_entries": {"kg": 81},
    "day_status_overrides": {"status": "incomplete"},
    "analyze_log_entries": {"exercise": "renamed"},
    "hyrox_races": {"category": "pro"},
    "hyrox_race_splits": {"at_seconds": 250},
    "coach_messages": {"body": "edited"},
    "workout_chat_messages": {"body": "edited"},
    "analyze_chat_messages": {"body": "edited"},
}


# Tables that must exist before another can be seeded (foreign keys).
SEED_DEPENDS = {
    "custom_food_servings": ["custom_foods"],
    "workout_sets": ["workout_entries"],
    "hyrox_race_splits": ["hyrox_races"],
    "analyze_chat_messages": ["analyze_results"],
}


def seed_person(service, person, label, only=None):
    """Seed rows for `person`: everything, or just `only` (a table name) with
    the profile and whatever it depends on -- a CRUD case needs one table, not
    28, and seeding is most of this suite's run time."""
    wanted = None
    if only:
        wanted = {"profiles", only, *SEED_DEPENDS.get(only, ())}
    for table, build in SEED_ORDER:
        if wanted is not None and table not in wanted:
            continue
        row = build(person.id, label, person.rows)
        resp = service.insert(table, row)
        assert resp.status_code in (200, 201), f"seeding {table}: {resp.status_code} {resp.text}"
        person.rows[table] = resp.json()[0]


@pytest.fixture(scope="module")
def service():
    return Client(ENV["SUPABASE_SERVICE_ROLE_KEY"])


@pytest.fixture(scope="module")
def anon():
    return Client(ENV["SUPABASE_ANON_KEY"])


@pytest.fixture(scope="module")
def world(service):
    """Users A and B with a row in every table they own, plus the cross-user rows
    (a friendship, a block of A by B, reports and a challenge by B). Seeded with
    the service key so the tests do not depend on any write grant. Deleting the
    Auth users at the end cascades to everything they own."""
    a, b, victim = Person("a"), Person("b"), Person("victim")
    # Neither of these hangs off a user, so deleting the users would leave them behind
    # in the live project on every run. Removed explicitly in `finally`.
    throttle_key = f"rls-test-{uuid.uuid4().hex}"
    waitlist_email = f"rls-{uuid.uuid4().hex[:10]}@example.invalid"
    try:
        assert service.insert("profiles", {"id": victim.id, "name": "Victim"}).status_code == 201
        seed_person(service, a, "A")
        seed_person(service, b, "B")
        for table, row in (
            ("auth_throttle", {"key": throttle_key, "window_start": 1, "count": 1}),
            ("waitlist", {"email": waitlist_email}),
            ("friends", {"user_id": a.id, "friend_id": b.id}),
            ("friends", {"user_id": b.id, "friend_id": a.id}),
            ("blocked_users", {"user_id": b.id, "blocked_id": a.id}),
            ("content_reports", {"reporter_id": b.id, "reported_id": a.id, "reason": "spam"}),
        ):
            assert service.insert(table, row).status_code in (200, 201), table
        chal = service.insert("challenges", {"creator_id": b.id, "exercise": "pushup"}).json()[0]
        assert service.insert("challenge_submissions", {"challenge_id": chal["id"], "user_id": b.id, "reps": 10}).status_code == 201
        yield {"a": a, "b": b, "victim": victim}
    finally:
        _admin_delete_user(a.id)
        _admin_delete_user(b.id)
        _admin_delete_user(victim.id)
        service.delete("auth_throttle", minimal=True, key=f"eq.{throttle_key}")
        service.delete("waitlist", minimal=True, email=f"eq.{waitlist_email}")


# ---------------------------------------------------------------------------
# The access contract itself (catalog level)
# ---------------------------------------------------------------------------

@needs_db
def test_every_public_table_has_a_reviewed_access_contract():
    import psycopg

    with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
        rls = dict(conn.execute(
            "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace "
            "where n.nspname = 'public' and c.relkind in ('r', 'p')").fetchall())
        grants = {}
        for table, grantee, priv in conn.execute(
                "select table_name, grantee, privilege_type from information_schema.role_table_grants "
                "where table_schema = 'public' and grantee in ('anon', 'authenticated')"):
            grants.setdefault((table, grantee), set()).add(priv)

    unreviewed = set(rls) - set(EXPECTED_ACCESS)
    assert not unreviewed, (
        f"New public table(s) {sorted(unreviewed)} have no entry in EXPECTED_ACCESS. Decide what the app "
        "may do with them, write the grants and policies, and add them here.")
    assert not (set(EXPECTED_ACCESS) - set(rls)), "EXPECTED_ACCESS names a table that does not exist"
    for table in sorted(rls):
        assert rls[table], f"{table}: row level security is OFF"
        assert not grants.get((table, "anon")), f"{table}: anon holds {grants.get((table, 'anon'))}"
        assert grants.get((table, "authenticated"), set()) == EXPECTED_ACCESS[table], (
            f"{table}: authenticated holds {grants.get((table, 'authenticated'), set())}, "
            f"expected {EXPECTED_ACCESS[table]}")


@needs_db
def test_profile_update_is_limited_to_the_onboarding_flag():
    import psycopg

    with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
        cols = {r[0] for r in conn.execute(
            "select column_name from information_schema.column_privileges "
            "where table_schema = 'public' and table_name = 'profiles' "
            "and grantee = 'authenticated' and privilege_type = 'UPDATE'")}
    assert cols == {"onboarding_completed"}


@needs_db
def test_no_app_table_is_missing_its_four_policies():
    """A writable table with an unscoped, missing or surplus policy is a leak or a dead table: it must
    have exactly one policy per privilege the app holds, each scoped to the caller."""
    import psycopg

    with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
        found = {}
        for table, cmd, qual, check in conn.execute(
                "select tablename, cmd, qual, with_check from pg_policies where schemaname = 'public'"):
            found.setdefault(table, {})[cmd] = (qual or "", check or "")
    for table in CRUD_TABLES:
        assert set(found.get(table, {})) == EXPECTED_ACCESS[table], f"{table}: {sorted(found.get(table, {}))}"
        for cmd, (qual, check) in found[table].items():
            # Each clause on its own: joining them would let a scoped USING hide an
            # unscoped WITH CHECK on the same UPDATE policy, or the reverse.
            clauses = {"SELECT": {"USING": qual}, "DELETE": {"USING": qual},
                       "INSERT": {"WITH CHECK": check}, "UPDATE": {"USING": qual, "WITH CHECK": check}}[cmd]
            for clause, expression in clauses.items():
                assert "auth.uid()" in expression and "user_id" in expression, (
                    f"{table} {cmd}: the {clause} clause is not scoped to the caller: {expression!r}")


# ---------------------------------------------------------------------------
# Isolation through the Data API
# ---------------------------------------------------------------------------

@needs_api
@pytest.mark.parametrize("table", READ_ONLY_OWN_TABLES + CRUD_TABLES)
def test_a_user_sees_only_their_own_rows(world, table):
    a, b = world["a"], world["b"]
    assert {r["user_id"] for r in _rows(a.client.get(table, select="user_id"))} == {a.id}, f"{table}: A saw another user's rows"
    assert {r["user_id"] for r in _rows(b.client.get(table, select="user_id"))} == {b.id}


@needs_api
def test_servings_follow_their_food_owner(world):
    a = world["a"]
    labels = {r["label"] for r in _rows(a.client.get("custom_food_servings", select="label"))}
    assert labels == {"Serving A"}


@needs_api
def test_profiles_a_user_sees_only_themselves(world):
    a = world["a"]
    assert {r["id"] for r in _rows(a.client.get("profiles", select="id"))} == {a.id}


@needs_api
@pytest.mark.parametrize("table", SERVER_ONLY_TABLES)
def test_server_only_tables_return_nothing_to_a_user(world, table):
    assert _rows(world["a"].client.get(table)) == [], f"{table} leaked rows to a signed-in user"


@needs_api
@pytest.mark.parametrize("table", ALL_TABLES)
def test_anonymous_callers_get_nothing_from_any_table(world, anon, table):
    assert _rows(anon.get(table)) == [], f"{table} leaked rows to an anonymous caller"


@needs_api
@pytest.mark.parametrize("table", READ_ONLY_OWN_TABLES + CRUD_TABLES)
def test_a_user_cannot_change_or_delete_another_users_rows(world, service, table):
    a, b = world["a"], world["b"]
    before = _ok_rows(service.get(table, user_id=f"eq.{b.id}"))
    assert before, f"no seeded row for B in {table}"
    # minimal: a 204 says nothing about how many rows were touched, so the verdict is the database's
    a.client.patch(table, {"user_id": a.id}, minimal=True, user_id=f"eq.{b.id}")
    assert _ok_rows(service.get(table, user_id=f"eq.{b.id}")) == before, f"{table}: A changed or moved B's row"
    a.client.delete(table, minimal=True, user_id=f"eq.{b.id}")
    assert _ok_rows(service.get(table, user_id=f"eq.{b.id}")) == before, f"{table}: A deleted B's row"


@needs_api
def test_read_only_tables_refuse_writes_from_the_app(world):
    a = world["a"]
    inserts = {
        "custom_foods": {"user_id": a.id, "name": "x", "emoji": "x", "calories": 1, "protein": 0, "fat": 0, "carbs": 0},
        "custom_exercises": {"user_id": a.id, "name": "x"},
        "progress_photos": {"user_id": a.id, "date": TODAY, "angle": "front", "filename": "x"},
        "analyze_results": {"user_id": a.id, "exercise_label": "x", "feedback_text": "x"},
        "hyrox_results": {"user_id": a.id, "gender": "m", "category": "o", "format": "s", "total_seconds": 1},
    }
    for table, row in inserts.items():
        assert a.client.insert(table, row).status_code >= 400, f"{table}: the app could insert"
        assert a.client.patch(table, {"user_id": a.id}, user_id=f"eq.{a.id}").status_code >= 400, f"{table}: the app could update"
        assert a.client.delete(table, user_id=f"eq.{a.id}").status_code >= 400, f"{table}: the app could delete"


@needs_api
def test_profile_update_only_reaches_the_onboarding_flag(world, service):
    a, b = world["a"], world["b"]
    ok = a.client.patch("profiles", {"onboarding_completed": True}, id=f"eq.{a.id}")
    assert ok.status_code == 200 and ok.json()[0]["onboarding_completed"] is True
    for column, value in (
        ("name", "Renamed"), ("friend_code", "RC-FORGED"), ("ai_consent_at", "2026-01-01T00:00:00Z"),
        ("deleted_at", "2026-01-01T00:00:00Z"), ("avatar_url", "http://x"), ("legacy_user_id", 999),
    ):
        resp = a.client.patch("profiles", {column: value}, id=f"eq.{a.id}")
        assert resp.status_code >= 400, f"profiles.{column} was writable by the app"
    assert _rows(a.client.patch("profiles", {"onboarding_completed": True}, id=f"eq.{b.id}")) == []
    row = _ok_rows(service.get("profiles", id=f"eq.{a.id}"))[0]
    assert row["name"] == "User A" and row["friend_code"] is None and row["ai_consent_at"] is None


@needs_api
def test_a_user_cannot_see_who_has_blocked_them(world):
    # B blocked A (seeded). A must not learn that.
    assert _rows(world["a"].client.get("blocked_users")) == []
    assert len(_rows(world["b"].client.get("blocked_users"))) == 1


@needs_api
def test_blocking_is_limited_to_your_own_blocks(world, service):
    a, b = world["a"], world["b"]
    victim = world["victim"]
    assert a.client.insert("blocked_users", {"user_id": victim.id, "blocked_id": a.id}, minimal=True).status_code >= 400
    assert _ok_rows(service.get("blocked_users", user_id=f"eq.{victim.id}")) == []
    # database.block_user() used to swallow a self-block silently
    assert a.client.insert("blocked_users", {"user_id": a.id, "blocked_id": a.id}).status_code >= 400
    assert a.client.insert("blocked_users", {"user_id": a.id, "blocked_id": b.id}).status_code == 201
    assert [r["blocked_id"] for r in _rows(a.client.get("blocked_users"))] == [b.id]
    assert _rows(b.client.get("blocked_users", user_id=f"eq.{a.id}")) == []
    assert _rows(b.client.delete("blocked_users", user_id=f"eq.{a.id}")) == []
    assert len(_rows(a.client.delete("blocked_users", user_id=f"eq.{a.id}"))) == 1
    assert _rows(a.client.delete("blocked_users", user_id=f"eq.{b.id}")) == []
    assert len(_ok_rows(service.get("blocked_users", user_id=f"eq.{b.id}"))) == 1


# ---------------------------------------------------------------------------
# Tables the app writes directly
# ---------------------------------------------------------------------------

@needs_api
@pytest.mark.parametrize("table", CRUD_TABLES)
def test_a_user_can_create_change_and_delete_their_own_rows(service, table):
    who = Person("crud")
    try:
        seed_person(service, who, "C", only=table)
        row = dict(who.rows[table])
        if table in UPDATE_PAYLOAD:
            resp = who.client.patch(table, UPDATE_PAYLOAD[table], user_id=f"eq.{who.id}")
            assert resp.status_code == 200 and len(resp.json()) == 1, f"{table}: own update failed: {resp.text}"
        if "DELETE" in EXPECTED_ACCESS[table]:
            assert len(_rows(who.client.delete(table, user_id=f"eq.{who.id}"))) == 1, f"{table}: own delete failed"
            row.pop(GENERATED_KEY_COLUMNS.get(table, ""), None)   # a client cannot supply a generated key
            resp = who.client.insert(table, row)
            assert resp.status_code == 201, f"{table}: own insert failed: {resp.text}"
        else:
            assert who.client.delete(table, minimal=True, user_id=f"eq.{who.id}").status_code >= 400, f"{table}: the app could delete"
            assert _ok_rows(service.get(table, user_id=f"eq.{who.id}")), f"{table}: the row is gone"
    finally:
        _admin_delete_user(who.id)


# Child tables whose foreign key to a parent row already refuses a forged owner;
# they have their own tests below, which is where the key is what is being tested.
FK_CHILD_TABLES = ("workout_sets", "hyrox_race_splits", "analyze_chat_messages")
# Tables whose primary key the database generates, so a copied row must drop it.
GENERATED_KEY_COLUMNS = {
    "coach_messages": "seq", "workout_chat_messages": "seq", "analyze_chat_messages": "seq", "analyze_log_entries": "id",
}


@needs_api
@pytest.mark.parametrize("table", [t for t in CRUD_TABLES if t not in FK_CHILD_TABLES])
def test_a_user_cannot_write_a_row_into_another_users_account(world, service, table):
    """Forged against the VICTIM, who owns no rows anywhere. Forging against B
    would collide with B's existing primary key and be refused for that reason,
    which would pass even if the policy were wide open."""
    a, victim = world["a"], world["victim"]
    forged = dict(a.rows[table], user_id=victim.id)
    forged.pop(GENERATED_KEY_COLUMNS.get(table, ""), None)
    assert a.client.insert(table, forged, minimal=True).status_code >= 400, f"{table}: A inserted a row owned by the victim"
    # moving A's own row to the victim must be refused too (WITH CHECK on UPDATE)
    assert a.client.patch(table, {"user_id": victim.id}, minimal=True, user_id=f"eq.{a.id}").status_code >= 400, \
        f"{table}: A reassigned a row to the victim"
    assert _ok_rows(service.get(table, user_id=f"eq.{victim.id}")) == [], f"{table}: a forged row landed in the victim's account"


@needs_api
def test_a_set_cannot_be_attached_to_another_users_workout(world, service):
    a, b = world["a"], world["b"]
    # (A, B's entry id) names no workout entry, so the composite foreign key refuses it
    forged = {"user_id": a.id, "entry_id": b.rows["workout_entries"]["id"], "position": 5, "reps": 1}
    assert a.client.insert("workout_sets", forged).status_code >= 400
    forged = {"user_id": a.id, "race_id": b.rows["hyrox_races"]["id"], "position": 5, "key": "run1", "at_seconds": 1}
    assert a.client.insert("hyrox_race_splits", forged).status_code >= 400
    assert len(_ok_rows(service.get("workout_sets", user_id=f"eq.{b.id}"))) == 1


@needs_api
def test_a_chat_can_only_attach_to_the_users_own_analysis(world, service):
    a, b = world["a"], world["b"]
    # both rows are complete (a client_id is mandatory), so ownership is the only thing that can refuse the forgery
    forged = {"user_id": a.id, "client_id": f"forged-{uuid.uuid4().hex}", "analyze_result_id": b.rows["analyze_results"]["id"],
              "role": "user", "body": "x"}
    assert a.client.insert("analyze_chat_messages", forged, minimal=True).status_code >= 400
    own = {"user_id": a.id, "client_id": f"own-{uuid.uuid4().hex}", "analyze_result_id": a.rows["analyze_results"]["id"],
           "role": "user", "body": "ok"}
    assert a.client.insert("analyze_chat_messages", own).status_code == 201


@needs_api
def test_deleting_an_analysis_removes_its_chat_thread(service):
    """What prune_analyze_results() used to do by hand: the thread goes with the analysis."""
    who = Person("prune")
    try:
        seed_person(service, who, "P")
        analysis = who.rows["analyze_results"]["id"]
        assert _ok_rows(service.get("analyze_chat_messages", analyze_result_id=f"eq.{analysis}"))
        assert service.delete("analyze_results", id=f"eq.{analysis}").status_code == 200
        assert _ok_rows(service.get("analyze_chat_messages", analyze_result_id=f"eq.{analysis}")) == []
    finally:
        _admin_delete_user(who.id)


@needs_api
def test_weight_entries_enforce_the_old_endpoints_range(world):
    a = world["a"]
    for bad in (0, -1, 400.5, 5000):
        resp = a.client.patch("weight_entries", {"kg": bad}, user_id=f"eq.{a.id}")
        assert resp.status_code >= 400, f"kg={bad} was accepted"
    assert a.client.patch("weight_entries", {"kg": 400}, user_id=f"eq.{a.id}").status_code == 200


@needs_api
def test_dates_must_be_real_calendar_days(world):
    a = world["a"]
    for bad in ("2026-02-31", "9999-99-99", "0000-00-00", "not-a-date"):
        resp = a.client.insert("activity_days", {"user_id": a.id, "log_date": bad, "action": "challenge"})
        assert resp.status_code >= 400, f"{bad!r} was stored as a day"


@needs_api
def test_only_the_two_day_status_overrides_exist(world):
    a = world["a"]
    assert a.client.patch("day_status_overrides", {"status": "logged"}, user_id=f"eq.{a.id}").status_code >= 400
    assert a.client.patch("day_status_overrides", {"status": "incomplete"}, user_id=f"eq.{a.id}").status_code == 200


@needs_api
def test_the_coaching_profile_never_loses_a_required_field(world, service):
    """database._merge_coaching_profile_write, now a trigger: a client that
    blanks a required field cannot erase the stored value."""
    a = world["a"]
    required_blank = {
        "aspiration": "", "gender": "", "weight_kg": None,
        "body_fat_range_id": None, "activity_level": "", "protein_preference": None,
    }
    resp = a.client.patch("coaching_profiles", required_blank, user_id=f"eq.{a.id}")
    assert resp.status_code == 200
    row = _ok_rows(service.get("coaching_profiles", user_id=f"eq.{a.id}"))[0]
    assert (row["aspiration"], row["gender"], row["weight_kg"]) == ("lose", "male", 80)
    assert (row["body_fat_range_id"], row["activity_level"], row["protein_preference"]) == ("m3", "lift_only", "high")
    # whitespace is blank too: it must not be a way round the rule
    whitespace = {"aspiration": "   ", "gender": "\t", "body_fat_range_id": " ", "activity_level": "  ", "protein_preference": " "}
    assert a.client.patch("coaching_profiles", whitespace, user_id=f"eq.{a.id}").status_code == 200
    row = _ok_rows(service.get("coaching_profiles", user_id=f"eq.{a.id}"))[0]
    assert (row["aspiration"], row["gender"]) == ("lose", "male")
    assert (row["body_fat_range_id"], row["activity_level"], row["protein_preference"]) == ("m3", "lift_only", "high")
    # a real change still goes through, and optional fields can still be cleared
    assert a.client.patch("coaching_profiles", {"gender": "female", "diet_preference": None}, user_id=f"eq.{a.id}").status_code == 200
    row = _ok_rows(service.get("coaching_profiles", user_id=f"eq.{a.id}"))[0]
    assert row["gender"] == "female" and row["diet_preference"] is None


@needs_api
def test_deleting_an_account_removes_everything_it_owns(service):
    """Mirrors database._purge_user_rows: every row a user owns, and every row
    that names them (friendships, blocks, reports, others' submissions to their
    challenges), goes when their Auth user does."""
    gone, stays = Person("gone"), Person("stays")
    try:
        seed_person(service, gone, "G")
        assert service.insert("import_quarantine", {
            "source": "user_data:x", "legacy_user_id": 1, "user_id": gone.id, "payload": {"k": 1}, "error": "x"}).status_code == 201
        assert service.insert("profiles", {"id": stays.id, "name": "stays"}).status_code == 201
        assert service.insert("friends", {"user_id": gone.id, "friend_id": stays.id}).status_code == 201
        assert service.insert("friends", {"user_id": stays.id, "friend_id": gone.id}).status_code == 201
        assert service.insert("blocked_users", {"user_id": stays.id, "blocked_id": gone.id}).status_code == 201
        assert service.insert("content_reports", {"reporter_id": stays.id, "reported_id": gone.id, "reason": "spam"}).status_code == 201
        chal = service.insert("challenges", {"creator_id": gone.id, "exercise": "pushup"}).json()[0]
        assert service.insert("challenge_submissions", {"challenge_id": chal["id"], "user_id": stays.id, "reps": 5}).status_code == 201
    finally:
        _admin_delete_user(gone.id)
    try:
        for table, column in [(t, "user_id") for t in ALL_TABLES if t not in (
                "profiles", "friends", "blocked_users", "content_reports", "challenges", "challenge_submissions",
                "waitlist", "auth_throttle", "custom_food_servings")]:
            assert _ok_rows(service.get(table, **{column: f"eq.{gone.id}"})) == [], f"{table} kept rows of a deleted account"
        assert _ok_rows(service.get("profiles", id=f"eq.{gone.id}")) == []
        assert _ok_rows(service.get("friends", friend_id=f"eq.{gone.id}")) == []
        assert _ok_rows(service.get("blocked_users", blocked_id=f"eq.{gone.id}")) == []
        assert _ok_rows(service.get("content_reports", reported_id=f"eq.{gone.id}")) == []
        assert _ok_rows(service.get("challenges", id=f"eq.{chal['id']}")) == []
        assert _ok_rows(service.get("challenge_submissions", challenge_id=f"eq.{chal['id']}")) == []
        assert _ok_rows(service.get("custom_food_servings", custom_food_id=f"eq.{gone.rows['custom_foods']['id']}")) == []
        assert _ok_rows(service.get("profiles", id=f"eq.{stays.id}")) != []
    finally:
        _admin_delete_user(stays.id)


# ---------------------------------------------------------------------------
# Hardening (supabase/migrations/20261024150000_hardening.sql)
# ---------------------------------------------------------------------------

@needs_api
@pytest.mark.parametrize("table,column", sorted(GENERATED_KEY_COLUMNS.items()))
def test_a_client_cannot_choose_its_own_generated_key(world, table, column):
    """With `generated by default`, a signed-in user could plant explicit seq/id values equal to the
    next values of the shared sequence and make everyone else's inserts collide with them."""
    a = world["a"]
    row = dict(a.rows[table])
    row[column] = 987654321
    # every other unique key is made different, so an explicit generated key is the only possible reason to refuse
    if "client_id" in row:
        row["client_id"] = f"explicit-{uuid.uuid4().hex}"
    if table == "analyze_log_entries":
        row["exercise"] = f"explicit-{uuid.uuid4().hex}"
    assert a.client.insert(table, row, minimal=True).status_code >= 400, f"{table}: the app chose its own {column}"


@needs_api
@pytest.mark.parametrize("table", ["coach_messages", "workout_chat_messages", "analyze_chat_messages"])
def test_a_retried_chat_turn_is_idempotent_through_the_api(service, table):
    """The offline-first app retries after a dropped response; PostgREST can only upsert on a NON-partial
    unique constraint, so (user_id, client_id) must be one."""
    who = Person("idem")
    try:
        seed_person(service, who, "I", only=table)
        row = {k: v for k, v in who.rows[table].items() if k != GENERATED_KEY_COLUMNS[table]}
        row["client_id"] = f"turn-{uuid.uuid4().hex}"
        first = who.client.upsert(table, row, "user_id,client_id")
        second = who.client.upsert(table, dict(row, body="retried"), "user_id,client_id")
        assert first.status_code in (200, 201, 204) and second.status_code in (200, 201, 204), (first.text, second.text)
        rows = _ok_rows(service.get(table, user_id=f"eq.{who.id}", client_id=f"eq.{row['client_id']}"))
        assert len(rows) == 1 and rows[0]["body"] == "retried"
    finally:
        _admin_delete_user(who.id)


@needs_api
def test_the_coaching_profile_cannot_be_deleted_and_recreated_partial(world, service):
    """The update trigger keeps a required field from being blanked; delete + insert used to walk around it."""
    a = world["a"]
    assert a.client.delete("coaching_profiles", minimal=True, user_id=f"eq.{a.id}").status_code >= 400
    (row,) = _ok_rows(service.get("coaching_profiles", user_id=f"eq.{a.id}"))
    assert row["aspiration"] == "lose" and row["weight_kg"] is not None


@needs_db
def test_new_tables_start_closed():
    """Postgres would otherwise give anon/authenticated TRUNCATE (which ignores RLS) and more on every new table."""
    import psycopg

    with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
        granted = conn.execute(
            "select d.defaclobjtype, a.privilege_type, r.rolname from pg_default_acl d "
            "cross join lateral aclexplode(d.defaclacl) a left join pg_roles r on r.oid = a.grantee "
            "where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace "
            "and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))").fetchall()
    assert granted == [], f"new postgres-owned objects in public would be opened to the app: {granted}"


@needs_db
def test_every_foreign_key_column_is_the_lead_of_an_index():
    """Row-level security filters by user_id and account deletion cascades through every foreign key;
    without a leading index each is a sequential scan, once per deleted user."""
    import psycopg

    with psycopg.connect(ENV["SUPABASE_DB_URL"], prepare_threshold=None) as conn:
        unindexed = conn.execute(
            "select c.conrelid::regclass::text, a.attname from pg_constraint c "
            "join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] "
            "where c.contype = 'f' and c.connamespace = 'public'::regnamespace "
            "and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])"
        ).fetchall()
    assert unindexed == [], f"foreign keys with no index leading with them: {unindexed}"


@needs_api
def test_a_legacy_password_hash_is_dropped_whenever_the_password_changes_and_only_then(service):
    """The migration fallback accepts the legacy hash while its row exists. A password the user changed
    some other way (a recovery email, a reset after the old password leaked) must retire the row, or the
    old password would be accepted again and put back."""
    who = Person("legacy")
    try:
        assert service.insert("profiles", {"id": who.id, "name": "legacy"}).status_code == 201
        assert service.insert("legacy_password_hashes", {"user_id": who.id, "password_hash": "scrypt:old"}).status_code == 201
        _admin_update_user(who.id, user_metadata={"unrelated": True})
        assert len(_ok_rows(service.get("legacy_password_hashes", user_id=f"eq.{who.id}"))) == 1, \
            "a change that is not a password change must keep the row"
        _admin_update_user(who.id, password=secrets.token_urlsafe(18))
        assert _ok_rows(service.get("legacy_password_hashes", user_id=f"eq.{who.id}")) == []
    finally:
        _admin_delete_user(who.id)
