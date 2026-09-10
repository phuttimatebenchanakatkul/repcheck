"""A fabricated race time must not be able to top the global leaderboard.

/api/hyrox/results takes total_seconds straight from the client -- unlike
challenge reps, which come from analyze_reps() on an uploaded video, a race
time is self-reported and there is nothing to verify it against. The only
thing standing between a made-up number and the top of a leaderboard every
user sees is this floor.

It was a flat 20 minutes, against a client that flags anything under 47-53.
Measured with two accounts before the fix: an honest 57:30 and a fabricated
20:00 were both accepted, and the fabricated one ranked first.

The server comment claimed the two guards already matched. They did not,
which is exactly the kind of drift a comment cannot prevent and a test can.
"""

import io
import re
from pathlib import Path

import app as app_module

ROOT = Path(__file__).resolve().parent.parent


def _client_thresholds():
    """FLAG_THRESHOLD_SECONDS as static/hyrox.js actually defines it."""
    src = io.open(ROOT / "static" / "hyrox.js", encoding="utf-8").read()
    block = re.search(r"const FLAG_THRESHOLD_SECONDS = \{(.*?)\};", src, re.S)
    assert block, "FLAG_THRESHOLD_SECONDS not found in static/hyrox.js"

    found = {}
    for key, minutes in re.findall(r'"([a-z|]+)":\s*(\d+)\s*\*\s*60', block.group(1)):
        found[key] = int(minutes) * 60
    assert found, "no thresholds parsed out of FLAG_THRESHOLD_SECONDS"
    return found


def test_the_server_floor_matches_the_client_exactly():
    """Drift either way is a bug.

    Looser on the server and a doctored request reaches the leaderboard;
    stricter and the server rejects a race the app itself just told the user
    was legitimate.
    """
    assert app_module.HYROX_MIN_PLAUSIBLE_SECONDS == _client_thresholds(), (
        "static/hyrox.js and app.py disagree about what counts as a plausible "
        "finish. They are the same rule and must carry the same numbers."
    )


def test_every_gender_and_format_combination_has_a_floor():
    """A missing key must not become an unbounded combination."""
    for gender in app_module.HYROX_GENDERS:
        for fmt in app_module.HYROX_FORMATS:
            assert f"{gender}|{fmt}" in app_module.HYROX_MIN_PLAUSIBLE_SECONDS, (
                f"{gender}|{fmt} has no floor, so any time would be accepted "
                "for it"
            )


def test_doubles_is_allowed_to_be_faster_than_singles():
    """Pins the reason the floor is a table rather than one number.

    Two athletes split the stations, so a doubles race really is quicker. A
    flat floor at the singles pace would reject real doubles results -- which
    is why "50 minutes for everything" is not what this encodes.
    """
    floors = app_module.HYROX_MIN_PLAUSIBLE_SECONDS
    assert floors["men|doubles"] < floors["men|singles"]
    assert floors["women|doubles"] < floors["women|singles"]


def _post(client, seconds, gender="men", fmt="singles"):
    import json

    return client.post(
        "/api/hyrox/results",
        data=json.dumps({
            "gender": gender, "category": "open",
            "format": fmt, "total_seconds": seconds,
        }),
        content_type="application/json",
    )


def _logged_in(email):
    import database

    existing = database.get_user_by_email(email)
    user_id = existing["id"] if existing else database.create_local_user(
        email, "irrelevant-password", "Hyrox Tester"
    )
    app_module.app.config["TESTING"] = True
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client


def test_a_fabricated_time_is_refused():
    """Regression: 20:00 was accepted and ranked first."""
    client = _logged_in("hyrox-fake@example.com")
    assert _post(client, 20 * 60).status_code == 400


def test_a_real_elite_time_is_accepted():
    """The floor must not reject genuine results."""
    client = _logged_in("hyrox-real@example.com")
    assert _post(client, 57 * 60 + 30).status_code == 200


def test_a_genuine_doubles_time_below_the_singles_floor_still_counts():
    """48:00 is under the 50-minute singles floor and over the doubles one.

    This is the case a flat floor would have broken.
    """
    client = _logged_in("hyrox-doubles@example.com")
    assert _post(client, 48 * 60, fmt="doubles").status_code == 200


