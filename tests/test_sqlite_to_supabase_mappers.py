"""Unit tests for scripts/migrate_sqlite_to_supabase.py's mappers.

No network and no database: every case feeds a user's blobs (shaped like the
real ones -- see the "Synced data" notes in MOBILE_APP_PLAN.md) through
UserMapper and checks the rows that come out, and that every source item is
accounted for as imported, quarantined or a collapsed duplicate. The import is
irreversible in practice once users have signed in on the new backend, so the
properties that keep it lossless are pinned here.

Mutation-check (CLAUDE.md): e.g. make the mapper drop `leftovers()` into
`extra`, or stop generating ids, and confirm the matching test goes red.
"""

import pytest

from importer_loader import imp

UID = "8ee0ee19-2365-565c-84bd-3bffbfacfc61"
MS = 1761300000000  # 2025-10-24 ~10:00 UTC


def run(blobs, analyses=None):
    m = imp.UserMapper(UID, analyses or {})
    m.map_all(blobs)
    assert m.balanced() == {}, f"accounting does not balance: {m.balanced()}"
    return m


# -- identity -----------------------------------------------------------------

def test_user_ids_are_stable_forever():
    """Same legacy id -> same uuid, in a rehearsal and on launch day. If this
    fails someone changed NAMESPACE, which re-ids every imported account."""
    assert imp.user_uuid(1) == "8ee0ee19-2365-565c-84bd-3bffbfacfc61"
    assert imp.user_uuid(183) == "adf19438-cb74-58bb-9c94-c664704f9aaf"


def test_generated_entry_ids_are_deterministic():
    assert imp.generated_id("2026-08-05", {"name": "x"}) == "legacy-c7e2d38e950b4147d8d8"
    assert imp.generated_id("2026-08-05", {"name": "x"}) != imp.generated_id("2026-08-06", {"name": "x"})


def test_every_synced_key_the_app_accepts_is_mapped():
    """A key the app accepts but the mapper does not know would be quarantined on
    launch day instead of imported."""
    os_env = __import__("os").environ
    os_env.setdefault("FLASK_SECRET_KEY", "test-only-key-not-a-real-secret")
    import app as flask_app

    unknown = set()
    for key in flask_app.SYNCED_DATA_KEYS:
        m = imp.UserMapper(UID, {})
        m.map_all({key: {}})
        if m.items["unknown_keys"]:
            unknown.add(key)
    assert not unknown, f"keys the importer does not map: {sorted(unknown)}"
    m = imp.UserMapper(UID, {})
    m.map_all({"repcheck_analyze_chat_v1_7": {"history": []}})
    assert m.items["unknown_keys"] == 0


# -- food log -----------------------------------------------------------------

def test_a_simple_and_a_composite_food_entry():
    m = run({"repcheck_nutrition_log_v1": {"2026-10-24": [
        {"id": "a", "food": "Oats", "addedAt": MS, "grams": 80, "unit": "g", "source": "scan",
         "baseCalories": 370, "baseCarbs": 60, "baseFat": 7, "baseProtein": 13},
        {"id": "b", "food": "Bowl", "addedAt": MS + 1000,
         "ingredients": [{"name": "Oats", "grams": 80, "unit": "g", "baseCalories": 370}]},
    ]}})
    simple, composite = m.rows["nutrition_entries"]
    assert (simple["food"], simple["grams"], simple["base_protein"], simple["source"]) == ("Oats", 80.0, 13.0, "scan")
    assert simple["ingredients"] is None and simple["extra"] == {}
    assert composite["grams"] is None and composite["ingredients"][0]["name"] == "Oats"
    assert simple["log_date"] == "2026-10-24" and simple["added_at"].year == 2025


def test_a_quick_macros_entry_keeps_its_own_added_at_not_the_day_it_is_filed_under():
    """'Log macros' stamps Date.now() even when a past day is selected, so the
    two are independent and must not be derived from each other."""
    m = run({"repcheck_nutrition_log_v1": {"2020-01-01": [{"id": "q", "food": "Snack", "addedAt": MS}]}})
    row = m.rows["nutrition_entries"][0]
    assert row["log_date"] == "2020-01-01" and row["added_at"].year == 2025


def test_legacy_fields_are_kept_in_extra_never_dropped():
    """Older rows carry calories/name/hour that current code no longer writes."""
    m = run({"repcheck_nutrition_log_v1": {"2026-08-05": [
        {"id": "o", "name": "Chicken breast", "grams": 200, "baseProtein": 31, "calories": 330, "protein": 62, "hour": 12}]}})
    row = m.rows["nutrition_entries"][0]
    assert row["food"] == "Chicken breast"
    assert row["extra"]["calories"] == 330 and row["extra"]["protein"] == 62 and row["extra"]["hour"] == 12
    assert "name" not in row["extra"]  # consumed: it became `food`
    assert any("legacy_hour" in note or "legacy hour" in note for note in m.notes)


