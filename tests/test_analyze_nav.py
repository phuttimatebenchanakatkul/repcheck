"""The Analyze nav must always open the upload form.

For a while one hardcoded account had its Analyze nav point at
/analyze/latest instead, so tapping Analyze landed on the previous
result and starting a new one meant navigating back out of it. That was
removed at the account owner's request.

It is worth a test rather than trusting the deletion, because the thing
that made it hard to spot is still true: the behaviour only appeared for
a single email address, so every other account -- and every casual check
-- looked correct. A per-account branch that silently changes the primary
action is exactly the kind of thing that gets reintroduced.
"""

import re

import pytest

import app as app_module
from database import save_analyze_result


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _analyze_hrefs(html):
    """Every href on an element whose label/aria-label mentions Analyze."""
    return re.findall(r'href="([^"]*)"[^>]*aria-label="Analyze"', html)


def test_no_hardcoded_account_branch_remains():
    """The mechanism itself, not just its effect.

    Guards against the branch coming back under a different name: nothing
    in the routing layer should key navigation off a specific address.
    """
    src = open(app_module.__file__, encoding="utf-8").read()
    assert "ANALYZE_LATEST_REDIRECT_EMAIL" not in src, (
        "the per-account Analyze redirect is back"
    )
    assert "inject_analyze_nav_href" not in src, (
        "the context processor that chose between upload and latest is back"
    )


def test_templates_do_not_route_analyze_through_a_variable():
    """Templates should link the upload page directly.

    The old indirection existed only to let one account get a different
    destination. If a template goes back to a variable href, the choice is
    being made somewhere again.
    """
    for name in ("templates/base.html", "templates/home.html"):
        html = open(name, encoding="utf-8").read()
        assert "analyze_nav_href" not in html, f"{name}: nav href is indirected again"


def _users_with_a_stored_result():
    """Accounts that actually satisfy the old branch's conditions.

    The removed redirect needed BOTH a specific email AND an existing
    analysis row. Testing an arbitrary user id therefore proves nothing --
    the first version of this test used user 1 and passed happily against
    the very code it was meant to catch. Checking every account that has a
    stored result covers whichever one the branch was keyed to, without
    naming the address here.
    """
    import sqlite3

    con = sqlite3.connect("repcheck.db")
    try:
        rows = con.execute(
            "SELECT DISTINCT user_id FROM analyze_results"
        ).fetchall()
    finally:
        con.close()
    return [r[0] for r in rows]


def test_analyze_nav_points_at_upload_even_with_a_stored_result(client):
    """The regression case: accounts WITH a saved analysis still get upload."""
    user_ids = _users_with_a_stored_result()
    if not user_ids:
        pytest.skip("no stored analyses in this database to exercise the branch")

    for user_id in user_ids:
        with client.session_transaction() as sess:
            sess["user_id"] = user_id

        html = client.get("/analyze").get_data(as_text=True)
        hrefs = _analyze_hrefs(html)
        assert hrefs, f"user {user_id}: no Analyze nav link found"
        for href in hrefs:
            assert not href.endswith("/analyze/latest"), (
                f"user {user_id}: Analyze nav points at {href}. Tapping "
                "Analyze must open the upload form, not the previous result."
            )


def test_analyze_latest_still_works_as_a_deep_link(client):
    """Removing it from the nav must not break the URL itself.

    With no stored result it redirects to the upload page rather than
    erroring, which is what makes it safe to keep around.
    """
    resp = client.get("/analyze/latest")
    assert resp.status_code in (200, 302)
