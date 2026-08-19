"""Pins the /api/scan-barcode response fields the live camera scanner needs
to tell its three outcomes apart.

Safari ships no BarcodeDetector at any version, so on an iPhone the barcode
button used to fall back to a single still photo: one shot, and if its focus,
angle or glare was off there was no retry. Safari does support getUserMedia
on HTTPS though, so nutrition.html now streams the camera and posts frames to
this endpoint until one reads (runServerBarcodeLoop).

That loop has to distinguish:

  * this frame had no readable barcode      -> keep scanning
  * read it, but nothing sells it           -> offer "create this food"
  * read it, but the lookup itself failed   -> stop and show the error

The first and third are both HTTP 502 with ok=false, and telling them apart
is exactly what "barcode" being present in the body is for. Without it a
transient Open Food Facts outage is indistinguishable from a miss, and the
camera loops forever over a code it had already read -- the same "scanning
never works" symptom from the other side.
"""

import io

import pytest
from PIL import Image

import app as app_module
import barcode_scanner
import database
from app import app as flask_app
from barcode_scanner import BarcodeScanError, ProductNotFoundError


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-live-scan.db")
    database.init_db()
    user_id = database.create_local_user(
        "live-scan@example.com", "irrelevant-password", "Live Scan Tester"
    )
    flask_app.config["TESTING"] = True
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client


def _frame():
    buf = io.BytesIO()
    Image.new("RGB", (32, 24), (255, 255, 255)).save(buf, format="JPEG")
    buf.seek(0)
    return buf


def _post(client, **extra):
    data = {"image": (_frame(), "frame.jpg")}
    data.update(extra)
    return client.post("/api/scan-barcode", data=data, content_type="multipart/form-data")


def test_undecodable_frame_carries_no_barcode(tmp_path, monkeypatch):
    """The keep-scanning case: nothing was read, so there is no barcode to
    report and the loop should move on to the next frame."""
    client = _client(tmp_path, monkeypatch)
    monkeypatch.setattr(app_module, "decode_barcode", lambda *a, **k: (_ for _ in ()).throw(
        BarcodeScanError("No barcode found in that photo.")
    ))

    response = _post(client, live="1")
    body = response.get_json()
    assert response.status_code == 502
    assert body["ok"] is False
    assert "barcode" not in body


def test_failed_lookup_still_reports_the_barcode_it_read(tmp_path, monkeypatch):
    """The stop-and-show case. The read succeeded and only the lookup behind
    it failed, so the barcode comes back with the error -- otherwise the
    live scanner cannot tell this from a miss and never stops."""
    client = _client(tmp_path, monkeypatch)
    monkeypatch.setattr(app_module, "decode_barcode", lambda *a, **k: "8850132042278")
    monkeypatch.setattr(app_module, "_resolve_barcode", lambda *a, **k: (_ for _ in ()).throw(
        BarcodeScanError("Couldn't reach the product database. Please try again.")
    ))

    response = _post(client, live="1")
    body = response.get_json()
    assert response.status_code == 502
    assert body["ok"] is False
    assert body["barcode"] == "8850132042278"


def test_unknown_product_is_not_an_error_and_offers_the_barcode(tmp_path, monkeypatch):
    """The create-this-food case: a 200 (not a 502) carrying not_found plus
    the barcode, which the loop hands to the create form."""
    client = _client(tmp_path, monkeypatch)
    monkeypatch.setattr(app_module, "decode_barcode", lambda *a, **k: "8850132042278")
    monkeypatch.setattr(app_module, "_resolve_barcode", lambda *a, **k: (_ for _ in ()).throw(
        ProductNotFoundError("No product found for barcode 8850132042278.")
    ))

    response = _post(client, live="1")
    body = response.get_json()
    assert response.status_code == 200
    assert body["ok"] is False
    assert body["not_found"] is True
    assert body["barcode"] == "8850132042278"