def test_an_entry_with_no_id_gets_a_stable_one_and_identical_copies_stay_separate_entries():
    """Logging the same food twice is two entries. Merging them would undercount the day's calories."""
    entry = {"name": "Rice", "grams": 100, "hour": 8}
    m = run({"repcheck_nutrition_log_v1": {"2026-08-05": [dict(entry), dict(entry)]}})
    ids = [r["id"] for r in m.rows["nutrition_entries"]]
    assert len(ids) == 2 and len(set(ids)) == 2 and all(i.startswith("legacy-") for i in ids)
    assert m.collapsed["nutrition_entries"] == 0
    assert m.notes["identical_id-less_entries_were_kept_as_separate_rows"] == 1
    again = run({"repcheck_nutrition_log_v1": {"2026-08-05": [dict(entry)]}})
    assert again.rows["nutrition_entries"][0]["id"] == ids[0], "the first copy's id does not depend on how many follow"


def test_the_same_id_with_different_content_is_quarantined_not_merged():
    m = run({"repcheck_nutrition_log_v1": {"2026-08-05": [
        {"id": "x", "food": "A", "addedAt": MS}, {"id": "x", "food": "B", "addedAt": MS}]}})
    assert len(m.rows["nutrition_entries"]) == 1 and len(m.quarantine) == 1
    assert "reused" in m.quarantine[0][2]


@pytest.mark.parametrize("bad_day", ["2026-02-31", "9999-99-99", "yesterday", ""])
def test_an_impossible_date_key_is_quarantined_with_the_entry_intact(bad_day):
    entry = {"id": "a", "food": "A", "addedAt": MS}
    m = run({"repcheck_nutrition_log_v1": {bad_day: [entry]}})
    assert m.rows["nutrition_entries"] == []
    assert m.quarantine[0][1]["entry"] == entry


def test_a_missing_added_at_defaults_to_midnight_and_says_so():
    m = run({"repcheck_nutrition_log_v1": {"2026-08-05": [{"id": "a", "food": "A"}]}})
    assert m.rows["nutrition_entries"][0]["added_at"].hour == 0
    assert m.notes["nutrition_added_at_defaulted_to_midnight"] == 1


def test_a_non_numeric_amount_is_kept_in_extra_not_lost():
    m = run({"repcheck_nutrition_log_v1": {"2026-08-05": [{"id": "a", "food": "A", "addedAt": MS, "grams": "lots"}]}})
    row = m.rows["nutrition_entries"][0]
    assert row["grams"] is None and row["extra"]["grams"] == "lots"


def test_an_empty_day_leaves_no_rows():
    m = run({"repcheck_nutrition_log_v1": {"2026-08-05": []}})
    assert m.rows["nutrition_entries"] == []


# -- workouts -----------------------------------------------------------------

def test_sets_become_ordered_rows_and_blank_fields_become_null():
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [{
        "id": "w", "exercise": "Squat", "addedAt": MS, "unilateral": True,
        "sets": [{"reps": 5, "weightKg": 100}, {"reps": "", "weightKg": ""}, {"leftKg": 20, "rightKg": 22, "leftReps": 8, "rightReps": 7}],
    }]}})
    entry = m.rows["workout_entries"][0]
    assert entry["unilateral"] is True
    sets = m.rows["workout_sets"]
    assert [s["position"] for s in sets] == [0, 1, 2]
    assert (sets[0]["reps"], sets[0]["weight_kg"]) == (5, 100.0)
    assert (sets[1]["reps"], sets[1]["weight_kg"]) == (None, None)
    # "" is the app's normal "not filled in" marker: it is NULL, not a leftover to keep
    assert sets[1]["extra"] == {} and sets[0]["extra"] == {}
    assert (sets[2]["left_kg"], sets[2]["right_kg"], sets[2]["left_reps"], sets[2]["right_reps"]) == (20.0, 22.0, 8, 7)


def test_numeric_strings_parse_and_odd_values_are_kept():
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [{
        "id": "w", "exercise": "Row", "addedAt": MS, "sets": [{"reps": "8", "weightKg": "52.5"}, {"reps": 8.5, "note": "tempo"}]}]}})
    first, second = m.rows["workout_sets"]
    assert (first["reps"], first["weight_kg"]) == (8, 52.5)
    assert second["reps"] is None and second["extra"] == {"reps": 8.5, "note": "tempo"}


def test_a_workout_with_no_exercise_name_is_quarantined():
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [{"id": "w", "addedAt": MS, "sets": []}]}})
    assert m.rows["workout_entries"] == [] and len(m.quarantine) == 1


def test_a_workout_entry_with_no_id_is_kept():
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [{"exercise": "Curl", "addedAt": MS, "sets": [{"reps": 10}]}]}})
    assert m.rows["workout_entries"][0]["id"].startswith("legacy-") and len(m.rows["workout_sets"]) == 1


# -- weight, day status, activity ---------------------------------------------

@pytest.mark.parametrize("kg", [0, -3, 400.5, 9000, "80", None, True])
def test_weights_outside_the_old_endpoints_range_are_quarantined(kg):
    m = run({"repcheck_weight_log_v1": {"2026-10-24": {"kg": kg, "loggedAt": MS}}})
    assert m.rows["weight_entries"] == [] and len(m.quarantine) == 1


