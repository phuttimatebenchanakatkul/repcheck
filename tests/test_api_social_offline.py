"""The social slice's pure parts: its constants against the website's, the rotation, id and code cleaning, the HYROX
validation, and the translation of the rep counter's error. No network, no database."""

import datetime as dt
import time

import pytest

import app as website
import database
import rep_form_analyzer
from api import ai, limits, social
from api.routes import social as routes

NAN, INF = float("nan"), float("inf")


# -- constants are the website's ----------------------------------------------------------------------------------------------

def test_the_ceilings_and_throttle_are_the_websites():
    assert social.CHALLENGE_LIMIT == website.PER_USER_LIMITS["challenges"] and social.HYROX_RESULT_LIMIT == website.PER_USER_LIMITS["hyrox_results"]
    assert (social.FRIEND_CODE_GUESS_LIMIT, social.FRIEND_CODE_GUESS_WINDOW) == (website.FRIEND_CODE_LOOKUP_LIMIT, website.FRIEND_CODE_LOOKUP_WINDOW)


def test_the_report_vocabularies_are_the_websites():
    assert social.REPORT_REASONS == database.REPORT_REASONS
    assert social.AI_REPORT_FEATURES == database.AI_REPORT_FEATURES and social.AI_REPORT_REASONS == database.AI_REPORT_REASONS
    assert social.MAX_AI_REPORT_TEXT == database.MAX_AI_REPORT_TEXT and social.MAX_OPEN_AI_REPORTS_PER_USER == database.MAX_OPEN_AI_REPORTS_PER_USER


def test_the_hyrox_vocabulary_and_floors_are_the_websites():
    assert social.HYROX_MIN_PLAUSIBLE_SECONDS == website.HYROX_MIN_PLAUSIBLE_SECONDS
    assert set(social.HYROX_GENDERS) == website.HYROX_GENDERS and set(social.HYROX_CATEGORIES) == website.HYROX_CATEGORIES
    assert set(social.HYROX_FORMATS) == website.HYROX_FORMATS
    assert social.HYROX_LEADERBOARD_ROWS == 50


def test_the_challenge_rotation_and_exercises_are_the_websites():
    assert social.CHALLENGE_ROTATION_EPOCH == website._CHALLENGE_ROTATION_EPOCH
    assert social.CHALLENGE_SECONDS == rep_form_analyzer.CHALLENGE_SECONDS == 25
    assert routes.CHALLENGE_ORDER == list(rep_form_analyzer.CHALLENGE_EXERCISES)
    assert routes.CHALLENGE_EXERCISES == {k: v["label"] for k, v in rep_form_analyzer.CHALLENGE_EXERCISES.items()}


def test_the_clip_types_are_the_analyze_slices_which_are_the_websites():
    from api import analyze
    assert analyze.ALLOWED_EXTENSIONS == website.ALLOWED_EXTENSIONS and analyze.RECORDED_EXTENSIONS == website.RECORDED_EXTENSIONS


# -- rotation -----------------------------------------------------------------------------------------------------------------------

def test_the_rotation_is_the_websites_for_every_day_of_two_years():
    day = dt.date(2025, 6, 1)
    for _ in range(800):
        index = (day - website._CHALLENGE_ROTATION_EPOCH).days % len(website._CHALLENGE_ROTATION_ORDER)
        assert social.todays_exercise(routes.CHALLENGE_ORDER, day) == website._CHALLENGE_ROTATION_ORDER[index], day
        day += dt.timedelta(days=1)


def test_the_rotation_starts_on_pushups_and_cycles_through_all_three():
    first = dt.date(2026, 1, 1)
    assert [social.todays_exercise(routes.CHALLENGE_ORDER, first + dt.timedelta(days=n)) for n in range(4)] == ["pushups", "situps", "pullups", "pushups"]


def test_the_daily_attempt_key_changes_at_midnight_utc_not_after_24_hours():
    just_before = int(dt.datetime(2026, 3, 1, 23, 59, 59, tzinfo=dt.timezone.utc).timestamp())
    assert limits._attempt_key("pushups", just_before) == "challenge:pushups:2026-03-01"
    assert limits._attempt_key("pushups", just_before + 1) == "challenge:pushups:2026-03-02"
    assert limits._attempt_key("situps", just_before) == "challenge:situps:2026-03-01"
    assert limits._attempt_key("pushups").endswith(dt.datetime.now(dt.timezone.utc).date().isoformat())


