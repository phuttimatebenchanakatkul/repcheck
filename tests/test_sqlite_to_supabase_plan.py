"""Offline tests for the parts of scripts/migrate_sqlite_to_supabase.py that sit
around the per-user mappers: `build_plan` (what is imported, what is orphaned, what
is quarantined), the accounting check, the operator's report, `main`'s offline
paths, and the IO helpers against fakes.

The guarantee most worth pinning is the privacy one: rows whose owner is gone from
`users` (SQLite never enforced its foreign keys, so deleting an account left them
behind) are counted and NOT imported, not even into quarantine.

No network and no database: the source is a temp SQLite built with the repo's own
`database.init_db()`, so a column added there is seen here.

Mutation-check (CLAUDE.md): e.g. make an orphan quarantine instead of count, drop the
`v not in uuids` filter, or skip the mode check, and confirm the matching test fails.
"""

import importlib.util
import json
import re
import sqlite3
import sys
import types

import pytest

import database
from importer_loader import imp


# -- fixtures -------------------------------------------------------------------

@pytest.fixture
def source(tmp_path, monkeypatch):
    """A SQLite file with the CURRENT schema and no rows; returns (path, connection)."""
    path = tmp_path / "src.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    database.init_db()
    conn = sqlite3.connect(path)
    yield path, conn
    conn.close()


def add_user(c, uid, **kw):
    row = {"email": f"u{uid}@example.com", "name": f"User {uid}", "password_hash": None, "auth_provider": "local",
           "provider_user_id": None, "avatar_url": None, "friend_code": None, "onboarding_completed": 1,
           "deleted_at": None, "ai_consent_at": None, "created_at": "2026-09-01 08:30:00"}
    row.update(kw)
    cols = ", ".join(row)
    c.execute(f"insert into users (id, {cols}) values (?, {', '.join('?' * len(row))})", (uid, *row.values()))


GHOST = 99  # an account that is not in `users`


# -- orphans: a deleted account's data must not follow the migration --------------

def test_rows_of_accounts_that_no_longer_exist_are_counted_and_not_imported(source):
    _path, c = source
    add_user(c, 1)
    add_user(c, 2)
    c.execute("insert into rate_limits values (?, 'food', 1, 1)", (GHOST,))
    c.execute("insert into usage_events (user_id, event, count) values (?, 'page:home', 1)", (GHOST,))
    c.execute("insert into friends (user_id, friend_id) values (?, 1)", (GHOST,))
    c.execute("insert into challenges (id, creator_id, exercise) values (5, ?, 'pushup')", (GHOST,))
    c.execute("insert into custom_foods (id, user_id, name, emoji, calories, protein, fat, carbs) values (1, ?, 'f', 'x', 1, 0, 0, 0)", (GHOST,))
    c.execute("insert into custom_exercises (id, user_id, name) values (1, ?, 'move')", (GHOST,))
    c.execute("insert into hyrox_results (id, user_id, gender, category, format, total_seconds) values (1, ?, 'men', 'open', 'singles', 1)", (GHOST,))
    c.execute("insert into analyze_results (id, user_id, exercise_label, feedback_text) values (1, ?, 'Squat', 'f')", (GHOST,))
    c.execute("insert into content_reports (id, reporter_id, reported_id, reason) values (1, ?, 1, 'spam')", (GHOST,))
    c.execute("insert into ai_reports (id, user_id, feature, reason, reply_text) values (1, ?, 'coach', 'x', 'r')", (GHOST,))
    c.execute("insert into user_data (user_id, key, value) values (?, 'repcheck_weight_log_v1', '{}')", (GHOST,))
    c.commit()
    plan = imp.build_plan(c)
    tables = ["rate_limits", "usage_events", "friends", "challenges", "custom_foods", "custom_exercises",
              "hyrox_results", "analyze_results", "content_reports", "ai_reports", "user_data"]
    for table in tables:
        assert plan.accounting[table]["orphaned"] == 1, table
        assert plan.accounting[table]["made"] == 0, table
        assert plan.rows[table] == [], f"{table}: an orphan was imported"
    assert plan.quarantine == [], "orphans must not be parked in quarantine either"
    assert plan.orphan_owners == {GHOST}
    assert imp.check_accounting(plan) == []


def test_a_row_whose_parent_is_gone_is_an_orphan_but_its_live_owner_is_not_counted_as_gone(source):
    _path, c = source
    add_user(c, 1)
    c.execute("insert into challenges (id, creator_id, exercise) values (5, ?, 'pushup')", (GHOST,))
    c.execute("insert into challenges (id, creator_id, exercise) values (6, 1, 'squat')")
    c.execute("insert into challenge_submissions (challenge_id, user_id, reps) values (5, 1, 10)")   # creator gone
    c.execute("insert into challenge_submissions (challenge_id, user_id, reps) values (6, 1, 12)")   # fine
    c.execute("insert into challenge_submissions (challenge_id, user_id, reps) values (77, 1, 3)")   # no such challenge
    c.execute("insert into custom_foods (id, user_id, name, emoji, calories, protein, fat, carbs) values (1, 1, 'f', 'x', 1, 0, 0, 0)")
    c.execute("insert into custom_food_servings (id, custom_food_id, label, grams) values (1, 1, 'box', 100)")
    c.execute("insert into custom_food_servings (id, custom_food_id, label, grams) values (2, 500, 'ghost', 100)")
    c.commit()
    plan = imp.build_plan(c)
    assert [r["challenge_id"] for r in plan.rows["challenge_submissions"]] == [6]
    assert plan.accounting["challenge_submissions"]["orphaned"] == 2
    assert [r["id"] for r in plan.rows["custom_food_servings"]] == [1]
    assert plan.accounting["custom_food_servings"]["orphaned"] == 1
    assert plan.orphan_owners == {GHOST}, "user 1 is alive: only the missing account may be reported as gone"
    assert plan.quarantine == []


# -- defects in a live user's rows are quarantined, with the row intact -----------

def test_constraint_violations_of_live_users_are_quarantined_with_the_reason(source):
    _path, c = source
    add_user(c, 1)
    c.execute("insert into custom_exercises (id, user_id, name, mode) values (1, 1, 'bad', 'bogus')")
    c.execute("insert into custom_exercises (id, user_id, name, mode) values (2, 1, 'blank mode', '')")
    c.execute("insert into custom_exercises (id, user_id, name, mode) values (3, 1, 'each', 'each')")
    c.execute("insert into progress_photos (id, user_id, date, angle, filename) values (1, 1, '2026-02-31', 'front', 'a.jpg')")
    c.execute("insert into progress_photos (id, user_id, date, angle, filename) values (2, 1, '2026-10-24', 'front', 'b.jpg')")
    c.execute("insert into blocked_users (user_id, blocked_id) values (1, 1)")
    c.commit()
    plan = imp.build_plan(c)
    modes = {r["id"]: r["mode"] for r in plan.rows["custom_exercises"]}
    assert modes == {2: "both", 3: "each"}
    assert [r["id"] for r in plan.rows["progress_photos"]] == [2]
    assert plan.rows["blocked_users"] == []
    reasons = sorted(error for _s, _l, _p, error in plan.quarantine)
    assert reasons == ["a user cannot block themselves", "date is not a real calendar day", "mode is not both/each/either"]
    assert all(legacy == 1 for _s, legacy, _p, _e in plan.quarantine), "quarantine rows carry the legacy user id"
    assert plan.orphan_owners == set()
    assert imp.check_accounting(plan) == []


