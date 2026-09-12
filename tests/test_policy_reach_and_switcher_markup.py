"""Two joins the legal pass created that nothing else looks at.

1. THE POLICY PAGES REACHED FROM INSIDE THE APP. Every existing test opens
   /cookies and /refunds with a logged-OUT client, because "public" is the
   unusual property worth pinning. But Settings -> Legal now links both, and a
   logged-in request renders a different base.html: the nav, the tab bar, the
   i18n bootstrap and current_user all come into play. A template that renders
   for an anonymous visitor and 500s for a signed-in one would pass the whole
   suite -- and the signed-in path is the one every actual user takes.

2. THE FEATURE SWITCHER'S MARKUP. marketing/app.js's showFeature() now writes
   aria-pressed, and tests-js/marketingFeatureSwitcher.test.js covers that
   behaviour. Two things live in the HTML instead, where that test cannot see
   them:

   * The initial state. showFeature(0) runs at load, so the attributes are
     correct a tick later -- but only if app.js runs at all. With the script
     blocked or still loading, the markup itself has to say which feature is
     showing, which is why index.html ships aria-pressed on all six buttons.

   * The count. showFeature indexes TAB_FOR_FEATURE by feature number. A
     seventh button would read undefined, and `tabs.toggle("is-active",
     n === undefined)` quietly un-highlights every tab in the handset.
"""

import re
from pathlib import Path

import pytest

import database
from app import app as flask_app

ROOT = Path(__file__).resolve().parent.parent
MARKETING = ROOT / "marketing"

NEW_POLICY_PATHS = ["/cookies", "/refunds"]


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    flask_app.config["TESTING"] = True
    return database


# ---------- 1. Reached from Settings, with an account ----------

@pytest.mark.parametrize("path", NEW_POLICY_PATHS)
def test_the_new_policy_pages_also_render_for_a_signed_in_user(db, path):
    """Settings -> Legal is the in-app route to these, so this is the request
    a real user makes. It renders the full base.html shell, not the bare page
    a logged-out visitor gets."""
    user_id = database.create_local_user("reader@example.com", "irrelevant-password", "Reader")
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id

    response = client.get(path)

    assert response.status_code == 200, (
        path + " renders for a logged-out visitor but not for a signed-in "
        "one, which is the only way anyone reaches it from inside the app"
    )
    html = response.get_data(as_text=True)
    # The display name, and ONLY the display name. The first cut of this was
    # `"Reader" in html or "nav" in html.lower()`, and the logged-OUT render
    # of these pages already contains "nav" -- so the or-branch was always
    # satisfied and the assertion proved nothing. Measured: of the shell
    # markers on this page (tabbar, sidebar, brand-logo, quick-actions,
    # REPCHECK_LOGGED_IN) the name is the only one that differs between the
    # two renders.
    assert "Reader" in html, (
        path + " rendered without the signed-in shell -- the account's display "
        "name is absent, so this is the logged-out page"
    )
    anonymous = flask_app.test_client().get(path).get_data(as_text=True)
    assert "Reader" not in anonymous, (
        "control failed: the display name appears on the LOGGED-OUT render of "
        + path + ", so the assertion above cannot distinguish the two shells"
    )


# (What /cookies renders INTO that shell -- the config values and the
# conditional Secure mention -- is covered by test_legal_policy_integrity.py.
# Those assertions are locale- and auth-independent, so repeating them on the
# signed-in path would only re-test Jinja.)


def test_the_login_consent_notice_links_the_binding_policies(db):
    """test_legal_policy_integrity.py pins this for /signup only, but the same
    notice sits on /login -- and it is the busier of the two screens, since
    it is where every gated route bounces an unauthenticated visitor to. Its
    links have to resolve with no account, which is the reason /terms and
    /privacy are in _PUBLIC_ENDPOINTS at all.
    """
    html = flask_app.test_client().get("/login").get_data(as_text=True)

    assert 'class="auth-consent"' in html, (
        "/login has lost its consent notice -- the Terms/Privacy line is what "
        "makes 'By continuing you agree' an informed agreement"
    )
    for target in ('href="/terms"', 'href="/privacy"'):
        assert target in html, "/login's consent notice must carry " + target
    assert "agree" in html.lower()


# ---------- 2. The switcher's static markup ----------

def _feature_buttons():
    html = (MARKETING / "index.html").read_text(encoding="utf-8")
    section = re.search(r'<section[^>]*class="[^"]*\bwhat\b[^"]*"(.*?)</section>', html, re.DOTALL)
    assert section, "the .what section is gone from marketing/index.html"
    return re.findall(r'<button\b[^>]*class="feature[^"]*"[^>]*>', section.group(1))


def test_the_switcher_says_which_feature_is_showing_before_the_script_runs():
    """showFeature(0) fixes this up at load, so the attribute is only missing
    for the window before app.js executes -- or forever, if it is blocked. A
    switcher with no pressed state is six buttons and no answer."""
    buttons = _feature_buttons()
    assert buttons, "no .feature buttons found in the .what section"

    without = [b for b in buttons if "aria-pressed=" not in b]
    assert without == [], (
        "these feature buttons ship with no aria-pressed: " + repr(without)
    )

    pressed = [b for b in buttons if 'aria-pressed="true"' in b]
    assert len(pressed) == 1, (
        "exactly one feature must start pressed (showFeature(0) is what runs "
        "on load), found " + str(len(pressed))
    )
    assert "is-active" in pressed[0], (
        "the pressed button and the is-active button must be the same one, or "
        "the visual state and the announced state disagree before any click"
    )


def test_there_are_exactly_as_many_features_as_the_script_has_tabs_for():
    """showFeature(i) does tabs.toggle("is-active", n === TAB_FOR_FEATURE[i]).
    A button with no entry reads undefined, which matches no tab and leaves
    the handset's tab bar with nothing highlighted."""
    js = (MARKETING / "app.js").read_text(encoding="utf-8")

    mapping = re.search(r"var TAB_FOR_FEATURE\s*=\s*\[([^\]]*)\]", js)
    assert mapping, "TAB_FOR_FEATURE is gone from marketing/app.js"

    entries = [n for n in mapping.group(1).split(",") if n.strip()]

    assert len(_feature_buttons()) == len(entries), (
        "marketing/index.html has " + str(len(_feature_buttons()))
        + " feature buttons but TAB_FOR_FEATURE has " + str(len(entries))
        + " entries -- add the tab index for the new feature"
    )
