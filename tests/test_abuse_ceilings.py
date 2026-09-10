"""What one caller can spend of somebody else's disk, bill and patience.

Two findings, both measured against a running instance rather than reasoned
about, and both fixed here:

1. The login and signup throttles were keyed on an address the CALLER chose.
   _client_ip() read the left-most X-Forwarded-For entry, which is the entry
   a client writes. Sending a different one per request handed the caller a
   fresh bucket every time: 20 of 20 signups and 25 of 25 wrong passwords
   went straight through. So the throttles added the day before were, in
   production, no throttle at all.

2. Nothing bounded what one account could store. A single /api/sync key
   accepted a 50 MB value (the database file grew to 55 MB from that one
   request, and the endpoint allows ~22 keys), and 200 custom foods were
   created in a loop with nothing refusing.
"""

import io
import json
import re
from pathlib import Path

import pytest

import app as app_module
import database

ROOT = Path(__file__).resolve().parent.parent


def _read(rel):
    return io.open(ROOT / rel, encoding="utf-8").read()


def _client(email):
    """A logged-in test client. Reuses the account if it already exists --
    the email column is UNIQUE and these tests share a database."""
    existing = database.get_user_by_email(email)
    user_id = existing["id"] if existing else database.create_local_user(
        email, "irrelevant-password", "Ceiling Tester"
    )
    app_module.app.config["TESTING"] = True
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client, user_id


# --------------------------------------------------------------------------
# 1. The throttle key must be one the caller cannot choose
# --------------------------------------------------------------------------

def test_the_client_address_never_comes_from_the_request_header():
    """Regression: reading X-Forwarded-For directly defeated both throttles.

    The header is caller-controlled. Behind Render, ProxyFix has already
    resolved remote_addr from the RIGHT-most entry -- the one Render itself
    appended -- and locally there is no proxy, so remote_addr is the socket
    address. Either way it is not something the caller can pick.
    """
    src = _read("auth.py")
    body = re.search(r"def _client_ip\(\):(.*?)\ndef ", src, re.S)
    assert body, "_client_ip must exist"

    # The literal call, not the word: the docstring below _client_ip
    # explains this history and legitimately names the header.
    assert 'request.headers.get("X-Forwarded-For"' not in body.group(1), (
        "_client_ip must not read X-Forwarded-For itself -- that header is "
        "written by the caller, so keying a throttle on it lets anyone mint "
        "a fresh bucket per request. Let ProxyFix resolve remote_addr."
    )
    assert "request.remote_addr" in body.group(1), (
        "_client_ip should use remote_addr, which ProxyFix corrects in "
        "production"
    )


def test_proxyfix_resolves_the_client_address_in_production():
    """Regression: ProxyFix ran with x_proto/x_host but not x_for.

    Without x_for, remote_addr stays Render's edge address, every caller
    shares one throttle bucket, and _client_ip has nothing trustworthy to
    read -- which is why it reached for the raw header in the first place.
    """
    src = _read("app.py")
    call = re.search(r"ProxyFix\(app\.wsgi_app[^)]*\)", src)
    assert call, "ProxyFix must be applied"
    assert "x_for=1" in call.group(0), (
        "ProxyFix needs x_for=1 or request.remote_addr is the proxy, not the "
        f"caller. Got: {call.group(0)}"
    )
    # Still gated on RENDER: trusting these headers without a proxy in front
    # would hand the spoofing hole straight back.
    assert re.search(r'if os\.environ\.get\("RENDER"\):\s*\n\s*app\.wsgi_app = ProxyFix', src), (
        "ProxyFix must stay gated on RENDER -- off Render there is no proxy "
        "overwriting these headers, so trusting them would be the same bug"
    )


# --------------------------------------------------------------------------
# 2. Ceilings on what one account can store
# --------------------------------------------------------------------------

