"""The waitlist and the owner's endpoints against the REAL Supabase project. Throwaway people and throwaway addresses
(`@example.invalid`), everything removed afterwards. Mutation-check any change here (CLAUDE.md)."""

import contextlib
import dataclasses
import secrets
import threading
import time

import pytest

from api import admin, social
from api.app import create_app
from api_support import bearer, client, db, forget, person, settings, storage  # noqa: F401 -- the fixtures are used by name
from test_supabase_rls import Person, needs_api, needs_db

pytestmark = [needs_api, needs_db]

ORIGIN = {"Origin": "https://repcheck-marketing.onrender.com"}


def sql(db, query, params=()):
    with db.connection() as conn:
        cur = conn.execute(query, params)
        return cur.fetchall() if cur.description else None


def fresh_ip():
    return f"198.51.100.{secrets.randbelow(250) + 1}"


def fresh_email(label="w"):
    return f"{label}-{secrets.token_hex(5)}@example.invalid"


@contextlib.contextmanager
def visitor(db):
    """A unique visitor address whose throttle row and signups are removed afterwards."""
    ip, emails = f"test-visitor-{secrets.token_hex(6)}", []      # the key is only a string; this one cannot collide with a real visitor
    key = "waitlist:" + ip
    try:
        yield ip, emails, key
    finally:
        sql(db, "delete from public.auth_throttle where key = %s", (key,))
        for email in emails:
            sql(db, "delete from public.waitlist where email = %s", (email,))


def join(c, ip, email, **extra):
    return c.post("/api/waitlist", json=dict({"email": email}, **extra), headers={"X-Forwarded-For": ip, **ORIGIN})


def stored(db, email):
    rows = sql(db, "select email, source from public.waitlist where email = %s", (email,))
    return rows[0] if rows else None


# -- the waitlist ----------------------------------------------------------------------------------------------------------------

def test_joining_stores_the_address_lower_cased_with_its_source_and_a_repeat_changes_nothing(client, db):
    with visitor(db) as (ip, emails, _key):
        email = fresh_email("Join")
        emails.append(email.lower())
        r = join(client, ip, "  " + email.upper() + " ", source="hero-form")
        assert r.status_code == 200 and r.get_json() == {"ok": True, "already": False}
        assert r.headers["Access-Control-Allow-Origin"] == ORIGIN["Origin"] and r.headers["Vary"] == "Origin"
        assert stored(db, email.lower()) == {"email": email.lower(), "source": "hero-form"}
        again = join(client, ip, email.lower(), source="other-form")
        assert again.status_code == 200 and again.get_json() == {"ok": True, "already": True}
        assert stored(db, email.lower())["source"] == "hero-form", "a repeat must not overwrite what was recorded"
        assert len(sql(db, "select 1 as one from public.waitlist where email = %s", (email.lower(),))) == 1


def test_a_known_address_gets_the_same_status_as_a_new_one(client, db):
    with visitor(db) as (ip, emails, _key):
        email = fresh_email()
        emails.append(email)
        first, second = join(client, ip, email), join(client, ip, email)
        assert first.status_code == second.status_code == 200 and set(first.get_json()) == set(second.get_json())


def test_the_sixth_try_in_an_hour_is_rate_limited_and_stores_nothing(client, db):
    with visitor(db) as (ip, emails, key):
        for n in range(admin.WAITLIST_LIMIT):
            email = fresh_email(f"ok{n}")
            emails.append(email)
            assert join(client, ip, email).status_code == 200
        blocked = fresh_email("blocked")
        emails.append(blocked)
        r = join(client, ip, blocked)
        assert r.status_code == 429 and r.get_json()["error"] == "rate-limited" and 3500 <= r.get_json()["retry_after_seconds"] <= 3600
        assert r.headers["Access-Control-Allow-Origin"] == ORIGIN["Origin"]
        assert stored(db, blocked) is None
        assert sql(db, "select count from public.auth_throttle where key = %s", (key,))[0]["count"] == admin.WAITLIST_LIMIT, "a refused try is not another try"


def test_a_repeat_of_a_known_address_still_spends_a_try(client, db):
    with visitor(db) as (ip, emails, key):
        email = fresh_email()
        emails.append(email)
        for _ in range(admin.WAITLIST_LIMIT):
            join(client, ip, email)
        assert join(client, ip, email).status_code == 429


