"""The pre-launch waitlist: /api/waitlist, and the owner's view of it.

The marketing site is a separate static deploy that used to post signups to
a Formspree placeholder URL which had never been filled in -- so every
submission 404'd, fell into the page's catch, and nobody's address was ever
stored. This is the route that replaced it.

What is worth pinning here, in rough order of what would hurt:

  - It actually stores the address. That is the whole point, and the thing
    that was silently untrue before.
  - It is reachable WITHOUT a session. The app is auth-gated by a
    before_request hook; a waitlist that 302s to /login collects nothing.
  - It answers only the two marketing origins, and never with a wildcard.
    A wildcard would let any page on the internet submit through it.
  - It says the same thing for a new address and one already on the list.
    A route that answered differently would let anyone test whether a given
    person had signed up.
  - The owner's pages are 404 for everyone else, including a logged-in
    non-admin -- these are other people's email addresses.
"""

import json

import pytest

import app as app_module
import database
from database import create_local_user, list_waitlist


MARKETING = "https://repcheck-marketing.onrender.com"
OFFICIAL = "https://repcheckofficials.onrender.com"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _join(client, email, origin=MARKETING, source="repcheck-marketing"):
    return client.post(
        "/api/waitlist",
        data=json.dumps({"email": email, "source": source}),
        content_type="application/json",
        headers={"Origin": origin} if origin else {},
    )


def _login(client, user_id):
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


# ---------- it stores the address ----------

def test_a_submitted_address_is_actually_stored(client):
    response = _join(client, "someone@example.com")

    assert response.status_code == 200
    assert response.get_json()["ok"] is True
    assert [row["email"] for row in list_waitlist()] == ["someone@example.com"]


def test_the_address_is_stored_lowercased_and_trimmed(client):
    _join(client, "  Someone@Example.COM  ")

    assert [row["email"] for row in list_waitlist()] == ["someone@example.com"]


def test_the_source_the_page_sends_is_kept(client):
    _join(client, "someone@example.com", source="repcheck-marketing")

    assert list_waitlist()[0]["source"] == "repcheck-marketing"


# ---------- it works for someone with no account ----------

def test_the_route_answers_without_a_session(client):
    """app.py's require_login hook redirects anonymous callers to /login for
    every endpoint not on the public allowlist. Every visitor to the
    marketing site is anonymous, so a 302 here would mean the form collects
    nothing -- the exact failure this route exists to end."""
    response = _join(client, "anonymous@example.com")

    assert response.status_code == 200, (
        "an anonymous POST got %s; the waitlist is for people with no account"
        % response.status_code
    )


# ---------- saying the same thing twice ----------

def test_submitting_the_same_address_twice_is_not_an_error(client):
    first = _join(client, "twice@example.com")
    second = _join(client, "twice@example.com")

    assert first.status_code == second.status_code == 200
    assert len(list_waitlist()) == 1, "the second submission added a duplicate row"


def test_a_known_address_is_not_distinguishable_by_status(client):
    """Whether an address is already held is other people's business. The
    body carries `already` for our own logging, but the status code and the
    ok flag must not differ, or the endpoint becomes a membership oracle."""
    first = _join(client, "known@example.com")
    second = _join(client, "known@example.com")

    assert first.status_code == second.status_code
    assert first.get_json()["ok"] == second.get_json()["ok"] is True


# ---------- rejecting nonsense ----------

@pytest.mark.parametrize("bad", ["", "   ", "not-an-email", "no@dot", "@example.com", "a@b@c.com"])
def test_an_invalid_address_is_rejected_and_stored_nowhere(client, bad):
    response = _join(client, bad)

    assert response.status_code == 400
    assert list_waitlist() == []


def test_an_absurdly_long_address_is_rejected(client):
    response = _join(client, "a" * 300 + "@example.com")

    assert response.status_code == 400
    assert list_waitlist() == []


# ---------- CORS ----------

@pytest.mark.parametrize("origin", [MARKETING, OFFICIAL])
def test_each_marketing_origin_is_allowed_by_name(client, origin):
    response = _join(client, "cors@example.com", origin=origin)

    assert response.headers.get("Access-Control-Allow-Origin") == origin
    # The header varies by request, so a shared cache must not reuse one
    # origin's response for the other.
    assert "Origin" in (response.headers.get("Vary") or "")


