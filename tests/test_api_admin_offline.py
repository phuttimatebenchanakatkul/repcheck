"""The waitlist and owner endpoints' pure parts and their offline-testable routes (refusals before any database use, and the
visitor key the limit counts under). No network, no database."""

import contextlib
import dataclasses
import datetime as dt
import re

import pytest

import app as website
import database
from api import admin
from api.app import create_app
from api.settings import Settings, from_env
from test_api_auth import FAKE_DB_URL, SETTINGS, token, verifier


# -- constants are the website's --------------------------------------------------------------------------------------------------

def test_the_waitlist_constants_are_the_websites():
    assert admin.WAITLIST_ORIGINS == website.WAITLIST_ORIGINS
    assert (admin.WAITLIST_LIMIT, admin.WAITLIST_WINDOW) == (website.WAITLIST_LIMIT, website.WAITLIST_WINDOW)
    assert admin.THAILAND_TZ == website.THAILAND_TZ and set(admin.RANGES) == website.ADMIN_SIGNUP_RANGES
    assert admin.MODERATED_DISPLAY_NAME == database.MODERATED_DISPLAY_NAME


def test_every_label_the_website_shows_is_still_shown():
    assert {k: v for k, v in website.ADMIN_FEATURE_LABELS.items()}.items() <= admin.FEATURE_LABELS.items()
    pages = {k: v for k, v in website.ADMIN_PAGE_LABELS.items() if k in admin.PAGE_LABELS}
    assert pages.items() <= admin.PAGE_LABELS.items() and set(admin.PAGE_LABELS) <= set(website.ADMIN_PAGE_LABELS)


# -- the address -----------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("a@b.co", "a@b.co"), ("  Mixed.Case@Example.COM \n", "mixed.case@example.com"), ("a+tag@b.co", "a+tag@b.co"), ("é@b.co", "é@b.co"),
    ("", None), ("   ", None), ("nope", None), ("a@b", None), ("a@@b.co", None), ("a b@c.co", None), ("@b.co", None), ("a@.co", None),
    (None, None), (5, None), (True, None), ([], None), (["a@b.co"], None), ({"a": 1}, None),
    ("a\x00@b.co", None), ("a\n@b.co", None), ("a\x7f@b.co", None), ("a@b.co\x00", None),
    ("x" * 250 + "@b.co", None), ("x" * 249 + "@b.co", "x" * 249 + "@b.co"),
])
def test_an_address_is_trimmed_lower_cased_and_must_look_like_one(raw, expected):
    assert admin.clean_email(raw) == expected


def test_the_pattern_is_the_websites_for_every_address_a_person_could_type():
    pattern = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    for text in ("a@b.co", "a@b", "a b@c.co", "@b.co", "a@.co", "a@b.", "a@b.c.d", "ünï@cödé.org", "a@b .co", "a@b .co", "a@b .co"):
        website_says = len(text) <= 254 and bool(pattern.match(text.strip().lower()))
        assert (admin.clean_email(text) is not None) == website_says, text


@pytest.mark.parametrize("raw,expected", [
    ("marketing", "marketing"), (None, None), ("", None), (5, None), (["x"], None), ("a" * 100, "a" * 64), ("a\x00b\nc", "abc"), ("\x00\x01", None),
])
def test_the_source_is_clipped_cleaned_and_must_be_text(raw, expected):
    assert admin.clean_source(raw) == expected


# -- the spreadsheet ---------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("plain", "plain"), ("=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"), ("+1", "'+1"), ("-1", "'-1"), ("@SUM(A1)", "'@SUM(A1)"), ("\tx", "'\tx"), ("\rx", "'\rx"),
    ("a=b", "a=b"), ("", ""), (None, ""), (5, "5"),
])
def test_a_cell_that_could_run_as_a_formula_is_defused(raw, expected):
    assert admin.spreadsheet_safe(raw) == expected


def test_the_csv_has_the_websites_header_quoting_and_line_endings():
    entries = [{"email": "a@b.co", "source": "hero", "created_at": "2026-03-01T10:00:00+00:00"},
               {"email": "=x@evil.com", "source": 'say "hi"', "created_at": "2026-03-02T10:00:00+00:00"},
               {"email": "c@d.co", "source": None, "created_at": "2026-03-03T10:00:00+00:00"}]
    assert admin.waitlist_csv(entries) == ('email,source,joined_utc\r\n'
                                           '"a@b.co","hero","2026-03-01T10:00:00+00:00"\r\n'
                                           '"\'=x@evil.com","say ""hi""","2026-03-02T10:00:00+00:00"\r\n'
                                           '"c@d.co","","2026-03-03T10:00:00+00:00"\r\n')
    assert admin.waitlist_csv([]) == "email,source,joined_utc\r\n"


# -- signup ranges ------------------------------------------------------------------------------------------------------------------------

NOW = dt.datetime(2026, 3, 10, 20, 30, tzinfo=dt.timezone.utc)          # 03:30 on the 11th in Bangkok