def test_the_limit_is_per_visitor_and_a_new_hour_starts_fresh(client, db):
    with visitor(db) as (ip, emails, key), visitor(db) as (other_ip, other_emails, other_key):
        for n in range(admin.WAITLIST_LIMIT):
            emails.append(fresh_email(f"a{n}"))
            join(client, ip, emails[-1])
        other_emails.append(fresh_email("b"))
        assert join(client, other_ip, other_emails[-1]).status_code == 200
        emails.append(fresh_email("late"))
        assert join(client, ip, emails[-1]).status_code == 429
        sql(db, "update public.auth_throttle set window_start = %s where key = %s", (int(time.time()) - admin.WAITLIST_WINDOW, key))
        assert join(client, ip, emails[-1]).status_code == 200
        assert sql(db, "select count from public.auth_throttle where key = %s", (key,))[0]["count"] == 1
        emails.append(fresh_email("again"))
        assert join(client, ip, emails[-1]).status_code == 200
        row = sql(db, "select count, window_start from public.auth_throttle where key = %s", (key,))[0]
        assert row["count"] == 2 and row["window_start"] > int(time.time()) - 120, "the new window must have started now and count up from there"


def test_a_bad_address_is_refused_and_does_not_spend_a_try(client, db):
    with visitor(db) as (ip, emails, key):
        for bad in ("nope", "", "a@b", 5, None, "a\x00@b.co"):
            assert join(client, ip, bad).status_code == 400
        assert sql(db, "select count from public.auth_throttle where key = %s", (key,)) == []


def test_ten_simultaneous_tries_let_exactly_five_through(settings, db, storage):
    c = create_app(settings, db=db, storage=storage, sweep=False).test_client()
    with visitor(db) as (ip, emails, key):
        results, gate = [], threading.Barrier(10)
        addresses = [fresh_email(f"burst{n}") for n in range(10)]
        emails.extend(addresses)

        def go(email):
            gate.wait()
            results.append(join(c, ip, email).status_code)
        threads = [threading.Thread(target=go, args=(e,)) for e in addresses]
        [t.start() for t in threads]
        [t.join(120) for t in threads]
        assert sorted(results) == [200] * 5 + [429] * 5
        assert len([e for e in addresses if stored(db, e)]) == 5


def test_a_signup_with_a_source_that_is_not_text_is_stored_without_one(client, db):
    with visitor(db) as (ip, emails, _key):
        email = fresh_email()
        emails.append(email)
        assert join(client, ip, email, source=["x"]).status_code == 200
        assert stored(db, email)["source"] is None


# -- the owner's endpoints --------------------------------------------------------------------------------------------------------------

@contextlib.contextmanager
def owner_app(settings, db, storage, *labels):
    """An app whose admin is a fresh account, plus that account and any extra people, all with profiles."""
    people = []
    try:
        owner = Person("owner")
        people.append(owner)
        s = dataclasses.replace(settings, admin_emails=frozenset({owner.email.lower()}))
        c = create_app(s, db=db, storage=storage, sweep=False).test_client()
        for who in (owner,) + tuple(Person(label) for label in labels):
            if who is not owner:
                people.append(who)
            assert c.post("/api/profile", headers=bearer(who), json={"name": who.email.split("-")[1].title()}).status_code == 201
        yield c, people
    finally:
        for p in people:
            forget(p)


def get(c, who, path):
    return c.get(path, headers=bearer(who))


def post(c, who, path, **body):
    return c.post(path, headers=bearer(who), json=body)


def test_a_signed_in_stranger_gets_a_404_and_the_owner_gets_in(settings, db, storage):
    with owner_app(settings, db, storage, "nosy") as (c, (owner, nosy)):
        for path in ("/api/admin/reports", "/api/admin/waitlist", "/api/admin/users"):
            assert get(c, nosy, path).status_code == 404
            assert get(c, owner, path).status_code == 200


def test_reports_are_listed_oldest_first_with_both_names_and_handled_ones_disappear(settings, db, storage):
    with owner_app(settings, db, storage, "alice", "bob", "troll") as (c, (owner, alice, bob, troll)):
        post(c, alice, "/api/safety/report", user_id=troll.id, reason="spam")
        time.sleep(0.05)
        post(c, bob, "/api/safety/report", user_id=troll.id, reason="offensive_name")
        body = get(c, owner, "/api/admin/reports").get_json()
        mine = [r for r in body["reports"] if r["reported_id"] == troll.id]
        assert [(r["reporter_name"], r["reported_name"], r["reason"]) for r in mine] == [("Alice", "Troll", "spam"), ("Bob", "Troll", "offensive_name")]
        first = mine[0]["id"]
        assert post(c, owner, f"/api/admin/reports/{first}/handled").get_json() == {"ok": True, "changed": True}
        assert post(c, owner, f"/api/admin/reports/{first}/handled").get_json() == {"ok": True, "changed": False}
        assert [r["reporter_name"] for r in get(c, owner, "/api/admin/reports").get_json()["reports"] if r["reported_id"] == troll.id] == ["Bob"]