def test_a_valid_weight_and_the_bare_number_shape():
    m = run({"repcheck_weight_log_v1": {"2026-10-24": {"kg": 80.4, "loggedAt": MS}, "2026-10-25": 79.9}})
    by_day = {r["log_date"]: r for r in m.rows["weight_entries"]}
    assert by_day["2026-10-24"]["kg"] == 80.4 and by_day["2026-10-25"]["kg"] == 79.9
    assert m.notes["weight_entry_was_a_bare_number"] == 1


def test_only_the_two_day_status_overrides_are_accepted():
    m = run({"repcheck_day_status_v1": {"2026-10-24": "fasting", "2026-10-25": "incomplete", "2026-10-26": "logged"}})
    assert sorted(r["status"] for r in m.rows["day_status_overrides"]) == ["fasting", "incomplete"]
    assert len(m.quarantine) == 1


def test_activity_days_collapse_repeats():
    m = run({"repcheck_activity_log_v1": {"2026-10-24": ["challenge", "challenge", "coach_chat"]}})
    assert sorted(r["action"] for r in m.rows["activity_days"]) == ["challenge", "coach_chat"]
    assert m.collapsed["activity_days"] == 1


def test_the_analyze_log_keeps_extra_keys_and_collapses_repeats():
    m = run({"repcheck_analyze_log_v1": [
        {"exercise": "Squat", "analyzedAt": MS}, {"exercise": "Squat", "analyzedAt": MS},
        {"exercise": "Row", "analyzedAt": MS, "score": 7}]})
    assert len(m.rows["analyze_log_entries"]) == 2 and m.collapsed["analyze_log_entries"] == 1
    assert {r["exercise"]: r["extra"] for r in m.rows["analyze_log_entries"]}["Row"] == {"score": 7}


# -- HYROX ---------------------------------------------------------------------

def _race(**over):
    race = {"id": "r1", "date": "2026-10-24T03:15:00.123Z", "category": "open", "format": "singles", "gender": "men",
            "scale": "full", "totalSeconds": 3600.5, "flagged": False, "isNewPb": True, "analysis": None,
            "splits": [{"key": "run1", "title": "1km Run", "atSeconds": 240.0}, {"key": "skierg", "title": "SkiErg", "atSeconds": 470.2}]}
    race.update(over)
    return race


def test_a_race_keeps_its_timestamp_and_its_splits_in_order():
    m = run({"repcheck_hyrox_history_v1": [_race()]})
    race = m.rows["hyrox_races"][0]
    assert race["raced_at"].isoformat() == "2026-10-24T03:15:00.123000+00:00"
    assert (race["total_seconds"], race["is_new_pb"], race["scale"]) == (3600.5, True, "full")
    assert [(s["position"], s["key"], s["at_seconds"]) for s in m.rows["hyrox_race_splits"]] == [(0, "run1", 240.0), (1, "skierg", 470.2)]


def test_an_older_race_without_scale_means_full_and_a_custom_race_has_null_format():
    older = _race(id="r2")
    del older["scale"]
    m = run({"repcheck_hyrox_history_v1": [older, _race(id="r3", category="custom", format=None, splits=[])]})
    by_id = {r["id"]: r for r in m.rows["hyrox_races"]}
    assert by_id["r2"]["scale"] == "full"
    assert by_id["r3"]["format"] is None and by_id["r3"]["category"] == "custom"


def test_a_double_appended_race_collapses_and_a_changed_one_is_quarantined():
    m = run({"repcheck_hyrox_history_v1": [_race(), _race(), _race(totalSeconds=1.0)]})
    assert len(m.rows["hyrox_races"]) == 1 and m.collapsed["hyrox_races"] == 1 and len(m.quarantine) == 1


def test_the_ai_analysis_is_kept_whole():
    analysis = {"overall": "Strong", "overallDetail": ["a"], "tips": [{"key": "run1", "rating": "focus", "tip": "t", "detail": []}]}
    m = run({"repcheck_hyrox_history_v1": [_race(analysis=analysis)]})
    assert m.rows["hyrox_races"][0]["analysis"] == analysis


def test_an_unknown_key_on_a_race_or_split_is_kept():
    race = _race(newField=1)
    race["splits"][0]["pace"] = "4:00"
    m = run({"repcheck_hyrox_history_v1": [race]})
    assert m.rows["hyrox_races"][0]["extra"] == {"newField": 1}
    assert m.rows["hyrox_race_splits"][0]["extra"] == {"pace": "4:00"}


def test_a_split_without_a_time_quarantines_the_race():
    bad = _race()
    bad["splits"][1] = {"key": "skierg"}
    m = run({"repcheck_hyrox_history_v1": [bad]})
    assert m.rows["hyrox_races"] == [] and m.rows["hyrox_race_splits"] == [] and len(m.quarantine) == 1


# -- chats ---------------------------------------------------------------------