def test_the_orphan_check_comes_before_the_defect_check(source):
    """The same bad rows under a DELETED owner are orphaned, not quarantined."""
    _path, c = source
    add_user(c, 1)
    c.execute("insert into custom_exercises (id, user_id, name, mode) values (1, ?, 'bad', 'bogus')", (GHOST,))
    c.execute("insert into progress_photos (id, user_id, date, angle, filename) values (1, ?, '2026-02-31', 'front', 'a.jpg')", (GHOST,))
    c.commit()
    plan = imp.build_plan(c)
    assert plan.quarantine == []
    assert plan.accounting["custom_exercises"]["orphaned"] == 1 and plan.accounting["progress_photos"]["orphaned"] == 1


def test_invalid_json_in_user_data_is_quarantined_and_a_valid_blob_still_flows(source):
    _path, c = source
    add_user(c, 1)
    c.execute("insert into user_data (user_id, key, value) values (1, 'repcheck_weight_log_v1', 'not json')")
    c.execute("insert into user_data (user_id, key, value) values (1, 'repcheck_theme', '\"dark\"')")
    c.commit()
    plan = imp.build_plan(c)
    assert plan.accounting["user_data"]["items"] == 1 and plan.accounting["user_data"]["rejected"] == 1
    (source_name, legacy, payload, error), = plan.quarantine
    assert (source_name, legacy, error) == ("table:user_data", 1, "value is not valid JSON")
    assert payload == {"key": "repcheck_weight_log_v1", "raw": "not json"}
    assert plan.rows["user_settings"][0]["theme"] == "dark"
    assert imp.check_accounting(plan) == []


def test_an_analyze_chat_attaches_only_to_an_analysis_of_the_same_user(source):
    _path, c = source
    add_user(c, 1)
    add_user(c, 2)
    c.execute("insert into analyze_results (id, user_id, exercise_label, feedback_text) values (5, 1, 'Squat', 'f')")
    thread = json.dumps({"createdAtMs": 1761300000000, "history": [{"role": "user", "text": "q"}, {"role": "assistant", "text": "a"}]})
    c.execute("insert into user_data (user_id, key, value) values (1, 'repcheck_analyze_chat_v1_5', ?)", (thread,))
    c.execute("insert into user_data (user_id, key, value) values (2, 'repcheck_analyze_chat_v1_5', ?)", (thread,))
    c.commit()
    plan = imp.build_plan(c)
    rows = plan.rows["analyze_chat_messages"]
    assert {r["user_id"] for r in rows} == {imp.user_uuid(1)} and len(rows) == 2
    assert plan.accounting["analyze_chat_messages"]["rejected"] == 2
    assert {legacy for _s, legacy, _p, _e in plan.quarantine} == {2}


# -- accounts -------------------------------------------------------------------

def test_accounts_carry_their_fields_and_only_real_password_hashes_move(source):
    _path, c = source
    add_user(c, 1, password_hash="scrypt:abc", ai_consent_at="2026-10-01 10:00:00", deleted_at="2026-10-20 12:00:00",
             avatar_url="http://x/a.png", auth_provider="google", provider_user_id="123", friend_code="RC-AAAAAA")
    add_user(c, 2, password_hash=None)
    add_user(c, 3, password_hash="", created_at="garbage")
    c.commit()
    plan = imp.build_plan(c)
    profiles = {p["legacy_user_id"]: p for p in plan.rows["profiles"]}
    assert profiles[1]["id"] == imp.user_uuid(1)
    assert profiles[1]["ai_consent_at"].isoformat() == "2026-10-01T10:00:00+00:00"
    assert profiles[1]["deleted_at"].isoformat() == "2026-10-20T12:00:00+00:00"
    assert (profiles[1]["avatar_url"], profiles[1]["friend_code"], profiles[1]["onboarding_completed"]) == ("http://x/a.png", "RC-AAAAAA", True)
    assert profiles[2]["ai_consent_at"] is None and profiles[2]["deleted_at"] is None
    assert profiles[3]["created_at"].tzinfo is not None, "an unparseable created_at falls back to a real timestamp"
    assert [r["user_id"] for r in plan.rows["legacy_password_hashes"]] == [imp.user_uuid(1)]
    meta = {legacy: m for _uid, legacy, _e, m in plan.users}
    assert meta[1] == {"legacy_user_id": 1, "legacy_provider": "google", "legacy_provider_user_id": "123"}
    assert meta[2]["legacy_provider"] == "local"


def test_an_older_database_with_missing_tables_and_columns_still_imports():
    c = sqlite3.connect(":memory:")
    c.executescript("""
        create table users (id integer primary key, email text, password_hash text, name text, auth_provider text,
            provider_user_id text, avatar_url text, friend_code text, onboarding_completed integer, deleted_at text,
            created_at text);
        create table custom_foods (id integer primary key, user_id integer, name text, emoji text, calories real,
            protein real, fat real, carbs real, created_at text);
        create table custom_exercises (id integer primary key, user_id integer, name text, created_at text);
        create table analyze_results (id integer primary key, user_id integer, exercise_label text,
            feedback_text text, created_at text);
        insert into users values (1, 'a@example.com', 'h', 'A', 'local', null, null, null, 1, null, '2026-09-01 08:30:00');
        insert into custom_foods values (1, 1, 'f', 'x', 1, 0, 0, 0, '2026-09-01 08:30:00');
        insert into custom_exercises values (1, 1, 'move', '2026-09-01 08:30:00');
        insert into analyze_results values (1, 1, 'Squat', 'fb', '2026-09-01 08:30:00');
    """)
    plan = imp.build_plan(c)
    assert plan.rows["profiles"][0]["ai_consent_at"] is None
    food = plan.rows["custom_foods"][0]
    assert (food["barcode"], food["serving_label"], food["serving_grams"]) == (None, "1 serving", 100)
    exercise = plan.rows["custom_exercises"][0]
    assert (exercise["emoji"], exercise["mode"]) == (None, "both")
    assert plan.rows["analyze_results"][0]["video_filename"] is None
    assert plan.skipped_by_design == {}
    assert "friends" not in plan.accounting and "user_data" not in plan.accounting
    assert imp.check_accounting(plan) == []


def test_defaults_and_pass_through_of_plain_rows(source):
    _path, c = source
    add_user(c, 1)
    c.execute("insert into custom_foods (id, user_id, name, emoji, calories, protein, fat, carbs, serving_label, serving_grams) "
              "values (1, 1, 'f', 'x', 1, 0, 0, 0, '', 0)")
    c.execute("insert into content_reports (id, reporter_id, reported_id, reason, handled_at) values (1, 1, 1, 'spam', '2026-10-02 03:04:05')")
    c.execute("insert into ai_reports (id, user_id, feature, reason, reply_text) values (1, 1, 'coach', 'x', 'r')")
    c.execute("insert into waitlist (id, email, source) values (1, 'w@example.com', 'marketing')")
    c.commit()
    plan = imp.build_plan(c)
    food = plan.rows["custom_foods"][0]
    assert (food["serving_label"], food["serving_grams"]) == ("1 serving", 100)
    assert plan.rows["content_reports"][0]["handled_at"].isoformat() == "2026-10-02T03:04:05+00:00"
    assert plan.rows["ai_reports"][0]["handled_at"] is None
    assert plan.rows["waitlist"] == [{"email": "w@example.com", "source": "marketing",
                                      "created_at": plan.rows["waitlist"][0]["created_at"]}]