def test_resetting_a_name_replaces_it_and_closes_every_open_report_against_that_account(settings, db, storage):
    with owner_app(settings, db, storage, "alice", "bob", "troll", "other") as (c, (owner, alice, bob, troll, other)):
        post(c, alice, "/api/safety/report", user_id=troll.id)
        post(c, bob, "/api/safety/report", user_id=troll.id)
        post(c, alice, "/api/safety/report", user_id=other.id)
        report = [r for r in get(c, owner, "/api/admin/reports").get_json()["reports"] if r["reported_id"] == troll.id][0]["id"]
        assert post(c, owner, f"/api/admin/reports/{report}/reset-name").get_json() == {"ok": True, "reset": troll.id}
        assert sql(db, "select name from public.profiles where id = %s", (troll.id,))[0]["name"] == "RepCheck User"
        left = [r["reported_id"] for r in get(c, owner, "/api/admin/reports").get_json()["reports"]]
        assert troll.id not in left and other.id in left, "only the reset account's reports close"
        assert sql(db, "select name from public.profiles where id = %s", (other.id,))[0]["name"] == "Other"


def test_resetting_or_handling_a_report_that_does_not_exist(settings, db, storage):
    with owner_app(settings, db, storage) as (c, (owner,)):
        r = post(c, owner, "/api/admin/reports/987654321/reset-name")
        assert r.status_code == 404 and r.get_json() == {"ok": False, "error": "Report not found."}
        assert post(c, owner, "/api/admin/reports/987654321/handled").get_json() == {"ok": True, "changed": False}
        assert post(c, owner, "/api/admin/ai-reports/987654321/handled").get_json() == {"ok": True, "changed": False}


def test_ai_reports_are_listed_with_the_reply_and_can_be_handled(settings, db, storage):
    with owner_app(settings, db, storage, "alice") as (c, (owner, alice)):
        post(c, alice, "/api/ai-report", reply="bad advice", feature="coach", reason="harmful")
        mine = [r for r in get(c, owner, "/api/admin/reports").get_json()["ai_reports"] if r["reporter_name"] == "Alice"]
        assert [(r["feature"], r["reason"], r["reply_text"]) for r in mine] == [("coach", "harmful", "bad advice")]
        assert post(c, owner, f"/api/admin/ai-reports/{mine[0]['id']}/handled").get_json() == {"ok": True, "changed": True}
        assert [r for r in get(c, owner, "/api/admin/reports").get_json()["ai_reports"] if r["reporter_name"] == "Alice"] == []


def test_the_waitlist_lists_newest_first_and_exports_a_csv_that_cannot_run_a_formula(settings, db, storage):
    with owner_app(settings, db, storage) as (c, (owner,)):
        older, newer, evil = fresh_email("old"), fresh_email("new"), "=cmd" + fresh_email("evil")
        try:
            sql(db, "insert into public.waitlist (email, source, created_at) values (%s, 'a', now() - interval '2 days'), (%s, 'b', now() - interval '1 day'), (%s, %s, now())",
                (older, newer, evil, '=1+1"x'))
            body = get(c, owner, "/api/admin/waitlist").get_json()
            emails = [e["email"] for e in body["entries"]]
            assert body["ok"] is True and body["total"] == len(emails)
            assert emails.index(evil) < emails.index(newer) < emails.index(older)
            csv = get(c, owner, "/api/admin/waitlist?format=csv")
            assert csv.status_code == 200 and csv.headers["Content-Type"] == "text/csv; charset=utf-8"
            assert csv.headers["Content-Disposition"] == 'attachment; filename="repcheck_waitlist.csv"'
            text = csv.get_data(as_text=True)
            assert text.startswith("email,source,joined_utc\r\n") and f'"\'{evil}","\'=1+1""x"' in text and f'"{older}","a",' in text
        finally:
            for email in (older, newer, evil):
                sql(db, "delete from public.waitlist where email = %s", (email,))