def test_coach_turns_keep_order_sources_and_a_missing_date_as_null():
    sources = [{"id": "s", "title": "T", "publisher": "P", "url": "u"}]
    m = run({"repcheck_coach_chat_v1": [
        {"role": "user", "text": "hi", "date": "2026-10-24"},
        {"role": "coach", "text": "hello", "date": "2026-10-24", "sources": sources},
        {"role": "user", "text": "undated legacy turn"}]})
    rows = m.rows["coach_messages"]
    assert [r["body"] for r in rows] == ["hi", "hello", "undated legacy turn"]
    assert rows[1]["sources"] == sources and rows[2]["msg_date"] is None


def test_workout_chat_files_turns_under_their_day_and_dedupes_by_client_id():
    m = run({"repcheck_workout_chat_v1": {"2026-10-24": [
        {"id": "t1", "role": "user", "text": "a", "date": "2026-10-24"},
        {"id": "t1", "role": "user", "text": "a", "date": "2026-10-24"},
        {"role": "assistant", "text": "no id on an older turn", "date": "2026-10-24", "sources": None}]}})
    rows = m.rows["workout_chat_messages"]
    assert rows[0]["client_id"] == "t1" and rows[1]["client_id"].startswith("legacy-")
    assert m.collapsed["workout_chat_messages"] == 1
    assert all(r["msg_date"] == "2026-10-24" for r in rows)


def test_an_analyze_chat_attaches_only_to_one_of_the_users_own_analyses():
    thread = {"createdAtMs": MS, "history": [{"role": "user", "text": "q"}, {"role": "assistant", "text": "a", "sources": []}]}
    mine = run({"repcheck_analyze_chat_v1_7": thread}, analyses={7: None})
    assert [(r["analyze_result_id"], r["body"]) for r in mine.rows["analyze_chat_messages"]] == [(7, "q"), (7, "a")]
    stranger = run({"repcheck_analyze_chat_v1_9": thread}, analyses={7: None})
    assert stranger.rows["analyze_chat_messages"] == [] and len(stranger.quarantine) == 2


# -- settings, goals, favourites, plan, coaching --------------------------------

def test_settings_gather_into_one_row_per_user():
    m = run({"repcheck_theme": "dark", "repcheck_language": "th",
             "repcheck_units_v1": {"weight": "lb", "height": "ftin", "distance": "km", "clock": "24h", "future": 1},
             "repcheck_hyrox_leaderboard_gender_v1": "women", "repcheck_hyrox_facility_lane_v1": 25,
             "repcheck_hyrox_history_synced_v1": 1})
    (row,) = m.rows["user_settings"]
    assert (row["theme"], row["language"], row["units_weight"], row["units_clock"]) == ("dark", "th", "lb", "24h")
    assert (row["hyrox_leaderboard_gender"], row["hyrox_facility_lane_m"], row["hyrox_history_backfilled"]) == ("women", 25.0, True)
    assert row["extra"] == {"units.future": 1}


def test_a_null_facility_lane_means_the_default():
    m = run({"repcheck_hyrox_facility_lane_v1": None})
    assert m.rows["user_settings"][0]["hyrox_facility_lane_m"] is None


def test_goals_favourites_and_the_split_plan():
    plan = {"splitType": "ppl", "daysPerWeek": 3, "goal": "", "days": [{"label": "Push", "exercises": ["Bench"]}],
            "schedule": {"monday": "Push"}, "exercisePrescriptions": {"[\"Push\",\"Bench\"]": {"sets": 3, "reps": 8}}, "type": "ppl"}
    m = run({"repcheck_nutrition_goals_v1": {"protein": 150, "fat": 65, "carbs": 200},
             "repcheck_nutrition_favorites_v1": ["Oats", "Oats", "Rice"], "repcheck_exercise_favorites_v1": ["Squat"],
             "repcheck_split_plan_v1": plan})
    goals = m.rows["nutrition_goals"][0]
    assert (goals["protein"], goals["fat"], goals["carbs"]) == (150, 65, 200)
    assert sorted(r["food_name"] for r in m.rows["nutrition_favorites"]) == ["Oats", "Rice"]
    row = m.rows["split_plans"][0]
    assert row["split_type"] == "ppl" and row["days"] == plan["days"] and row["extra"] == {"type": "ppl"}


def test_the_coaching_keys_merge_into_one_row_and_a_partial_profile_is_flagged():
    m = run({
        "repcheck_coaching_profile_v1": {"aspiration": "lose", "gender": "male", "weightKg": 82.5, "createdAt": "2026-10-01",
                                         "lastAdjustmentDate": "2026-10-20", "lossRatePct": 0.5, "extraThing": 1},
        "repcheck_coaching_last_adjustment_v1": {"reason": "weekly", "delta": -100, "at": MS},
        "repcheck_coaching_distribution_v1": {"monday": {"calories": 2000}},
        "repcheck_coaching_goal_achieved_v1": {"goalWeightKg": 75, "aspiration": "lose"},
        "repcheck_coaching_inactivity_notified_v1": "2026-10-21"})
    (row,) = m.rows["coaching_profiles"]
    assert (row["aspiration"], row["weight_kg"], row["loss_rate_pct"]) == ("lose", 82.5, 0.5)
    assert row["body_fat_range_id"] is None and row["created_on"] == "2026-10-01"
    assert (row["last_adjustment_reason"], row["last_adjustment_delta"]) == ("weekly", -100.0)
    assert row["weekly_distribution"] == {"monday": {"calories": 2000}}
    assert (row["goal_achieved_weight_kg"], row["goal_achieved_aspiration"]) == (75.0, "lose")
    assert row["inactivity_notified_on"] == "2026-10-21" and row["extra"] == {"extraThing": 1}
    assert m.notes["coaching_profile_missing_a_required_field"] == 1