def test_throwaway_tables_are_skipped_on_purpose_and_reported_with_their_counts(source):
    _path, c = source
    add_user(c, 1)
    c.execute("insert into auth_throttle (key, window_start, count) values ('a', 1, 1)")
    c.execute("insert into auth_throttle (key, window_start, count) values ('b', 1, 1)")
    c.execute("insert into native_auth_tokens (token, user_id, created_at) values ('t', 1, 1)")
    c.commit()
    plan = imp.build_plan(c)
    assert plan.skipped_by_design["auth_throttle"][0] == 2
    assert plan.skipped_by_design["native_auth_tokens"][0] == 1
    assert "auth_throttle" not in plan.rows and "native_auth_tokens" not in plan.rows


# -- accounting and the operator's report ----------------------------------------

def test_the_accounting_check_names_a_table_that_does_not_balance(source):
    _path, c = source
    add_user(c, 1)
    c.commit()
    plan = imp.build_plan(c)
    assert imp.check_accounting(plan) == []
    plan.accounting["custom_foods"]["items"] += 1
    (problem,) = imp.check_accounting(plan)
    assert problem.startswith("custom_foods: 1 source items != 0 imported")


def test_the_report_shows_orphans_skips_notes_and_caps_quarantine_at_15(capsys):
    plan = imp.Plan()
    plan.users = [("u", 1, "a@x", {})]
    plan.accounting["friends"].update(items=3, made=1, orphaned=2)
    plan.orphan_owners = {98, 99}
    plan.skipped_by_design["auth_throttle"] = (4, "short-lived")
    plan.notes["something_was_defaulted"] = 7
    plan.quarantine = [("table:x", 7, {}, f"defect {i}") for i in range(20)]
    imp.print_report(plan, "plan from x.db")
    out = capsys.readouterr().out
    assert "2 rows were not imported because their owner is not part of this import: 2 accounts no longer exist" in out
    assert "does not follow the migration" in out and "listed above" not in out
    assert "auth_throttle" in out and "skipped on purpose: short-lived" in out
    assert "something_was_defaulted" in out
    assert "quarantined rows: 20 (first 15)" in out
    assert out.count("user 7: table:x") == 15 and "defect 14" in out and "defect 15" not in out


# -- main: the paths that need no network ----------------------------------------