# --------------------------------------------------------------------------
# Rows that predate the floor
# --------------------------------------------------------------------------

def test_a_row_stored_before_the_floor_existed_cannot_rank():
    """The floor guards the way in; this guards the way out.

    A flat 20-minute floor shipped for a while, so the table can contain
    times half an hour below what the app calls possible. Rejecting new ones
    does nothing about those -- they would sit at the top of the board
    forever. Deliberately filtered rather than deleted: this is somebody's
    row, and a query that ignores it is reversible in a way a DELETE is not.
    """
    import database

    client = _logged_in("hyrox-legacy@example.com")
    user = database.get_user_by_email("hyrox-legacy@example.com")

    # straight into the table, as an old client could have put it there
    with database.get_db() as conn:
        conn.execute(
            "INSERT INTO hyrox_results (user_id, gender, category, format, total_seconds) "
            "VALUES (?, 'men', 'open', 'singles', ?)",
            (user["id"], 20 * 60),
        )

    rows = database.get_hyrox_leaderboard(
        "men", "open", "singles",
        min_seconds=app_module.HYROX_MIN_PLAUSIBLE_SECONDS["men|singles"],
    )
    assert all(r["best_seconds"] >= 50 * 60 for r in rows), (
        "an impossible time stored before the floor existed must not rank"
    )
    assert user["id"] not in [r["user_id"] for r in rows]


def test_a_user_with_one_bad_time_still_ranks_on_their_good_one():
    """Filtering before the MIN(), not after.

    Otherwise the fix would punish a real athlete for one junk row: their
    genuine PB would be replaced by nothing at all.
    """
    import database

    client = _logged_in("hyrox-mixed@example.com")
    user = database.get_user_by_email("hyrox-mixed@example.com")

    with database.get_db() as conn:
        conn.executemany(
            "INSERT INTO hyrox_results (user_id, gender, category, format, total_seconds) "
            "VALUES (?, 'men', 'open', 'singles', ?)",
            [(user["id"], 20 * 60), (user["id"], 58 * 60)],
        )

    rows = database.get_hyrox_leaderboard(
        "men", "open", "singles",
        min_seconds=app_module.HYROX_MIN_PLAUSIBLE_SECONDS["men|singles"],
    )
    mine = [r for r in rows if r["user_id"] == user["id"]]
    assert mine, "a real time must still rank"
    assert mine[0]["best_seconds"] == 58 * 60, (
        "the impossible row must be filtered before MIN(), not become the PB"
    )


def test_the_leaderboard_ROUTE_applies_the_floor_not_just_the_query():
    """Through HTTP, because the query accepting a floor proves nothing if
    the route forgets to pass one.

    Caught by mutation testing twice over. Blanking min_seconds at the call
    site left the direct-query tests passing, because they supply the floor
    themselves -- and the first version of THIS test read a "rows" key that
    does not exist, so it asserted all([]) and passed against everything.
    Hence the non-empty assertion below: a vacuous truth is not a test.
    """
    import database

    client = _logged_in("hyrox-route@example.com")
    user = database.get_user_by_email("hyrox-route@example.com")

    with database.get_db() as conn:
        conn.executemany(
            "INSERT INTO hyrox_results (user_id, gender, category, format, total_seconds) "
            "VALUES (?, 'men', 'open', 'singles', ?)",
            [(user["id"], 20 * 60), (user["id"], 58 * 60)],
        )

    res = client.get("/api/hyrox/leaderboard?gender=men&category=open&format=singles")
    assert res.status_code == 200
    body = res.get_json()

    board = body["leaderboard"]
    assert board, "the good time must still be on the board"
    assert all(r["best_seconds"] >= 50 * 60 for r in board), (
        "the route must pass the floor into the query, not leave it to the "
        "caller to remember"
    )

    mine = [r for r in board if r["user_id"] == user["id"]]
    assert mine and mine[0]["best_seconds"] == 58 * 60

    # "me" is rendered from the same ranking and must not disagree with it.
    assert body["me"]["best_seconds"] == 58 * 60, (
        "the viewer's own row has to respect the floor too, or the board "
        "says one thing and their own line says another"
    )