def test_today_is_bangkoks_calendar_day_not_utcs():
    assert admin.signup_cutoff("today", NOW) == dt.datetime(2026, 3, 11, 0, 0, tzinfo=admin.THAILAND_TZ)
    assert admin.signup_cutoff("today", NOW).astimezone(dt.timezone.utc) == dt.datetime(2026, 3, 10, 17, 0, tzinfo=dt.timezone.utc)


def test_week_month_and_all():
    assert admin.signup_cutoff("week", NOW) == NOW - dt.timedelta(days=7)
    assert admin.signup_cutoff("month", NOW) == NOW - dt.timedelta(days=30)
    assert admin.signup_cutoff("all", NOW) is None and admin.signup_cutoff("anything", NOW) is None


def test_usage_events_split_into_pages_and_features_with_labels():
    stamp = dt.datetime(2026, 3, 1, tzinfo=dt.timezone.utc)
    pages, features = admin.usage_split([
        {"event": "page:nutrition", "count": 4, "last_at": stamp}, {"event": "feature:food_scan", "count": 2, "last_at": stamp},
        {"event": "page:brand_new", "count": 1, "last_at": stamp}, {"event": "feature:other_thing", "count": 1, "last_at": stamp}])
    assert [(p["label"], p["count"]) for p in pages] == [("Nutrition", 4), ("brand_new", 1)]
    assert [(f["label"], f["count"]) for f in features] == [("Food photo scans (AI)", 2), ("other_thing", 1)]
    assert pages[0]["last_at"] == stamp.isoformat() and pages[0]["event"] == "page:nutrition"


# -- who is the owner -------------------------------------------------------------------------------------------------------------------------

BASE_ENV = {"SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k", "SUPABASE_DB_URL": FAKE_DB_URL}


def test_only_admin_emails_makes_an_admin_not_the_review_account(tmp_path):
    s = from_env(dict(BASE_ENV, ADMIN_EMAILS=" Owner@Example.com, second@example.com ,", REVIEW_ACCOUNT_EMAILS="reviewer@example.com"), env_file=tmp_path / "none.env")
    assert s.admin_emails == frozenset({"owner@example.com", "second@example.com"})
    assert "reviewer@example.com" in s.rate_limit_exempt and "reviewer@example.com" not in s.admin_emails


def test_nobody_is_an_admin_by_default(tmp_path):
    assert from_env(BASE_ENV, env_file=tmp_path / "none.env").admin_emails == frozenset()
    assert SETTINGS.admin_emails == frozenset()


def test_the_admin_check_uses_the_verified_address_case_insensitively():
    settings = dataclasses.replace(SETTINGS, admin_emails=frozenset({"owner@example.com"}))
    Identity = type("Identity", (), {"__init__": lambda self, email: setattr(self, "email", email)})
    assert admin.is_admin(settings, Identity("OWNER@example.com")) and not admin.is_admin(settings, Identity("other@example.com"))
    assert not admin.is_admin(settings, Identity(None)) and not admin.is_admin(settings, Identity(""))


# -- routes that need no database ---------------------------------------------------------------------------------------------------------------

class ExplodingDb:
    @contextlib.contextmanager
    def connection(self):
        raise AssertionError("the database must not be touched")
        yield


def app_for(email="a@example.com", admins=(), db=None):
    settings = dataclasses.replace(SETTINGS, admin_emails=frozenset(admins))
    app = create_app(settings, db=db or ExplodingDb(), verifier=verifier(), storage=object(), auth_admin=object(), sweep=False)
    c = app.test_client()
    return c


def signed_in(c, email):
    import test_api_auth
    c.environ_base["HTTP_AUTHORIZATION"] = "Bearer " + token(test_api_auth.claims(email=email))
    return c


ADMIN_ROUTES = [("get", "/api/admin/reports"), ("post", "/api/admin/reports/1/reset-name"), ("post", "/api/admin/reports/1/handled"),
                ("post", "/api/admin/ai-reports/1/handled"), ("get", "/api/admin/waitlist"), ("post", "/api/admin/waitlist/delete"),
                ("get", "/api/admin/users"), ("get", "/api/admin/users/123e4567-e89b-12d3-a456-426614174000")]


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_every_admin_route_is_a_404_for_anyone_who_is_not_the_owner_and_a_401_for_nobody(method, path):
    c = app_for(admins={"owner@example.com"})
    assert getattr(c, method)(path).status_code == 401
    signed_in(c, "someone@example.com")
    r = getattr(c, method)(path)
    assert r.status_code == 404 and r.get_json() == {"ok": False, "error": "Not found."}


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_the_review_account_is_not_an_admin(method, path):
    settings = dataclasses.replace(SETTINGS, rate_limit_exempt=frozenset({"reviewer@example.com"}), admin_emails=frozenset({"owner@example.com"}))
    c = create_app(settings, db=ExplodingDb(), verifier=verifier(), storage=object(), auth_admin=object(), sweep=False).test_client()
    signed_in(c, "reviewer@example.com")
    assert getattr(c, method)(path).status_code == 404