def _forbid_the_database(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("the importer touched the database")
    fake = types.ModuleType("psycopg")
    fake.connect = boom
    monkeypatch.setitem(sys.modules, "psycopg", fake)


def test_a_missing_source_file_exits_with_a_message(tmp_path):
    with pytest.raises(SystemExit) as exc:
        imp.main([str(tmp_path / "nope.db")])
    assert "not found" in str(exc.value)


def test_a_dry_run_writes_nothing_and_never_connects_and_leaves_the_source_untouched(tmp_path, monkeypatch, capsys):
    folder = tmp_path / "with space"
    folder.mkdir()
    path = folder / "src.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    database.init_db()
    conn = sqlite3.connect(path)
    add_user(conn, 1)
    conn.commit()
    conn.close()
    before = path.read_bytes()
    _forbid_the_database(monkeypatch)
    assert imp.main([str(path), "--dry-run"]) == 0
    assert "dry run" in capsys.readouterr().out
    assert path.read_bytes() == before
    assert not list(folder.glob("*-journal")) and not list(folder.glob("*-wal"))


def test_an_unbalanced_plan_stops_with_status_2_before_any_connection(tmp_path, monkeypatch, capsys):
    path = tmp_path / "src.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    database.init_db()
    _forbid_the_database(monkeypatch)
    monkeypatch.setattr(imp, "check_accounting", lambda plan: ["friends: 3 source items != 1 imported"])
    assert imp.main([str(path)]) == 2
    assert "ACCOUNTING DOES NOT BALANCE" in capsys.readouterr().out


def test_load_env_reads_the_environment_then_the_env_file(tmp_path, monkeypatch):
    monkeypatch.setattr(imp, "REPO_ROOT", tmp_path)
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(SystemExit) as exc:
        imp.load_env()
    assert all(k in str(exc.value) for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"))
    (tmp_path / ".env").write_text("OTHER=1\nSUPABASE_URL = https://x.supabase.co  \nSUPABASE_SERVICE_ROLE_KEY=k\n", encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        imp.load_env()
    message = str(exc.value)
    assert "SUPABASE_DB_URL" in message
    assert "SUPABASE_URL" not in message and "SUPABASE_SERVICE_ROLE_KEY" not in message, "the .env values were read"
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://db")
    monkeypatch.setenv("SUPABASE_URL", "https://from-env")
    env = imp.load_env()
    assert env == {"SUPABASE_URL": "https://from-env", "SUPABASE_SERVICE_ROLE_KEY": "k", "SUPABASE_DB_URL": "postgresql://db"}


# -- accounts past their deletion window -------------------------------------------

def test_the_grace_period_matches_the_apps():
    assert imp.ACCOUNT_DELETION_GRACE_DAYS == database.ACCOUNT_DELETION_GRACE_DAYS


def test_accounts_past_their_deletion_window_are_not_imported_and_their_data_becomes_orphans(source):
    """The app purges lazily, so an account can sit past its 30 days. Importing it would resurrect
    data its owner was promised would be gone."""
    import datetime
    _path, c = source
    add_user(c, 1, deleted_at="2026-09-23 00:00:00")      # 31 days before NOW: past
    add_user(c, 2, deleted_at="2026-09-24 00:00:00")      # exactly 30 days: not past
    add_user(c, 3, deleted_at="2026-10-20 12:00:00")
    add_user(c, 4)
    c.execute("insert into user_data (user_id, key, value) values (1, 'repcheck_theme', '\"dark\"')")
    c.execute("insert into custom_exercises (id, user_id, name) values (1, 1, 'move')")
    c.commit()
    plan = imp.build_plan(c, now=datetime.datetime(2026, 10, 24, tzinfo=datetime.timezone.utc))
    assert plan.expired_accounts == [1]
    assert [legacy for _uid, legacy, _e, _m in plan.users] == [2, 3, 4]
    profiles = {p["legacy_user_id"]: p for p in plan.rows["profiles"]}
    assert profiles[2]["deleted_at"] is not None and profiles[3]["deleted_at"] is not None
    assert plan.accounting["profiles"]["orphaned"] == 1
    assert plan.rows["custom_exercises"] == [] and plan.accounting["custom_exercises"]["orphaned"] == 1
    assert plan.accounting["user_data"]["orphaned"] == 1 and plan.rows["user_settings"] == []
    assert plan.quarantine == [] and imp.check_accounting(plan) == []


def test_the_report_names_accounts_that_were_not_imported_for_having_expired(capsys):
    plan = imp.Plan()
    plan.expired_accounts = [1, 2]
    imp.print_report(plan, "x")
    assert "2 accounts asked to be deleted more than 30 days ago and were NOT imported" in capsys.readouterr().out


# -- values that are replaced are said out loud ---------------------------------------

def test_replaced_values_and_uncopied_files_are_noted_not_silent(source):
    _path, c = source
    add_user(c, 1)
    c.execute("insert into custom_foods (id, user_id, name, emoji, calories, protein, fat, carbs, serving_label, serving_grams) "
              "values (1, 1, 'f', 'x', 1, 0, 0, 0, '', 0)")
    c.execute("insert into progress_photos (id, user_id, date, angle, filename) values (1, 1, '2026-10-24', 'front', 'a.jpg')")
    c.execute("insert into analyze_results (id, user_id, exercise_label, feedback_text, video_filename) values (1, 1, 'Squat', 'f', 'v.mp4')")
    c.execute("insert into analyze_results (id, user_id, exercise_label, feedback_text) values (2, 1, 'Row', 'f')")
    c.commit()
    plan = imp.build_plan(c)
    notes = plan.notes
    assert notes["custom_food_serving_label_was_blank_so_1_serving_was_used"] == 1
    assert notes["custom_food_serving_grams_was_zero_or_blank_so_100_was_used"] == 1
    assert "timestamp_unparseable_so_the_import_time_was_used" not in notes
    (files,) = [v for k, v in notes.items() if k.startswith("files_referenced_but_NOT_copied")]
    assert files == 2, "one progress photo and one analysis video"


def test_an_unparseable_profile_timestamp_is_noted(source):
    _path, c = source
    add_user(c, 1, created_at="garbage")
    c.commit()
    assert imp.build_plan(c).notes["timestamp_unparseable_so_the_import_time_was_used"] == 1


def test_an_unparseable_timestamp_on_a_table_row_is_noted(source):
    """A different code path from the profile's: the ts() helper every plain table goes through."""
    _path, c = source
    add_user(c, 1)
    c.execute("insert into custom_foods (id, user_id, name, emoji, calories, protein, fat, carbs, created_at) "
              "values (1, 1, 'f', 'x', 1, 0, 0, 0, 'garbage')")
    c.commit()
    assert imp.build_plan(c).notes["timestamp_unparseable_so_the_import_time_was_used"] == 1


def test_a_mapper_that_emits_the_wrong_columns_is_refused_loudly():
    m = imp.UserMapper("u", {})
    with pytest.raises(ValueError, match="nutrition_favorites"):
        m.row("nutrition_favorites", user_id="u")


def test_load_env_refuses_a_non_https_url(tmp_path, monkeypatch):
    monkeypatch.setattr(imp, "REPO_ROOT", tmp_path)
    monkeypatch.setenv("SUPABASE_URL", "http://insecure.example.com")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://db")
    with pytest.raises(SystemExit, match="https"):
        imp.load_env()


def test_load_env_strips_quotes_around_a_value_in_the_env_file(tmp_path, monkeypatch):
    monkeypatch.setattr(imp, "REPO_ROOT", tmp_path)
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"):
        monkeypatch.delenv(key, raising=False)
    (tmp_path / ".env").write_text("SUPABASE_URL=\"https://x.supabase.co\"\nSUPABASE_SERVICE_ROLE_KEY='k'\n"
                                   "SUPABASE_DB_URL=postgresql://db\n", encoding="utf-8")
    assert imp.load_env() == {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k",
                              "SUPABASE_DB_URL": "postgresql://db"}


# -- values Postgres cannot store, found in the plan --------------------------------------

def test_a_row_with_a_value_postgres_cannot_store_is_quarantined_and_so_are_its_children(source):
    """A NUL character is storable in SQLite and fatal in Postgres. It must be found here, where --dry-run
    sees it, and parked (safely encoded), not left to abort the load. The children of a quarantined parent are
    quarantined with it, not dropped as if their owner had been deleted. (A lone surrogate and NaN cannot sit in
    a SQLite column; they reach the importer inside JSON blobs, covered by the mapper tests.)"""
    _path, c = source
    add_user(c, 1)
    c.execute("insert into custom_foods (id, user_id, name, emoji, calories, protein, fat, carbs) values (1, 1, ?, 'x', 1, 0, 0, 0)",
              ("Bad\x00name",))
    c.execute("insert into custom_foods (id, user_id, name, emoji, calories, protein, fat, carbs) values (2, 1, 'Fine', 'x', 1, 0, 0, 0)")
    c.execute("insert into custom_food_servings (id, custom_food_id, label, grams) values (1, 1, 'box', 100)")
    c.execute("insert into custom_food_servings (id, custom_food_id, label, grams) values (2, 2, 'box', 100)")
    c.execute("insert into challenges (id, creator_id, exercise) values (5, 1, ?)", ("bad\x00exercise",))
    c.execute("insert into challenge_submissions (challenge_id, user_id, reps) values (5, 1, 10)")
    c.commit()
    plan = imp.build_plan(c)
    assert [r["id"] for r in plan.rows["custom_foods"]] == [2]
    assert [r["id"] for r in plan.rows["custom_food_servings"]] == [2]
    assert plan.rows["challenges"] == [] and plan.rows["challenge_submissions"] == []
    reasons = sorted(error for _s, _l, _p, error in plan.quarantine)
    assert reasons == ["its challenge was quarantined", "its food was quarantined",
                       "the row contains a NUL character", "the row contains a NUL character"]
    assert plan.orphan_owners == set(), "the owner is alive: these are defects, not leftovers of a deleted account"
    for _s, _l, payload, _e in plan.quarantine:
        assert imp.unsafe_reason(payload) is None, "what is parked must itself be storable"
    assert imp.check_accounting(plan) == []


@pytest.mark.parametrize("value,reason", [
    ("a\x00b", "NUL"), ("lone \ud83d", "lone surrogate"), (float("nan"), "NaN"), (float("inf"), "NaN"),
    ({"k": ["fine", {"deep": "x\x00"}]}, "NUL"), ({"bad\x00key": 1}, "NUL"),
])
def test_unsafe_reason_finds_what_postgres_cannot_store_however_deep(value, reason):
    assert reason in imp.unsafe_reason(value)


@pytest.mark.parametrize("value", ["fine", "emoji \U0001F3CB️ and Thai สวัสดี", 1.5, None, True, [], {"a": [1, "b"]}])
def test_unsafe_reason_lets_ordinary_text_and_numbers_through(value):
    assert imp.unsafe_reason(value) is None


# -- accounts that cannot be created -------------------------------------------------------------

@pytest.mark.parametrize("email", [
    "no-at-sign", "a@b", "a@@b.com", ".dot@start.com", "dot.@end.com", "do..uble@x.com", "sp ace@x.com",
    "a@-bad.com", "a@bad-.com", "a@x..com", "x" * 65 + "@example.com", "a@" + "x" * 250 + ".com", "", None,
])
def test_an_email_supabase_auth_would_refuse_is_flagged_before_anything_is_written(email):
    assert imp.account_problem({"email": email, "name": "n"}) == "its email address is not one Supabase Auth will accept"


@pytest.mark.parametrize("email", [
    "a@example.com", "first.last+tag@sub.example.co.uk", "o'brien@example.com", "apple-001122.abcd@no-email.repcheck.local",
    "UPPER@EXAMPLE.COM", "x" * 64 + "@example.com",
])
def test_ordinary_and_unusual_but_valid_emails_pass(email):
    assert imp.account_problem({"email": email, "name": "n"}) is None


def test_a_name_postgres_cannot_store_makes_the_account_unimportable():
    assert "its name contains a NUL character" == imp.account_problem({"email": "a@example.com", "name": "x\x00"})


def test_unimportable_accounts_are_listed_and_excluded_and_skip_account_leaves_one_out_on_purpose(source):
    _path, c = source
    add_user(c, 1)
    add_user(c, 2, email="not-an-email")
    add_user(c, 3, name="x\x00y")
    add_user(c, 4)
    c.execute("insert into custom_exercises (id, user_id, name) values (1, 2, 'move')")
    c.commit()
    plan = imp.build_plan(c)
    assert [legacy for _u, legacy, _e, _m in plan.users] == [1, 4]
    assert plan.unimportable == [(2, "its email address is not one Supabase Auth will accept"),
                                 (3, "its name contains a NUL character")]
    assert plan.accounting["profiles"]["orphaned"] == 2 and imp.check_accounting(plan) == []
    left_out = imp.build_plan(c, skip=[2, 3])
    assert left_out.unimportable == [] and left_out.skipped_accounts == [2, 3]
    assert [legacy for _u, legacy, _e, _m in left_out.users] == [1, 4]


def test_main_refuses_to_touch_anything_while_an_account_cannot_be_imported_and_proceeds_once_it_is_skipped(tmp_path, monkeypatch, capsys):
    path = tmp_path / "src.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    database.init_db()
    c = sqlite3.connect(path)
    add_user(c, 1)
    add_user(c, 2, email="not-an-email")
    c.commit()
    c.close()
    _forbid_the_database(monkeypatch)
    assert imp.main([str(path)]) == 2
    out = capsys.readouterr().out
    assert "ACCOUNTS THAT CANNOT BE IMPORTED" in out and "2: its email address" in out and "--skip-account" in out
    assert imp.main([str(path), "--dry-run"]) == 2, "a dry run reports it too"
    assert imp.main([str(path), "--dry-run", "--skip-account", "2"]) == 0


# -- id-less entries ---------------------------------------------------------------------------

def test_identical_id_less_entries_are_kept_as_separate_rows_not_merged(source):
    _path, c = source
    add_user(c, 1)
    entry = {"name": "Rice", "grams": 100, "hour": 8}
    c.execute("insert into user_data (user_id, key, value) values (1, 'repcheck_nutrition_log_v1', ?)",
              (json.dumps({"2026-08-05": [entry, dict(entry)]}),))
    c.commit()
    plan = imp.build_plan(c)
    ids = [r["id"] for r in plan.rows["nutrition_entries"]]
    assert len(ids) == 2 and len(set(ids)) == 2, "logging the same food twice is two entries; merging undercounts calories"
    assert plan.notes["identical_id-less_entries_were_kept_as_separate_rows"] == 1
    assert [r["id"] for r in imp.build_plan(c).rows["nutrition_entries"]] == ids, "stable across runs"


# -- the waitlist has no ids of its own ----------------------------------------------------------

def test_waitlist_rows_are_imported_without_an_id_so_they_cannot_collide_with_rows_captured_since(source):
    _path, c = source
    add_user(c, 1)
    c.execute("insert into waitlist (id, email, source) values (7, 'w@example.com', 'marketing')")
    c.commit()
    plan = imp.build_plan(c)
    assert plan.rows["waitlist"] == [{"email": "w@example.com", "source": "marketing", "created_at": plan.rows["waitlist"][0]["created_at"]}]
    assert "waitlist" not in plan.identity_tables


# -- IO helpers against fakes ----------------------------------------------------------

needs_psycopg = pytest.mark.skipif(
    importlib.util.find_spec("psycopg") is None, reason="the importer's database driver (psycopg) is not installed")


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def _check(self, sql):
        if self.conn.fail_on and self.conn.fail_on in sql:
            raise RuntimeError("the database refused this statement")

    def execute(self, sql, params=None):
        self._check(sql)
        self.conn.log.append(("execute", sql, params))

    def executemany(self, sql, seq):
        self._check(sql)
        self.conn.log.append(("executemany", sql, [list(r) for r in seq]))

    def fetchall(self):
        return [(i,) for i in self.conn.ids]


class FakeConn:
    def __init__(self, ids=(), fail_on=None):
        self.log, self.ids, self.fail_on = [], list(ids), fail_on
        self.commits = self.rollbacks = 0

    def cursor(self, **kwargs):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakeAuth:
    def __init__(self, exists=(), create=(200, {}), create_by_uid=None, update=(200, {}), delete=None, boom=None):
        self._exists, self._create, self._update = set(exists), create, update
        self._create_by_uid, self._delete, self._boom = create_by_uid or {}, delete or {}, boom or {}
        self.created, self.updated, self.deleted = [], [], []

    def exists(self, uid):
        return uid in self._exists

    def create(self, uid, email, meta):
        self.created.append(uid)
        if uid in self._boom:
            raise self._boom[uid]
        return self._create_by_uid.get(uid, self._create)

    def update(self, uid, email, meta):
        self.updated.append((uid, email))
        return self._update

    def delete(self, uid):
        self.deleted.append(uid)
        result = self._delete.get(uid, 200)
        if isinstance(result, Exception):
            raise result
        return result


def _users(*ids):
    return [(f"u{i}", i, f"user{i}@example.com", {"legacy_provider": "local"}) for i in ids]


def test_create_auth_users_refuses_and_removes_the_accounts_it_had_already_created():
    plan = imp.Plan()
    plan.users = _users(1, 2, 3)
    auth = FakeAuth(exists={"u3"}, create_by_uid={"u2": (422, {"msg": "email exists"})})
    with pytest.raises(RuntimeError) as exc:
        imp.create_auth_users(plan, auth)
    message = str(exc.value)
    assert "(2, 422, 'email exists')" in message and "(1," not in message and "(3," not in message
    assert "@example.com" not in message, "the error names legacy ids, never email addresses"
    assert auth.deleted == ["u1"], "the account this run created is removed again"


def test_create_auth_users_refreshes_an_account_that_exists_and_never_recreates_it():
    plan = imp.Plan()
    plan.users = _users(1, 2)
    auth = FakeAuth(exists={"u1", "u2"})
    assert imp.create_auth_users(plan, auth) == ([], 2)
    assert auth.created == [] and auth.updated == [("u1", "user1@example.com"), ("u2", "user2@example.com")]


def test_a_refused_refresh_of_an_existing_account_is_a_problem_too():
    plan = imp.Plan()
    plan.users = _users(1)
    with pytest.raises(RuntimeError, match=r"\(1, 422, 'email taken'\)"):
        imp.create_auth_users(plan, FakeAuth(exists={"u1"}, update=(422, {"msg": "email taken"})))


def test_create_auth_users_returns_what_it_created():
    plan = imp.Plan()
    plan.users = _users(1, 2, 3)
    assert imp.create_auth_users(plan, FakeAuth(exists={"u2"})) == (["u1", "u3"], 1)


@pytest.mark.parametrize("error", [OSError("connection dropped"), KeyboardInterrupt(), RuntimeError("boom")])
def test_create_auth_users_cleans_up_on_any_failure_including_an_interrupt(error):
    """A dropped connection, a timeout or Ctrl-C part-way through thousands of calls must not leave accounts behind."""
    plan = imp.Plan()
    plan.users = _users(1, 2, 3)
    auth = FakeAuth(boom={"u3": error})
    with pytest.raises(type(error)):
        imp.create_auth_users(plan, auth)
    assert auth.deleted == ["u1", "u2"]


def test_undo_auth_keeps_going_past_an_account_that_will_not_delete_and_says_so(capsys):
    auth = FakeAuth(delete={"b": 500, "c": OSError("down")})
    assert imp.undo_auth(auth, ["a", "b", "c", "d"]) == ["b", "c"]
    assert auth.deleted == ["a", "b", "c", "d"], "every account is tried"
    assert "WARNING" in capsys.readouterr().err


@needs_psycopg
def test_load_rows_inserts_with_explicit_ids_only_for_identity_tables_and_never_commits():
    plan = imp.Plan()
    plan.users = _users(1, 2)
    plan.rows["challenges"] = [{"id": 7, "creator_id": "u1", "exercise": "pushup", "duration_seconds": 25, "created_at": None}]
    plan.rows["friends"] = [{"user_id": "u1", "friend_id": "u2", "created_at": None}]
    plan.identity_tables = {"challenges"}
    conn = FakeConn()
    assert imp.load_rows(plan, conn) == (0, [])
    inserts = {sql.split()[2]: sql for kind, sql, _ in conn.log if kind == "executemany"}
    assert "overriding system value" in inserts["public.challenges"]
    assert "overriding system value" not in inserts["public.friends"]
    setvals = [sql for kind, sql, _ in conn.log if kind == "execute" and "setval" in sql]
    assert len(setvals) == 1 and "public.challenges" in setvals[0]
    assert not [1 for kind, sql, _ in conn.log if kind == "execute" and sql.startswith("delete")], "no reset was asked for"
    assert conn.commits == 0 and conn.rollbacks == 0, "the caller verifies, then commits"


@needs_psycopg
def test_a_reset_happens_inside_the_load_transaction_before_the_inserts_and_names_the_stale_accounts():
    """So a failed import leaves the project as it was: nothing is deleted outside the transaction that is rolled back."""
    plan = imp.Plan()
    plan.users = _users(1)
    plan.rows["waitlist"] = [{"email": "w@example.com", "source": None, "created_at": None}]
    plan.rows["friends"] = [{"user_id": "u1", "friend_id": "u1", "created_at": None}]
    conn = FakeConn(ids=["u1", "gone-from-the-source"])
    removed, stale = imp.load_rows(plan, conn, reset=True)
    assert (removed, stale) == (2, ["gone-from-the-source"]), "only accounts that are not in this plan are stale"
    statements = [(kind, sql) for kind, sql, _ in conn.log]
    first_insert = next(i for i, (kind, _s) in enumerate(statements) if kind == "executemany")
    deletes = [sql for kind, sql in statements[:first_insert] if kind == "execute"]
    assert deletes == ["select id from public.profiles where legacy_user_id is not null",
                       "delete from public.import_quarantine",
                       "delete from public.waitlist where email = any(%s)",
                       "delete from public.profiles where legacy_user_id is not null"]
    waitlist_params = [p for kind, sql, p in conn.log if "delete from public.waitlist" in sql]
    assert waitlist_params == [(["w@example.com"],)]
    assert conn.commits == 0 and conn.rollbacks == 0


@needs_psycopg
def test_load_rows_writes_quarantine_rows_with_their_owner_and_payload():
    import datetime
    when = datetime.datetime(2026, 1, 2)
    plan = imp.Plan()
    plan.users = _users(3)
    plan.quarantine = [("user_data:x", 3, {"when": when}, "bad"), ("table:y", 99, {}, "stray")]
    conn = FakeConn()
    imp.load_rows(plan, conn)
    (_, sql, rows), = [e for e in conn.log if e[0] == "executemany" and "import_quarantine" in e[1]]
    assert "user_id" in sql
    assert rows[0][:3] == ["user_data:x", 3, "u3"] and rows[0][4] == "bad"
    assert rows[0][3].obj == {"when": when}
    assert rows[1][2] is None, "a legacy id with no imported account gets no owner"


def test_delete_stale_auth_reports_only_real_failures():
    auth = FakeAuth(delete={"b": 500, "c": 404})
    assert imp.delete_stale_auth(auth, ["a", "b", "c"]) == ["b"]
    assert auth.deleted == ["a", "b", "c"]


@needs_psycopg
def test_insert_rows_builds_sql_and_insists_every_row_has_the_same_columns():
    conn = FakeConn()
    cur = FakeCursor(conn)
    imp.insert_rows(cur, "friends", [{"user_id": "a", "friend_id": "b"}], overriding=False)
    imp.insert_rows(cur, "challenges", [{"id": 1, "exercise": "x"}], overriding=True)
    imp.insert_rows(cur, "friends", [])
    sqls = [sql for _, sql, _ in conn.log]
    assert sqls == ["insert into public.friends (user_id, friend_id) values (%s, %s)",
                    "insert into public.challenges (id, exercise) overriding system value values (%s, %s)"]
    with pytest.raises(ValueError, match="different columns"):
        imp.insert_rows(cur, "friends", [{"a": 1, "b": 2}, {"b": 2, "a": 1}])


@needs_psycopg
def test_adapt_wraps_json_columns_only_and_leaves_null_alone():
    from psycopg.types.json import Jsonb
    assert isinstance(imp.adapt("extra", {"k": 1}), Jsonb)
    assert isinstance(imp.adapt("sources", [1]), Jsonb)
    assert imp.adapt("extra", None) is None
    assert imp.adapt("food", {"k": 1}) == {"k": 1}


# -- main: the order of operations and what it refuses ---------------------------------------

class MainCursor:
    def __init__(self, conn):
        self.conn, self._row = conn, None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self._row = (self.conn.signed_in,) if "last_sign_in_at" in sql else (self.conn.previous,)

    def fetchone(self):
        return self._row


class MainConn:
    """Scripted answers to main()'s own two counting queries; every connection event goes in one shared log."""

    def __init__(self, n, events, previous=0, signed_in=0):
        self.n, self.events, self.previous, self.signed_in = n, events, previous, signed_in

    def cursor(self):
        return MainCursor(self)

    def commit(self):
        self.events.append(f"commit{self.n}")

    def rollback(self):
        self.events.append(f"rollback{self.n}")

    def close(self):
        self.events.append(f"close{self.n}")


@pytest.fixture
def run_main(tmp_path, monkeypatch):
    """A source database (one user, one waitlist row), a fake psycopg, and spies for the steps main()
    orchestrates, so its control flow is tested without a database. Everything is recorded, in order, in
    state.events."""
    path = tmp_path / "src.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    database.init_db()
    c = sqlite3.connect(path)
    add_user(c, 1)
    c.execute("insert into waitlist (id, email, source) values (1, 'w@example.com', 'm')")
    c.commit()
    c.close()
    state = types.SimpleNamespace(path=path, events=[], connects=[], previous=0, signed_in=0, created=["u1"],
                                  load_result=(1, []), load_error=None, verify=[], verify_error=None, stale_failed=[],
                                  auth=FakeAuth(), seen={})
    fake = types.ModuleType("psycopg")

    def connect(url, **kwargs):
        state.connects.append((url, kwargs))
        n = len(state.connects)
        state.events.append(f"connect{n}")
        return MainConn(n, state.events, state.previous, state.signed_in)
    fake.connect = connect
    monkeypatch.setitem(sys.modules, "psycopg", fake)
    monkeypatch.setattr(imp, "load_env", lambda: {"SUPABASE_URL": "https://abc.supabase.co",
                                                  "SUPABASE_SERVICE_ROLE_KEY": "k", "SUPABASE_DB_URL": "postgresql://db"})
    monkeypatch.setattr(imp, "Auth", lambda env: state.auth)

    def create_auth_users(plan, auth):
        state.events.append("auth")
        return state.created, 0

    def load_rows(plan, conn, reset=False):
        state.events.append("load")
        state.seen["reset"] = reset
        state.seen["waitlist_emails"] = [r["email"] for r in plan.rows.get("waitlist", [])]
        if state.load_error:
            raise state.load_error
        return state.load_result

    def verify_database(plan, conn):
        state.events.append("verify")
        if state.verify_error:
            raise state.verify_error
        return list(state.verify)

    def delete_stale_auth(auth, uids):
        state.events.append("stale")
        state.seen["stale"] = list(uids)
        return list(state.stale_failed)
    monkeypatch.setattr(imp, "create_auth_users", create_auth_users)
    monkeypatch.setattr(imp, "load_rows", load_rows)
    monkeypatch.setattr(imp, "verify_database", verify_database)
    monkeypatch.setattr(imp, "delete_stale_auth", delete_stale_auth)
    state.run = lambda *flags: imp.main([str(path), *flags])
    return state


def test_main_asks_its_questions_closes_that_connection_creates_accounts_then_loads_verifies_and_commits_last(run_main, capsys):
    """The first connection is closed before the long Auth step (a pooler may drop an idle one); the load
    uses a fresh connection and commits only after verification."""
    assert run_main.run() == 0
    assert run_main.events == ["connect1", "commit1", "close1", "auth", "connect2", "load", "verify", "commit2", "close2"]
    for url, kwargs in run_main.connects:
        assert (url, kwargs) == ("postgresql://db", {"sslmode": "require", "prepare_threshold": None})
    assert "target project: abc.supabase.co" in capsys.readouterr().out
    assert run_main.seen["reset"] is False


def test_a_failed_verification_rolls_back_removes_the_new_accounts_and_exits_4(run_main, capsys):
    run_main.verify = ["friends: planned 2, database has 1"]
    assert run_main.run() == 4
    assert run_main.events[-4:] == ["load", "verify", "rollback2", "close2"], "rolled back, never committed"
    assert "commit2" not in run_main.events and run_main.auth.deleted == ["u1"]
    out = capsys.readouterr().out
    assert "VERIFICATION FAILED" in out and "the project is as it was" in out


@pytest.mark.parametrize("where", ["verify_error", "load_error"])
@pytest.mark.parametrize("error", [RuntimeError("boom"), KeyboardInterrupt()])
def test_a_crash_while_loading_or_verifying_rolls_back_and_removes_the_new_accounts(run_main, where, error):
    setattr(run_main, where, error)
    with pytest.raises(type(error)):
        run_main.run()
    assert run_main.events[-2:] == ["rollback2", "close2"] and "commit2" not in run_main.events
    assert run_main.auth.deleted == ["u1"]


def test_reset_refuses_when_imported_accounts_have_signed_in_and_nothing_is_touched(run_main):
    """After launch the imported accounts ARE the real users: --reset would delete their data."""
    run_main.signed_in = 2
    with pytest.raises(SystemExit) as exc:
        run_main.run("--reset")
    assert "REFUSING" in str(exc.value) and "none was given" in str(exc.value)
    assert "auth" not in run_main.events and "load" not in run_main.events
    assert run_main.auth.deleted == []


def test_the_force_flag_must_name_this_project_not_merely_be_present(run_main):
    run_main.signed_in = 2
    with pytest.raises(SystemExit) as exc:
        run_main.run("--reset", "--force-reset-signed-in-accounts", "some-other-project")
    assert "does not match" in str(exc.value) and "load" not in run_main.events


def test_the_force_flag_with_the_right_ref_lets_a_reset_through(run_main):
    run_main.signed_in = 2
    assert run_main.run("--reset", "--force-reset-signed-in-accounts", "abc") == 0
    assert run_main.seen["reset"] is True and run_main.seen["waitlist_emails"] == ["w@example.com"]


def test_an_earlier_import_blocks_a_second_one_without_reset(run_main):
    run_main.previous = 3
    with pytest.raises(SystemExit) as exc:
        run_main.run()
    assert "3 previously imported accounts" in str(exc.value)
    assert "auth" not in run_main.events and "load" not in run_main.events


def test_accounts_that_left_the_source_are_deleted_from_auth_only_after_the_commit(run_main, capsys):
    run_main.load_result = (3, ["old1", "old2"])
    assert run_main.run("--reset") == 0
    assert run_main.events[-3:] == ["commit2", "close2", "stale"] and run_main.seen["stale"] == ["old1", "old2"]
    out = capsys.readouterr().out
    assert "Replaced 3 previously imported accounts" in out and "removed 2 Auth accounts" in out


def test_stale_accounts_that_will_not_delete_are_reported_after_a_successful_commit_with_status_3(run_main, capsys):
    run_main.load_result = (1, ["old1"])
    run_main.stale_failed = ["old1"]
    assert run_main.run("--reset") == 3
    assert "commit2" in run_main.events
    assert "could not be deleted" in capsys.readouterr().out


# -- the Auth client: what it sends, and what it retries -------------------------------------------

class FakeResponse:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body
        self.content = b"x" if body is not None else b""

    def json(self):
        return self._body


class FakeSession:
    def __init__(self):
        self.calls, self.queue, self.next = [], [], FakeResponse(200, {})

    def _record(self, verb, url, **kw):
        self.calls.append((verb, url, kw))
        item = self.queue.pop(0) if self.queue else self.next
        if isinstance(item, Exception):
            raise item
        return item

    def get(self, url, **kw):
        return self._record("get", url, **kw)

    def post(self, url, **kw):
        return self._record("post", url, **kw)

    def put(self, url, **kw):
        return self._record("put", url, **kw)

    def delete(self, url, **kw):
        return self._record("delete", url, **kw)


@pytest.fixture
def auth_and_session(monkeypatch):
    session, slept = FakeSession(), []
    fake = types.ModuleType("requests")
    fake.Session = lambda: session
    monkeypatch.setitem(sys.modules, "requests", fake)
    auth = imp.Auth({"SUPABASE_URL": "https://abc.supabase.co/", "SUPABASE_SERVICE_ROLE_KEY": "the-key"}, sleep=slept.append)
    auth.slept = slept
    return auth, session


def test_auth_create_sends_the_chosen_id_and_keeps_legacy_ids_out_of_user_metadata(auth_and_session):
    auth, session = auth_and_session
    meta = {"legacy_user_id": 7, "legacy_provider": "local", "legacy_provider_user_id": None}
    assert auth.create("uuid-7", "a@example.com", meta) == (200, {})
    (verb, url, kw), = session.calls
    assert (verb, url) == ("post", "https://abc.supabase.co/auth/v1/admin/users")
    assert kw["headers"]["apikey"] == "the-key" and kw["timeout"] == 30
    assert kw["json"] == {"id": "uuid-7", "email": "a@example.com", "email_confirm": False, "app_metadata": meta}
    assert "user_metadata" not in kw["json"], "the user can edit user_metadata"


@pytest.mark.parametrize("provider,confirmed", [("local", False), ("google", True), ("apple", True), (None, False)])
def test_only_an_address_a_provider_vouched_for_is_marked_confirmed(auth_and_session, provider, confirmed):
    """Local sign-up never verified email. Marking those confirmed would let whoever registered someone
    else's address on the old site own the account Apple/Google later links to by email."""
    auth, session = auth_and_session
    auth.create("u", "a@example.com", {"legacy_provider": provider})
    assert session.calls[0][2]["json"]["email_confirm"] is confirmed


def test_auth_update_refreshes_email_and_metadata_but_never_touches_password_or_confirmation(auth_and_session):
    auth, session = auth_and_session
    assert auth.update("u", "new@example.com", {"legacy_user_id": 7}) == (200, {})
    (verb, url, kw), = session.calls
    assert (verb, url) == ("put", "https://abc.supabase.co/auth/v1/admin/users/u")
    assert kw["json"] == {"email": "new@example.com", "app_metadata": {"legacy_user_id": 7}}


def test_auth_create_survives_an_empty_response_body(auth_and_session):
    auth, session = auth_and_session
    session.next = FakeResponse(422)
    assert auth.create("u", "a@example.com", {}) == (422, {})


def test_auth_exists_is_true_for_200_false_for_404_and_an_error_for_anything_else(auth_and_session):
    auth, session = auth_and_session
    session.next = FakeResponse(200, {})
    assert auth.exists("u") is True
    session.next = FakeResponse(404, {})
    assert auth.exists("u") is False
    session.next = FakeResponse(403, {})
    with pytest.raises(imp.AuthError, match="answered 403"):
        auth.exists("u")


def test_auth_delete_returns_the_status(auth_and_session):
    auth, session = auth_and_session
    session.next = FakeResponse(204)
    assert auth.delete("u") == 204
    assert session.calls[0][:2] == ("delete", "https://abc.supabase.co/auth/v1/admin/users/u")


def test_a_rate_limit_or_a_server_error_is_retried_with_a_growing_wait_not_treated_as_a_refusal(auth_and_session):
    auth, session = auth_and_session
    session.queue = [FakeResponse(429, {}), FakeResponse(503, {}), FakeResponse(200, {"id": "u"})]
    assert auth.create("u", "a@example.com", {}) == (200, {"id": "u"})
    assert auth.slept == [1, 2] and len(session.calls) == 3


def test_a_dropped_connection_or_timeout_is_retried_too(auth_and_session):
    auth, session = auth_and_session
    session.queue = [OSError("connection reset"), FakeResponse(200, {})]
    assert auth.exists("u") is True
    assert auth.slept == [1]


def test_auth_gives_up_after_four_attempts_with_an_error_not_a_refusal(auth_and_session):
    auth, session = auth_and_session
    session.next = FakeResponse(429, {})
    with pytest.raises(imp.AuthError, match="kept failing: 429"):
        auth.create("u", "a@example.com", {})
    assert len(session.calls) == 4 and auth.slept == [1, 2, 4, 8]


def test_a_real_refusal_is_returned_not_retried(auth_and_session):
    auth, session = auth_and_session
    session.next = FakeResponse(422, {"msg": "email exists"})
    assert auth.create("u", "a@example.com", {}) == (422, {"msg": "email exists"})
    assert len(session.calls) == 1 and auth.slept == []


# -- verification: the database holds exactly the plan ---------------------------------------------

def test_every_loaded_table_has_a_key_to_match_rows_by():
    assert set(imp.KEY_COLUMNS) == set(imp.LOAD_ORDER)


def test_norm_makes_plan_values_and_database_values_comparable():
    import datetime
    import uuid as uuidlib
    utc = datetime.timezone.utc
    plus7 = datetime.timezone(datetime.timedelta(hours=7))
    assert imp._norm(datetime.datetime(2026, 1, 1, 7, tzinfo=plus7)) == imp._norm(datetime.datetime(2026, 1, 1, tzinfo=utc))
    assert imp._norm(datetime.datetime(2026, 1, 1)) == imp._norm(datetime.datetime(2026, 1, 1, tzinfo=utc))
    assert imp._norm(datetime.date(2026, 10, 24)) == imp._norm("2026-10-24")
    assert imp._norm(uuidlib.UUID(imp.user_uuid(1))) == imp._norm(imp.user_uuid(1))
    assert imp._norm(5) == imp._norm(5.0) and imp._norm(True) is True and imp._norm(None) is None
    assert imp._norm({"a": [1, {"b": 2}]}) == imp._norm({"a": [1.0, {"b": 2.0}]})


def test_compare_finds_nothing_when_the_database_holds_the_plan_whatever_the_types():
    import datetime
    planned = [{"user_id": imp.user_uuid(1), "log_date": "2026-10-24", "kg": 80, "logged_at": datetime.datetime(2026, 10, 24, tzinfo=datetime.timezone.utc), "extra": {}}]
    found = [{"user_id": __import__("uuid").UUID(imp.user_uuid(1)), "log_date": datetime.date(2026, 10, 24), "kg": 80.0,
              "logged_at": datetime.datetime(2026, 10, 24, 7, tzinfo=datetime.timezone(datetime.timedelta(hours=7))), "extra": {}}]
    assert imp._compare("weight_entries", planned, found) == []


def test_compare_reports_a_missing_an_unexpected_and_a_differing_row_and_never_prints_a_value():
    secret = "very-private-food"
    planned = [{"user_id": "u", "id": "a", "food": secret}, {"user_id": "u", "id": "b", "food": "x"}]
    found = [{"user_id": "u", "id": "a", "food": "changed"}, {"user_id": "u", "id": "zzz", "food": "x"}]
    problems = imp._compare("nutrition_entries", planned, found)
    assert "nutrition_entries: 1 planned row(s) missing from the database" in problems
    assert "nutrition_entries: 1 unexpected row(s) in the database" in problems
    assert "nutrition_entries: column 'food' differs in 1 row(s)" in problems
    assert all(secret not in p and "changed" not in p for p in problems)


def test_compare_reports_a_count_mismatch():
    assert imp._compare("friends", [{"user_id": "a", "friend_id": "b"}], []) == [
        "friends: planned 1, database has 0", "friends: 1 planned row(s) missing from the database"]


class RebuildCursor:
    def __init__(self, tables, log):
        self.tables, self.log, self.rows = tables, log, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.log.append((sql, params))
        match = re.search(r"from public\.(\w+)", sql)
        self.rows = self.tables.get(match.group(1), []) if match else []

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0]


class RebuildConn:
    def __init__(self, tables):
        self.tables, self.log = dict(tables), []
        self.tables.setdefault("import_quarantine", [{"n": 0}])

    def cursor(self, row_factory=None):
        return RebuildCursor(self.tables, self.log)


@needs_psycopg
def test_verify_database_passes_when_every_table_holds_the_plan_and_scopes_each_read():
    plan = imp.Plan()
    plan.users = _users(1)
    plan.rows["friends"] = [{"user_id": "u1", "friend_id": "u1", "created_at": None}]
    plan.rows["waitlist"] = [{"email": "w@example.com", "source": None, "created_at": None}]
    conn = RebuildConn({"friends": [{"user_id": "u1", "friend_id": "u1", "created_at": None}],
                        "waitlist": [{"email": "w@example.com", "source": None, "created_at": None}]})
    assert imp.verify_database(plan, conn) == []
    sql = {re.search(r"from public\.(\w+)", s).group(1): (s, p) for s, p in conn.log if "from public." in s}
    assert "creator_id = any" in sql["challenges"][0] and "reporter_id = any" in sql["content_reports"][0]
    assert " id = any" in sql["profiles"][0] and "user_id = any" in sql["nutrition_entries"][0]
    assert sql["nutrition_entries"][1] == (["u1"],)
    assert "email = any" in sql["waitlist"][0] and sql["waitlist"][1] == (["w@example.com"],)
    assert "join public.custom_foods" in sql["custom_food_servings"][0]


@needs_psycopg
def test_verify_database_finds_a_table_that_holds_something_other_than_the_plan():
    plan = imp.Plan()
    plan.users = _users(1)
    plan.rows["friends"] = [{"user_id": "u1", "friend_id": "u1", "created_at": None}]
    problems = imp.verify_database(plan, RebuildConn({"friends": []}))
    assert "friends: planned 1, database has 0" in problems


@needs_psycopg
def test_verify_database_checks_the_quarantine_count_and_not_the_other_tables_it_was_not_given():
    plan = imp.Plan()
    plan.users = _users(1)
    plan.quarantine = [("s", 1, {}, "e")]
    assert imp.verify_database(plan, RebuildConn({})) == ["import_quarantine: row count differs from the plan"]


@needs_psycopg
def test_verify_database_covers_every_table_the_import_writes_not_just_the_main_logs():
    conn = RebuildConn({})
    plan = imp.Plan()
    plan.users = _users(1)
    imp.verify_database(plan, conn)
    read = {re.search(r"from public\.(\w+)", s).group(1) for s, _p in conn.log if "from public." in s}
    assert read == set(imp.LOAD_ORDER) | {"import_quarantine"}


@needs_psycopg
def test_verify_database_reads_floats_back_at_full_precision_before_it_reads_anything():
    # Found on the real dev data: the pooler session prints doubles with 15 digits, so a stored
    # 79.83225712000001 came back as 79.83225712 and every such row looked corrupted.
    conn = RebuildConn({})
    plan = imp.Plan()
    plan.users = _users(1)
    imp.verify_database(plan, conn)
    first = conn.log[0][0].lower()
    assert "set local extra_float_digits" in first and first.rstrip().endswith("3")
