"""Guards the digit-only sanitization added to barcode_scanner.py's two
barcode-producing/consuming paths.

Retail barcodes (EAN/UPC) are always numeric. Before this change,
decode_barcode() passed pyzbar's raw decoded string straight through, and
lookup_by_barcode() only .strip()ped whitespace -- either one leaves stray
symbology noise or (for lookup_by_barcode, reachable from the client-side
BarcodeDetector path in templates/nutrition.html, which is NOT run through
decode_barcode() first) arbitrary non-digit characters in the value used to
build the Open Food Facts lookup URL and to search FatSecret. A barcode
that fails to match because of one stray character is a silent dead end
for the user (redirected into "create this food yourself" instead of
finding the real product), so both sanitization sites are pinned here.

decode_barcode() needs a real (any) decodable image for Image.open()/
.load() to succeed -- the barcode *content* comes from monkeypatching
pyzbar's decode() (imported into barcode_scanner as zbar_decode), so the
image pixels themselves are irrelevant to what's under test.
"""

import io

import pytest
from PIL import Image

import barcode_scanner
from barcode_scanner import BarcodeScanError, decode_barcode, lookup_by_barcode


def _tiny_png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, format="PNG")
    return buf.getvalue()


class _FakeZbarResult:
    """Stands in for a pyzbar Decoded object: a .type and a .data (bytes,
    matching pyzbar's real API, since decode_barcode calls .decode("utf-8")
    on it)."""

    def __init__(self, data, type_="EAN13"):
        self.data = data.encode("utf-8")
        self.type = type_


def test_decode_barcode_strips_non_digits_and_still_prefers_retail_symbology(monkeypatch):
    """Two things must both hold, together: (1) a camera/photo read can
    pick up whitespace or stray symbology noise around the actual digits,
    which decode_barcode must strip; (2) that stripping must apply AFTER
    the preferred-type selection (EAN13/EAN8/UPCA/UPCE over e.g. a QR code
    incidentally in the same photo), not to whichever result happens to
    come first in pyzbar's output."""
    monkeypatch.setattr(
        barcode_scanner,
        "zbar_decode",
        lambda image: [
            _FakeZbarResult("https://example.com/not-a-barcode", type_="QRCODE"),
            _FakeZbarResult(" 00-111 222\n", type_="EAN13"),
        ],
    )
    result = decode_barcode(_tiny_png_bytes())
    assert result == "00111222"


def test_lookup_by_barcode_strips_non_digits_before_searching(monkeypatch):
    """Covers the client-side BarcodeDetector path: a barcode read straight
    in the browser (never passed through decode_barcode()'s own
    sanitization) reaches lookup_by_barcode() as the sole sanitization
    point. Pins that the value used to actually build the lookup request
    is digits-only, not just .strip()ped."""
    captured = {}

    def fake_lookup_product(barcode):
        captured["barcode"] = barcode
        return {
            "product_name": "Test Product",
            "nutriments": {"energy-kcal_100g": 100, "proteins_100g": 1, "fat_100g": 1, "carbohydrates_100g": 1},
        }

    monkeypatch.setattr(barcode_scanner, "_lookup_product", fake_lookup_product)
    lookup_by_barcode(" 012-345 678901\n")
    assert captured["barcode"] == "012345678901"


def test_lookup_by_barcode_rejects_a_value_with_no_digits_at_all(monkeypatch):
    """A barcode that's entirely non-numeric noise (e.g. a misread that
    yielded pure symbology garbage) strips down to an empty string --
    must raise the same "no barcode value given" error as an actually
    empty input, not silently look up an empty-string barcode."""

    def fail_if_called(barcode):
        raise AssertionError("_lookup_product should not be reached for an empty-after-stripping barcode")

    monkeypatch.setattr(barcode_scanner, "_lookup_product", fail_if_called)
    with pytest.raises(BarcodeScanError, match="No barcode value given"):
        lookup_by_barcode("---")
