"""App Store Guidelines 1.2 and 1.5: can a user reach us, and reach the block?

Both rules are about REACHABILITY, which is why every assertion here is about
a path through the UI rather than about an endpoint existing. All three of the
things this file pins were already built and already worked when it was
written; each was simply unreachable, which under these guidelines is the same
as absent.

1.2 (user-generated content -- display names, shown to every other account on
the global leaderboards) asks for four things: filtering (name_filter.py), a
report mechanism, the ability to block, and published contact information.

1.5 asks that the app AND its Support URL carry an easy way to contact the
developer.

What was wrong, measured before the fix:

* /support had been public and complete the whole time and NOTHING in the app
  linked to it. The only contact address a user could find from inside the app
  was a mailto in the middle of the privacy policy's prose.

* Blocking could only be started from a leaderboard row. /api/friends/add is
  mutual and asks nobody, so whoever has your friend code appears in your
  friends list -- and if they had never posted a challenge or a race time,
  there was no row anywhere in the app to reach them through. Settings lists
  accounts you have already blocked and only offers unblock. So for that user
  there was no way to block them at all.

* The support page told users to use "Forgot password" on the login screen.
  There is no such link, no reset route, and no mail transport anywhere in the
  project -- the one page App Review opens to check support was documenting a
  feature that does not exist (Guideline 2.1).
"""

import io
import re
from pathlib import Path

import pytest

import database
from app import app as flask_app

ROOT = Path(__file__).resolve().parent.parent


def _read(*parts):
    return io.open(ROOT.joinpath(*parts), encoding="utf-8").read()


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    flask_app.config["TESTING"] = True
    return database


# ---------- 1.5 / 1.2: published contact information ----------

def test_support_is_reachable_without_an_account(db):
    """App Review opens the Support URL logged out, like the policy pages."""
    assert flask_app.test_client().get("/support").status_code == 200


def test_the_app_itself_links_to_support(db):
    """1.5 is about the app, not only the store listing's Support URL.

    Settings -> Legal is where the other two legal links already live, so it
    is where a user looks. A mailto buried in the privacy policy's body is not
    "an easy way to contact you".

    Against the RENDERED settings page, not the template source. A source
    grep for url_for('support') still passed with the whole anchor wrapped in
    an HTML comment, and said nothing about whether url_for resolves at all.
    Rendering covers both, plus the data-i18n attribute the Thai label needs.
    """
    user_id = database.create_local_user("legal@example.com", "pw", "Legal")
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id

    page = client.get("/settings").get_data(as_text=True)
    prose = re.sub(r"<!--.*?-->", "", page, flags=re.S)

    assert re.search(r'<a[^>]+href="/support"', prose), (
        "nothing in the app links to /support, so the support page might as "
        "well not exist as far as a user inside the app is concerned"
    )
    assert re.search(r'<a[^>]+href="/support"[^>]+data-i18n="settings\.legal\.support"', prose), (
        "the link needs its data-i18n key or it stays English for a Thai user"
    )


def test_support_carries_a_real_contact_address():
    """A Support URL that names no way to reach anyone fails the point of it."""
    assert "mailto:" in _read("templates", "support.html")


# ---------- 2.1: the support page has to be true ----------

def test_support_does_not_promise_a_password_reset_that_does_not_exist(db):
    """Copy against behaviour, the same tradeoff as
    test_hyrox_flagged_copy_matches_behavior.py.

    Written as an implication rather than a banned phrase so it stays correct
    in both directions: the day a reset flow is actually built, the support
    page is free to describe it and this test keeps passing instead of having
    to be deleted.

    Against the rendered page with its comments stripped, which is what a user
    actually reads. The first version read the template source and failed on
    the comment above the fix -- which explains the very phrase it was banning
    -- and the second still failed, because an HTML comment (unlike a Jinja
    one) is rendered and sent to the client.
    """
    page = flask_app.test_client().get("/support").get_data(as_text=True)
    prose = re.sub(r"<!--.*?-->", "", page, flags=re.S).lower()
    mentions_reset = "forgot password" in prose or "reset your password" in prose

    sources = _read("auth.py") + _read("app.py")
    reset_exists = "password/reset" in sources or "reset_password" in sources

    assert not mentions_reset or reset_exists, (
        "support.html tells users to reset their password, but there is no "
        "reset route in auth.py or app.py. Either build the flow or describe "
        "the recovery path that genuinely works."
    )


