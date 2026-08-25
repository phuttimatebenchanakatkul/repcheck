"""The App Review surface: /privacy, /terms, and the deletion banner.

Apple opens the privacy policy without an account, so /privacy and /terms have
to be reachable logged out -- the whole rest of this app is gated behind
require_login, which makes "public" the unusual case here and exactly the kind
of thing a later tightening of _PUBLIC_ENDPOINTS would silently break. That is
the property this file exists to pin.

The second half pins copy against behaviour, the same tradeoff
test_hyrox_flagged_copy_matches_behavior.py makes: the deletion window is
stated to the user in three places (the settings card, the confirm dialog, and
the privacy policy) and promised to Apple in the App Store listing. All three
have to be rendered from ACCOUNT_DELETION_GRACE_DAYS rather than typed as "30",
or the policy drifts from what the code does and the promise becomes false.
"""

import re
from pathlib import Path

import pytest

import database
from app import app as flask_app

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    flask_app.config["TESTING"] = True
    return database


# ---------- Reachable without an account ----------

@pytest.mark.parametrize("path", ["/privacy", "/terms"])
def test_policy_pages_are_public(db, path):
    """App Store Connect requires a privacy-policy URL App Review can open
    without logging in, and the listing links straight at it."""
    response = flask_app.test_client().get(path)

    assert response.status_code == 200, (
        path + " must render for a logged-out visitor, not redirect to /login"
    )


@pytest.mark.parametrize("path", ["/privacy", "/terms"])
def test_policy_pages_are_listed_as_public_endpoints(db, path):
    """The 200 above would also pass if require_login were removed entirely.
    Pin the actual mechanism: the endpoint is named in _PUBLIC_ENDPOINTS."""
    import app as app_module

    endpoint = path.lstrip("/")

    assert endpoint in app_module._PUBLIC_ENDPOINTS


def test_a_gated_page_still_redirects_logged_out(db):
    """Control for the two tests above -- proves the app is still gated, so
    their 200s mean something."""
    response = flask_app.test_client().get("/settings")

    assert response.status_code == 302
    assert "/login" in response.headers["Location"]


def test_privacy_states_the_real_deletion_window(db):
    html = flask_app.test_client().get("/privacy").get_data(as_text=True)

    assert str(database.ACCOUNT_DELETION_GRACE_DAYS) + " days" in html
    assert "/settings" in html or "Settings" in html


# ---------- The banner ----------

def _logged_in_client(user_id):
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return client


def test_banner_is_absent_for_a_normal_account(db):
    user_id = database.create_local_user("normal@example.com", "irrelevant-password", "Normal")

    html = _logged_in_client(user_id).get("/settings").get_data(as_text=True)

    assert "deletion-banner" not in html, (
        "the overwhelmingly common case is an account that never asked to be "
        "deleted -- it must not carry this banner"
    )


def test_banner_appears_with_the_due_date_once_scheduled(db):
    user_id = database.create_local_user("leaving@example.com", "irrelevant-password", "Leaving")
    database.schedule_account_deletion(user_id)
    due = database.account_deletion_due_at(database.get_user_by_id(user_id)["deleted_at"])

    html = _logged_in_client(user_id).get("/settings").get_data(as_text=True)

    assert "deletion-banner" in html
    assert due in html, "the banner must name the date the data actually goes"


def test_settings_renders_the_delete_card_with_the_real_window(db):
    user_id = database.create_local_user("settings@example.com", "irrelevant-password", "Settings")

    html = _logged_in_client(user_id).get("/settings").get_data(as_text=True)

    assert 'id="delete-account"' in html, (
        "Apple Guideline 5.1.1(v) requires account deletion to be reachable "
        "from inside the app"
    )
    assert 'data-grace-days="' + str(database.ACCOUNT_DELETION_GRACE_DAYS) + '"' in html


# ---------- Copy pinned to behaviour ----------

def test_deletion_copy_is_never_hardcoded_to_a_number():
    """Every user-facing statement of the window has to interpolate, not
    hardcode. A literal "30 days" in these files is a promise that stops
    tracking the constant the moment anyone changes it."""
    offenders = []
    for relative in ("templates/privacy.html", "templates/settings.html", "static/i18n.js"):
        text = (ROOT / relative).read_text(encoding="utf-8")
        # Strip comments before scanning: the explanatory comments in these
        # files legitimately mention the number when describing the rule.
        stripped = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
        stripped = re.sub(r"^\s*//.*$", "", stripped, flags=re.MULTILINE)
        stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.DOTALL)
        if re.search(r"\b30\s*(days|วัน)\b", stripped):
            offenders.append(relative)

    assert offenders == [], (
        "hardcoded deletion window in: " + repr(offenders)
        + " -- render it from ACCOUNT_DELETION_GRACE_DAYS / {days} instead"
    )


def test_both_dictionaries_carry_every_deletion_string():
    """t() falls back to the raw key when a translation is missing, which
    would put "settings.danger.body" on screen as literal text. The general
    parity test covers the dictionaries as a whole; this pins the specific
    keys this feature introduced."""
    i18n = (ROOT / "static/i18n.js").read_text(encoding="utf-8")
    required = (
        "settings.danger.title",
        "settings.danger.body",
        "settings.danger.what",
        "settings.danger.button",
        "settings.danger.confirmPrompt",
        "settings.danger.scheduled",
        "settings.danger.restore",
        "settings.danger.restored",
        "settings.danger.error",
        "settings.legal.privacy",
        "settings.legal.terms",
        "banner.deletion.text",
        "banner.deletion.action",
    )

    missing = [key for key in required if i18n.count('"' + key + '"') < 2]

    assert missing == [], (
        "these keys are missing from one of the two dictionaries: " + repr(missing)
    )


def test_delete_card_js_writes_through_textcontent():
    """RepCheckI18n.t() does not escape its vars (see CLAUDE.md), and the due
    date on this card comes back off the wire. textContent is what makes that
    safe -- an innerHTML "simplification" here would reintroduce a sink."""
    settings = (ROOT / "templates/settings.html").read_text(encoding="utf-8")
    card_js = settings.split("// ---------- Delete account ----------", 1)[1]

    assert "innerHTML" not in card_js, "the delete-account card must not build HTML by string"
    assert "textContent = t(" in card_js
