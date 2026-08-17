"""A custom food may be saved with no macros filled in.

/api/custom-foods used to reject a food whose protein, fat and carbs were
all zero. That guard made sense while the only way to reach the form was the
"Log macros" quick entry, where the macros are the entire point. It stopped
making sense once a food could be created deliberately -- scanning a
product's barcode, naming it, setting its serving size -- because the label
is not always to hand at that moment, and refusing the save threw away the
scan over a number the user could have filled in later.

Such a food logs as 0 kcal until its macros are entered, which is an honest
representation of a product nothing is known about yet. The quick "Log
macros" form still requires at least one macro, enforced client-side (see
submitCustomFood in templates/nutrition.html) rather than here, because at
this layer the two forms are indistinguishable -- both are just a POST.
"""

import database
from app import app as flask_app


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-optional-macros.db")
    database.init_db()
    user_id = database.create_local_user(
        "optional-macros@example.com", "irrelevant-password", "Macro Tester"
    )
    flask_app.config["TESTING"] = True
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client, user_id


def test_a_food_with_no_macros_is_accepted(tmp_path, monkeypatch):
    client, user_id = _client(tmp_path, monkeypatch)

    response = client.post(
        "/api/custom-foods",
        json={"name": "Mineral water", "barcode": "8850132042278"},
    )
    body = response.get_json()

    assert body["ok"] is True, body
    assert body["food"]["protein"] == 0
    assert body["food"]["fat"] == 0
    assert body["food"]["carbs"] == 0
    assert body["food"]["calories"] == 0


def test_that_food_is_still_findable_by_its_barcode(tmp_path, monkeypatch):
    """The reason for allowing it: the scan is what the user wanted to keep,
    so the saved food has to resolve when the same code is scanned again."""
    client, user_id = _client(tmp_path, monkeypatch)
    client.post("/api/custom-foods", json={"name": "Mineral water", "barcode": "8850132042278"})

    found = database.get_custom_food_by_barcode(user_id, "8850132042278")
    assert found is not None
    assert found["name"] == "Mineral water"


def test_macros_are_still_stored_when_they_are_given(tmp_path, monkeypatch):
    """Guards against the zero-macro allowance being implemented by ignoring
    the macro fields altogether."""
    client, _ = _client(tmp_path, monkeypatch)

    response = client.post(
        "/api/custom-foods",
        json={"name": "Chicken breast", "protein": 31, "fat": 3.6, "carbs": 0},
    )
    food = response.get_json()["food"]

    assert food["protein"] == 31
    assert food["fat"] == 3.6
    # 31*4 + 3.6*9 = 156.4 -- calories stay derived from the macros server-side
    assert food["calories"] == round(31 * 4 + 3.6 * 9)
