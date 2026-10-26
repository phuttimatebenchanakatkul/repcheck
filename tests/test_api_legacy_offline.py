"""Moving an imported account's old password across: the order of the steps, what each answer is, and that a failure of any
kind looks the same from outside. No network, no database (the fakes record every statement)."""

import contextlib
import dataclasses

import pytest
from werkzeug.security import check_password_hash, generate_password_hash

from api import legacy, throttle
from api.app import create_app
from api.supabase_admin import SupabaseError, WeakPassword
from test_api_auth import SETTINGS, verifier

OLD = "old-password-1"
HASH = generate_password_hash(OLD)
UID = "123e4567-e89b-12d3-a456-426614174000"
NOW = 1_800_000_000


class Cursor:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class FakeConn:
    """Answers the throttle upsert (allowed unless a key is in `blocked`), the select that finds an old hash, and the rest."""

    def __init__(self, hashes=None, blocked=()):
        self.hashes = hashes or {}                      # email -> (uid, hash)
        self.blocked = set(blocked)
        self.log = []                                   # ("take", key) / ("lookup", email) / ("commit",) / ("clear", key) / ("delete", uid)
        self.now = NOW

    def execute(self, query, params=()):
        q = " ".join(query.split())
        if q.startswith("insert into public.auth_throttle"):
            key = params["k"]
            self.now = params["now"]
            self.log.append(("take", key, params["limit"], params["w"]))
            return Cursor(None if key in self.blocked else {"window_start": params["now"]})
        if q.startswith("select window_start from public.auth_throttle"):
            return Cursor({"window_start": self.now - 100})           # the refused key's window opened 100 s ago
        if q.startswith("select u.id, h.password_hash"):
            self.log.append(("lookup", params[0]))
            found = self.hashes.get(params[0])
            return Cursor({"id": found[0], "password_hash": found[1]} if found else None)
        if q.startswith("delete from public.auth_throttle"):
            self.log.append(("clear", params[0]))
        elif q.startswith("delete from public.legacy_password_hashes"):
            self.log.append(("delete", params[0]))
        else:
            raise AssertionError(f"unexpected statement: {q}")
        return Cursor(None)

    def commit(self):
        self.log.append(("commit",))


class FakeAdmin:
    def __init__(self, raises=None):
        self.set = []
        self.raises = raises

    def set_password(self, uid, password):
        if self.raises:
            raise self.raises
        self.set.append((uid, password))


def run(conn, admin=None, email="Sam@Example.com", password=OLD, caller="198.51.100.7"):
    admin = admin if admin is not None else FakeAdmin()
    return legacy.migrate(conn, admin, email, password, caller, NOW), admin


# -- the happy path and each way it can fail ------------------------------------------------------------------------------------

def test_the_right_password_is_set_in_supabase_and_the_old_hash_and_the_tries_are_cleared():
    conn = FakeConn({"sam@example.com": (UID, HASH)})
    (outcome, wait), admin = run(conn)
    assert (outcome, wait) == (legacy.Outcome.MIGRATED, 0)
    assert admin.set == [(UID, OLD)]
    assert ("delete", UID) in conn.log and ("clear", "legacy:sam@example.com") in conn.log


def test_the_address_is_matched_case_insensitively_and_trimmed():
    conn = FakeConn({"sam@example.com": (UID, HASH)})
    (outcome, _), _admin = run(conn, email="  SAM@EXAMPLE.COM ")
    assert outcome == legacy.Outcome.MIGRATED


def test_a_wrong_password_is_a_mismatch_changes_nothing_and_keeps_the_tries_counted():
    conn = FakeConn({"sam@example.com": (UID, HASH)})
    (outcome, _), admin = run(conn, password="not it")
    assert outcome == legacy.Outcome.MISMATCH and admin.set == []
    assert not any(step[0] in ("delete", "clear") for step in conn.log)


def test_an_unknown_address_and_an_account_with_no_old_hash_are_the_same_mismatch():
    for conn in (FakeConn(), FakeConn({"other@example.com": (UID, HASH)})):
        (outcome, wait), admin = run(conn)
        assert (outcome, wait) == (legacy.Outcome.MISMATCH, 0) and admin.set == []