# -- the safety net -------------------------------------------------------------

def test_an_unrecognised_key_is_quarantined_not_dropped():
    m = run({"repcheck_something_new_v1": {"a": 1}})
    assert len(m.quarantine) == 1 and m.quarantine[0][1]["value"] == {"a": 1}


def test_a_blob_of_the_wrong_type_is_quarantined_whole():
    m = run({"repcheck_nutrition_log_v1": ["not", "a", "dict"], "repcheck_hyrox_history_v1": {"not": "a list"}})
    assert len(m.quarantine) == 2 and not m.rows["nutrition_entries"] and not m.rows["hyrox_races"]


# -- unusual legacy shapes: the importer exists for these -------------------------
# Each case is one branch where the data is not what current code writes. The rule in
# every one: keep what can be kept, park what cannot WHOLE in quarantine, never drop.

@pytest.mark.parametrize("bad_race", [
    _race(date="garbage"), _race(date=12345), _race(category=None), _race(totalSeconds="fast"),
    "not a race", _race(splits="x"), _race(splits=[{"key": 1, "atSeconds": 2}]),
])
def test_a_race_that_cannot_be_placed_is_quarantined_whole(bad_race):
    m = run({"repcheck_hyrox_history_v1": [bad_race]})
    assert m.rows["hyrox_races"] == [] and m.rows["hyrox_race_splits"] == []
    assert len(m.quarantine) == 1


def test_a_race_with_no_id_gets_a_generated_one():
    race = _race()
    del race["id"]
    m = run({"repcheck_hyrox_history_v1": [race]})
    assert m.rows["hyrox_races"][0]["id"].startswith("legacy-")
    assert m.notes["hyrox_race_had_no_id_so_one_was_generated"] == 1


def test_odd_types_on_a_race_are_kept_in_extra():
    m = run({"repcheck_hyrox_history_v1": [_race(scale=2, analysis="text", format=5, flagged="yes")]})
    row = m.rows["hyrox_races"][0]
    assert (row["scale"], row["analysis"], row["format"], row["flagged"]) == ("full", None, None, False)
    assert row["extra"] == {"scale": 2, "analysis": "text", "format": 5, "flagged": "yes"}


def test_a_workout_id_reused_with_different_content_is_quarantined_and_an_exact_copy_collapses():
    entry = {"id": "w", "exercise": "Row", "addedAt": MS, "sets": []}
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [entry, dict(entry)], "2026-10-25": [dict(entry, exercise="Curl")]}})
    assert len(m.rows["workout_entries"]) == 1 and m.collapsed["workout_entries"] == 1 and len(m.quarantine) == 1


@pytest.mark.parametrize("blob,reason", [
    ({"2026-10-24": "not a list"}, "day value is not a list"),
    ({"2026-10-24": ["not an object"]}, "entry is not an object"),
])
def test_workout_and_food_blobs_with_the_wrong_shape_inside_a_day_are_quarantined(blob, reason):
    for key, table in (("repcheck_workout_log_v2", "workout_entries"), ("repcheck_nutrition_log_v1", "nutrition_entries")):
        m = run({key: blob})
        assert m.rows[table] == [] and [e for _s, _p, e in m.quarantine] == [reason]


def test_odd_types_inside_a_workout_are_kept():
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [
        {"id": "w", "exercise": "Row", "addedAt": MS, "unilateral": "maybe", "sets": "not a list"},
        {"id": "x", "exercise": "Row", "addedAt": MS, "sets": ["not a dict", {"reps": 5}]}]}})
    first, second = m.rows["workout_entries"]
    assert first["unilateral"] is False and first["extra"] == {"unilateral": "maybe", "sets": "not a list"}
    assert m.rows["workout_sets"][0]["extra"] == {"raw": "not a dict"} and m.rows["workout_sets"][1]["reps"] == 5


def test_odd_types_inside_a_food_entry_are_kept():
    m = run({"repcheck_nutrition_log_v1": {"2026-10-24": [
        {"id": "a", "food": 123, "addedAt": MS, "ingredients": "not a list", "unit": 4}]}})
    row = m.rows["nutrition_entries"][0]
    assert row["food"] == "" and row["ingredients"] is None
    assert row["extra"] == {"food": 123, "ingredients": "not a list", "unit": 4}
    assert m.notes["nutrition_entry_without_food_name"] == 1