# -- ids and codes -------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174000"),
    ("  123E4567-E89B-12D3-A456-426614174000 ", "123e4567-e89b-12d3-a456-426614174000"),
    ("123e4567e89b12d3a456426614174000", "123e4567-e89b-12d3-a456-426614174000"),
    ("{123e4567-e89b-12d3-a456-426614174000}", "123e4567-e89b-12d3-a456-426614174000"),
    ("urn:uuid:123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174000"),
    (None, None), (5, None), (1.5, None), (True, None), ([], None), ({}, None), ("", None), ("nope", None), ("1", None),
    ("123e4567-e89b-12d3-a456-42661417400", None), ("123e4567-e89b-12d3-a456-4266141740000", None), ("g23e4567-e89b-12d3-a456-426614174000", None),
])
def test_a_user_id_is_a_uuid_in_canonical_form_or_nothing(raw, expected):
    assert social.parse_user_id(raw) == expected


@pytest.mark.parametrize("raw,expected", [("RC-ABCDEF", "RC-ABCDEF"), ("  rc-abcdef\n", "RC-ABCDEF"), ("rc-AbCdEf", "RC-ABCDEF"), ("x", "X")])
def test_a_code_is_trimmed_and_upper_cased_like_the_websites(raw, expected):
    assert social.clean_code(raw) == expected == raw.strip().upper()


@pytest.mark.parametrize("raw", [None, "", "   ", "\n\t", 5, 5.5, True, [], ["RC-ABCDEF"], {}, {"a": 1}])
def test_something_that_cannot_be_a_code_is_refused_cleanly(raw):
    with pytest.raises(social.Rejected, match="Enter a friend code.") as refused:
        social.clean_code(raw)
    assert refused.value.status == 400


# -- activity offsets ----------------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    (0, 0), ("0", 0), (420, 420), ("-300", -300), (840, 840), (841, 840), (9999, 840), (-841, -840), (-9999, -840),
    (None, 0), ("", 0), ("abc", 0), ("60.5", 0), ([], 0), ({}, 0), (5.9, 5), (True, 1),
])
def test_the_offset_is_clamped_to_real_timezones_and_a_bad_one_means_utc(raw, expected):
    assert social.offset_minutes(raw) == expected


def test_the_offset_rule_is_the_websites():
    """database.get_activity_dates clamps with the same bounds; its source is the only place the bounds are spelled out."""
    import inspect
    source = inspect.getsource(database.get_activity_dates)
    assert "max(-14 * 60, min(14 * 60, offset))" in source and social.offset_minutes(14 * 60 + 1) == 14 * 60


def test_the_activity_sources_are_the_websites_four_tables():
    ours = {(a, t, c) for a, t, c, _ in social.ACTIVITY_SOURCES}
    assert ours == {(a, t, c) for a, (t, c) in database.ACTIVITY_DATE_SOURCES.items()}
    assert {a: instant for a, _t, _c, instant in social.ACTIVITY_SOURCES} == {"challenge": True, "analysis": True, "hyrox": True, "checkin_photo": False}


# -- HYROX validation -----------------------------------------------------------------------------------------------------------------------

GOOD = {"gender": "men", "category": "open", "format": "singles", "total_seconds": 3600}


def test_a_good_result_is_cleaned_to_four_values():
    assert social.clean_hyrox_result(GOOD) == ("men", "open", "singles", 3600.0)
    assert social.clean_hyrox_result(dict(GOOD, gender="  women ", total_seconds="3601.5", format="doubles")) == ("women", "open", "doubles", 3601.5)


@pytest.mark.parametrize("seconds", [None, "x", "", [], {}, True, False, NAN, INF, -INF, "nan", "inf"])
def test_an_unreadable_time_is_invalid_time(seconds):
    with pytest.raises(social.Rejected, match="^Invalid time.$"):
        social.clean_hyrox_result(dict(GOOD, total_seconds=seconds))