def test_the_recovery_path_the_support_page_names_actually_works(db, monkeypatch):
    """It points a locked-out password user at Google sign-in on the same
    address. That only helps if the callback ADOPTS the existing account
    rather than making a second one.

    Behavioural. The first version counted a literal source line twice in
    auth.py, which proves the line exists and nothing else: discard the
    result, reassign `user` underneath it, or drop the _login_session and
    the count is still 2. It would also have broken on a rename or a third
    provider using the same idiom.
    """
    import auth as auth_module

    class _Resp:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    monkeypatch.setattr(auth_module, "GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr(auth_module, "GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setattr(auth_module.requests, "post",
                        lambda *a, **k: _Resp({"access_token": "t"}))
    monkeypatch.setattr(auth_module.requests, "get", lambda *a, **k: _Resp({
        "sub": "g-locked-out", "email": "locked@example.com",
        "email_verified": True, "name": "Locked Out",
    }))

    original = database.create_local_user("locked@example.com", "the-forgotten-one", "Locked Out")

    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["oauth_state"] = "s"
    client.get("/auth/google/callback?code=c&state=s")

    with client.session_transaction() as session:
        assert session["user_id"] == original, (
            "signing in with Google after forgetting the password made a "
            "SECOND account -- the support page tells users this recovers "
            "their history, so it has to be the same row"
        )


# ---------- 1.2: the ability to block, from where it is needed ----------

def test_a_friend_row_offers_report_and_block():
    """The one screen where an unwanted account actually turns up.

    Matches the BUTTON, not the class name. Deleting the button outright left
    the first version of this passing, because `.fr-friend-more` still
    appeared in the stylesheet above it -- a rule for an element that no
    longer existed.
    """
    friends = _read("templates", "friends.html")

    assert re.search(r'<button[^>]*class="fr-friend-more"', friends), (
        "friend rows carry no report/block affordance"
    )
    assert "RepCheckSafety.open" in friends, (
        "the affordance has to open the shared safety sheet (static/safety.js)"
    )


def test_the_friend_row_passes_the_id_the_safety_sheet_needs():
    """A button wired to the wrong field opens a sheet that reports nobody."""
    friends = _read("templates", "friends.html")

    assert 'data-safety-user="${Number(f.id)}"' in friends, (
        "the safety target must be the friend's user id, and /api/friends "
        "returns it as `id`"
    )


def test_blocking_removes_them_from_the_friends_list_both_ways(db):
    """Behavioural, because this is what makes the button worth having.

    There is deliberately no separate unfriend path: a block already has to
    hold everywhere the other account's name would appear, so the friends
    query filters it. If that ever stopped being true, blocking from this
    screen would appear to do nothing at all.
    """
    a = db.create_local_user("blocker@example.com", "pw", "Blocker")
    b = db.create_local_user("blocked@example.com", "pw", "Blocked")
    db.add_friendship(a, b)

    assert [f["id"] for f in db.get_friends(a)] == [b]
    assert [f["id"] for f in db.get_friends(b)] == [a]

    db.block_user(a, b)

    assert db.get_friends(a) == [], "the blocker must stop seeing them"
    assert db.get_friends(b) == [], (
        "and the blocked account must stop seeing the blocker -- a one-way "
        "hide would let them go on watching"
    )


def test_reporting_blocks_in_the_same_step(db):
    """The support page and safety.js both tell the user this happens."""
    reporter = db.create_local_user("reporter@example.com", "pw", "Reporter")
    target = db.create_local_user("target@example.com", "pw", "Target")
    db.add_friendship(reporter, target)

    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = reporter

    res = client.post(
        "/api/safety/report",
        json={"user_id": target, "reason": "offensive_name"},
    )

    assert res.status_code == 200
    assert db.get_friends(reporter) == [], (
        "reporting promises the account is blocked in the meantime; if it is "
        "not, the name the user objected to is still on their screen"
    )


def test_block_copy_matches_where_blocking_now_reaches():
    """The subtitle said "on any leaderboard" while a block also clears the
    friends list -- and now that a friend row is an entry point, that is the
    surface the user is most likely looking at when they read it."""
    i18n = _read("static", "i18n.js")

    stale = "\"safety.blockSub\": \"You won't see them on any leaderboard\""
    current = (
        "\"safety.blockSub\": \"You won't see them on leaderboards or in "
        "your friends list\""
    )

    assert stale not in i18n, (
        "the English block subtitle understates what blocking does"
    )
    assert current in i18n

    # Both locales, because only English was checked at first and reverting
    # the Thai string alone passed. A Thai user reads the old promise.
    thai_stale = "คุณจะไม่เห็นบัญชีนี้บนกระดานอันดับอีก"
    assert thai_stale not in i18n, (
        "the Thai block subtitle still says leaderboards only"
    )
    assert "รายชื่อเพื่อน" in i18n.split('"safety.blockSub"')[2][:200], (
        "the Thai subtitle must name the friends list too"
    )


def test_the_support_page_tells_users_how_to_report_an_account(db):
    """1.2 wants the report mechanism findable, and the support page is where
    someone goes when they don't know what to do about another user.

    Rendered, comments stripped: an HTML comment describing the answer is not
    the answer.
    """
    page = flask_app.test_client().get("/support").get_data(as_text=True)
    prose = re.sub(r"<!--.*?-->", "", page, flags=re.S)

    assert "report" in prose.lower() and "block" in prose.lower(), (
        "the support page says nothing about reporting or blocking an account"
    )
    assert "&#8942;" in prose or "⋮" in prose, (
        "it should name the control the user is looking for, not just the verb"
    )


# ---------- 5.1.2(i): permission before third-party AI, not just disclosure ----------

@pytest.mark.parametrize("path", ["/signup", "/login"])
def test_every_screen_that_can_create_an_account_asks_permission_first(db, path):
    """5.1.2(i) is two obligations, and only one of them was met.

    "You must clearly disclose where personal data will be shared with third
    parties, including with third-party AI, and obtain explicit permission
    before doing so." /privacy carried the disclosure from the start -- and
    was reachable only from Settings, which you need an account to open. So
    a user's food photos, lift videos and check-in photos went to Gemini
    having agreed to nothing.

    Both screens, because /login creates accounts too and that is easy to
    miss: its "Continue with Google" and "Continue with Apple" buttons run
    the same callbacks, which create the user when no match exists. Checking
    only /signup left that route wide open and the test still green.

    Rendered, comments stripped: the explanation above the markup is not the
    notice.
    """
    page = flask_app.test_client().get(path).get_data(as_text=True)
    prose = re.sub(r"<!--.*?-->", "", page, flags=re.S)

    assert "third-party" in prose and "AI providers" in prose, (
        "the signup screen must say the content is processed by third-party "
        "AI -- a Privacy Policy link alone discloses it somewhere else, it "
        "does not ask"
    )
    assert re.search(r'href="/privacy"', prose) and re.search(r'href="/terms"', prose), (
        "and both policies have to be openable from the screen where the "
        "agreement is being made"
    )


def test_the_policies_open_for_someone_who_has_no_account_yet(db):
    """The consent links are worthless if they redirect to /login.

    The whole app is behind require_login, which makes public the unusual
    case here -- exactly the kind of thing a later tightening of
    _PUBLIC_ENDPOINTS breaks silently.
    """
    client = flask_app.test_client()
    for path in ("/privacy", "/terms"):
        assert client.get(path).status_code == 200, f"{path} must open logged out"