@pytest.mark.parametrize("key,blob,table", [
    ("repcheck_weight_log_v1", ["not", "an", "object"], "weight_entries"),
    ("repcheck_day_status_v1", ["x"], "day_status_overrides"),
    ("repcheck_activity_log_v1", ["x"], "activity_days"),
    ("repcheck_analyze_log_v1", {"not": "a list"}, "analyze_log_entries"),
    ("repcheck_coach_chat_v1", {"not": "a list"}, "coach_messages"),
    ("repcheck_nutrition_favorites_v1", {"not": "a list"}, "nutrition_favorites"),
])
def test_a_blob_of_the_wrong_top_level_type_is_quarantined_whole(key, blob, table):
    m = run({key: blob})
    assert m.rows[table] == [] and len(m.quarantine) == 1


def test_bad_day_keys_and_empty_values_in_the_small_logs_are_quarantined():
    m = run({"repcheck_day_status_v1": {"not-a-day": "fasting"},
             "repcheck_activity_log_v1": {"2026-10-24": "not a list", "2026-10-25": ["", "coach_chat"]},
             "repcheck_analyze_log_v1": ["not an object", {"exercise": "Row", "analyzedAt": "soon"}]})
    assert m.rows["day_status_overrides"] == []
    assert [r["action"] for r in m.rows["activity_days"]] == ["coach_chat"]
    assert m.rows["analyze_log_entries"] == []
    assert len(m.quarantine) == 5


def test_fractional_goals_round_and_keep_the_original():
    m = run({"repcheck_nutrition_goals_v1": {"protein": 150.4, "fat": 65, "carbs": 199.6, "extra": 1}})
    row = m.rows["nutrition_goals"][0]
    assert (row["protein"], row["fat"], row["carbs"]) == (150, 65, 200)
    assert row["extra"] == {"extra": 1, "protein_original": 150.4, "carbs_original": 199.6}


@pytest.mark.parametrize("goals", [{"protein": "lots", "fat": 1, "carbs": 1}, {"protein": 1}, "text", None])
def test_goals_that_are_not_three_numbers_are_quarantined(goals):
    m = run({"repcheck_nutrition_goals_v1": goals})
    assert m.rows["nutrition_goals"] == [] and len(m.quarantine) == 1


def test_a_favourite_that_is_not_text_is_quarantined():
    m = run({"repcheck_exercise_favorites_v1": ["Squat", "", 7]})
    assert [r["exercise_name"] for r in m.rows["exercise_favorites"]] == ["Squat"] and len(m.quarantine) == 2


def test_a_split_plan_that_is_not_an_object_is_quarantined_and_odd_fields_are_kept():
    assert len(run({"repcheck_split_plan_v1": ["x"]}).quarantine) == 1
    row = run({"repcheck_split_plan_v1": {"splitType": 3, "daysPerWeek": "many", "goal": "g"}}).rows["split_plans"][0]
    assert row["split_type"] is None and row["days_per_week"] is None and row["goal"] == "g"
    assert row["extra"] == {"splitType": 3, "daysPerWeek": "many"}


def test_odd_settings_values_are_kept_in_extra():
    m = run({"repcheck_theme": 5, "repcheck_language": ["th"], "repcheck_units_v1": "metric",
             "repcheck_hyrox_leaderboard_gender_v1": 1, "repcheck_hyrox_facility_lane_v1": "far",
             "repcheck_hyrox_history_synced_v1": "weird"})
    row = m.rows["user_settings"][0]
    assert (row["theme"], row["language"], row["hyrox_leaderboard_gender"], row["hyrox_facility_lane_m"]) == (None, None, None, None)
    assert row["hyrox_history_backfilled"] is False
    assert row["extra"] == {"theme": 5, "language": ["th"], "units": "metric", "hyrox_leaderboard_gender": 1,
                            "hyrox_facility_lane_m": "far", "hyrox_history_synced": "weird"}


def test_odd_coaching_values_are_kept_in_extra():
    m = run({"repcheck_coaching_profile_v1": "text", "repcheck_coaching_last_adjustment_v1": "x",
             "repcheck_coaching_goal_achieved_v1": 3,
             "repcheck_coaching_goal_achieved_handled_v1": {"goalWeightKg": 70, "aspiration": "gain", "n": 1},
             "repcheck_coaching_inactivity_notified_v1": "yesterday", "repcheck_coaching_future_v1": {"a": 1}})
    row = m.rows["coaching_profiles"][0]
    assert row["inactivity_notified_on"] is None and (row["goal_handled_weight_kg"], row["goal_handled_aspiration"]) == (70.0, "gain")
    assert row["extra"] == {"profile": "text", "last_adjustment": "x", "goal_achieved": 3,
                            "goal_handled": {"n": 1}, "inactivity_notified": "yesterday",
                            "repcheck_coaching_future_v1": {"a": 1}}


