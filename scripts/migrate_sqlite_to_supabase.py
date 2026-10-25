#!/usr/bin/env python
"""Import a RepCheck SQLite database into the Supabase project.

    python scripts/migrate_sqlite_to_supabase.py repcheck_production.db --dry-run
    python scripts/migrate_sqlite_to_supabase.py repcheck_production.db --reset --files-dir D:/RepCheck_Backups/disk

Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL from the
environment or the repo's .env. The SQLite file is opened READ-ONLY.

What it does, in this order
  0. Plans everything from the SQLite file alone (--dry-run stops here). Anything that would fail in
     Postgres or Auth is found NOW, before anything is touched. Accounts Auth cannot take are listed
     (fix them in the source, or leave one out on purpose with --skip-account). A value Postgres cannot
     store (a NUL character, a lone surrogate, NaN) is parked whole in quarantine, not allowed to abort
     the load.
  1. Creates one Supabase Auth account per user, with the SAME uuid every run (uuid5 of the legacy id),
     so a rehearsal and the launch-day import give a person the same id. An account that already exists
     keeps its password and confirmation; only its email and legacy metadata are refreshed. No password
     is supplied for a new one, so Auth stores a random one nobody knows; the real password hash goes to
     legacy_password_hashes, and a row THERE -- not a missing Auth password -- marks an account as still
     needing its password migrated.
  2. Copies the photo and video FILES into the private Storage buckets (see "Files" below), before the
     database is touched, and checks each against Storage's own record of it.
  3. In ONE database transaction: with --reset, deletes what a previous import left (its profiles, which
     cascades through everything they own, the parked quarantine rows, this file's waitlist emails), then
     loads every real table and turns each user_data blob into rows.
  4. Proves it BEFORE committing: every source item is accounted for as imported, quarantined, a
     collapsed duplicate or not imported (orphaned); then every table is read back and compared, row by
     row, with the plan. A failed check rolls the transaction back, so the project is exactly as it was,
     and deletes the Auth accounts and the stored files this run created.
  5. Commits. Only then are Auth accounts of previously imported users who are no longer in the source
     deleted, and stored files the plan does not call for (an earlier failed run's, or an account that
     is gone) removed, so Storage ends up holding exactly the plan.

Nothing a live user owns is silently dropped. A row that breaks a rule is parked whole in
import_quarantine with the reason (erased with its owner). A key the mapper does not recognise goes into
that row's `extra` column. Three kinds of account are deliberately NOT imported, and are counted in the
report: rows whose owner is no longer in `users` (SQLite never enforced its foreign keys, so deleting an
account left them behind), accounts already past their 30-day deletion window, and accounts the operator
left out with --skip-account. A deleted account's data must not follow the migration.

Files. /admin/export-db carries only the database; the photos and clips live on the old server's disk
(DATA_DIR/progress_photos and DATA_DIR/analyze_videos). Copy those two folders somewhere (outside the
repo) and pass their parent with --files-dir, or import the rows alone with --skip-files. Rows that point
at files with neither flag stop the run, and so does a folder in which none of them is found. A row's file
that is simply absent is reported and the row is kept (the old site answered 404 for it too). A file is
copied only if its name is what the old server generated and its type is one the bucket allows; links are
refused. Object key: '<user uuid>/<file name>'. Nothing is copied for an account that is not imported.

Sized for the app as it is (thousands of users, hundreds of thousands of rows): the whole import is held
in memory and loaded with executemany. Move to COPY and batches if it grows a hundredfold.

Rerunnable: --reset replaces a previous import. Without it the script refuses to run on top of one, and
--reset itself refuses once an imported account has signed in unless the project ref is given.
"""

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

# Fixed forever. Changing it changes every imported user's id.
NAMESPACE = uuid.UUID("0b6a1c2e-5b6e-4a53-9f0e-2d3f4c5a6b7c")

REPO_ROOT = Path(__file__).resolve().parent.parent
UTC = dt.timezone.utc

# Must equal database.ACCOUNT_DELETION_GRACE_DAYS (a test pins it): an account whose deletion
# was requested longer ago than this is past its window.
ACCOUNT_DELETION_GRACE_DAYS = 30
MAX_WEIGHT_KG = 400            # the weight_entries check constraint; keep the two equal
INT32_MAX = 2147483647         # the largest value a Postgres `integer` column holds
MS_2000, MS_2100 = 946684800000, 4102444800000   # the plausible range for a JS timestamp
CHAT_STAMP_TOLERANCE_S = 5     # createdAtMs may differ this much from its analysis row


def generated_id(*parts):
    """A stable id for a legacy entry that never had one. The old server matched
    id-less entries by their full JSON (database._merge_by_id), so the same
    content on the same day is the same entry: hashing it reproduces that, and
    makes a rerun produce the same ids."""
    digest = hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode("utf-8")).hexdigest()
    return "legacy-" + digest[:20]


def user_uuid(legacy_id):
    return str(uuid.uuid5(NAMESPACE, f"repcheck-legacy-user-{legacy_id}"))


# ---------------------------------------------------------------------------
# Value parsing
# ---------------------------------------------------------------------------

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_day(value):
    """'YYYY-MM-DD' that is a real calendar day, else None."""
    if not isinstance(value, str) or not _DAY_RE.match(value):
        return None
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        return None
    return value


def parse_ts(value):
    """SQLite datetime('now') text ('YYYY-MM-DD HH:MM:SS', UTC) or an ISO
    8601 string, as an aware UTC datetime. None if it is neither."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace(" ", "T", 1) if " " in value.strip() and "T" not in value else value.strip()
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def ms_to_dt(value):
    """Milliseconds since epoch (JS Date.now()) as an aware UTC datetime, or
    None if it is not a plausible one (a number between 2000 and 2100)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    if not MS_2000 <= value <= MS_2100:
        return None
    return dt.datetime.fromtimestamp(value / 1000, tz=UTC)


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def take_float(src, key, extra):
    """A numeric field. "" / missing -> None. Anything non-numeric is kept
    verbatim in `extra` rather than lost, and the column is left NULL."""
    value = src.get(key)
    if value is None or value == "":
        return None
    if _is_number(value):
        return float(value)
    if isinstance(value, str):
        try:
            number = float(value)
            if math.isfinite(number):
                return number
        except ValueError:
            pass
    extra[key] = value
    return None


def take_int(src, key, extra):
    number = take_float(src, key, extra)
    if number is None:
        return None
    if number.is_integer() and abs(number) <= INT32_MAX:
        return int(number)
    extra[key] = src.get(key)          # fractional, or too big for a Postgres integer
    return None


def take_text(src, key, extra):
    value = src.get(key)
    if value is None:
        return None
    if isinstance(value, str):
        return value
    extra[key] = value
    return None


def take_bool(src, key, extra, default=False):
    value = src.get(key)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    extra[key] = value
    return default


def leftovers(src, consumed):
    return {k: v for k, v in src.items() if k not in consumed}


def unsafe_reason(value):
    """Why a value cannot be stored in Postgres, or None. SQLite and Python accept every one of these, so
    nothing before the load notices: a NUL character, a lone surrogate (half of an emoji, what slicing
    through one leaves), and NaN or Infinity (jsonb has no such number). Any user of the old site could
    store one through the sync endpoint, so they are checked for in the plan, where --dry-run sees them."""
    if isinstance(value, str):
        if "\x00" in value:
            return "contains a NUL character"
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            return "contains a lone surrogate (half of an emoji)"
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return "contains NaN or Infinity"
    if isinstance(value, dict):
        for k, v in value.items():
            reason = unsafe_reason(k) or unsafe_reason(v)
            if reason:
                return reason
    elif isinstance(value, (list, tuple)):
        for v in value:
            reason = unsafe_reason(v)
            if reason:
                return reason
    return None