@pytest.mark.parametrize("email,password", [(None, OLD), ("", OLD), ("not an email", OLD), (5, OLD), (["a@b.co"], OLD), ("a\x00@b.co", OLD),
                                            ("sam@example.com", None), ("sam@example.com", ""), ("sam@example.com", 5), ("sam@example.com", ["x"]),
                                            ("sam@example.com", "x" * (legacy.MAX_PASSWORD_CHARS + 1))])
def test_a_malformed_try_is_a_mismatch_that_never_reaches_supabase(email, password):
    conn = FakeConn({"sam@example.com": (UID, HASH)})
    (outcome, _), admin = run(conn, email=email, password=password)
    assert outcome == legacy.Outcome.MISMATCH and admin.set == []
    assert not any(step[0] == "lookup" for step in conn.log)


def test_a_password_the_project_refuses_is_reported_as_a_reset_and_the_old_hash_stays():
    conn = FakeConn({"sam@example.com": (UID, HASH)})
    (outcome, _), admin = run(conn, admin=FakeAdmin(WeakPassword("too short")))
    assert outcome == legacy.Outcome.RESET_REQUIRED
    assert not any(step[0] in ("delete", "clear") for step in conn.log)


def test_an_outage_setting_the_password_is_an_error_not_a_mismatch_and_the_tries_were_already_committed():
    conn = FakeConn({"sam@example.com": (UID, HASH)})
    with pytest.raises(SupabaseError):
        run(conn, admin=FakeAdmin(SupabaseError("down")))
    assert ("commit",) in conn.log and not any(step[0] in ("delete", "clear") for step in conn.log)


# -- the order of the steps ------------------------------------------------------------------------------------------------------

def test_both_budgets_are_spent_and_committed_before_the_account_is_looked_up_or_anything_is_hashed(monkeypatch):
    hashed = []
    monkeypatch.setattr(legacy, "check_password_hash", lambda h, p: hashed.append(len(conn.log)) or False)
    conn = FakeConn({"sam@example.com": (UID, HASH)})
    run(conn)
    kinds = [step[0] for step in conn.log]
    assert kinds[:4] == ["take", "take", "commit", "lookup"]
    assert [step[1] for step in conn.log[:2]] == ["legacyip:198.51.100.7", "legacy:sam@example.com"]
    assert hashed == [4], "the hash is checked only after the lookup"


def test_the_budgets_are_the_websites_login_limits_per_address_and_a_wider_one_per_caller():
    conn = FakeConn()
    run(conn)
    takes = {step[1]: step[2:] for step in conn.log if step[0] == "take"}
    assert takes["legacy:sam@example.com"] == (10, 900)
    assert takes["legacyip:198.51.100.7"] == (30, 900)


def test_a_caller_over_budget_is_limited_before_anything_else_happens_and_is_told_how_long():
    conn = FakeConn(blocked={"legacyip:198.51.100.7"})
    (outcome, wait), admin = run(conn)
    assert outcome == legacy.Outcome.LIMITED and wait == 800
    assert [step[0] for step in conn.log] == ["take"] and admin.set == []


def test_an_address_over_budget_is_limited_even_with_the_right_password():
    conn = FakeConn({"sam@example.com": (UID, HASH)}, blocked={"legacy:sam@example.com"})
    (outcome, wait), admin = run(conn)
    assert outcome == legacy.Outcome.LIMITED and wait == 800 and admin.set == []
    assert not any(step[0] == "lookup" for step in conn.log)


def test_a_malformed_try_still_spends_the_callers_budget():
    conn = FakeConn()
    run(conn, email=None)
    assert [step[1] for step in conn.log if step[0] == "take"] == ["legacyip:198.51.100.7"]


def test_a_missing_caller_address_still_gets_a_bucket():
    conn = FakeConn()
    run(conn, caller=None)
    assert ("take", "legacyip:unknown", 30, 900) in conn.log
    assert legacy.caller_key("x" * 200) == "legacyip:" + "x" * 64