def test_chat_turns_that_cannot_be_placed_are_quarantined_and_odd_sources_are_kept():
    m = run({"repcheck_coach_chat_v1": ["not a turn", {"role": "user", "date": "2026-10-24"},
                                        {"role": "coach", "text": "ok", "date": "2026-10-24", "sources": "none"}]})
    assert [r["body"] for r in m.rows["coach_messages"]] == ["ok"] and len(m.quarantine) == 2
    assert m.rows["coach_messages"][0]["sources"] is None and m.rows["coach_messages"][0]["extra"] == {"sources": "none"}


def test_a_reused_workout_chat_id_with_different_text_is_quarantined():
    m = run({"repcheck_workout_chat_v1": {"2026-10-24": [
        {"id": "t", "role": "user", "text": "a"}, {"id": "t", "role": "user", "text": "b"}]}})
    assert len(m.rows["workout_chat_messages"]) == 1 and len(m.quarantine) == 1


def test_an_analyze_chat_without_a_history_list_is_quarantined():
    m = run({"repcheck_analyze_chat_v1_7": {"createdAtMs": MS}}, analyses={7: None})
    assert m.rows["analyze_chat_messages"] == [] and len(m.quarantine) == 1


def test_an_analyze_chat_whose_stamp_differs_from_the_analysis_is_noted():
    import datetime
    created = datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc)
    m = run({"repcheck_analyze_chat_v1_7": {"createdAtMs": MS, "history": [{"role": "user", "text": "q"}]}}, analyses={7: created})
    assert m.notes["analyze_chat_createdAtMs_differs_from_analysis_created_at"] == 1
    assert len(m.rows["analyze_chat_messages"]) == 1


# -- review fixes ------------------------------------------------------------------

def test_every_chat_turn_gets_a_unique_deterministic_key_even_when_the_text_repeats():
    """The app upserts chat turns on (user_id, client_id), so the key must tell two identical
    messages apart (position) and must not change between runs (hash, not random)."""
    blobs = {
        "repcheck_coach_chat_v1": [{"role": "user", "text": "ok", "date": "2026-10-24"}] * 3,
        "repcheck_workout_chat_v1": {"2026-10-24": [{"role": "user", "text": "ok"}] * 3},
        "repcheck_analyze_chat_v1_7": {"history": [{"role": "user", "text": "ok"}] * 3},
    }
    first = run(blobs, analyses={7: None})
    again = run(blobs, analyses={7: None})
    for table in ("coach_messages", "workout_chat_messages", "analyze_chat_messages"):
        keys = [r["client_id"] for r in first.rows[table]]
        assert len(keys) == 3 and len(set(keys)) == 3, f"{table}: identical turns must not share a key"
        assert all(k.startswith("legacy-") for k in keys)
        assert keys == [r["client_id"] for r in again.rows[table]], f"{table}: keys changed between runs"


def test_a_workout_chat_turn_that_already_has_an_id_keeps_it():
    m = run({"repcheck_workout_chat_v1": {"2026-10-24": [{"id": "abc", "role": "user", "text": "hi"}]}})
    assert m.rows["workout_chat_messages"][0]["client_id"] == "abc"


@pytest.mark.parametrize("value", [99999999999, 2147483648, -2147483649, 1e12])
def test_a_set_value_too_big_for_a_postgres_integer_is_kept_in_extra_not_sent_to_fail_the_import(value):
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [
        {"id": "w", "exercise": "Row", "addedAt": MS, "sets": [{"reps": value, "leftReps": 5}]}]}})
    row = m.rows["workout_sets"][0]
    assert row["reps"] is None and row["extra"] == {"reps": value} and row["left_reps"] == 5


def test_the_largest_integer_postgres_accepts_still_goes_in():
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [
        {"id": "w", "exercise": "Row", "addedAt": MS, "sets": [{"reps": 2147483647}]}]}})
    assert m.rows["workout_sets"][0]["reps"] == 2147483647


def test_goals_too_big_for_a_postgres_integer_are_quarantined():
    m = run({"repcheck_nutrition_goals_v1": {"protein": 2147483648, "fat": 1, "carbs": 1}})
    assert m.rows["nutrition_goals"] == [] and len(m.quarantine) == 1


def test_two_analyze_log_entries_at_the_same_time_with_different_fields_are_not_merged():
    exact = {"exercise": "Row", "analyzedAt": MS}
    m = run({"repcheck_analyze_log_v1": [exact, dict(exact), dict(exact, score=7)]})
    assert len(m.rows["analyze_log_entries"]) == 1 and m.collapsed["analyze_log_entries"] == 1
    assert [e for _s, _p, e in m.quarantine] == ["same exercise and time as another entry, with different fields"]


def test_notes_are_only_counted_for_entries_that_were_actually_kept():
    """A note says 'this was kept like so'; a duplicate or a rejected turn was not kept."""
    legacy = {"id": "same", "name": "Rice", "grams": 100, "hour": 8}
    m = run({"repcheck_nutrition_log_v1": {"2026-08-05": [dict(legacy), dict(legacy)]},
             "repcheck_coach_chat_v1": [{"role": "user", "date": "2026-10-24"}, {"role": "user", "text": "hi"}]})
    hour_notes = {k: v for k, v in m.notes.items() if "legacy_hour" in k}
    assert list(hour_notes.values()) == [1], "the collapsed duplicate must not be counted"
    undated = {k: v for k, v in m.notes.items() if "no_real_date" in k}
    assert list(undated.values()) == [1], "the turn that was rejected for having no text must not be counted"


