"""Home's lead card is the AI form check, and it stays wired to it.

The hero used to be a "today's plan" card (date, streak flame, week
activity dots, "See today's plan"). It was replaced wholesale by an
"Analyze a workout" card whose one job is to open /analyze and name the
last analysis. Two things about that are worth pinning:

* the CTA's destination. It is a plain server-rendered link, so a wrong
  url_for is a silently wrong tap target with no JS error anywhere --
  the same failure mode test_analyze_nav.py already guards for the nav.
* the escaping of the exercise label. It comes from an account's own
  custom exercises (POST /api/custom-exercises trims and length-caps the
  name and nothing else) and lands in innerHTML through a template
  literal, exactly like the sinks tests/test_cross_user_name_escaping.py
  covers.

Source-level assertions against the real template for the escaping (the
row is built by hand-rolled inline JS with no module boundary to import),
plus a real render for the parts the server actually emits.
"""

import re
from pathlib import Path

import pytest

import database
from app import app as flask_app

ROOT = Path(__file__).resolve().parent.parent
HOME = (ROOT / "templates" / "home.html").read_text(encoding="utf-8")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    user_id = database.create_local_user(
        "home-hero@example.com", "irrelevant-password", "Home Hero Tester"
    )
    # A brand-new account is bounced to the onboarding wizard from every
    # page, home included (see app.home) -- so / would be a redirect, not
    # the hero.
    database.mark_onboarding_completed(user_id)
    flask_app.config["TESTING"] = True
    test_client = flask_app.test_client()
    with test_client.session_transaction() as session:
        session["user_id"] = user_id
    return test_client


def test_hero_cta_opens_the_analyze_page(client):
    html = client.get("/").get_data(as_text=True)
    hero = html[html.index('class="hm-hero"') : html.index('id="hm-checkin-banner"')]
    assert re.search(r'class="hm-hero-cta" href="/analyze"', hero), (
        "the hero's call to action must link straight to the Analyze upload page"
    )
    assert 'data-i18n="home.analyze.title"' in hero, "the hero must carry the analyze copy"


def test_hero_no_longer_shows_the_replaced_plan_card(client):
    """The old card is gone from the page, not just visually restyled."""
    html = client.get("/").get_data(as_text=True)
    hero = html[html.index('class="hm-hero"') : html.index('id="hm-checkin-banner"')]
    for gone in ("hm-hero-week", "hm-streak-chip", "hm-hero-date"):
        assert gone not in hero, f"{gone} is back in the home hero"


def test_last_analysis_row_escapes_the_exercise_label():
    # Both branches interpolate a label: the server-history one (an
    # analysis stored for this account) and the local-log fallback.
    assert "${escapeHtml(entry.exercise_label)}" in HOME, (
        "the server-history row must escape the exercise label"
    )
    assert "${escapeHtml(local.exercise)}" in HOME, (
        "the local-log fallback row must escape the exercise name"
    )
    assert "${entry.exercise_label}" not in HOME, "found a raw ${entry.exercise_label}"
    assert "${local.exercise}" not in HOME, "found a raw ${local.exercise}"


def test_home_defines_the_escaper_it_uses():
    # home.html is its own script scope with no shared import, so the
    # helper has to exist locally or the call is a ReferenceError that
    # only fires once someone opens the page with an analysis stored.
    assert "function escapeHtml(" in HOME, "home.html calls escapeHtml but never defines it"
    block = HOME[HOME.index("function escapeHtml(") :]
    assert "textContent" in block[:400], (
        "home.html's escapeHtml must round-trip via textContent, the codebase's idiom"
    )