# What Supabase Auth will take as an email, approximately: dot-atom local part up to 64 characters with no
# leading, trailing or doubled dots, then a domain of dot-separated labels. The old sign-up only checked
# for an @ and a dot after it, so some stored addresses will not pass.
EMAIL_RE = re.compile(
    r"^(?!\.)(?!.*\.\.)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}(?<!\.)@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


def account_problem(user):
    """Why this account cannot be created in Auth / stored in Postgres, or None."""
    email = user.get("email")
    if not isinstance(email, str) or len(email) > 254 or not EMAIL_RE.match(email):
        return "its email address is not one Supabase Auth will accept"
    for field in ("name", "avatar_url", "friend_code"):
        reason = unsafe_reason(user.get(field))
        if reason:
            return f"its {field} {reason}"
    return None


# ---------------------------------------------------------------------------
# Output columns per table (mappers must emit exactly these)
# ---------------------------------------------------------------------------

COLUMNS = {
    "user_settings": ["user_id", "theme", "language", "units_weight", "units_height", "units_distance",
                      "units_clock", "hyrox_leaderboard_gender", "hyrox_facility_lane_m",
                      "hyrox_history_backfilled", "extra"],
    "nutrition_goals": ["user_id", "protein", "fat", "carbs", "extra"],
    "nutrition_favorites": ["user_id", "food_name"],
    "exercise_favorites": ["user_id", "exercise_name"],
    "coaching_profiles": ["user_id", "aspiration", "gender", "weight_kg", "body_fat_range_id", "activity_level",
                          "protein_preference", "diet_preference", "goal_weight_kg", "height_cm",
                          "distribution_mode", "loss_rate_pct", "gain_rate_pct", "created_on",
                          "last_adjustment_on", "last_adjustment_reason", "last_adjustment_delta",
                          "last_adjustment_at", "weekly_distribution", "goal_achieved_weight_kg",
                          "goal_achieved_aspiration", "goal_handled_weight_kg", "goal_handled_aspiration",
                          "inactivity_notified_on", "extra"],
    "split_plans": ["user_id", "split_type", "days_per_week", "goal", "days", "schedule",
                    "exercise_prescriptions", "extra"],
    "nutrition_entries": ["user_id", "id", "log_date", "food", "added_at", "source", "grams", "unit",
                          "base_calories", "base_carbs", "base_fat", "base_protein", "ingredients", "extra"],
    "workout_entries": ["user_id", "id", "log_date", "exercise", "added_at", "unilateral", "extra"],
    "workout_sets": ["user_id", "entry_id", "position", "reps", "weight_kg", "left_kg", "right_kg",
                     "left_reps", "right_reps", "extra"],
    "weight_entries": ["user_id", "log_date", "kg", "logged_at", "extra"],
    "day_status_overrides": ["user_id", "log_date", "status"],
    "activity_days": ["user_id", "log_date", "action"],
    "analyze_log_entries": ["user_id", "exercise", "analyzed_at", "extra"],
    "hyrox_races": ["user_id", "id", "raced_at", "category", "format", "gender", "scale", "total_seconds",
                    "flagged", "is_new_pb", "analysis", "extra"],
    "hyrox_race_splits": ["user_id", "race_id", "position", "key", "title", "at_seconds", "extra"],
    "coach_messages": ["user_id", "client_id", "role", "body", "msg_date", "sources", "extra"],
    "workout_chat_messages": ["user_id", "client_id", "role", "body", "msg_date", "sources", "extra"],
    "analyze_chat_messages": ["user_id", "client_id", "analyze_result_id", "role", "body", "sources", "extra"],
}

# The columns adapt() wraps in Jsonb.
JSON_COLUMNS = {"extra", "ingredients", "analysis", "weekly_distribution", "days", "schedule",
                "exercise_prescriptions", "sources"}

ANALYZE_CHAT_KEY_RE = re.compile(r"^repcheck_analyze_chat_v1_(0|[1-9]\d*)$")


# ---------------------------------------------------------------------------
# One user's blobs -> rows
# ---------------------------------------------------------------------------

class UserMapper:
    """Maps one user's user_data blobs to table rows, and accounts for every
    source item: items == imported + quarantined + collapsed duplicates."""

    def __init__(self, uid, analyses):
        self.uid = uid
        self.analyses = analyses            # {analyze_results.id: created_at datetime or None}
        self.rows = defaultdict(list)
        self.quarantine = []                # (source, payload, error)
        self.notes = Counter()
        self.items = Counter()
        self.made = Counter()
        self.rejected = Counter()
        self.collapsed = Counter()
        self._idless = Counter()

    # -- accounting ---------------------------------------------------------
    def take(self, name):
        self.items[name] += 1

    def ok(self, name, table=None, row=None):
        self.made[name] += 1
        if table:
            self.rows[table].append(row)

    def reject(self, name, source, payload, error):
        self.rejected[name] += 1
        self.quarantine.append((source, payload, error))

    def dup(self, name):
        self.collapsed[name] += 1

    def balanced(self):
        names = set(self.items) | set(self.made) | set(self.rejected) | set(self.collapsed)
        return {n: (self.items[n], self.made[n] + self.rejected[n] + self.collapsed[n]) for n in names
                if self.items[n] != self.made[n] + self.rejected[n] + self.collapsed[n]}

    def row(self, table, **values):
        if set(values) != set(COLUMNS[table]):
            raise ValueError(f"{table}: a mapper emitted {sorted(values)}, expected {COLUMNS[table]}")
        return values

    def _idless_id(self, *parts):
        """An id for a legacy entry that never had one. Two identical id-less entries are two entries (the
        user logged it twice, and merging them would undercount), so the n-th copy gets its own id. Stable
        across runs, so a rerun produces the same ids."""
        key = json.dumps(parts, sort_keys=True, default=str)
        n = self._idless[key]
        self._idless[key] += 1
        if n:
            self.notes["identical_id-less_entries_were_kept_as_separate_rows"] += 1
        return generated_id(*parts, n)

    # -- dispatch -----------------------------------------------------------
    def map_all(self, blobs):
        coaching = {}
        settings = {}
        for key in sorted(blobs):
            value = blobs[key]
            reason = unsafe_reason(value)
            if reason:
                # Valid in SQLite, fatal in Postgres. Park the whole value, encoded so it is safe to store.
                self.take("unsafe_blobs")
                self.reject("unsafe_blobs", f"user_data:{key}",
                            {"key": key, "value_json": json.dumps(value, ensure_ascii=True)}, f"the value {reason}")
                continue
            if key in ("repcheck_theme", "repcheck_language", "repcheck_units_v1",
                       "repcheck_hyrox_leaderboard_gender_v1", "repcheck_hyrox_facility_lane_v1",
                       "repcheck_hyrox_history_synced_v1"):
                settings[key] = value
            elif key.startswith("repcheck_coaching_"):
                coaching[key] = value
            elif key == "repcheck_nutrition_log_v1":
                self.nutrition_log(value)
            elif key == "repcheck_workout_log_v2":
                self.workout_log(value)
            elif key == "repcheck_weight_log_v1":
                self.weight_log(value)
            elif key == "repcheck_day_status_v1":
                self.day_status(value)
            elif key == "repcheck_activity_log_v1":
                self.activity_log(value)
            elif key == "repcheck_analyze_log_v1":
                self.analyze_log(value)
            elif key == "repcheck_hyrox_history_v1":
                self.hyrox_history(value)
            elif key == "repcheck_coach_chat_v1":
                self.coach_chat(value)
            elif key == "repcheck_workout_chat_v1":
                self.workout_chat(value)
            elif key == "repcheck_nutrition_goals_v1":
                self.nutrition_goals(value)
            elif key == "repcheck_nutrition_favorites_v1":
                self.favorites("nutrition_favorites", "food_name", value)
            elif key == "repcheck_exercise_favorites_v1":
                self.favorites("exercise_favorites", "exercise_name", value)
            elif key == "repcheck_split_plan_v1":
                self.split_plan(value)
            elif ANALYZE_CHAT_KEY_RE.match(key):
                self.analyze_chat(key, value)
            else:
                self.take("unknown_keys")
                self.reject("unknown_keys", f"user_data:{key}", {"key": key, "value": value}, "unrecognised synced key")
        if settings:
            self.user_settings(settings)
        if coaching:
            self.coaching(coaching)

    # -- helpers ------------------------------------------------------------
    def _dated_lists(self, name, source, value):
        """Yield (day, item) for a {day: [items]} blob, rejecting what is not."""
        if not isinstance(value, dict):
            self.take(name)
            self.reject(name, source, {"value": value}, "blob is not an object")
            return
        for day_key, items in value.items():
            if not isinstance(items, list):
                self.take(name)
                self.reject(name, source, {"date": day_key, "value": items}, "day value is not a list")
                continue
            for item in items:
                self.take(name)
                day = parse_day(day_key)
                if day is None:
                    self.reject(name, source, {"date": day_key, "entry": item}, "date key is not a real calendar day")
                    continue
                yield day, item

    def _fallback_when(self, day, extra_note):
        self.notes[extra_note] += 1
        return dt.datetime.fromisoformat(day).replace(tzinfo=UTC)

    # -- food log -----------------------------------------------------------
    def nutrition_log(self, value):
        seen = {}
        consumed = {"id", "food", "addedAt", "source", "grams", "unit", "baseCalories", "baseCarbs",
                    "baseFat", "baseProtein", "ingredients"}
        for day, e in self._dated_lists("nutrition_entries", "user_data:repcheck_nutrition_log_v1", value):
            if not isinstance(e, dict):
                self.reject("nutrition_entries", "user_data:repcheck_nutrition_log_v1", {"date": day, "entry": e}, "entry is not an object")
                continue
            entry_id = e.get("id")
            if entry_id in (None, ""):
                entry_id = self._idless_id(day, e)
                self.notes["nutrition_entry_had_no_id_so_one_was_generated"] += 1
            entry_id = str(entry_id)
            if entry_id in seen:
                if seen[entry_id] == (day, e):
                    self.dup("nutrition_entries")
                else:
                    self.reject("nutrition_entries", "user_data:repcheck_nutrition_log_v1", {"date": day, "entry": e},
                                "id reused by a different entry")
                continue
            seen[entry_id] = (day, e)
            extra = {}
            food = e.get("food")
            used = set(consumed)
            if not isinstance(food, str) or food == "":
                if isinstance(e.get("name"), str) and e["name"] != "":
                    food = e["name"]       # older rows: the display name was `name`
                    used.add("name")
                else:
                    if "food" in e and e["food"] not in (None, ""):
                        extra["food"] = e["food"]          # present but not text: keep it
                    food = ""
                    self.notes["nutrition_entry_without_food_name"] += 1
            added = ms_to_dt(e.get("addedAt"))
            if added is None:
                added = self._fallback_when(day, "nutrition_added_at_defaulted_to_midnight")
                if "addedAt" in e:
                    extra["addedAt"] = e["addedAt"]
                if "hour" in e:
                    self.notes["nutrition_entry_has_a_legacy_hour_and_no_addedAt (hour kept in extra, time defaulted to midnight)"] += 1
            ingredients = e.get("ingredients")
            if ingredients is not None and not isinstance(ingredients, list):
                extra["ingredients"] = ingredients
                ingredients = None
            extra.update(leftovers(e, used))
            self.ok("nutrition_entries", "nutrition_entries", self.row(
                "nutrition_entries", user_id=self.uid, id=entry_id, log_date=day, food=food, added_at=added,
                source=take_text(e, "source", extra), grams=take_float(e, "grams", extra),
                unit=take_text(e, "unit", extra), base_calories=take_float(e, "baseCalories", extra),
                base_carbs=take_float(e, "baseCarbs", extra), base_fat=take_float(e, "baseFat", extra),
                base_protein=take_float(e, "baseProtein", extra), ingredients=ingredients, extra=extra))

    # -- workout log --------------------------------------------------------
    def workout_log(self, value):
        seen = {}
        consumed = {"id", "exercise", "addedAt", "sets", "unilateral"}
        set_fields = {"reps", "weightKg", "leftKg", "rightKg", "leftReps", "rightReps"}
        source = "user_data:repcheck_workout_log_v2"
        for day, e in self._dated_lists("workout_entries", source, value):
            if not isinstance(e, dict):
                self.reject("workout_entries", source, {"date": day, "entry": e}, "entry is not an object")
                continue
            entry_id = e.get("id")
            if entry_id in (None, ""):
                entry_id = self._idless_id(day, e)
                self.notes["workout_entry_had_no_id_so_one_was_generated"] += 1
            entry_id = str(entry_id)
            exercise = e.get("exercise")
            if not isinstance(exercise, str) or exercise == "":
                self.reject("workout_entries", source, {"date": day, "entry": e}, "entry has no exercise name")
                continue
            if entry_id in seen:
                if seen[entry_id] == (day, e):
                    self.dup("workout_entries")
                else:
                    self.reject("workout_entries", source, {"date": day, "entry": e}, "id reused by a different entry")
                continue
            seen[entry_id] = (day, e)
            extra = {}
            added = ms_to_dt(e.get("addedAt"))
            if added is None:
                added = self._fallback_when(day, "workout_added_at_defaulted_to_midnight")
                if "addedAt" in e:
                    extra["addedAt"] = e["addedAt"]
            sets = e.get("sets")
            if sets is None:
                sets = []
            elif not isinstance(sets, list):
                extra["sets"] = sets
                sets = []
            extra.update(leftovers(e, consumed))
            self.ok("workout_entries", "workout_entries", self.row(
                "workout_entries", user_id=self.uid, id=entry_id, log_date=day, exercise=exercise, added_at=added,
                unilateral=take_bool(e, "unilateral", extra), extra=extra))
            for position, s in enumerate(sets):
                self.take("workout_sets")
                s_extra = {}
                if not isinstance(s, dict):
                    s_extra["raw"] = s
                    s = {}
                s_extra.update(leftovers(s, set_fields))
                self.ok("workout_sets", "workout_sets", self.row(
                    "workout_sets", user_id=self.uid, entry_id=entry_id, position=position,
                    reps=take_int(s, "reps", s_extra), weight_kg=take_float(s, "weightKg", s_extra),
                    left_kg=take_float(s, "leftKg", s_extra), right_kg=take_float(s, "rightKg", s_extra),
                    left_reps=take_int(s, "leftReps", s_extra), right_reps=take_int(s, "rightReps", s_extra),
                    extra=s_extra))

    # -- weight / day status / activity -------------------------------------
    def weight_log(self, value):
        source = "user_data:repcheck_weight_log_v1"
        if not isinstance(value, dict):
            self.take("weight_entries")
            self.reject("weight_entries", source, {"value": value}, "blob is not an object")
            return
        for day_key, entry in value.items():
            self.take("weight_entries")
            day = parse_day(day_key)
            if day is None:
                self.reject("weight_entries", source, {"date": day_key, "entry": entry}, "date key is not a real calendar day")
                continue
            extra = {}
            if isinstance(entry, dict):
                kg_raw, logged_raw = entry.get("kg"), entry.get("loggedAt")
                extra.update(leftovers(entry, {"kg", "loggedAt"}))
            else:
                kg_raw, logged_raw = entry, None      # an older shape: the bare number
                self.notes["weight_entry_was_a_bare_number"] += 1
            if not _is_number(kg_raw) or not 0 < kg_raw <= MAX_WEIGHT_KG:
                self.reject("weight_entries", source, {"date": day_key, "entry": entry}, "kg is not a number in (0, 400]")
                continue
            logged = ms_to_dt(logged_raw)
            if logged is None:
                logged = self._fallback_when(day, "weight_logged_at_defaulted_to_midnight")
                if logged_raw is not None:
                    extra["loggedAt"] = logged_raw
            self.ok("weight_entries", "weight_entries", self.row(
                "weight_entries", user_id=self.uid, log_date=day, kg=float(kg_raw), logged_at=logged, extra=extra))

    def day_status(self, value):
        source = "user_data:repcheck_day_status_v1"
        if not isinstance(value, dict):
            self.take("day_status_overrides")
            self.reject("day_status_overrides", source, {"value": value}, "blob is not an object")
            return
        for day_key, status in value.items():
            self.take("day_status_overrides")
            day = parse_day(day_key)
            if day is None or status not in ("fasting", "incomplete"):
                self.reject("day_status_overrides", source, {"date": day_key, "status": status},
                            "not a real day" if day is None else "status is not fasting/incomplete")
                continue
            self.ok("day_status_overrides", "day_status_overrides", self.row(
                "day_status_overrides", user_id=self.uid, log_date=day, status=status))

    def activity_log(self, value):
        source = "user_data:repcheck_activity_log_v1"
        seen = set()
        if not isinstance(value, dict):
            self.take("activity_days")
            self.reject("activity_days", source, {"value": value}, "blob is not an object")
            return
        for day_key, actions in value.items():
            if not isinstance(actions, list):
                self.take("activity_days")
                self.reject("activity_days", source, {"date": day_key, "value": actions}, "day value is not a list")
                continue
            for action in actions:
                self.take("activity_days")
                day = parse_day(day_key)
                if day is None or not isinstance(action, str) or action == "":
                    self.reject("activity_days", source, {"date": day_key, "action": action}, "bad day or action")
                    continue
                if (day, action) in seen:
                    self.dup("activity_days")
                    continue
                seen.add((day, action))
                self.ok("activity_days", "activity_days", self.row("activity_days", user_id=self.uid, log_date=day, action=action))

    def analyze_log(self, value):
        source = "user_data:repcheck_analyze_log_v1"
        if not isinstance(value, list):
            self.take("analyze_log_entries")
            self.reject("analyze_log_entries", source, {"value": value}, "blob is not a list")
            return
        seen = {}
        for e in value:
            self.take("analyze_log_entries")
            if not isinstance(e, dict) or not isinstance(e.get("exercise"), str):
                self.reject("analyze_log_entries", source, {"entry": e}, "entry has no exercise")
                continue
            analyzed = ms_to_dt(e.get("analyzedAt"))
            if analyzed is None:
                self.reject("analyze_log_entries", source, {"entry": e}, "analyzedAt is not a plausible millisecond timestamp")
                continue
            key = (e["exercise"], analyzed)
            if key in seen:
                if seen[key] == e:
                    self.dup("analyze_log_entries")
                else:
                    self.reject("analyze_log_entries", source, {"entry": e},
                                "same exercise and time as another entry, with different fields")
                continue
            seen[key] = e
            self.ok("analyze_log_entries", "analyze_log_entries", self.row(
                "analyze_log_entries", user_id=self.uid, exercise=e["exercise"], analyzed_at=analyzed,
                extra=leftovers(e, {"exercise", "analyzedAt"})))

    # -- HYROX --------------------------------------------------------------
    def hyrox_history(self, value):
        source = "user_data:repcheck_hyrox_history_v1"
        if not isinstance(value, list):
            self.take("hyrox_races")
            self.reject("hyrox_races", source, {"value": value}, "blob is not a list")
            return
        seen = {}
        consumed = {"id", "date", "category", "format", "gender", "scale", "totalSeconds", "splits",
                    "flagged", "isNewPb", "analysis"}
        for r in value:
            self.take("hyrox_races")
            if not isinstance(r, dict):
                self.reject("hyrox_races", source, {"race": r}, "race is not an object")
                continue
            if r.get("id") in (None, ""):
                race_id = self._idless_id(r)
                self.notes["hyrox_race_had_no_id_so_one_was_generated"] += 1
            else:
                race_id = str(r["id"])
            if race_id in seen:
                if seen[race_id] == r:
                    self.dup("hyrox_races")
                else:
                    self.reject("hyrox_races", source, {"race": r}, "id reused by a different race")
                continue
            seen[race_id] = r
            raced = parse_ts(r.get("date")) if isinstance(r.get("date"), str) else None
            if raced is None:
                self.reject("hyrox_races", source, {"race": r}, "date is not a parseable timestamp")
                continue
            total = r.get("totalSeconds")
            if not _is_number(total) or not isinstance(r.get("category"), str):
                self.reject("hyrox_races", source, {"race": r}, "missing category or numeric totalSeconds")
                continue
            splits = r.get("splits")
            if splits is None:
                splits = []
            bad_split = (not isinstance(splits, list) or any(
                not isinstance(s, dict) or not isinstance(s.get("key"), str) or not _is_number(s.get("atSeconds"))
                for s in splits))
            if bad_split:
                self.reject("hyrox_races", source, {"race": r}, "a split lacks a key or numeric atSeconds")
                continue
            extra = {}
            analysis = r.get("analysis")
            if analysis is not None and not isinstance(analysis, dict):
                extra["analysis"] = analysis
                analysis = None
            extra.update(leftovers(r, consumed))
            scale = r.get("scale")
            if scale is None:
                scale = "full"
            elif not isinstance(scale, str):
                extra["scale"] = scale
                scale = "full"
            self.ok("hyrox_races", "hyrox_races", self.row(
                "hyrox_races", user_id=self.uid, id=race_id, raced_at=raced, category=r["category"],
                format=take_text(r, "format", extra), gender=take_text(r, "gender", extra), scale=scale,
                total_seconds=float(total), flagged=take_bool(r, "flagged", extra),
                is_new_pb=take_bool(r, "isNewPb", extra), analysis=analysis, extra=extra))
            for position, s in enumerate(splits):
                self.take("hyrox_race_splits")
                s_extra = leftovers(s, {"key", "title", "atSeconds"})
                self.ok("hyrox_race_splits", "hyrox_race_splits", self.row(
                    "hyrox_race_splits", user_id=self.uid, race_id=race_id, position=position, key=s["key"],
                    title=take_text(s, "title", s_extra), at_seconds=float(s["atSeconds"]), extra=s_extra))

    # -- chats --------------------------------------------------------------
    def _message(self, name, source, m, day, id_field=None):
        """Common validation for a chat turn; returns (role, body, sources, extra) or None."""
        if not isinstance(m, dict) or not isinstance(m.get("role"), str) or not isinstance(m.get("text"), str):
            self.reject(name, source, {"date": day, "turn": m}, "turn has no role/text")
            return None
        extra = {}
        sources = m.get("sources")
        if sources is not None and not isinstance(sources, list):
            extra["sources"] = sources
            sources = None
        consumed = {"role", "text", "sources"} | ({"date"} if day is not None else set()) | ({id_field} if id_field else set())
        extra.update(leftovers(m, consumed))
        if "date" in m and day is not None and m["date"] != day:
            extra["date"] = m["date"]
        return m["role"], m["text"], sources, extra

    def coach_chat(self, value):
        source = "user_data:repcheck_coach_chat_v1"
        if not isinstance(value, list):
            self.take("coach_messages")
            self.reject("coach_messages", source, {"value": value}, "blob is not a list")
            return
        for position, m in enumerate(value):
            self.take("coach_messages")
            day = parse_day(m.get("date")) if isinstance(m, dict) else None
            parsed = self._message("coach_messages", source, m, day)
            if parsed is None:
                continue
            if day is None:
                self.notes["coach_turn_has_no_real_date (kept with a NULL date)"] += 1
            role, body, sources, extra = parsed
            # The old thread had no turn ids. The position makes each key unique, and the hash
            # makes it deterministic, so a rerun produces the same keys.
            self.ok("coach_messages", "coach_messages", self.row(
                "coach_messages", user_id=self.uid, client_id=generated_id("coach-chat", position, m), role=role,
                body=body, msg_date=day, sources=sources, extra=extra))

    def workout_chat(self, value):
        source = "user_data:repcheck_workout_chat_v1"
        seen = {}
        position = Counter()
        for day, m in self._dated_lists("workout_chat_messages", source, value):
            position[day] += 1
            client_id = m.get("id") if isinstance(m, dict) else None
            client_id = None if client_id in (None, "") else str(client_id)
            if client_id is not None and client_id in seen:
                if seen[client_id] == (day, m):
                    self.dup("workout_chat_messages")
                else:
                    self.reject("workout_chat_messages", source, {"date": day, "turn": m}, "id reused by a different turn")
                continue
            parsed = self._message("workout_chat_messages", source, m, day, id_field="id")
            if parsed is None:
                continue
            if client_id is not None:
                seen[client_id] = (day, m)
            role, body, sources, extra = parsed
            if client_id is None:      # older turns carry no id: the day and position make one
                client_id = generated_id("workout-chat", day, position[day], m)
            self.ok("workout_chat_messages", "workout_chat_messages", self.row(
                "workout_chat_messages", user_id=self.uid, client_id=client_id, role=role, body=body, msg_date=day,
                sources=sources, extra=extra))

    def analyze_chat(self, key, value):
        source = f"user_data:{key}"
        result_id = int(ANALYZE_CHAT_KEY_RE.match(key).group(1))
        history = value.get("history") if isinstance(value, dict) else None
        if not isinstance(history, list):
            self.take("analyze_chat_messages")
            self.reject("analyze_chat_messages", source, {"value": value}, "thread has no history list")
            return
        created = self.analyses.get(result_id, "missing")
        stamp = value.get("createdAtMs")
        if created not in ("missing", None) and ms_to_dt(stamp) is not None and abs((ms_to_dt(stamp) - created).total_seconds()) > CHAT_STAMP_TOLERANCE_S:
            self.notes["analyze_chat_createdAtMs_differs_from_analysis_created_at"] += 1
        for position, m in enumerate(history):
            self.take("analyze_chat_messages")
            if created == "missing":
                self.reject("analyze_chat_messages", source, {"turn": m}, "no analysis of this user has that id")
                continue
            parsed = self._message("analyze_chat_messages", source, m, None)
            if parsed is None:
                continue
            role, body, sources, extra = parsed
            self.ok("analyze_chat_messages", "analyze_chat_messages", self.row(
                "analyze_chat_messages", user_id=self.uid, client_id=generated_id("analyze-chat", result_id, position, m),
                analyze_result_id=result_id, role=role, body=body, sources=sources, extra=extra))

    # -- goals, favourites, plan, settings, coaching ------------------------
    def nutrition_goals(self, value):
        source = "user_data:repcheck_nutrition_goals_v1"
        self.take("nutrition_goals")
        if not isinstance(value, dict) or not all(
                _is_number(value.get(k)) and abs(value[k]) <= INT32_MAX for k in ("protein", "fat", "carbs")):
            self.reject("nutrition_goals", source, {"value": value}, "protein/fat/carbs are not all numbers in range")
            return
        extra = leftovers(value, {"protein", "fat", "carbs"})
        ints = {}
        for k in ("protein", "fat", "carbs"):
            ints[k] = int(round(value[k]))
            if ints[k] != value[k]:
                extra[f"{k}_original"] = value[k]
        self.ok("nutrition_goals", "nutrition_goals", self.row(
            "nutrition_goals", user_id=self.uid, protein=ints["protein"], fat=ints["fat"], carbs=ints["carbs"], extra=extra))

    def favorites(self, table, column, value):
        source = f"user_data:{table}"
        if not isinstance(value, list):
            self.take(table)
            self.reject(table, source, {"value": value}, "blob is not a list")
            return
        seen = set()
        for name in value:
            self.take(table)
            if not isinstance(name, str) or name == "":
                self.reject(table, source, {"value": name}, "not a non-empty string")
            elif name in seen:
                self.dup(table)
            else:
                seen.add(name)
                self.ok(table, table, self.row(table, user_id=self.uid, **{column: name}))

    def split_plan(self, value):
        source = "user_data:repcheck_split_plan_v1"
        self.take("split_plans")
        if not isinstance(value, dict):
            self.reject("split_plans", source, {"value": value}, "blob is not an object")
            return
        extra = leftovers(value, {"splitType", "daysPerWeek", "goal", "days", "schedule", "exercisePrescriptions"})
        self.ok("split_plans", "split_plans", self.row(
            "split_plans", user_id=self.uid, split_type=take_text(value, "splitType", extra),
            days_per_week=take_int(value, "daysPerWeek", extra), goal=take_text(value, "goal", extra),
            days=value.get("days"), schedule=value.get("schedule"),
            exercise_prescriptions=value.get("exercisePrescriptions"), extra=extra))

    def user_settings(self, blobs):
        self.take("user_settings")
        extra = {}
        row = dict.fromkeys(COLUMNS["user_settings"])
        row.update(user_id=self.uid, hyrox_history_backfilled=False)
        for blob_key, column in (("repcheck_theme", "theme"), ("repcheck_language", "language")):
            if blob_key in blobs:
                if isinstance(blobs[blob_key], str):
                    row[column] = blobs[blob_key]
                else:
                    extra[column] = blobs[blob_key]
        units = blobs.get("repcheck_units_v1")
        if units is not None:
            if isinstance(units, dict):
                for col, key in (("units_weight", "weight"), ("units_height", "height"),
                                 ("units_distance", "distance"), ("units_clock", "clock")):
                    row[col] = take_text(units, key, extra)
                extra.update({f"units.{k}": v for k, v in leftovers(units, {"weight", "height", "distance", "clock"}).items()})
            else:
                extra["units"] = units
        if "repcheck_hyrox_leaderboard_gender_v1" in blobs:
            g = blobs["repcheck_hyrox_leaderboard_gender_v1"]
            if isinstance(g, str):
                row["hyrox_leaderboard_gender"] = g
            else:
                extra["hyrox_leaderboard_gender"] = g
        if "repcheck_hyrox_facility_lane_v1" in blobs:
            lane = blobs["repcheck_hyrox_facility_lane_v1"]
            if lane is None:
                pass
            elif _is_number(lane):
                row["hyrox_facility_lane_m"] = float(lane)
            else:
                extra["hyrox_facility_lane_m"] = lane
        if "repcheck_hyrox_history_synced_v1" in blobs:
            flag = blobs["repcheck_hyrox_history_synced_v1"]
            row["hyrox_history_backfilled"] = flag in (1, True, "1")
            if flag not in (1, True, "1", 0, False, "0", None):
                extra["hyrox_history_synced"] = flag
        row["extra"] = extra
        self.ok("user_settings", "user_settings", self.row("user_settings", **row))

    def coaching(self, blobs):
        self.take("coaching_profiles")
        extra = {}
        row = dict.fromkeys(COLUMNS["coaching_profiles"])
        row.update(user_id=self.uid)
        profile = blobs.get("repcheck_coaching_profile_v1")
        if profile is not None:
            if not isinstance(profile, dict):
                extra["profile"] = profile
            else:
                consumed = {"aspiration", "gender", "weightKg", "bodyFatRangeId", "activityLevel",
                            "proteinPreference", "dietPreference", "goalWeightKg", "heightCm", "distribution",
                            "lossRatePct", "gainRatePct", "createdAt", "lastAdjustmentDate"}
                extra.update(leftovers(profile, consumed))
                row.update(
                    aspiration=take_text(profile, "aspiration", extra), gender=take_text(profile, "gender", extra),
                    weight_kg=take_float(profile, "weightKg", extra),
                    body_fat_range_id=take_text(profile, "bodyFatRangeId", extra),
                    activity_level=take_text(profile, "activityLevel", extra),
                    protein_preference=take_text(profile, "proteinPreference", extra),
                    diet_preference=take_text(profile, "dietPreference", extra),
                    goal_weight_kg=take_float(profile, "goalWeightKg", extra),
                    height_cm=take_float(profile, "heightCm", extra),
                    distribution_mode=take_text(profile, "distribution", extra),
                    loss_rate_pct=take_float(profile, "lossRatePct", extra),
                    gain_rate_pct=take_float(profile, "gainRatePct", extra))
                for col, key in (("created_on", "createdAt"), ("last_adjustment_on", "lastAdjustmentDate")):
                    raw = profile.get(key)
                    day = parse_day(raw[:10]) if isinstance(raw, str) else None
                    row[col] = day
                    if raw is not None and day is None:
                        extra[key] = raw
        last = blobs.get("repcheck_coaching_last_adjustment_v1")
        if last is not None:
            if isinstance(last, dict):
                sub = {}
                row["last_adjustment_reason"] = take_text(last, "reason", sub)
                row["last_adjustment_delta"] = take_float(last, "delta", sub)
                at = ms_to_dt(last.get("at"))
                row["last_adjustment_at"] = at
                if last.get("at") is not None and at is None:
                    sub["at"] = last["at"]
                sub.update(leftovers(last, {"reason", "delta", "at"}))
                if sub:
                    extra["last_adjustment"] = sub
            else:
                extra["last_adjustment"] = last
        dist = blobs.get("repcheck_coaching_distribution_v1")
        if dist is not None:
            row["weekly_distribution"] = dist
        for key, wcol, acol, label in (
                ("repcheck_coaching_goal_achieved_v1", "goal_achieved_weight_kg", "goal_achieved_aspiration", "goal_achieved"),
                ("repcheck_coaching_goal_achieved_handled_v1", "goal_handled_weight_kg", "goal_handled_aspiration", "goal_handled")):
            goal = blobs.get(key)
            if goal is None:
                continue
            if isinstance(goal, dict):
                sub = {}
                row[wcol] = take_float(goal, "goalWeightKg", sub)
                row[acol] = take_text(goal, "aspiration", sub)
                sub.update(leftovers(goal, {"goalWeightKg", "aspiration"}))
                if sub:
                    extra[label] = sub
            else:
                extra[label] = goal
        notified = blobs.get("repcheck_coaching_inactivity_notified_v1")
        if notified is not None:
            day = parse_day(notified) if isinstance(notified, str) else None
            row["inactivity_notified_on"] = day
            if day is None:
                extra["inactivity_notified"] = notified
        for key in blobs:
            if key not in ("repcheck_coaching_profile_v1", "repcheck_coaching_last_adjustment_v1",
                           "repcheck_coaching_distribution_v1", "repcheck_coaching_goal_achieved_v1",
                           "repcheck_coaching_goal_achieved_handled_v1", "repcheck_coaching_inactivity_notified_v1"):
                extra[key] = blobs[key]
        row["extra"] = extra
        self.ok("coaching_profiles", "coaching_profiles", self.row("coaching_profiles", **row))
        required = ("aspiration", "gender", "weight_kg", "body_fat_range_id", "activity_level", "protein_preference")
        if profile is not None and any(row[c] in (None, "") for c in required):
            self.notes["coaching_profile_missing_a_required_field"] += 1


# ---------------------------------------------------------------------------
# The whole database
# ---------------------------------------------------------------------------

def _all(conn, table):
    cur = conn.execute(f"select * from {table}")
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def _has_table(conn, table):
    return conn.execute("select 1 from sqlite_master where type='table' and name=?", (table,)).fetchone() is not None


class Plan:
    """Everything the import will write, computed from SQLite alone."""

    def __init__(self):
        self.users = []                     # (uid, legacy_id, email, metadata)
        self.rows = defaultdict(list)       # table -> [row dicts]
        self.identity_tables = set()        # tables loaded with explicit ids
        self.quarantine = []                # (source, legacy_user_id, payload, error)
        self.accounting = defaultdict(lambda: Counter())   # table -> items/made/rejected/collapsed/orphaned
        self.notes = Counter()
        self.orphan_owners = set()          # legacy ids named by rows whose account is gone
        self.expired_accounts = []          # legacy ids past their 30-day deletion window: not imported
        self.skipped_accounts = []          # legacy ids the operator left out on purpose (--skip-account)
        self.unimportable = []              # (legacy id, reason): accounts Auth or Postgres cannot take
        self.skipped_by_design = {}
        self.files = []                     # (bucket, user uuid, file name) the imported rows point at
        self.unusable_files = []            # (bucket, user uuid, file name, why): never copied

    def q(self, source, legacy_id, payload, error):
        if unsafe_reason(payload):
            # The payload itself holds a value Postgres cannot store: keep it as escaped text instead.
            payload = {"unsafe_payload_json": json.dumps(payload, ensure_ascii=True, default=str)}
        self.quarantine.append((source, legacy_id, payload, error))


class Orphan(str):
    """Why a row is an orphan (its owner or a parent row was not imported). A str subclass so a
    builder can return it where it would otherwise return a defect message, and the caller tells
    the two apart by TYPE, never by what the text happens to start with."""


OWNER_KEYS = ("user_id", "creator_id", "reporter_id", "reported_id", "friend_id", "blocked_id")

CORE_IDENTITY = ("challenges", "custom_foods", "custom_food_servings", "custom_exercises", "progress_photos",
                 "hyrox_results", "analyze_results", "content_reports", "ai_reports")


def build_plan(conn, now=None, skip=()):
    plan = Plan()
    now = now or dt.datetime.now(UTC)
    cutoff = now - dt.timedelta(days=ACCOUNT_DELETION_GRACE_DAYS)
    skip = set(skip)
    users = []
    for u in _all(conn, "users"):
        if u["id"] in skip:
            plan.skipped_accounts.append(u["id"])
            continue
        requested = parse_ts(u.get("deleted_at")) if u.get("deleted_at") else None
        if requested is not None and requested < cutoff:
            # Past its deletion window and merely not purged yet (the app purges lazily). Importing
            # it would bring back an account whose owner was promised deletion; its rows fall
            # through below as orphans.
            plan.expired_accounts.append(u["id"])
            continue
        problem = account_problem(u)
        if problem:
            plan.unimportable.append((u["id"], problem))
            continue
        users.append(u)
    uuids = {u["id"]: user_uuid(u["id"]) for u in users}
    cols_of = lambda t: {r[1] for r in conn.execute(f"pragma table_info({t})")}  # noqa: E731

    def acct(table, outcome, n=1):
        plan.accounting[table][outcome] += n

    for _left_out in plan.expired_accounts + plan.skipped_accounts + [i for i, _r in plan.unimportable]:
        acct("profiles", "items")
        acct("profiles", "orphaned")

    # accounts -------------------------------------------------------------
    for u in users:
        acct("profiles", "items")
        uid = uuids[u["id"]]
        meta = {"legacy_user_id": u["id"], "legacy_provider": u.get("auth_provider"),
                "legacy_provider_user_id": u.get("provider_user_id")}
        plan.users.append((uid, u["id"], u["email"], meta))
        created = parse_ts(u.get("created_at"))
        deleted = parse_ts(u.get("deleted_at")) if u.get("deleted_at") else None
        consent = parse_ts(u.get("ai_consent_at")) if u.get("ai_consent_at") else None
        plan.rows["profiles"].append({
            "id": uid, "legacy_user_id": u["id"], "name": u["name"], "avatar_url": u.get("avatar_url"),
            "friend_code": u.get("friend_code"), "onboarding_completed": bool(u.get("onboarding_completed")),
            "ai_consent_at": consent, "deleted_at": deleted, "created_at": created or dt.datetime.now(UTC)})
        if created is None:
            plan.notes["timestamp_unparseable_so_the_import_time_was_used"] += 1
        acct("profiles", "made")
        if u.get("password_hash"):
            plan.rows["legacy_password_hashes"].append({"user_id": uid, "password_hash": u["password_hash"]})
            acct("legacy_password_hashes", "items")
            acct("legacy_password_hashes", "made")

    def uid_of(legacy):
        return uuids.get(legacy)

    bad_ids = defaultdict(set)      # rows quarantined in a parent table: their children are quarantined too

    def simple(table, source_table, build, check=None):
        """Map every row of a plain table; quarantine rows that cannot be placed."""
        if not _has_table(conn, source_table):
            return
        def reject(r, why):
            plan.q(f"table:{source_table}", r.get("user_id") or r.get("creator_id") or r.get("reporter_id"), r, why)
            acct(table, "rejected")
            if table in ("custom_foods", "challenges"):
                bad_ids[table].add(r["id"])

        for r in _all(conn, source_table):
            acct(table, "items")
            built = build(r)
            if isinstance(built, Orphan):
                # The owner (or a parent row) is not in the source database. These are
                # leftovers of deleted accounts -- SQLite never enforced its foreign
                # keys -- so they are NOT imported, not even into quarantine: a deleted
                # account's data must not follow the migration.
                acct(table, "orphaned")
                plan.orphan_owners.update(
                    v for k, v in r.items() if k in OWNER_KEYS and isinstance(v, int) and v not in uuids)
                continue
            if isinstance(built, str):               # a genuine defect in a live user's row
                reject(r, built)
                continue
            reason = unsafe_reason(built)
            if reason:                               # valid in SQLite, fatal in Postgres
                reject(r, f"the row {reason}")
                continue
            plan.rows[table].append(built)
            acct(table, "made")

    def ts(r, key="created_at"):
        parsed = parse_ts(r.get(key))
        if parsed is None:
            plan.notes["timestamp_unparseable_so_the_import_time_was_used"] += 1
            return dt.datetime.now(UTC)
        return parsed

    def owned(r, key="user_id"):
        return uid_of(r.get(key))

    simple("rate_limits", "rate_limits", lambda r: (
        Orphan("its user is gone") if not owned(r) else
        {"user_id": owned(r), "feature": r["feature"], "window_start": r["window_start"], "count": r["count"]}))
    simple("usage_events", "usage_events", lambda r: (
        Orphan("its user is gone") if not owned(r) else
        {"user_id": owned(r), "event": r["event"], "count": r["count"], "last_at": ts(r, "last_at")}))
    simple("friends", "friends", lambda r: (
        Orphan("its user is gone") if not (owned(r) and owned(r, "friend_id")) else
        {"user_id": owned(r), "friend_id": owned(r, "friend_id"), "created_at": ts(r)}))
    simple("challenges", "challenges", lambda r: (
        Orphan("its creator is gone") if not owned(r, "creator_id") else
        {"id": r["id"], "creator_id": owned(r, "creator_id"), "exercise": r["exercise"],
         "duration_seconds": r["duration_seconds"], "created_at": ts(r)}))
    plan.identity_tables.add("challenges")
    challenge_ids = {r["id"] for r in plan.rows["challenges"]}
    simple("challenge_submissions", "challenge_submissions", lambda r: (
        Orphan("its user is gone") if not owned(r) else
        "its challenge was quarantined" if r["challenge_id"] in bad_ids["challenges"] else
        Orphan("its challenge was not imported") if r["challenge_id"] not in challenge_ids else
        {"challenge_id": r["challenge_id"], "user_id": owned(r), "reps": r["reps"], "notes": r.get("notes"),
         "created_at": ts(r)}))
    custom_food_cols = cols_of("custom_foods")

    def build_food(r):
        if not owned(r):
            return Orphan("its user is gone")
        # A stored blank or zero is a value the user's macros were entered against; say so when it is replaced.
        if "serving_label" in custom_food_cols and not r.get("serving_label"):
            plan.notes["custom_food_serving_label_was_blank_so_1_serving_was_used"] += 1
        if "serving_grams" in custom_food_cols and not r.get("serving_grams"):
            plan.notes["custom_food_serving_grams_was_zero_or_blank_so_100_was_used"] += 1
        return {"id": r["id"], "user_id": owned(r), "name": r["name"], "emoji": r["emoji"], "calories": r["calories"],
                "protein": r["protein"], "fat": r["fat"], "carbs": r["carbs"],
                "barcode": r.get("barcode") if "barcode" in custom_food_cols else None,
                "serving_label": r.get("serving_label") or "1 serving",
                "serving_grams": r.get("serving_grams") or 100, "created_at": ts(r)}

    simple("custom_foods", "custom_foods", build_food)
    food_ids = {r["id"] for r in plan.rows["custom_foods"]}
    simple("custom_food_servings", "custom_food_servings", lambda r: (
        "its food was quarantined" if r["custom_food_id"] in bad_ids["custom_foods"] else
        Orphan("its food was not imported") if r["custom_food_id"] not in food_ids else
        {"id": r["id"], "custom_food_id": r["custom_food_id"], "label": r["label"], "grams": r["grams"]}))
    custom_exercise_cols = cols_of("custom_exercises")
    simple("custom_exercises", "custom_exercises", lambda r: (
        Orphan("its user is gone") if not owned(r) else
        "mode is not both/each/either" if (r.get("mode") or "both") not in ("both", "each", "either") else
        {"id": r["id"], "user_id": owned(r), "name": r["name"],
         "emoji": r.get("emoji") if "emoji" in custom_exercise_cols else None,
         "mode": (r.get("mode") if "mode" in custom_exercise_cols else None) or "both", "created_at": ts(r)}))
    simple("progress_photos", "progress_photos", lambda r: (
        Orphan("its user is gone") if not owned(r) else
        "date is not a real calendar day" if parse_day(r["date"]) is None else
        {"id": r["id"], "user_id": owned(r), "date": r["date"], "angle": r["angle"], "filename": r["filename"],
         "created_at": ts(r)}))
    simple("hyrox_results", "hyrox_results", lambda r: (
        Orphan("its user is gone") if not owned(r) else
        {"id": r["id"], "user_id": owned(r), "gender": r["gender"], "category": r["category"],
         "format": r["format"], "total_seconds": r["total_seconds"], "created_at": ts(r)}))
    analyze_cols = cols_of("analyze_results")
    simple("analyze_results", "analyze_results", lambda r: (
        Orphan("its user is gone") if not owned(r) else
        {"id": r["id"], "user_id": owned(r), "exercise_label": r["exercise_label"],
         "overall_score": r.get("overall_score"), "stretch_score": r.get("stretch_score"),
         "squeeze_score": r.get("squeeze_score"), "favored": r.get("favored"), "reps": r.get("reps"),
         "feedback_text": r["feedback_text"],
         "video_filename": r.get("video_filename") if "video_filename" in analyze_cols else None,
         "created_at": ts(r)}))
    simple("blocked_users", "blocked_users", lambda r: (
        Orphan("its user is gone") if not (owned(r) and owned(r, "blocked_id")) else
        "a user cannot block themselves" if r["user_id"] == r["blocked_id"] else
        {"user_id": owned(r), "blocked_id": owned(r, "blocked_id"), "created_at": ts(r)}))
    simple("content_reports", "content_reports", lambda r: (
        Orphan("its user is gone") if not (owned(r, "reporter_id") and owned(r, "reported_id")) else
        {"id": r["id"], "reporter_id": owned(r, "reporter_id"), "reported_id": owned(r, "reported_id"),
         "reason": r["reason"], "created_at": ts(r),
         "handled_at": parse_ts(r["handled_at"]) if r.get("handled_at") else None}))
    simple("ai_reports", "ai_reports", lambda r: (
        Orphan("its user is gone") if not owned(r) else
        {"id": r["id"], "user_id": owned(r), "feature": r["feature"], "reason": r["reason"],
         "reply_text": r["reply_text"], "created_at": ts(r),
         "handled_at": parse_ts(r["handled_at"]) if r.get("handled_at") else None}))
    # No id: nothing refers to a waitlist row, and a source id could collide with a row captured since.
    simple("waitlist", "waitlist", lambda r: {
        "email": r["email"], "source": r.get("source"), "created_at": ts(r)})
    plan.identity_tables.update(CORE_IDENTITY)
    plan.files, plan.unusable_files = plan_files(plan.rows)
    for table, why in (("auth_throttle", "short-lived login/signup throttle keyed on opaque strings"),
                       ("native_auth_tokens", "120-second sign-in handoff tokens; Supabase Auth replaces them")):
        if _has_table(conn, table):
            plan.skipped_by_design[table] = (conn.execute(f"select count(*) from {table}").fetchone()[0], why)

    # blobs ---------------------------------------------------------------
    analysis_created = defaultdict(dict)
    for r in plan.rows["analyze_results"]:
        analysis_created[r["user_id"]][r["id"]] = r["created_at"]
    blobs_by_user = defaultdict(dict)
    if _has_table(conn, "user_data"):
        for r in _all(conn, "user_data"):
            uid = uid_of(r["user_id"])
            if uid is None:
                acct("user_data", "items")
                acct("user_data", "orphaned")
                plan.orphan_owners.add(r["user_id"])
                continue
            try:
                blobs_by_user[uid][r["key"]] = json.loads(r["value"])
            except (TypeError, ValueError):
                acct("user_data", "items")
                acct("user_data", "rejected")
                plan.q("table:user_data", r["user_id"], {"key": r["key"], "raw": r["value"]}, "value is not valid JSON")
    legacy_of = {uid: legacy for uid, legacy, _e, _m in plan.users}
    for uid, blobs in blobs_by_user.items():
        m = UserMapper(uid, analysis_created.get(uid, {}))
        m.map_all(blobs)
        unbalanced = m.balanced()
        if unbalanced:
            raise AssertionError(f"accounting does not balance for user {legacy_of[uid]}: {unbalanced}")
        for table, rows in m.rows.items():
            plan.rows[table].extend(rows)
        for source, payload, error in m.quarantine:
            plan.q(source, legacy_of[uid], payload, error)
        plan.notes.update(m.notes)
        for name in set(m.items) | set(m.made) | set(m.rejected) | set(m.collapsed):
            plan.accounting[name]["items"] += m.items[name]
            plan.accounting[name]["made"] += m.made[name]
            plan.accounting[name]["rejected"] += m.rejected[name]
            plan.accounting[name]["collapsed"] += m.collapsed[name]
    return plan


# ---------------------------------------------------------------------------
# Environment, Supabase I/O
# ---------------------------------------------------------------------------

def _unquote(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def load_env():
    wanted = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL")
    found = {k: os.environ[k] for k in wanted if os.environ.get(k)}
    env_file = REPO_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*(SUPABASE_[A-Z_]+)\s*=\s*(.*?)\s*$", line)
            if m and m.group(1) in wanted:
                found.setdefault(m.group(1), _unquote(m.group(2)))
    missing = [k for k in wanted if k not in found]
    if missing:
        sys.exit(f"missing {', '.join(missing)} (environment or .env)")
    if not found["SUPABASE_URL"].startswith("https://"):
        sys.exit("SUPABASE_URL must be an https:// address: the service-role key is sent to it")
    return found


class AuthError(RuntimeError):
    pass


class StoreError(RuntimeError):
    pass


class _Api:
    """A Supabase admin API. A 429 or 5xx, a dropped connection and a timeout are retried with a
    backoff: they are the service having a bad moment, not a refusal."""

    RETRY_STATUSES = (429, 500, 502, 503, 504)
    error = AuthError
    timeout = 30

    def __init__(self, env, sleep, path, headers):
        import requests
        self.requests = requests.Session()
        self.sleep = sleep
        self.base = env["SUPABASE_URL"].rstrip("/") + path
        self.headers = headers

    def _call(self, verb, url, body=None, headers=None, **kwargs):
        """`body`, when given, opens the file to send: it is reopened for every attempt."""
        last = None
        for attempt in range(4):
            try:
                if body is None:
                    response = getattr(self.requests, verb)(url, headers=headers or self.headers, timeout=self.timeout, **kwargs)
                else:
                    with body() as fh:
                        response = getattr(self.requests, verb)(url, headers=headers or self.headers, timeout=self.timeout,
                                                                data=fh, **kwargs)
            except OSError as exc:                  # requests' connection errors and timeouts are OSErrors
                last = exc
            else:
                if response.status_code not in self.RETRY_STATUSES:
                    return response
                last = response.status_code
            self.sleep(2 ** attempt)
        raise self.error(f"{verb} {url.rsplit('/', 1)[-1]} kept failing: {last}")


class Auth(_Api):
    """The Auth admin API."""

    def __init__(self, env, sleep=time.sleep):
        super().__init__(env, sleep, "/auth/v1/admin/users",
                         {"apikey": env["SUPABASE_SERVICE_ROLE_KEY"], "Content-Type": "application/json"})


    def exists(self, uid):
        status = self._call("get", f"{self.base}/{uid}").status_code
        if status == 200:
            return True
        if status == 404:
            return False
        raise AuthError(f"asking whether account {uid} exists answered {status}")

    def create(self, uid, email, meta):
        # Only an address a provider vouched for is marked confirmed. Local sign-up never verified
        # email, so those stay unconfirmed until the owner proves the address: otherwise whoever
        # registered someone else's address on the old site would own the account that Apple or
        # Google later links to by email. The legacy ids go in app_metadata, which the user cannot
        # edit (user_metadata they can); like all metadata it is copied into the user's own JWT.
        confirmed = meta.get("legacy_provider") in ("google", "apple")
        r = self._call("post", self.base, json={
            "id": uid, "email": email, "email_confirm": confirmed, "app_metadata": meta})
        return r.status_code, (r.json() if r.content else {})

    def update(self, uid, email, meta):
        """Refresh an account that already exists. Its password and confirmation are left alone."""
        r = self._call("put", f"{self.base}/{uid}", json={"email": email, "app_metadata": meta})
        return r.status_code, (r.json() if r.content else {})

    def delete(self, uid):
        return self._call("delete", f"{self.base}/{uid}").status_code


class Store(_Api):
    """The Storage API, as the service role (which bypasses the buckets' policies; their size and type
    rules still apply)."""

    error = StoreError
    timeout = 300

    def __init__(self, env, sleep=time.sleep):
        key = env["SUPABASE_SERVICE_ROLE_KEY"]
        super().__init__(env, sleep, "/storage/v1", {"apikey": key, "Authorization": "Bearer " + key})

    def upload(self, bucket, key, path, content_type):
        """("ok", None), or ("refused", why) when the bucket's own rules (size, type) turn the file away.
        Upserts, so a rerun replaces an object instead of failing on it."""
        r = self._call("post", f"{self.base}/object/{bucket}/{key}", body=lambda: open(path, "rb"),
                       headers=dict(self.headers, **{"Content-Type": content_type, "x-upsert": "true"}))
        if r.status_code == 200:
            return "ok", None
        try:
            detail = r.json()
        except ValueError:
            detail = {}
        if r.status_code == 400 and str(detail.get("statusCode")) in REFUSED_BY_BUCKET:
            return "refused", str(detail.get("message") or detail.get("error"))
        raise StoreError(f"uploading to {bucket} answered {r.status_code}")

    def remove(self, bucket, keys):
        return self._call("delete", f"{self.base}/object/{bucket}", json={"prefixes": list(keys)}).status_code


def adapt(column, value):
    from psycopg.types.json import Jsonb
    if column in JSON_COLUMNS and value is not None:
        return Jsonb(value)
    return value


def insert_rows(cur, table, rows, overriding=False):
    if not rows:
        return
    cols = list(rows[0].keys())
    if any(list(r.keys()) != cols for r in rows):
        raise ValueError(f"{table}: rows have different columns")
    sql = (f"insert into public.{table} ({', '.join(cols)}) "
           f"{'overriding system value ' if overriding else ''}values ({', '.join(['%s'] * len(cols))})")
    cur.executemany(sql, [[adapt(c, r[c]) for c in cols] for r in rows])


LOAD_ORDER = ["profiles", "legacy_password_hashes", "rate_limits", "usage_events", "friends", "challenges",
              "challenge_submissions", "custom_foods", "custom_food_servings", "custom_exercises",
              "progress_photos", "hyrox_results", "analyze_results", "blocked_users", "content_reports",
              "ai_reports", "waitlist", "user_settings", "nutrition_goals", "nutrition_favorites",
              "exercise_favorites", "coaching_profiles", "split_plans", "nutrition_entries", "workout_entries",
              "workout_sets", "weight_entries", "day_status_overrides", "activity_days", "analyze_log_entries",
              "hyrox_races", "hyrox_race_splits", "coach_messages", "workout_chat_messages",
              "analyze_chat_messages"]


def undo_auth(auth, uids):
    """Delete the Auth accounts a failed run created, so none is left without a profile. Best effort:
    one that will not go is reported, not allowed to stop the rest."""
    failed = []
    for uid in uids:
        try:
            if auth.delete(uid) not in (200, 404):
                failed.append(uid)
        except Exception:
            failed.append(uid)
    if failed:
        print(f"WARNING: could not remove these Auth accounts this run created: {failed}", file=sys.stderr)
    return failed


def create_auth_users(plan, auth):
    """Create the Auth account of every planned user. An account that already exists (ids are
    deterministic) keeps its password and confirmation: only its email and legacy metadata are
    refreshed. Returns (uids created, count that already existed). If anything fails, the accounts
    this call created are deleted again and the error is raised, so nothing is left half-done."""
    created, existing, problems = [], 0, []
    try:
        for uid, legacy_id, email, meta in plan.users:
            if auth.exists(uid):
                existing += 1
                status, body = auth.update(uid, email, meta)
            else:
                status, body = auth.create(uid, email, meta)
                if status == 200:
                    created.append(uid)
            if status != 200:
                problems.append((legacy_id, status, body.get("msg") or body.get("error_code") or body))
        if problems:
            raise RuntimeError("Auth refused these accounts (legacy id, status, reason); nothing was written:\n  "
                               + "\n  ".join(map(str, problems)))
    except BaseException:
        undo_auth(auth, created)
        raise
    return created, existing


def load_rows(plan, conn, reset=False):
    """Write every row inside the caller's transaction; the caller verifies, then commits.

    With `reset`, what a previous import left is deleted FIRST, in the same transaction: its profiles
    (which cascades through everything they own), the parked quarantine rows, and this file's
    waitlist emails. So a failed import leaves the project exactly as it was.

    Returns (how many previously imported accounts were replaced, the Auth ids of previously imported
    accounts that are NOT in this plan). Those Auth accounts are deleted after the commit."""
    removed, stale = 0, []
    with conn.cursor() as cur:
        if reset:
            cur.execute("select id from public.profiles where legacy_user_id is not null")
            before = [str(r[0]) for r in cur.fetchall()]
            planned = {uid for uid, _l, _e, _m in plan.users}
            removed, stale = len(before), [i for i in before if i not in planned]
            cur.execute("delete from public.import_quarantine")        # only the importer ever writes it
            # Only the signups this file carries: a row added to the waitlist since is not the importer's.
            cur.execute("delete from public.waitlist where email = any(%s)",
                        ([r["email"] for r in plan.rows.get("waitlist", [])],))
            cur.execute("delete from public.profiles where legacy_user_id is not null")
        for table in LOAD_ORDER:
            insert_rows(cur, table, plan.rows.get(table, []), overriding=table in plan.identity_tables)
        for table in sorted(plan.identity_tables):
            cur.execute(
                f"select setval(pg_get_serial_sequence('public.{table}', 'id'), "
                f"coalesce((select max(id) from public.{table}), 1), (select count(*) > 0 from public.{table}))")
        if plan.quarantine:
            from psycopg.types.json import Jsonb
            uid_of_legacy = {legacy: uid for uid, legacy, _e, _m in plan.users}
            cur.executemany(
                "insert into public.import_quarantine (source, legacy_user_id, user_id, payload, error) "
                "values (%s, %s, %s, %s, %s)",
                [[s, l, uid_of_legacy.get(l), Jsonb(p, dumps=lambda o: json.dumps(o, default=str)), e]
                 for s, l, p, e in plan.quarantine])
    return removed, stale


def delete_stale_auth(auth, uids):
    """Delete the Auth accounts of previously imported users who are no longer in the source."""
    return [uid for uid in uids if auth.delete(uid) not in (200, 404)]


# ---------------------------------------------------------------------------
# Files (progress photos, analysis clips) -> Storage
# ---------------------------------------------------------------------------

# Equal to supabase/migrations/20261025100000_storage_buckets.sql (a test pins it) and to the folders
# the old server kept them in (app.py: PROGRESS_PHOTOS_DIR, ANALYZE_VIDEOS_DIR).
BUCKETS = {
    "progress-photos": {
        "dir": "progress_photos", "limit": 12 * 1024 * 1024,
        "types": {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}},
    "analyze-videos": {
        "dir": "analyze_videos", "limit": 50 * 1024 * 1024,
        "types": {".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
                  ".avi": "video/x-msvideo", ".mkv": "video/x-matroska", ".webm": "video/webm"}},
}
# What the old server generated: a hex id plus an extension. Anything else is not a file name this script
# will join to a directory or put in an object key.
FILE_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}")
# Storage answers a refused upload with HTTP 400 and the real status inside the body.
REFUSED_BY_BUCKET = ("413", "415")
DELETE_BATCH = 100


def object_key(uid, name):
    return f"{uid}/{name}"


def plan_files(rows):
    """The files the imported rows point at: ([(bucket, user id, name)], [(bucket, user id, name, why)]).
    A file of an account that is not imported is never in here, because its rows are not."""
    planned, unusable, seen = [], [], set()
    for table, column, bucket in (("progress_photos", "filename", "progress-photos"),
                                  ("analyze_results", "video_filename", "analyze-videos")):
        for r in rows.get(table, []):
            name = r.get(column)
            if not name:
                continue
            ext = Path(name).suffix.lower()
            if not FILE_NAME_RE.fullmatch(name):
                why = "the name has characters outside A-Z a-z 0-9 . _ -"
            elif ext not in BUCKETS[bucket]["types"]:
                why = f"extension {ext or '(none)'} is not allowed in {bucket}"
            else:
                item = (bucket, r["user_id"], name)
                if item not in seen:
                    seen.add(item)
                    planned.append(item)
                continue
            unusable.append((bucket, r["user_id"], name, why))
    return planned, unusable


class FileScan:
    """What is actually on disk for the planned files."""

    def __init__(self):
        self.found = []       # (bucket, user id, name, path, size)
        self.missing = []     # (bucket, user id, name): the row stays, the old site served a 404 for it too
        self.refused = []     # (bucket, user id, name, why): present but not copied


def scan_files(planned, root):
    scan, root = FileScan(), Path(root)
    for bucket, uid, name in planned:
        path = root / BUCKETS[bucket]["dir"] / name
        try:
            if path.is_symlink():
                scan.refused.append((bucket, uid, name, "is a symbolic link"))
                continue
            if not path.is_file():
                scan.missing.append((bucket, uid, name))
                continue
            size = path.stat().st_size
        except OSError:
            scan.missing.append((bucket, uid, name))
            continue
        if size > BUCKETS[bucket]["limit"]:
            scan.refused.append((bucket, uid, name, f"is {size} bytes, over the {BUCKETS[bucket]['limit']} byte limit of {bucket}"))
        else:
            scan.found.append((bucket, uid, name, path, size))
    return scan


class FileCopy:
    """What copy_files did, kept as it goes so a crash half way can still be undone."""

    def __init__(self):
        self.expected = {}    # (bucket, key) -> (md5 hex, size) of every object that went up
        self.created = []     # (bucket, key) this run added (did not exist before)
        self.refused = []     # (bucket, user id, name, why) Storage's bucket rules turned away
        self.size_only = 0    # objects whose ETag was not an md5 (multipart), checked by size alone


def file_md5(path):
    digest = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def existing_objects(conn, planned):
    """Which of the planned objects Storage already holds (so a failed run removes only what it added)."""
    found = set()
    with conn.cursor() as cur:
        for bucket in BUCKETS:
            names = [object_key(uid, name) for b, uid, name in planned if b == bucket]
            if names:
                cur.execute("select name from storage.objects where bucket_id = %s and name = any(%s)", (bucket, names))
                found |= {(bucket, row[0]) for row in cur.fetchall()}
    return found


def copy_files(scan, store, had, result, say=print):
    total = len(scan.found)
    for i, (bucket, uid, name, path, size) in enumerate(scan.found, 1):
        key = object_key(uid, name)
        digest = file_md5(path)
        if (bucket, key) not in had:
            result.created.append((bucket, key))      # before the upload: a crash mid-upload is then undone too
        status, detail = store.upload(bucket, key, path, BUCKETS[bucket]["types"][Path(name).suffix.lower()])
        if status == "refused":
            result.refused.append((bucket, uid, name, detail))
        else:
            result.expected[(bucket, key)] = (digest, size)
        if i % 100 == 0:
            say(f"  copied {i} of {total} files")
    return result


def verify_files(result, conn):
    """Read Storage's own record of every uploaded object and compare it with the file that was sent: for
    a single-part upload the ETag IS the md5, so no object is downloaded again."""
    problems = []
    with conn.cursor() as cur:
        for bucket in BUCKETS:
            wanted = {key: v for (b, key), v in result.expected.items() if b == bucket}
            if not wanted:
                continue
            cur.execute("select name, metadata->>'eTag', (metadata->>'size')::bigint from storage.objects "
                        "where bucket_id = %s and name = any(%s)", (bucket, sorted(wanted)))
            stored = {name: (etag, size) for name, etag, size in cur.fetchall()}
            for key, (digest, size) in sorted(wanted.items()):
                if key not in stored:
                    problems.append(f"{bucket}: an uploaded object is missing from Storage")
                    continue
                etag, stored_size = stored[key]
                if stored_size != size:
                    problems.append(f"{bucket}: an object is {stored_size} bytes in Storage, {size} on disk")
                elif etag and "-" in etag:
                    result.size_only += 1
                elif (etag or "").strip('"') != digest:
                    problems.append(f"{bucket}: an object's content differs from the file on disk")
    return problems


def storage_extras(conn, wanted, uids):
    """Objects in these users' folders that the plan does not call for (left by an earlier failed run, or
    belonging to an account that is gone): after the commit, Storage must hold exactly the plan."""
    with conn.cursor() as cur:
        cur.execute("select bucket_id, name from storage.objects where bucket_id = any(%s) "
                    "and split_part(name, '/', 1) = any(%s)", (list(BUCKETS), list(uids)))
        return sorted((b, n) for b, n in cur.fetchall() if (b, n) not in wanted)


def delete_objects(store, items):
    """Delete (bucket, key) pairs through the Storage API (SQL cannot: the bytes would be orphaned).
    Returns those that would not go."""
    failed = []
    for bucket in BUCKETS:
        keys = [k for b, k in items if b == bucket]
        for i in range(0, len(keys), DELETE_BATCH):
            batch = keys[i:i + DELETE_BATCH]
            try:
                if store.remove(bucket, batch) != 200:
                    failed += [(bucket, k) for k in batch]
            except Exception:
                failed += [(bucket, k) for k in batch]
    return failed


def undo_files(store, created):
    """Remove the objects a failed run added. Best effort, like undo_auth."""
    failed = delete_objects(store, created) if created else []
    if failed:
        print(f"WARNING: could not remove {len(failed)} stored files this run added; the next run removes them", file=sys.stderr)
    return failed


def print_files(plan):
    print(f"\nfiles referenced by imported rows: {len(plan.files)}"
          + (f" (+{len(plan.unusable_files)} the importer will not copy)" if plan.unusable_files else ""))
    for bucket, _uid, name, why in plan.unusable_files[:10]:
        print(f"  not copied: a {bucket} name: {why}")


def print_scan(scan, root):
    mib = sum(s for *_x, s in scan.found) / (1024 * 1024)
    print(f"  in {root}: found {len(scan.found)} ({mib:.1f} MiB), missing {len(scan.missing)}, not copyable {len(scan.refused)}")
    for bucket, _uid, name in scan.missing[:10]:
        print(f"  missing from disk: {bucket}/{name}")
    for bucket, _uid, name, why in scan.refused[:10]:
        print(f"  not copied: {bucket}/{name} {why}")
    if len(scan.missing) > 10:
        print(f"  ... and {len(scan.missing) - 10} more missing")


def check_files(plan, args):
    """What happens to the files the imported rows point at. Returns (scan or None, exit code or None).
    Never silent: rows that point at files need an explicit answer, or a launch would quietly leave every
    photo behind."""
    print_files(plan)
    if not plan.files:
        return None, None
    if args.skip_files:
        print("\n--skip-files: the rows will point at files that are NOT in Storage until they are copied.")
        return None, None
    if not args.files_dir:
        print("\nThe imported rows point at files, and the SQLite export does not contain them. Give a folder holding a copy "
              "of the old server's progress_photos/ and analyze_videos/ with --files-dir, or import the rows alone with "
              "--skip-files. Nothing was written.")
        return None, 2
    root = Path(args.files_dir)
    scan = scan_files(plan.files, root)
    print_scan(scan, root)
    if not scan.found:
        print("\nNone of the referenced files were found there: this is almost certainly the wrong folder (it needs "
              "progress_photos/ and analyze_videos/ inside it). Nothing was written.")
        return None, 2
    return scan, None


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

def check_accounting(plan):
    problems = []
    for table, c in sorted(plan.accounting.items()):
        if c["items"] != c["made"] + c["rejected"] + c["collapsed"] + c["orphaned"]:
            problems.append(f"{table}: {c['items']} source items != {c['made']} imported + {c['rejected']} quarantined + "
                            f"{c['collapsed']} duplicates + {c['orphaned']} orphaned")
    return problems


# The columns that identify a row, per table: how a planned row is matched to the row in the database.
KEY_COLUMNS = {
    "profiles": ("id",), "legacy_password_hashes": ("user_id",), "rate_limits": ("user_id", "feature"),
    "usage_events": ("user_id", "event"), "friends": ("user_id", "friend_id"), "challenges": ("id",),
    "challenge_submissions": ("challenge_id", "user_id"), "custom_foods": ("id",), "custom_food_servings": ("id",),
    "custom_exercises": ("id",), "progress_photos": ("id",), "hyrox_results": ("id",), "analyze_results": ("id",),
    "blocked_users": ("user_id", "blocked_id"), "content_reports": ("id",), "ai_reports": ("id",),
    "waitlist": ("email",), "user_settings": ("user_id",), "nutrition_goals": ("user_id",),
    "nutrition_favorites": ("user_id", "food_name"), "exercise_favorites": ("user_id", "exercise_name"),
    "coaching_profiles": ("user_id",), "split_plans": ("user_id",), "nutrition_entries": ("user_id", "id"),
    "workout_entries": ("user_id", "id"), "workout_sets": ("user_id", "entry_id", "position"),
    "weight_entries": ("user_id", "log_date"), "day_status_overrides": ("user_id", "log_date"),
    "activity_days": ("user_id", "log_date", "action"), "analyze_log_entries": ("user_id", "exercise", "analyzed_at"),
    "hyrox_races": ("user_id", "id"), "hyrox_race_splits": ("user_id", "race_id", "position"),
    "coach_messages": ("user_id", "client_id"), "workout_chat_messages": ("user_id", "client_id"),
    "analyze_chat_messages": ("user_id", "client_id"),
}

# The column that ties a row to an imported account, per table. Scoping by it (rather than reading the
# whole table) keeps verification honest once real signups exist next to imported data. The waitlist
# has no owner, so it is matched by email; custom_food_servings goes via its food.
OWNER_COLUMN = {"profiles": "id", "challenges": "creator_id", "content_reports": "reporter_id"}


def _norm(value):
    """A value in a form that compares equal whether it came from the plan or from the database."""
    if isinstance(value, dt.datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        return {k: _norm(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_norm(v) for v in value]
    return value


def _fetch(table, uids, emails):
    if table == "waitlist":
        return "select * from public.waitlist where email = any(%s)", (emails,)
    if table == "custom_food_servings":
        return ("select s.* from public.custom_food_servings s join public.custom_foods f "
                "on f.id = s.custom_food_id where f.user_id = any(%s)"), (uids,)
    return f"select * from public.{table} where {OWNER_COLUMN.get(table, 'user_id')} = any(%s)", (uids,)


def _compare(table, planned, found):
    """Problems between the rows the plan intended to write and the rows the database holds. Never
    prints a value (they are people's health data and email addresses), only which column differs."""
    keys = KEY_COLUMNS[table]

    def key(row):
        return tuple(_norm(row[c]) for c in keys)

    problems = []
    if len(planned) != len(found):
        problems.append(f"{table}: planned {len(planned)}, database has {len(found)}")
    want = {}
    for row in planned:
        want.setdefault(key(row), row)
    have = {key(row): row for row in found}
    missing = sum(1 for k in want if k not in have)
    if missing:
        problems.append(f"{table}: {missing} planned row(s) missing from the database")
    unexpected = sum(1 for k in have if k not in want)
    if unexpected:
        problems.append(f"{table}: {unexpected} unexpected row(s) in the database")
    differing = Counter()
    for k, row in want.items():
        stored = have.get(k)
        if stored is None:
            continue
        for column, value in row.items():
            if _norm(value) != _norm(stored[column]):
                differing[column] += 1
    for column, n in sorted(differing.items()):
        problems.append(f"{table}: column '{column}' differs in {n} row(s)")
    return problems


def verify_database(plan, conn):
    """Read back every table the import wrote and compare it, row by row, with the PLAN. The plan is
    already proved against the source by the accounting; this proves the database holds exactly the
    plan: no precision, ordering, timezone or type lost on the way in, nothing missing, nothing extra."""
    from psycopg.rows import dict_row
    uids = [uid for uid, _l, _e, _m in plan.users]
    emails = [r["email"] for r in plan.rows.get("waitlist", [])]
    problems = []
    with conn.cursor(row_factory=dict_row) as cur:
        # Postgres stores a double exactly but PRINTS it with 15 significant digits on a session whose
        # extra_float_digits is 0, which is what Supabase's pooler hands out. Read at full precision, or
        # every float with 16 or 17 digits looks like a difference. (set local: gone at commit/rollback.)
        cur.execute("set local extra_float_digits = 3")
        for table in LOAD_ORDER:
            sql, params = _fetch(table, uids, emails)
            cur.execute(sql, params)
            problems += _compare(table, plan.rows.get(table, []), cur.fetchall())
        cur.execute("select count(*) as n from public.import_quarantine")
        if cur.fetchone()["n"] != len(plan.quarantine):
            problems.append("import_quarantine: row count differs from the plan")
    return problems


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def print_report(plan, header):
    print(f"\n=== {header} ===")
    print(f"accounts: {len(plan.users)}")
    print(f"{'table':28} {'source':>8} {'imported':>9} {'quarantined':>12} {'duplicates':>11} {'orphaned':>9}")
    for table, c in sorted(plan.accounting.items()):
        print(f"{table:28} {c['items']:>8} {c['made']:>9} {c['rejected']:>12} {c['collapsed']:>11} {c['orphaned']:>9}")
    if plan.expired_accounts:
        print(f"\n{len(plan.expired_accounts)} accounts asked to be deleted more than {ACCOUNT_DELETION_GRACE_DAYS} "
              "days ago and were NOT imported: their deletion window had passed.")
    if plan.skipped_accounts:
        print(f"\n{len(plan.skipped_accounts)} accounts were left out on purpose (--skip-account): "
              f"{sorted(plan.skipped_accounts)}. Their data stays in the SQLite file only.")
    orphaned = sum(c["orphaned"] for c in plan.accounting.values())
    if orphaned:
        excluded = set(plan.expired_accounts) | set(plan.skipped_accounts) | {i for i, _r in plan.unimportable}
        gone = len(plan.orphan_owners - excluded)
        rest = " The rest belong to the accounts listed above." if excluded else ""
        print(f"\n{orphaned} rows were not imported because their owner is not part of this import: {gone} accounts "
              f"no longer exist in the source database.{rest} A deleted account's data does not follow the migration.")
    for table, (n, why) in plan.skipped_by_design.items():
        print(f"{table:28} {n:>8}   skipped on purpose: {why}")
    if plan.notes:
        print("\nnotes (data was kept, but note how):")
        for k, v in sorted(plan.notes.items()):
            print(f"  {v:>5}  {k}")
    if plan.quarantine:
        print(f"\nquarantined rows: {len(plan.quarantine)} (first 15)")
        for source, legacy, _payload, error in plan.quarantine[:15]:
            print(f"  user {legacy}: {source} -- {error}")
    if plan.unimportable:
        print("\nACCOUNTS THAT CANNOT BE IMPORTED (legacy id: reason):")
        for legacy, reason in plan.unimportable:
            print(f"  {legacy}: {reason}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sqlite_path")
    ap.add_argument("--dry-run", action="store_true", help="map, check and account only; touch nothing")
    ap.add_argument("--reset", action="store_true", help="replace what a previous import created")
    ap.add_argument("--skip-account", type=int, action="append", default=[], metavar="LEGACY_ID",
                    help="leave this account out on purpose (repeatable); for an account that cannot be imported")
    ap.add_argument("--force-reset-signed-in-accounts", metavar="PROJECT_REF",
                    help="allow --reset even though imported accounts have signed in (after launch these are the "
                         "real users: this DELETES their data). Give the project ref shown as 'target project'.")
    ap.add_argument("--files-dir", metavar="DIR",
                    help="a copy of the old server's data folder: it must contain progress_photos/ and analyze_videos/")
    ap.add_argument("--skip-files", action="store_true",
                    help="import the rows only; they will point at files that are not in Storage until copied")
    args = ap.parse_args(argv)

    path = Path(args.sqlite_path).resolve()
    if not path.exists():
        sys.exit(f"{path} not found")
    src = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    plan = build_plan(src, skip=args.skip_account)
    src.close()
    print_report(plan, "plan from " + path.name)
    problems = check_accounting(plan)
    if problems:
        print("\nACCOUNTING DOES NOT BALANCE:\n  " + "\n  ".join(problems))
        return 2
    if plan.unimportable:
        print("\nNothing was written. Fix those accounts in the source, or leave them out on purpose with "
              "--skip-account <legacy id>.")
        return 2
    scan, refusal = check_files(plan, args)
    if refusal is not None:
        return refusal
    if args.dry_run:
        print("\ndry run: the plan checks out and the accounting balances; nothing was written")
        return 0

    import psycopg
    env = load_env()
    host = urlparse(env["SUPABASE_URL"]).hostname
    ref = host.split(".")[0]
    print(f"target project: {host}")
    auth = Auth(env)

    def connect():
        return psycopg.connect(env["SUPABASE_DB_URL"], sslmode="require", prepare_threshold=None)

    # Read-only questions first, on a connection that is then closed: the Auth step below can take a
    # long time and a database connection left idle through it may be dropped by the pooler.
    had = set()
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.profiles where legacy_user_id is not null")
            previous = cur.fetchone()[0]
        conn.commit()
        signed_in = 0
        if args.reset:
            with conn.cursor() as cur:
                cur.execute("select count(*) from public.profiles p join auth.users u on u.id = p.id "
                            "where p.legacy_user_id is not null and u.last_sign_in_at is not null")
                signed_in = cur.fetchone()[0]
            conn.commit()
        if scan is not None:
            had = existing_objects(conn, plan.files)
            conn.commit()
    finally:
        conn.close()
    if previous and not args.reset:
        sys.exit(f"{previous} previously imported accounts exist. Run with --reset to replace them.")
    if signed_in and args.force_reset_signed_in_accounts != ref:
        sys.exit(f"REFUSING to reset: {signed_in} imported accounts have signed in, so they are real users and "
                 "--reset would delete their data. If this really is a throwaway project, pass "
                 f"--force-reset-signed-in-accounts followed by the project ref (shown above as 'target project'); "
                 + ("the one you gave does not match." if args.force_reset_signed_in_accounts else "none was given."))

    created, existing = create_auth_users(plan, auth)        # deletes what it created if it fails
    print(f"\nauth accounts created: {len(created)} (already present and refreshed: {existing})")
    copy, store, extras = FileCopy(), None, []
    wanted = {(bucket, object_key(uid, name)) for bucket, uid, name in plan.files}
    conn = None
    try:
        if scan is not None:
            store = Store(env)
            copy_files(scan, store, had, copy)
            print(f"files copied: {len(copy.expected)} (turned away by the bucket's own rules: {len(copy.refused)})")
            for bucket, _uid, name, why in copy.refused[:10]:
                print(f"  refused: {bucket}/{name}: {why}")
        conn = connect()
        removed, stale = load_rows(plan, conn, reset=args.reset)
        problems = verify_database(plan, conn)
        if copy.expected:
            problems += verify_files(copy, conn)
        if not problems:
            extras = storage_extras(conn, wanted, [uid for uid, _l, _e, _m in plan.users] + list(stale))
        if problems:
            conn.rollback()
            undo_auth(auth, created)
            undo_files(store, copy.created)
            print("\nVERIFICATION FAILED. Nothing was committed (the project is as it was), and the Auth accounts "
                  "and stored files this run created were removed:\n  " + "\n  ".join(problems[:40]))
            return 4
        conn.commit()
    except BaseException:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        undo_auth(auth, created)
        if copy.created:
            undo_files(store or Store(env), copy.created)
        raise
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    print("verified before commit: every table holds exactly the planned rows"
          + (f" and {len(copy.expected)} stored files match the files on disk" if copy.expected else "")
          + ". Committed." + (f" Replaced {removed} previously imported accounts." if args.reset else ""))
    status = 0
    if stale:
        failed = delete_stale_auth(auth, stale)
        print(f"removed {len(stale) - len(failed)} Auth accounts that are no longer in the source")
        if failed:
            print(f"WARNING: these Auth accounts could not be deleted and need removing by hand: {failed}")
            status = 3
    if extras:
        failed = delete_objects(store or Store(env), extras)
        print(f"removed {len(extras) - len(failed)} stored files that are not part of this import")
        if failed:
            print(f"WARNING: {len(failed)} stored files could not be removed; the next run removes them")
            status = 3
    return status


if __name__ == "__main__":
    sys.exit(main())
