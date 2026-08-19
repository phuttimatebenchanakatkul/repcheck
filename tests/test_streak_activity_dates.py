"""The streak counts a day when the user USED RepCheck that day -- doing a
daily challenge, logging a workout, logging food, and so on -- rather than
only the workout/nutrition logs it used to look at.

Most of that rule lives client-side (static/streak.js, covered by
tests-js/streak.test.js) because every one of those features already keeps
a dated local log. The daily challenge is the exception: an attempt is
recorded ONLY in the server's challenge_submissions table, so without
get_activity_dates() a user who does the challenge every single day would
still be shown a zero streak. Form analyses, HYROX races and check-in
photos ride along on the same query, which is also what recovers a streak
after switching devices or clearing the browser.

The timezone handling is the subtle part and the reason this file exists:
those rows are stamped in UTC (datetime('now')), but a streak is counted in
the user's own calendar days. An evening attempt in Bangkok (UTC+7) is
already "tomorrow" in UTC, so bucketing by the raw timestamp would file it
on the wrong day and split one continuous streak in two.
"""

import database


def _seed(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    return database.create_local_user("streak-tester@example.com", "irrelevant-password", "Streak Tester")


def _add_challenge_attempt(user_id, created_at, challenge_id=1):
    with database.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO challenges (id, creator_id, exercise, duration_seconds) VALUES (?, ?, 'pushups', 25)",
            (challenge_id, user_id),
        )
        conn.execute(
            "INSERT INTO challenge_submissions (challenge_id, user_id, reps, notes, created_at) VALUES (?, ?, 20, '', ?)",
            (challenge_id, user_id, created_at),
        )


def test_challenge_attempts_are_reported_as_activity_days(tmp_path, monkeypatch):
    """The whole point: a challenge attempt exists nowhere but this table,
    so this is the only way the streak can ever learn about it."""
    user_id = _seed(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-14 10:00:00", challenge_id=1)
    _add_challenge_attempt(user_id, "2026-08-15 10:00:00", challenge_id=2)

    assert database.get_activity_dates(user_id, 0) == {
        "2026-08-14": ["challenge"],
        "2026-08-15": ["challenge"],
    }


def test_utc_timestamps_are_bucketed_into_the_users_own_calendar_days(tmp_path, monkeypatch):
    """21:00 in Bangkok (UTC+7) is stored as 14:00 UTC the same day, but
    01:30 in Bangkok is stored as 18:30 UTC the day BEFORE. Reported in UTC
    those two attempts look like one day; in the user's own timezone they
    are the two consecutive days they actually were."""
    user_id = _seed(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-15 14:00:00", challenge_id=1)  # 21:00 local, Aug 15
    _add_challenge_attempt(user_id, "2026-08-15 18:30:00", challenge_id=2)  # 01:30 local, Aug 16

    assert list(database.get_activity_dates(user_id, 420)) == ["2026-08-15", "2026-08-16"]
    # ...and without the shift they'd collapse into a single day, breaking
    # what is really a 2-day streak.
    assert list(database.get_activity_dates(user_id, 0)) == ["2026-08-15"]


def test_every_server_recorded_feature_counts_not_just_challenges(tmp_path, monkeypatch):
    user_id = _seed(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-16 09:00:00")
    with database.get_db() as conn:
        conn.execute(
            "INSERT INTO analyze_results (user_id, exercise_label, feedback_text, created_at) VALUES (?, 'Squat', 'ok', ?)",
            (user_id, "2026-08-16 11:00:00"),
        )
        conn.execute(
            "INSERT INTO hyrox_results (user_id, gender, category, format, total_seconds, created_at) "
            "VALUES (?, 'male', 'open', 'singles', 3600, ?)",
            (user_id, "2026-08-15 08:00:00"),
        )
        # progress_photos.date is already the user's local check-in date,
        # so it is deliberately NOT timezone-shifted.
        conn.execute(
            "INSERT INTO progress_photos (user_id, date, angle, filename) VALUES (?, '2026-08-14', 'front', 'f.jpg')",
            (user_id,),
        )

    dates = database.get_activity_dates(user_id, 0)
    assert dates == {
        "2026-08-14": ["checkin_photo"],
        "2026-08-15": ["hyrox"],
        "2026-08-16": ["analysis", "challenge"],
    }


def test_one_day_with_several_attempts_is_still_one_day(tmp_path, monkeypatch):
    """Days are what a streak counts, so repeats within a day must collapse
    -- otherwise the client's activity log fills with duplicates."""
    user_id = _seed(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-16 09:00:00", challenge_id=1)
    _add_challenge_attempt(user_id, "2026-08-16 20:00:00", challenge_id=2)

    assert database.get_activity_dates(user_id, 0) == {"2026-08-16": ["challenge"]}


def test_only_this_users_activity_is_returned(tmp_path, monkeypatch):
    user_id = _seed(tmp_path, monkeypatch)
    other_id = database.create_local_user("someone-else@example.com", "irrelevant-password", "Someone Else")
    _add_challenge_attempt(other_id, "2026-08-16 09:00:00")

    assert database.get_activity_dates(user_id, 0) == {}
    assert database.get_activity_dates(other_id, 0) == {"2026-08-16": ["challenge"]}


def test_a_missing_or_junk_timezone_offset_degrades_to_utc(tmp_path, monkeypatch):
    """The offset arrives as a query-string parameter, so it can be absent
    or garbage. Reporting UTC days is a slightly-off streak; raising would
    be no streak at all."""
    user_id = _seed(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-16 09:00:00")

    assert database.get_activity_dates(user_id, "not-a-number") == {"2026-08-16": ["challenge"]}
    assert database.get_activity_dates(user_id, None) == {"2026-08-16": ["challenge"]}
    assert database.get_activity_dates(user_id) == {"2026-08-16": ["challenge"]}


def test_an_absurd_offset_is_clamped_to_a_real_timezone(tmp_path, monkeypatch):
    """A client sending a nonsense offset shouldn't be able to shift its own
    activity years away from when it happened."""
    user_id = _seed(tmp_path, monkeypatch)
    _add_challenge_attempt(user_id, "2026-08-16 09:00:00")

    # +14h is the largest real UTC offset, so 09:00 UTC lands on the 16th
    # at the very latest -- never on some arbitrary far-off date.
    assert database.get_activity_dates(user_id, 10_000_000) == {"2026-08-16": ["challenge"]}
    assert database.get_activity_dates(user_id, -10_000_000) == {"2026-08-15": ["challenge"]}


def test_the_activity_log_key_is_synced_to_the_account(tmp_path, monkeypatch):
    """repcheck_activity_log_v1 is the only record that a challenge, weekly
    check-in or coach chat ever happened on a given day, so it has to sync
    like the other logs -- and merge rather than overwrite, or a device with
    a stale copy would delete a streak the user actually earned."""
    import app

    assert "repcheck_activity_log_v1" in app.SYNCED_DATA_KEYS
    assert "repcheck_activity_log_v1" in database.LOG_MERGE_DATE_KEYED_KEYS

    user_id = _seed(tmp_path, monkeypatch)
    database.set_user_data(user_id, "repcheck_activity_log_v1", {"2026-08-15": ["challenge"]})
    # A second device that never saw Aug 15 writes only its own day.
    database.set_user_data(user_id, "repcheck_activity_log_v1", {"2026-08-16": ["checkin"]})

    stored = database.get_all_user_data(user_id)["repcheck_activity_log_v1"]
    assert stored == {"2026-08-15": ["challenge"], "2026-08-16": ["checkin"]}