def test_a_bad_user_id_in_the_admin_detail_is_a_404_without_touching_the_database():
    c = signed_in(app_for(admins={"owner@example.com"}), "owner@example.com")
    for bad in ("5", "nope", "123e4567"):
        assert c.get(f"/api/admin/users/{bad}").status_code == 404


@pytest.mark.parametrize("body", [{}, {"email": ""}, {"email": "nope"}, {"email": 5}, {"email": ["a@b.co"]}, {"email": "a\x00@b.co"}, {"source": "x"}])
def test_a_bad_waitlist_address_is_the_websites_invalid_email_before_any_database_use(body):
    r = app_for().post("/api/waitlist", json=body)
    assert r.status_code == 400 and r.get_json() == {"error": "invalid-email"}


def test_a_waitlist_body_that_is_not_an_object_is_invalid_not_a_crash():
    c = app_for()
    for raw in ("[]", "5", "null", "", "not json"):
        assert c.post("/api/waitlist", data=raw, content_type="application/json").status_code == 400


def test_the_waitlist_needs_no_sign_in_and_answers_the_preflight():
    r = app_for().options("/api/waitlist", headers={"Origin": "https://repcheck-marketing.onrender.com"})
    assert r.status_code == 204 and r.headers["Access-Control-Allow-Origin"] == "https://repcheck-marketing.onrender.com"
    assert r.headers["Vary"] == "Origin" and r.headers["Access-Control-Allow-Methods"] == "POST, OPTIONS"
    assert r.headers["Access-Control-Allow-Headers"] == "Content-Type" and r.headers["Access-Control-Max-Age"] == "86400"


@pytest.mark.parametrize("origin", ["https://evil.example", "https://repcheck-marketing.onrender.com.evil.example", "http://repcheck-marketing.onrender.com",
                                    "*", "null", "", "https://REPCHECK-MARKETING.onrender.com"])
def test_any_other_origin_gets_no_cors_headers_at_all(origin):
    c = app_for()
    for r in (c.options("/api/waitlist", headers={"Origin": origin}), c.post("/api/waitlist", json={"email": "x"}, headers={"Origin": origin})):
        assert not any(h.lower().startswith("access-control") for h in r.headers.keys()) and "Vary" not in r.headers


def test_the_second_marketing_hostname_is_allowed_too():
    r = app_for().post("/api/waitlist", json={"email": "x"}, headers={"Origin": "https://repcheckofficials.onrender.com"})
    assert r.status_code == 400 and r.headers["Access-Control-Allow-Origin"] == "https://repcheckofficials.onrender.com"


# -- the visitor key the limit counts under ----------------------------------------------------------------------------------------------------------

class RecordingDb:
    """A connection that records every statement and answers the waitlist's three: take a try, add an address."""

    def __init__(self, allowed=True):
        self.seen, self.allowed = [], allowed

    @contextlib.contextmanager
    def connection(self):
        db = self

        class Cursor:
            def __init__(self, row):
                self.row = row

            def fetchone(self):
                return self.row

        class Conn:
            def execute(self, query, params=()):
                db.seen.append((query, params))
                if "auth_throttle" in query and query.lstrip().startswith("insert"):
                    return Cursor({"window_start": 1} if db.allowed else None)
                if "auth_throttle" in query:
                    return Cursor({"window_start": 1_000_000_000})
                return Cursor({"id": 1})
        yield Conn()


def test_the_limit_counts_under_the_address_the_proxy_appended_not_a_header_the_caller_wrote():
    db = RecordingDb()
    c = app_for(db=db)
    r = c.post("/api/waitlist", json={"email": "a@b.co"}, headers={"X-Forwarded-For": "6.6.6.6, 203.0.113.9"})
    assert r.status_code == 200
    key = db.seen[0][1]["k"]
    assert key == "waitlist:203.0.113.9"


def test_a_very_long_forwarded_address_cannot_make_a_very_long_key():
    db = RecordingDb()
    app_for(db=db).post("/api/waitlist", json={"email": "a@b.co"}, headers={"X-Forwarded-For": "9" * 300})
    assert db.seen[0][1]["k"] == "waitlist:" + "9" * 64


def test_a_visitor_over_the_limit_gets_rate_limited_and_nothing_is_stored():
    db = RecordingDb(allowed=False)
    r = app_for(db=db).post("/api/waitlist", json={"email": "a@b.co"}, headers={"X-Forwarded-For": "203.0.113.9"})
    assert r.status_code == 429 and r.get_json()["error"] == "rate-limited" and r.get_json()["retry_after_seconds"] >= 1
    assert not any("waitlist (" in q for q, _p in db.seen)


def test_the_address_and_source_are_stored_cleaned():
    db = RecordingDb()
    app_for(db=db).post("/api/waitlist", json={"email": "  A@B.Co ", "source": "hero\x00" + "z" * 100}, headers={"X-Forwarded-For": "203.0.113.9"})
    insert = [p for q, p in db.seen if "public.waitlist" in q][0]
    assert insert == ("a@b.co", "hero" + "z" * 60)