def test_the_time_is_judged_before_the_combination_like_the_website():
    with pytest.raises(social.Rejected, match="^Invalid time.$"):
        social.clean_hyrox_result({"gender": "x", "category": "x", "format": "x", "total_seconds": "x"})
    with pytest.raises(social.Rejected, match="Invalid gender, category, or format."):
        social.clean_hyrox_result({"gender": "x", "category": "x", "format": "x", "total_seconds": 3600})


@pytest.mark.parametrize("gender,format_,floor", [("men", "singles", 3000), ("women", "singles", 3180), ("men", "doubles", 2820), ("women", "doubles", 3060)])
def test_the_floor_is_inclusive_and_per_gender_and_format(gender, format_, floor):
    base = {"gender": gender, "category": "pro", "format": format_}
    assert social.clean_hyrox_result(dict(base, total_seconds=floor))[3] == floor
    with pytest.raises(social.Rejected, match="plausible race finish"):
        social.clean_hyrox_result(dict(base, total_seconds=floor - 0.001))


def test_a_day_is_the_longest_time_and_the_floor_matches_the_websites_validation():
    assert social.clean_hyrox_result(dict(GOOD, total_seconds=86400))[3] == 86400.0
    with pytest.raises(social.Rejected, match="plausible race finish"):
        social.clean_hyrox_result(dict(GOOD, total_seconds=86400.001))
    for key, floor in website.HYROX_MIN_PLAUSIBLE_SECONDS.items():
        gender, format_ = key.split("|")
        social.clean_hyrox_result({"gender": gender, "category": "open", "format": format_, "total_seconds": floor})


@pytest.mark.parametrize("combo,ok", [(("men", "open", "singles"), True), (("women", "pro", "doubles"), True), (("MEN", "open", "singles"), False),
                                      (("men", "open", "single"), False), (("men", "", "singles"), False), ((None, "open", "singles"), False), ((["men"], "open", "singles"), False)])
def test_a_combination_must_be_exactly_known(combo, ok):
    assert social.hyrox_combo(*combo) is ok


def test_a_rejection_carries_its_status_and_extra_fields():
    refusal = social.Rejected("nope", 429, retry_after=7, limitReached=True)
    assert (str(refusal), refusal.status, refusal.extra) == ("nope", 429, {"retry_after": 7, "limitReached": True})
    assert social.Rejected("plain").status == 400


# -- the rep counter's error is translated --------------------------------------------------------------------------------------------------

def test_a_clip_the_counter_refuses_becomes_rep_count_failed_with_its_message(monkeypatch, tmp_path):
    def boom(path, exercise, trimmed_path=None):
        raise rep_form_analyzer.RepCountError("We couldn't find a person in that video.")
    monkeypatch.setattr(rep_form_analyzer, "analyze_reps", boom)
    with pytest.raises(ai.RepCountFailed, match="couldn't find a person"):
        ai._count_reps(tmp_path / "a.mp4", "pushups", tmp_path / "t.mp4")

    seen = {}

    def fine(path, exercise, trimmed_path=None):
        seen.update(path=path, exercise=exercise, trimmed=trimmed_path)
        return {"reps": 3, "rejected": 1, "notes": "ok"}
    monkeypatch.setattr(rep_form_analyzer, "analyze_reps", fine)
    assert ai._count_reps(tmp_path / "a.mp4", "situps", tmp_path / "t.mp4") == {"reps": 3, "rejected": 1, "notes": "ok"}
    assert seen == {"path": tmp_path / "a.mp4", "exercise": "situps", "trimmed": tmp_path / "t.mp4"}


def test_any_other_failure_of_the_counter_is_not_swallowed(monkeypatch, tmp_path):
    monkeypatch.setattr(rep_form_analyzer, "analyze_reps", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("gemini exploded")))
    with pytest.raises(RuntimeError, match="gemini exploded"):
        ai._count_reps(tmp_path / "a.mp4", "pushups", tmp_path / "t.mp4")


def test_the_real_backends_include_the_counter():
    assert ai.default_backends().count_reps is ai._count_reps