def test_a_sync_value_that_is_too_large_is_refused():
    """Regression: a single key accepted 50 MB, ~1 GB across the key list."""
    client, _ = _client("sync-ceiling@example.com")

    oversized = "A" * (app_module.MAX_SYNC_VALUE_BYTES + 1024)
    res = client.put(
        "/api/sync/repcheck_split_plan_v1",
        data=json.dumps({"value": oversized}),
        content_type="application/json",
    )
    assert res.status_code == 413, (
        "an oversized sync value must be refused before it is stored; "
        "MAX_CONTENT_LENGTH is no help because it is 300 MB for video upload"
    )


def test_a_normal_sized_sync_value_still_works():
    """The ceiling must not break the thing it is protecting."""
    client, user_id = _client("sync-ceiling@example.com")

    plan = {"days": [{"label": "Push", "exercises": ["Bench Press", "Dip"]}]}
    res = client.put(
        "/api/sync/repcheck_split_plan_v1",
        data=json.dumps({"value": plan}),
        content_type="application/json",
    )
    assert res.status_code == 200
    assert database.get_all_user_data(user_id)["repcheck_split_plan_v1"] == plan


@pytest.mark.parametrize("table", sorted(app_module.PER_USER_LIMITS))
def test_every_capped_table_is_actually_countable(table):
    """A ceiling that cannot count its table is a ceiling that never fires."""
    client, user_id = _client("count-ceiling@example.com")
    # Raises ValueError for a table missing from the whitelist.
    assert database.count_user_rows(table, user_id) >= 0


def test_the_custom_food_ceiling_refuses_the_row_past_the_limit():
    """Regression: 200 created in a loop with nothing refusing.

    Seeded to the boundary rather than making 500 requests -- the assertion
    is about the edge, not about throughput.
    """
    client, user_id = _client("food-ceiling@example.com")
    limit = app_module.PER_USER_LIMITS["custom_foods"]

    with database.get_db() as conn:
        conn.executemany(
            "INSERT INTO custom_foods (user_id, name, emoji, calories, protein, fat, carbs) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(user_id, f"Seed {i}", "🍎", 100, 5, 2, 10) for i in range(limit - 1)],
        )

    def create(name):
        return client.post(
            "/api/custom-foods",
            data=json.dumps({
                "name": name, "emoji": "🍎",
                "calories": 100, "protein": 5, "fat": 2, "carbs": 10,
            }),
            content_type="application/json",
        )

    assert create("At the limit").status_code == 200, (
        "the row that reaches the limit must still be allowed"
    )
    assert create("Past the limit").status_code == 429, (
        "the row past the limit must be refused"
    )
    assert database.count_user_rows("custom_foods", user_id) == limit


# --------------------------------------------------------------------------
# 3. A progress photo has to be a photo, and a reasonable one
# --------------------------------------------------------------------------

def _jpeg_bytes(width=800, height=1000):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (width, height), (90, 120, 200)).save(buf, "JPEG", quality=85)
    return buf.getvalue()


def _post_photo(client, data, filename="p.jpg"):
    import datetime

    return client.post(
        "/api/checkin/photo",
        data={
            "photo": (io.BytesIO(data), filename),
            "date": datetime.date.today().isoformat(),
            "angle": "front",
        },
        content_type="multipart/form-data",
    )


def test_an_oversized_photo_is_refused():
    """Regression: a 100 MB file named .jpg was accepted and written to disk.

    The extension whitelist was the only gate, and MAX_CONTENT_LENGTH is no
    help -- it is 300 MB because video upload needs it to be. At 500 photos
    per account that was 150 GB of someone else's disk.
    """
    client, _ = _client("photo-size@example.com")

    oversized = b"\xff\xd8\xff\xe0" + b"A" * (app_module.MAX_PHOTO_BYTES + 1024)
    assert _post_photo(client, oversized).status_code == 413


def test_a_file_that_is_not_an_image_is_refused():
    """Regression: the endpoint doubled as storage for arbitrary bytes.

    Checking the extension says nothing about the content -- the extension
    is just the end of a filename the caller chose.
    """
    client, _ = _client("photo-content@example.com")

    assert _post_photo(client, b"this is not an image" * 100).status_code == 400