def test_no_other_origin_is_allowed(client):
    response = _join(client, "evil@example.com", origin="https://evil.example")

    assert "Access-Control-Allow-Origin" not in response.headers


def test_the_allow_origin_header_is_never_a_wildcard(client):
    for origin in (MARKETING, OFFICIAL, "https://evil.example"):
        response = _join(client, "star@example.com", origin=origin)
        assert response.headers.get("Access-Control-Allow-Origin") != "*"


def test_the_preflight_is_answered(client):
    """A POST carrying Content-Type: application/json is not a CORS simple
    request, so the browser asks first. No OPTIONS answer means the real
    POST is never sent and the form fails without reaching this app."""
    response = client.open(
        "/api/waitlist",
        method="OPTIONS",
        headers={
            "Origin": MARKETING,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )

    assert response.status_code in (200, 204)
    assert response.headers.get("Access-Control-Allow-Origin") == MARKETING
    assert "POST" in (response.headers.get("Access-Control-Allow-Methods") or "")
    assert "Content-Type" in (response.headers.get("Access-Control-Allow-Headers") or "")


# ---------- throttling ----------

def test_one_address_per_person_per_hour_is_plenty_but_a_flood_is_stopped(client):
    limit = app_module.WAITLIST_LIMIT

    for i in range(limit):
        assert _join(client, "flood%d@example.com" % i).status_code == 200

    blocked = _join(client, "flood-over@example.com")

    assert blocked.status_code == 429
    assert blocked.get_json()["error"] == "rate-limited"
    assert len(list_waitlist()) == limit, "a throttled submission was still stored"


def test_a_rejected_address_does_not_spend_the_budget(client):
    """The validity check runs before the throttle, so someone fat-fingering
    their address three times does not lock themselves out of joining."""
    for _ in range(app_module.WAITLIST_LIMIT + 3):
        assert _join(client, "not-an-email").status_code == 400

    assert _join(client, "finally@example.com").status_code == 200


# ---------- the owner's view ----------

def test_the_waitlist_page_is_invisible_to_a_logged_out_visitor(client):
    _join(client, "someone@example.com")

    response = client.get("/admin/waitlist")

    assert response.status_code in (302, 404)
    assert b"someone@example.com" not in response.data


def test_the_waitlist_page_is_404_for_a_logged_in_non_admin(client):
    _join(client, "someone@example.com")
    other = create_local_user("nosy@example.com", "irrelevant-password", "Nosy")
    _login(client, other)

    response = client.get("/admin/waitlist")

    assert response.status_code == 404
    assert b"someone@example.com" not in response.data


def _login_as_admin(client):
    email = sorted(app_module.ADMIN_EMAILS)[0]
    owner_id = create_local_user(email, "irrelevant-password", "Owner")
    _login(client, owner_id)
    return owner_id


def test_the_owner_sees_the_addresses(client):
    _join(client, "someone@example.com")
    _login_as_admin(client)

    response = client.get("/admin/waitlist")

    assert response.status_code == 200
    assert b"someone@example.com" in response.data


def test_the_owner_can_download_a_csv(client):
    _join(client, "someone@example.com")
    _login_as_admin(client)

    response = client.get("/admin/waitlist?format=csv")

    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/csv")
    assert b"someone@example.com" in response.data


def test_the_owner_can_delete_an_address(client):
    """marketing/privacy.html promises erasure on request. If this is not
    possible from the app, that promise is not one anybody can keep."""
    _join(client, "forgetme@example.com")
    _login_as_admin(client)

    client.post("/admin/waitlist/delete", data={"email": "forgetme@example.com"})

    assert list_waitlist() == []


def test_a_non_admin_cannot_delete_an_address(client):
    _join(client, "someone@example.com")
    other = create_local_user("nosy@example.com", "irrelevant-password", "Nosy")
    _login(client, other)

    response = client.post("/admin/waitlist/delete", data={"email": "someone@example.com"})

    assert response.status_code == 404
    assert len(list_waitlist()) == 1
