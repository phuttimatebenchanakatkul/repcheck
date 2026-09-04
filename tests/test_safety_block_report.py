"""Blocking and reporting -- App Store Guideline 1.2.

The only content one RepCheck account writes that another one sees is a
display name, on the global leaderboards. Guideline 1.2 asks for three things
wherever that is true: filter it, let people report it, let people block the
account. `name_filter.py` is the filter; these are the other two.

What is worth pinning here is not that the endpoints return 200 -- it is that a
block actually HOLDS. A block that hides someone from the reps leaderboard but
leaves them on the HYROX board, or in the friends list, or able to re-add
themselves by code, is not a block; it is a filter on one screen. Each of those
paths gets its own test.
"""

import pytest

import app as app_module
import database

flask_app = app_module.app


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "safety-test.db")
    database.init_db()
    return database


def _user(email, name):
    return database.create_local_user(email, "irrelevant-password", name)


def _client(user_id):
    flask_app.config["TESTING"] = True
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client


def _submit_reps(user_id, reps, exercise="pushups"):
    """A challenge submission, which is what the reps leaderboard ranks."""
    challenge_id = database.create_challenge(user_id, exercise)
    with database.get_db() as conn:
        conn.execute(
            "INSERT INTO challenge_submissions (challenge_id, user_id, reps) VALUES (?, ?, ?)",
            (challenge_id, user_id, reps),
        )


# ---------- The data layer ----------


def test_hidden_ids_reads_a_block_in_both_directions(db):
    """A one-way read would let the account someone blocked go on watching
    them climb the leaderboard, which is the thing blocking exists to stop."""
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.block_user(alice, bob)

    assert database.hidden_user_ids(alice) == {bob}, "the blocker must not see the blocked"
    assert database.hidden_user_ids(bob) == {alice}, "the blocked must not see the blocker"


def test_blocking_is_idempotent_and_refuses_self(db):
    alice = _user("a@example.com", "Alice")
    bob = _user("b@example.com", "Bob")
    assert database.block_user(alice, bob) is True
    assert database.block_user(alice, bob) is True  # again: no duplicate-key error
    assert len(database.get_blocked_accounts(alice)) == 1
    assert database.block_user(alice, alice) is False