def test_an_address_is_erased_on_request_in_any_case_and_only_that_one(settings, db, storage):
    with owner_app(settings, db, storage) as (c, (owner,)):
        keep, drop = fresh_email("keep"), fresh_email("drop")
        try:
            sql(db, "insert into public.waitlist (email) values (%s), (%s)", (keep, drop))
            assert post(c, owner, "/api/admin/waitlist/delete", email="  " + drop.upper() + " ").get_json() == {"ok": True, "removed": True}
            assert post(c, owner, "/api/admin/waitlist/delete", email=drop).get_json() == {"ok": True, "removed": False}
            assert stored(db, drop) is None and stored(db, keep) is not None
            for bad in ({}, {"email": ""}, {"email": 5}, {"email": ["x"]}, {"email": None}):
                assert post(c, owner, "/api/admin/waitlist/delete", **bad).get_json() == {"ok": True, "removed": False}
        finally:
            sql(db, "delete from public.waitlist where email = any(%s)", ([keep, drop],))


def test_the_user_list_has_name_and_email_and_honours_the_range(settings, db, storage):
    with owner_app(settings, db, storage, "recent", "old") as (c, (owner, recent, old)):
        sql(db, "update public.profiles set created_at = now() - interval '45 days' where id = %s", (old.id,))
        def ids(range_key):
            return {u["id"]: u for u in get(c, owner, f"/api/admin/users?range={range_key}").get_json()["users"]}
        today, week, month, everyone = ids("today"), ids("week"), ids("month"), ids("all")
        assert recent.id in today and recent.id in week and recent.id in month and recent.id in everyone
        assert old.id in everyone and old.id not in month and old.id not in today
        assert everyone[recent.id]["email"] == recent.email and everyone[recent.id]["name"] == "Recent"
        assert get(c, owner, "/api/admin/users?range=bogus").get_json()["range"] == "today"
        assert get(c, owner, "/api/admin/users").get_json()["range"] == "today"


def test_the_user_detail_shows_usage_and_counts(settings, db, storage):
    with owner_app(settings, db, storage, "active") as (c, (owner, active)):
        sql(db, "insert into public.usage_events (user_id, event, count) values (%s, 'page:nutrition', 3), (%s, 'feature:food_scan', 2), (%s, 'feature:mystery', 1)",
            (active.id, active.id, active.id))
        sql(db, "insert into public.weight_entries (user_id, log_date, kg, logged_at) values (%s, '2026-03-01', 80, now()), (%s, '2026-03-05', 79.5, now())", (active.id, active.id))
        sql(db, "insert into public.weight_entries (user_id, log_date, kg, logged_at) values (%s, '2026-03-09', 70, now())", (owner.id,))
        sql(db, "insert into public.analyze_results (user_id, exercise_label, feedback_text, overall_score) values (%s, 'Squat', 'f', 7)", (active.id,))
        body = get(c, owner, f"/api/admin/users/{active.id}").get_json()
        user = body["user"]
        assert body["ok"] is True and (user["id"], user["name"], user["email"], user["ai_consent"], user["deleted_at"]) == (active.id, "Active", active.email, False, None)
        assert [(p["label"], p["count"]) for p in user["page_views"]] == [("Nutrition", 3)]
        assert [(f["label"], f["count"]) for f in user["feature_uses"]] == [("Food photo scans (AI)", 2), ("mystery", 1)]
        assert user["counts"]["weigh_ins"] == 2 and user["counts"]["analyses"] == 1 and user["counts"]["friends"] == 0
        assert user["latest_weight"] == {"date": "2026-03-05", "kg": 79.5}
        assert [(a["exercise_label"], a["overall_score"]) for a in user["analyses"]] == [("Squat", 7)]


@pytest.mark.parametrize("target", ["00000000-0000-0000-0000-000000000000", "5", "nope"])
def test_the_detail_of_someone_who_does_not_exist_is_a_404(settings, db, storage, target):
    with owner_app(settings, db, storage) as (c, (owner,)):
        assert get(c, owner, f"/api/admin/users/{target}").status_code == 404


def test_the_detail_page_does_not_hand_out_other_peoples_data_to_strangers(settings, db, storage):
    with owner_app(settings, db, storage, "nosy", "victim") as (c, (owner, nosy, victim)):
        assert get(c, nosy, f"/api/admin/users/{victim.id}").status_code == 404
