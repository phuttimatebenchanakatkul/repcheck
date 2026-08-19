"""Pins digit-only barcode normalization at the two HTTP endpoints, not
just inside barcode_scanner.

barcode_scanner.digits_only() is applied by decode_barcode() and
lookup_by_barcode(), and templates/nutrition.html applies the same rule
client-side via sanitizeBarcodeDigits(). But the client is not the only
caller: /api/custom-foods and /api/lookup-barcode accept JSON directly, so
a request that never went through the browser form (curl, a replayed
session, a future UI regression) reached them with only .strip() applied.

Two things break when a dirty value gets through:

  1. Storage. A barcode saved as "012-345" never string-matches the
     "012345" a real scan produces -- get_custom_food_by_barcode() is an
     exact match -- so the saved food silently stops resolving and the user
     is sent back into "create this food yourself" for a product they
     already created. The failure is invisible: nothing errors, the food
     just never comes back.

  2. The duplicate guard. api_create_custom_food() 409s when the user
     already has a food for that barcode, also by exact match, so
     "012345" and "012-345" read as two different products and both get
     stored -- defeating the one-barcode-per-user intent.

Lookup has the same shape: _resolve_barcode() checks the user's own custom
foods BEFORE falling through to lookup_by_barcode(), so normalizing only
inside lookup_by_barcode() is too late -- the fast path already missed.
"""

import app as app_module
import database
from app import app as flask_app


def _client(tmp_path, monkeypatch):
    """A logged-in test client against a throwaway DB."""
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = database.create_local_user(
        "barcode-normalization@example.com", "irrelevant-password", "Barcode Tester"
    )
    flask_app.config["TESTING"] = True
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client, user_id


def test_create_custom_food_stores_the_barcode_digits_only(tmp_path, monkeypatch):
    """A dirty barcode POSTed straight to the API is normalized before it
    hits the DB, so a later real scan of the same product still matches."""
    client, user_id = _client(tmp_path, monkeypatch)

    response = client.post(
        "/api/custom-foods",
        json={"name": "Test Bar", "protein": 10, "fat": 5, "carbs": 20, "barcode": " 885-099 9320007\n"},
    )
    assert response.get_json()["ok"] is True

    # The value a real scan would produce resolves to the food that was
    # just created with the messy one.
    assert database.get_custom_food_by_barcode(user_id, "8850999320007") is not None


def test_create_custom_food_duplicate_check_sees_through_formatting(tmp_path, monkeypatch):
    """The 409 duplicate guard compares normalized values, so the same
    physical product can't be stored twice under two spellings."""
    client, _ = _client(tmp_path, monkeypatch)

    first = client.post(
        "/api/custom-foods",
        json={"name": "Test Bar", "protein": 10, "barcode": "8850999320007"},
    )
    assert first.get_json()["ok"] is True

    second = client.post(
        "/api/custom-foods",
        json={"name": "Same Bar Again", "protein": 10, "barcode": "885-099-9320007"},
    )
    assert second.status_code == 409
    assert second.get_json()["ok"] is False


def test_lookup_barcode_normalizes_before_checking_the_users_own_foods(tmp_path, monkeypatch):
    """_resolve_barcode() checks the user's own custom foods first, by exact
    match, so normalization has to happen before that -- not only inside
    lookup_by_barcode(), which the fast path never reaches."""
    client, user_id = _client(tmp_path, monkeypatch)
    database.create_custom_food(
        user_id, "My Saved Bar", "\U0001F36B", 200, 10, 5, 20, barcode="8850999320007"
    )

    def fail_if_called(barcode):
        raise AssertionError(
            "external lookup should not run -- the user's own food for this "
            f"barcode must resolve first (got {barcode!r})"
        )

    monkeypatch.setattr(app_module, "lookup_by_barcode", fail_if_called)

    response = client.post("/api/lookup-barcode", json={"barcode": " 885-099 9320007 "})
    data = response.get_json()
    assert data["ok"] is True
    assert data["food_name"] == "My Saved Bar"


def test_lookup_barcode_rejects_a_value_with_no_digits(tmp_path, monkeypatch):
    """Pure non-numeric noise strips to empty and is refused up front,
    rather than being passed down as an empty-string barcode."""
    client, _ = _client(tmp_path, monkeypatch)

    response = client.post("/api/lookup-barcode", json={"barcode": "---"})
    assert response.status_code == 400
    assert response.get_json()["ok"] is False