def test_unblock_only_undoes_your_own_block(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.block_user(alice, bob)

    # Bob cannot lift the block Alice placed by "unblocking" her.
    assert database.unblock_user(bob, alice) is False
    assert database.hidden_user_ids(alice) == {bob}

    assert database.unblock_user(alice, bob) is True
    assert database.hidden_user_ids(alice) == set()


def test_blocked_accounts_lists_only_blocks_you_made(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.block_user(bob, alice)  # Bob blocked Alice, not the other way round
    assert database.get_blocked_accounts(alice) == [], (
        "being blocked by someone is not something you are shown, or can undo"
    )


def test_report_records_a_row_and_rejects_self_reports(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    assert database.create_content_report(alice, bob, "offensive_name") is not None
    assert database.create_content_report(alice, alice, "spam") is None

    open_reports = database.get_open_reports()
    assert len(open_reports) == 1
    assert open_reports[0]["reported_name"] == "Bob"
    assert open_reports[0]["reporter_name"] == "Alice"

    assert database.mark_report_handled(open_reports[0]["id"]) is True
    assert database.get_open_reports() == []


def test_an_unknown_reason_is_stored_as_other_not_rejected(db):
    """A client sending a reason this build does not know about must still
    file the report -- losing it is worse than mislabelling it."""
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.create_content_report(alice, bob, "something-invented")
    assert database.get_open_reports()[0]["reason"] == "other"


# ---------- The block has to hold everywhere a name appears ----------


def test_block_hides_the_account_from_the_reps_leaderboard_both_ways(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    _submit_reps(alice, 50)
    _submit_reps(bob, 90)

    both = {r["user_id"] for r in database.get_total_reps_leaderboard()}
    assert both == {alice, bob}

    database.block_user(alice, bob)

    alice_sees = database.get_total_reps_leaderboard(exclude_ids=database.hidden_user_ids(alice))
    assert {r["user_id"] for r in alice_sees} == {alice}
    bob_sees = database.get_total_reps_leaderboard(exclude_ids=database.hidden_user_ids(bob))
    assert {r["user_id"] for r in bob_sees} == {bob}


def test_block_hides_the_account_from_the_hyrox_leaderboard(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.create_hyrox_result(alice, "men", "open", "singles", 4200)
    database.create_hyrox_result(bob, "men", "open", "singles", 3900)

    database.block_user(alice, bob)
    rows = database.get_hyrox_leaderboard(
        "men", "open", "singles", exclude_ids=database.hidden_user_ids(alice)
    )
    assert {r["user_id"] for r in rows} == {alice}, (
        "a block that only covers the reps board is not a block"
    )


def test_block_removes_the_account_from_the_friends_list(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.add_friendship(alice, bob)
    database.add_friendship(bob, alice)
    assert [f["id"] for f in database.get_friends(alice)] == [bob]

    database.block_user(alice, bob)
    assert database.get_friends(alice) == []
    assert database.get_friends(bob) == [], "hidden in both directions here too"


def test_excluding_ids_keeps_the_ranks_contiguous(db):
    """Filtered in SQL rather than after the fact, so the caller's
    position-in-list rank is the rank the viewer is actually shown."""
    alice, bob, cara = (
        _user("a@example.com", "Alice"),
        _user("b@example.com", "Bob"),
        _user("c@example.com", "Cara"),
    )
    _submit_reps(bob, 100)   # would be #1
    _submit_reps(cara, 80)   # would be #2
    _submit_reps(alice, 10)  # would be #3

    database.block_user(alice, bob)
    rows = database.get_total_reps_leaderboard(exclude_ids=database.hidden_user_ids(alice))
    assert [r["user_id"] for r in rows] == [cara, alice]  # no gap where Bob was


# ---------- The routes ----------


def test_block_and_unblock_round_trip_through_the_api(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    client = _client(alice)

    assert client.post("/api/safety/block", json={"user_id": bob}).get_json()["ok"] is True
    assert [b["name"] for b in client.get("/api/safety/blocks").get_json()["blocked"]] == ["Bob"]

    client.delete("/api/safety/block", json={"user_id": bob})
    assert client.get("/api/safety/blocks").get_json()["blocked"] == []


def test_reporting_also_blocks(db):
    """Being asked to take a second action to stop seeing what you just
    objected to is the wrong shape for this."""
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    client = _client(alice)

    assert client.post(
        "/api/safety/report", json={"user_id": bob, "reason": "offensive_name"}
    ).get_json()["ok"] is True

    assert database.hidden_user_ids(alice) == {bob}
    assert len(database.get_open_reports()) == 1


def test_the_leaderboard_route_hides_blocked_accounts(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    _submit_reps(alice, 10)
    _submit_reps(bob, 99)
    client = _client(alice)

    before = client.get("/api/leaderboard?scope=global").get_json()
    assert {r["user_id"] for r in before["leaderboard"]} == {alice, bob}

    client.post("/api/safety/block", json={"user_id": bob})
    after = client.get("/api/leaderboard?scope=global").get_json()
    assert {r["user_id"] for r in after["leaderboard"]} == {alice}
    assert after["totalEntries"] == 1


def test_a_blocked_account_cannot_add_you_back_by_code(db):
    """Otherwise a block is undone the moment they send their code again."""
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.block_user(alice, bob)
    alice_code = database.get_or_create_friend_code(alice)

    resp = _client(bob).post("/api/friends/add", json={"code": alice_code})
    assert resp.status_code == 404
    assert database.get_friends(bob) == []
    # The message must not confirm that a block exists -- that is itself a
    # channel back to the person who was blocked.
    assert "block" not in resp.get_json()["error"].lower()


def test_safety_routes_require_login(db):
    flask_app.config["TESTING"] = True
    anon = flask_app.test_client()
    assert anon.get("/api/safety/blocks").status_code == 401
    assert anon.post("/api/safety/block", json={"user_id": 1}).status_code == 401
    assert anon.post("/api/safety/report", json={"user_id": 1}).status_code == 401


def test_blocking_an_account_that_does_not_exist_is_a_404_not_a_row(db):
    alice = _user("a@example.com", "Alice")
    client = _client(alice)
    assert client.post("/api/safety/block", json={"user_id": 999999}).status_code == 404
    assert client.post("/api/safety/block", json={"user_id": "nonsense"}).status_code == 404
    assert database.get_blocked_accounts(alice) == []


def test_you_cannot_block_or_report_yourself_through_the_api(db):
    alice = _user("a@example.com", "Alice")
    client = _client(alice)
    assert client.post("/api/safety/block", json={"user_id": alice}).status_code == 400
    assert client.post("/api/safety/report", json={"user_id": alice}).status_code == 400


def test_admin_reports_page_is_404_for_a_normal_account(db):
    alice = _user("a@example.com", "Alice")
    assert _client(alice).get("/admin/reports").status_code == 404


# ---------- Deleting an account takes its safety rows with it ----------


def test_purging_an_account_removes_its_blocks_and_reports(db):
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.block_user(alice, bob)
    database.block_user(bob, alice)
    database.create_content_report(alice, bob, "spam")
    database.create_content_report(bob, alice, "spam")

    with database.get_db() as conn:
        database._purge_user_rows(conn, bob)

    with database.get_db() as conn:
        blocks = conn.execute("SELECT COUNT(*) AS n FROM blocked_users").fetchone()["n"]
        reports = conn.execute("SELECT COUNT(*) AS n FROM content_reports").fetchone()["n"]
    assert blocks == 0, "rows naming the purged account on EITHER side must go"
    assert reports == 0, "a report whose subject no longer exists has nothing to moderate"


# ---------- Regressions from the adversarial review ----------


def test_block_hides_the_account_from_challenges_and_their_notes(db):
    """get_visible_challenges reaches the friends table directly instead of
    going through get_friends(), so it does not inherit that filtering. It
    also returns `notes` -- free text another account wrote, which
    name_filter.py never sees."""
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    database.add_friendship(alice, bob)
    database.add_friendship(bob, alice)

    bobs_challenge = database.create_challenge(bob, "pushups")
    database.save_submission(bobs_challenge, bob, 40, "something unpleasant")

    assert len(database.get_visible_challenges(alice)) == 1, "precondition: Alice can see it"

    database.block_user(alice, bob)
    assert database.get_visible_challenges(alice) == [], (
        "a challenge created by a blocked account must not reach the blocker"
    )


def test_block_hides_a_blocked_submitter_from_someone_elses_challenge(db):
    """The challenge itself can be legitimate while one submission on it is
    from a blocked account -- the row, and its notes, still have to go."""
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    mine = database.create_challenge(alice, "pushups")
    database.save_submission(mine, alice, 30, "fine")
    database.save_submission(mine, bob, 90, "something unpleasant")

    database.block_user(alice, bob)
    visible = database.get_visible_challenges(alice)
    assert len(visible) == 1, "my own challenge stays"
    submitters = {row["user_id"] for row in visible[0]["leaderboard"]}
    assert submitters == {alice}, "the blocked account's submission and notes must be gone"


def test_reporting_twice_does_not_flood_the_review_queue(db):
    """One OPEN report per (reporter, subject). Without this an automated
    client can pile unbounded rows against one account."""
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    first = database.create_content_report(alice, bob, "spam")
    again = database.create_content_report(alice, bob, "offensive_name")
    assert first == again
    assert len(database.get_open_reports()) == 1

    # Once handled, a fresh complaint is a genuinely new one.
    database.mark_report_handled(first)
    assert database.create_content_report(alice, bob, "spam") != first
    assert len(database.get_open_reports()) == 1


def test_the_safety_routes_do_not_echo_a_display_name_back(db):
    """The routes accept any user id on purpose (ids are not secret), so
    replying with the name would let a script walk 1..N and read the display
    name of every account, including ones on no leaderboard."""
    alice, bob = _user("a@example.com", "Alice"), _user("b@example.com", "Bob")
    client = _client(alice)

    blocked = client.post("/api/safety/block", json={"user_id": bob}).get_json()["blocked"]
    assert "name" not in blocked and blocked["id"] == bob

    client.delete("/api/safety/block", json={"user_id": bob})
    reported = client.post(
        "/api/safety/report", json={"user_id": bob, "reason": "spam"}
    ).get_json()["blocked"]
    assert "name" not in reported and reported["id"] == bob


def test_both_leaderboards_refresh_when_a_block_happens():
    """safety.js tells the user "you won't see this account again" the moment
    the block lands. Both boards have to make that true immediately rather
    than at the next navigation, or the one feature added for App Review
    fails in front of the reviewer.

    Source-level: this is the pairing of an event name dispatched in one file
    with a listener in two others, which is textual rather than behavioural --
    the same tradeoff tests/test_analyze_camera_released_on_page_swap.py makes.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    read = lambda rel: (root / rel).read_text(encoding="utf-8")

    assert 'CustomEvent("repcheck:safety-changed")' in read("static/safety.js"), (
        "safety.js must announce a block/report for the boards to react to"
    )
    assert 'document.addEventListener("repcheck:safety-changed"' in read("templates/challenges.html")

    hyrox = read("static/hyrox.js")
    assert 'document.addEventListener("repcheck:safety-changed"' in hyrox
    assert "this.leaderboardCache = null;" in hyrox.split('"repcheck:safety-changed"', 1)[1][:400], (
        "the HYROX handler must CLEAR the cache -- loadLeaderboard() "
        "short-circuits on a matching key, so a bare render() would redraw "
        "the same rows, blocked name included"
    )