# -- the shared value parsers, directly ------------------------------------------

@pytest.mark.parametrize("value,ok", [
    (946684800000, True), (946684799999, False), (4102444800000, True), (4102444800001, False),
    (True, False), (float("nan"), False), (float("inf"), False), (-1, False), ("1761300000000", False), (None, False),
])
def test_ms_to_dt_accepts_only_a_plausible_millisecond_timestamp(value, ok):
    assert (imp.ms_to_dt(value) is not None) is ok


@pytest.mark.parametrize("value,expected", [
    ("2026-01-01 10:00:00", "2026-01-01T10:00:00+00:00"),
    ("2026-01-01T10:00:00Z", "2026-01-01T10:00:00+00:00"),
    ("2026-01-01T10:00:00", "2026-01-01T10:00:00+00:00"),
    ("2026-01-01T17:00:00+07:00", "2026-01-01T17:00:00+07:00"),
    ("2026-01-01", "2026-01-01T00:00:00+00:00"),
    ("2026-10-24T03:15:00.123Z", "2026-10-24T03:15:00.123000+00:00"),
    ("", None), ("   ", None), ("garbage", None), (None, None), (5, None),
])
def test_parse_ts(value, expected):
    parsed = imp.parse_ts(value)
    assert (parsed.isoformat() if parsed else None) == expected
    if parsed:
        assert parsed.tzinfo is not None


def test_parse_ts_treats_the_sqlite_form_and_the_iso_form_as_the_same_instant():
    assert imp.parse_ts("2026-01-01 10:00:00") == imp.parse_ts("2026-01-01T10:00:00Z")
    assert imp.parse_ts("2026-01-01T17:00:00+07:00") == imp.parse_ts("2026-01-01T10:00:00Z")


@pytest.mark.parametrize("value,ok", [
    ("2026-10-24", True), ("2024-02-29", True), ("2026-02-31", False), ("2026-13-01", False),
    ("9999-99-99", False), ("0000-00-00", False), ("2026-1-1", False), (" 2026-10-24", False), (20261024, False), (None, False),
    # forms Python's own date.fromisoformat accepts but a day key in the app's data never is
    ("20261024", False), ("2026-W43-6", False),
])
def test_parse_day_accepts_only_a_real_calendar_day(value, ok):
    assert (imp.parse_day(value) is not None) is ok



# -- values Postgres cannot store ------------------------------------------------------------------

@pytest.mark.parametrize("bad,reason", [
    ("Rice\x00", "NUL"), ("cut through an emoji \ud83d", "lone surrogate"), (float("nan"), "NaN"),
])
@pytest.mark.parametrize("key,blob", [
    ("repcheck_nutrition_log_v1", lambda v: {"2026-10-24": [{"id": "a", "food": v, "addedAt": MS}]}),
    ("repcheck_workout_log_v2", lambda v: {"2026-10-24": [{"id": "w", "exercise": v, "addedAt": MS}]}),
    ("repcheck_coach_chat_v1", lambda v: [{"role": "user", "text": v, "date": "2026-10-24"}]),
    ("repcheck_split_plan_v1", lambda v: {"goal": v}),
])
def test_a_blob_holding_a_value_postgres_cannot_store_is_parked_whole_and_safely_encoded(key, blob, bad, reason):
    """Any user of the old site could store one of these through the sync endpoint. Left alone it fails the
    whole launch-day load; here it quarantines that one blob."""
    m = run({key: blob(bad), "repcheck_theme": "dark"})
    assert m.rows["user_settings"][0]["theme"] == "dark", "the user's other data still goes in"
    for table in ("nutrition_entries", "workout_entries", "coach_messages", "split_plans"):
        assert m.rows[table] == []
    (source, payload, error), = m.quarantine
    assert source == f"user_data:{key}" and reason in error
    assert imp.unsafe_reason(payload) is None, "what is parked must itself be storable"
    assert payload["key"] == key and isinstance(payload["value_json"], str)


def test_identical_id_less_workouts_and_races_are_kept_separate_too():
    workout = {"exercise": "Curl", "addedAt": MS, "sets": [{"reps": 10}]}
    race = {"date": "2026-10-24T03:15:00.123Z", "category": "open", "totalSeconds": 4000.5, "splits": []}
    m = run({"repcheck_workout_log_v2": {"2026-10-24": [dict(workout), dict(workout)]},
             "repcheck_hyrox_history_v1": [dict(race), dict(race)]})
    for table in ("workout_entries", "hyrox_races"):
        ids = [r["id"] for r in m.rows[table]]
        assert len(ids) == 2 and len(set(ids)) == 2, table
    assert len(m.rows["workout_sets"]) == 2