def test_a_real_photo_still_uploads():
    """The guard must not break the feature it is protecting."""
    client, user_id = _client("photo-ok@example.com")

    before = database.count_user_rows("progress_photos", user_id)
    assert _post_photo(client, _jpeg_bytes()).status_code == 200
    assert database.count_user_rows("progress_photos", user_id) == before + 1


def test_a_valid_image_in_a_format_we_do_not_accept_is_refused():
    """The format whitelist, specifically.

    Unparseable bytes already fail at verify(). This covers the other case:
    a genuine, decodable image whose format is not one we serve back --
    named .jpg, because the extension is chosen by the caller and proves
    nothing about the content.
    """
    from PIL import Image

    client, _ = _client("photo-format@example.com")

    buf = io.BytesIO()
    Image.new("RGB", (40, 40), (10, 200, 10)).save(buf, "BMP")
    res = _post_photo(client, buf.getvalue(), filename="looks-like.jpg")

    assert res.status_code == 400, (
        "a real BMP renamed .jpg parses fine, so only the format check can "
        "stop it"
    )


# --------------------------------------------------------------------------
# 4. Friend codes are guessable in bulk unless something counts the misses
# --------------------------------------------------------------------------

def test_wrong_friend_codes_are_throttled():
    """Regression: 60 of 60 wrong codes answered, ~6/s from one host.

    "RC-" plus 6 hex characters is 16,777,216 codes -- fine against guessing
    at one person's, days rather than centuries against walking the space.
    A hit is not harmless: add_friendship() is mutual and asks nobody, so it
    puts the guesser in a stranger's friends list and vice versa.
    """
    client, _ = _client("friend-guesser@example.com")

    codes = [f"RC-{i:06X}" for i in range(app_module.FRIEND_CODE_LOOKUP_LIMIT + 5)]
    statuses = [
        client.post(
            "/api/friends/add",
            data=json.dumps({"code": c}),
            content_type="application/json",
        ).status_code
        for c in codes
    ]

    assert statuses.count(404) == app_module.FRIEND_CODE_LOOKUP_LIMIT, (
        "misses up to the limit should answer normally"
    )
    assert statuses[-1] == 429, "past the limit the lookup must be refused"


def test_a_valid_friend_code_is_not_spent_from_the_guess_budget():
    """Only misses count, so ordinary use never trips the limit."""
    owner_client, owner_id = _client("friend-owner@example.com")
    code = database.get_or_create_friend_code(owner_id)

    adder_client, _ = _client("friend-adder@example.com")
    for _ in range(3):
        res = adder_client.post(
            "/api/friends/add",
            data=json.dumps({"code": code}),
            content_type="application/json",
        )
        assert res.status_code == 200, "a real code must keep working"


# --------------------------------------------------------------------------
# 5. "Invalid date." should mean the date is invalid
# --------------------------------------------------------------------------

def _log_weight(client, date_iso):
    return client.post(
        "/api/weight/log-entry",
        data=json.dumps({"date": date_iso, "entry": {"kg": 80}}),
        content_type="application/json",
    )


@pytest.mark.parametrize("bad", ["9999-99-99", "0000-00-00", "2026-02-31", "2025-13-01"])
def test_a_date_that_does_not_exist_is_refused(bad):
    """Regression: the check was ^\d{4}-\d{2}-\d{2}$ and nothing more.

    All four of these were measured getting a 200 and being stored as keys
    in the user's own log, under an error message that says "Invalid date."
    """
    client, _ = _client("date-bad@example.com")
    assert _log_weight(client, bad).status_code == 400


def test_a_real_date_still_logs():
    client, _ = _client("date-good@example.com")
    assert _log_weight(client, "2026-02-28").status_code == 200


def test_logging_a_day_ahead_is_still_allowed():
    """Not bounded to today, deliberately.

    The day strip in the nutrition and workout UIs lets you tap forward and
    log ahead. Only the check-in photo's date is bounded, because that one
    feeds the streak's back-fill and a forged date there invents history.
    """
    import datetime

    client, _ = _client("date-ahead@example.com")
    ahead = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
    assert _log_weight(client, ahead).status_code == 200
