"""Guards the food-name trust boundary in the nutrition page.

Every food name rendered on this page is attacker-influenced: Gemini
writes them freeform from a photo ("Pad Kra Pao Moo Krob"), the user
types them in Create food, and Open Food Facts supplies them from a
public product database anyone can edit. All of them reach the DOM via
innerHTML on template literals, so an unescaped one renders as live
markup rather than text.

This was confirmed exploitable, not theorized: a logged entry named
'<img src=x onerror="...">' injected a real <img> element into the
Recent scans list and its onerror handler ran on the next page load,
in the browser of whoever opened the sheet. The names are stored
server-side and synced back down, so the payload persists.

The fix escapes at every interpolation site. These tests pin each one,
since the failure is silent -- the page looks fine until a name happens
to contain a bracket.

Two helpers exist and they are not interchangeable:
  escapeHtml() round-trips through textContent, escaping < > and & but
  NOT quotes. Correct for a text node.
  escapeAttr() adds the quote escaping, and is required wherever the
  value lands inside a quoted attribute -- one " there ends the
  attribute and the rest parses as markup.
"""

import re

import pytest

from app import app as flask_app


@pytest.fixture(scope="module")
def nutrition_html():
    with flask_app.test_request_context():
        from flask import render_template

        try:
            return render_template(
                "nutrition.html",
                food_library=[],
                nutrition_goals={},
                weight_unit="lbs",
            )
        except Exception:
            with open("templates/nutrition.html", encoding="utf-8") as f:
                return f.read()


def test_recent_scans_row_escapes_the_food_name(nutrition_html):
    """The confirmed-exploitable site: the Recent scans list."""
    match = re.search(r'af-recent-name">(.*?)</div>', nutrition_html)
    assert match, "could not find the recent-scans name element"
    assert match.group(1) == "${escapeHtml(entry.food)}", (
        "the Recent scans row renders the food name unescaped -- a name "
        'like \'<img src=x onerror="...">\' becomes a live element here'
    )


def test_timeline_entry_escapes_the_food_name(nutrition_html):
    match = re.search(r'nl-entry-name">(.*?)</div>', nutrition_html)
    assert match, "could not find the timeline entry name element"
    assert match.group(1) == "${escapeHtml(entry.food)}", (
        "the timeline row renders the food name unescaped"
    )


def test_ingredient_row_escapes_the_ingredient_name(nutrition_html):
    match = re.search(r'nl-ingredient-name">(.*?)</div>', nutrition_html)
    assert match, "could not find the ingredient name element"
    assert match.group(1) == "${escapeHtml(ing.name)}", (
        "ingredient names come straight from Gemini and must be escaped"
    )


def test_food_search_row_escapes_the_food_name(nutrition_html):
    """Covers custom foods (user-typed) and the library alike."""
    match = re.search(r'nl-food-row-name">(.*?)</span>', nutrition_html)
    assert match, "could not find the food-search row name element"
    assert "escapeHtml(" in match.group(1), (
        "the food-search row renders the name unescaped"
    )


def test_favorite_toggle_attribute_uses_attribute_escaping(nutrition_html):
    """An attribute needs escapeAttr, not escapeHtml.

    escapeHtml leaves " untouched, which is fine in a text node and
    useless here -- the quote would close data-entry-fav-toggle and let
    the rest of the name inject new attributes onto the button.
    """
    match = re.search(r'data-entry-fav-toggle="(.*?)"', nutrition_html)
    assert match, "could not find the favorite-toggle attribute"
    assert match.group(1) == "${escapeAttr(entry.food)}", (
        "the favorite-toggle attribute must use escapeAttr -- escapeHtml "
        "does not escape the quote that would break out of it"
    )


def test_create_food_barcode_attribute_uses_attribute_escaping(nutrition_html):
    """The scanned barcode is attacker-influenced and lands in an attribute.

    /api/lookup-barcode echoes the submitted `barcode` field back verbatim
    in its not_found response (app.py), and that echoed value is what the
    create-food form pre-fills its barcode input with -- so whatever a
    caller POSTs ends up inside value="...". escapeHtml leaves the quote
    that would close that attribute and let the rest inject an event
    handler, so this site needs escapeAttr like the favorite toggle above.
    """
    match = re.search(r'id="af-create-barcode-input"[^>]*value="(.*?)"', nutrition_html)
    assert match, "could not find the create-food barcode input"
    assert match.group(1) == "${escapeAttr(afCreateBarcode)}", (
        "the barcode input renders into an attribute with text-node escaping "
        "-- a barcode containing a quote breaks out of value=\"...\""
    )


def test_escape_attr_helper_escapes_quotes(nutrition_html):
    """The helper itself must actually handle quotes.

    Pins the property the attribute sites depend on, so escapeAttr can't
    later be simplified into an escapeHtml alias without failing here.
    """
    match = re.search(
        r"function escapeAttr\(text\)\s*\{(.*?)\n  \}", nutrition_html, re.DOTALL
    )
    assert match, "escapeAttr() helper is missing"
    body = match.group(1)
    assert "&quot;" in body, "escapeAttr must escape double quotes"
    assert "escapeHtml(" in body, (
        "escapeAttr should build on escapeHtml so it also covers < > and &"
    )