# -- every miss costs a hash ------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("case", ["unknown", "wrong", "malformed", "match"])
def test_every_kind_of_try_computes_exactly_one_hash(monkeypatch, case):
    calls = []
    real = check_password_hash
    monkeypatch.setattr(legacy, "check_password_hash", lambda h, p: (calls.append(1), real(h, p))[1])
    conn = FakeConn({"sam@example.com": (UID, HASH)} if case in ("wrong", "match") else {})
    run(conn, email=None if case == "malformed" else "sam@example.com", password="nope" if case == "wrong" else OLD)
    assert len(calls) == 1


def test_the_dummy_hash_is_a_real_scrypt_hash_computed_once():
    first = legacy._dummy_hash()
    assert first.startswith("scrypt:") and legacy._dummy_hash() is first
    assert not check_password_hash(first, OLD)


def test_hashes_the_website_wrote_verify():
    """The importer carries werkzeug's default scrypt hashes across unchanged."""
    assert check_password_hash(generate_password_hash("hunter2hunter2"), "hunter2hunter2")


# -- the route ----------------------------------------------------------------------------------------------------------------------

class RouteDb:
    def __init__(self, conn):
        self.conn = conn

    @contextlib.contextmanager
    def connection(self):
        yield self.conn


def client(conn, admin=None):
    app = create_app(dataclasses.replace(SETTINGS), db=RouteDb(conn), verifier=verifier(), storage=object(), auth_admin=admin or FakeAdmin(), sweep=False)
    return app.test_client()


def post(c, **body):
    return c.post("/api/auth/legacy-login", json=body, headers={"X-Forwarded-For": "198.51.100.7"})


def test_it_needs_no_token():
    r = post(client(FakeConn({"sam@example.com": (UID, HASH)})), email="sam@example.com", password=OLD)
    assert r.status_code == 200 and r.get_json() == {"ok": True}


def test_every_failure_to_match_is_the_same_401_body():
    bodies = set()
    for conn, email, password in ((FakeConn(), "sam@example.com", OLD), (FakeConn({"sam@example.com": (UID, HASH)}), "sam@example.com", "wrong"),
                                  (FakeConn(), "nope", OLD), (FakeConn(), None, None)):
        r = post(client(conn), email=email, password=password)
        assert r.status_code == 401
        bodies.add(r.get_data(as_text=True))
    assert len(bodies) == 1 and "don't match" in bodies.pop()


def test_a_limit_is_a_429_with_retry_after_and_never_says_which_budget():
    r = post(client(FakeConn(blocked={"legacy:sam@example.com"})), email="sam@example.com", password=OLD)
    assert r.status_code == 429 and r.headers["Retry-After"] == "800"
    assert r.get_json() == {"ok": False, "error": "Too many tries. Please wait a few minutes and try again."}


def test_a_refused_password_is_a_409_that_asks_for_a_reset():
    r = post(client(FakeConn({"sam@example.com": (UID, HASH)}), FakeAdmin(WeakPassword("x"))), email="sam@example.com", password=OLD)
    assert r.status_code == 409 and r.get_json()["reset_required"] is True


def test_a_body_that_is_not_an_object_is_just_a_mismatch():
    c = client(FakeConn())
    for raw in ("[]", "5", "null", "", "not json"):
        assert c.post("/api/auth/legacy-login", data=raw, content_type="application/json").status_code == 401


def test_the_callers_address_is_the_one_the_proxy_appended_not_a_header_the_caller_wrote():
    conn = FakeConn()
    client(conn).post("/api/auth/legacy-login", json={"email": "a@b.co", "password": "x"}, headers={"X-Forwarded-For": "6.6.6.6, 203.0.113.9"})
    assert ("take", "legacyip:203.0.113.9", 30, 900) in conn.log


# -- the generic counter ----------------------------------------------------------------------------------------------------------

def test_throttle_take_reports_the_wait_when_refused_and_clear_forgets_the_key():
    conn = FakeConn(blocked={"k"})
    assert throttle.take(conn, "ok", 5, 60, NOW) == (True, 0)
    allowed, wait = throttle.take(conn, "k", 5, 60, NOW)
    assert (allowed, wait) == (False, 1)          # a window that has run out by the time we look still says 1 s, never 0 or negative
    throttle.clear(conn, "k")
    assert ("clear", "k") in conn.log
