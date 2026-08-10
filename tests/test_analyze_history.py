"""The "View full logs" page: /analyze/history lists every stored form
analysis, and /analyze/history/<id> opens one of them in the full result
view. Linked from a new pill next to the Analyze page's "Recent analyses"
strip -- that strip already renders every entry the API returns (no
client-side slicing in its server-history branch) as a horizontal scroll,
so this page's value is a plain vertical list, not more history than the
strip has.

Covers the two things worth pinning here:
  - Ownership: one user must never be able to open another user's analysis
    by guessing an id, whether via the list or the detail page.
  - The list never shows more than ANALYZE_HISTORY_KEEP entries, since
    that's the server-side cap this user's history is actually pruned to
    (see api_analyze() in app.py) -- there is nothing beyond it to show.
"""

import pytest

import app as app_module
import database
from database import create_local_user, save_analyze_result


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def _login(client, user_id):
    with client.session_transaction() as sess:
        sess["user_id"] = user_id


def _make_user(email):
    return create_local_user(email, "irrelevant-password", "Test User")


def _make_analysis(user_id, exercise_label="Bicep Curl", overall_score=72, reps=10):
    return save_analyze_result(
        user_id, exercise_label, overall_score,
        stretch_score=70, squeeze_score=65, favored=None,
        reps=reps, feedback_text="Some feedback.", video_filename=None,
    )


def test_history_page_redirects_when_logged_out(client):
    """The app's global require_login before_request hook (app.py) gates
    every page but auth/static, so a logged-out request never even reaches
    analyze_history_page's own "if not user" guard -- it's intercepted
    first and sent to login instead. That in-view guard is still correct
    defense-in-depth (same pattern as the pre-existing analyze_latest), it
    just isn't the thing a logged-out browser actually hits."""
    res = client.get("/analyze/history")
    assert res.status_code == 302
    assert "/login" in res.headers["Location"]


def test_detail_page_redirects_when_logged_out(client):
    res = client.get("/analyze/history/1")
    assert res.status_code == 302
    assert "/login" in res.headers["Location"]


def test_history_page_lists_every_stored_entry(client):
    user_id = _make_user("history-list@example.com")
    _make_analysis(user_id, "Bicep Curl", overall_score=72, reps=10)
    _make_analysis(user_id, "Flat Bench Press", overall_score=91, reps=8)
    _make_analysis(user_id, "Squat", overall_score=None, reps=None)
    _login(client, user_id)

    html = client.get("/analyze/history").get_data(as_text=True)

    assert "Bicep Curl" in html
    assert "Flat Bench Press" in html
    assert "Squat" in html
    assert "72" in html
    assert "91" in html


def test_history_page_links_to_each_detail_page(client):
    user_id = _make_user("history-links@example.com")
    result_id = _make_analysis(user_id)
    _login(client, user_id)

    html = client.get("/analyze/history").get_data(as_text=True)

    assert f"/analyze/history/{result_id}" in html


def test_history_page_shows_empty_state_with_no_analyses(client):
    user_id = _make_user("history-empty@example.com")
    _login(client, user_id)

    html = client.get("/analyze/history").get_data(as_text=True)

    assert "No analyses yet" in html


def test_history_page_falls_back_to_a_generic_icon_for_an_unrecognized_exercise(client):
    """Custom/typo'd exercise labels that aren't in EXERCISE_ICONS must not
    crash the page -- they get the emoji fallback instead of a KeyError."""
    user_id = _make_user("history-unknown-exercise@example.com")
    _make_analysis(user_id, "Totally Made Up Exercise Name", overall_score=50, reps=5)
    _login(client, user_id)

    res = client.get("/analyze/history")

    assert res.status_code == 200
    assert "Totally Made Up Exercise Name" in res.get_data(as_text=True)


def test_history_page_caps_at_analyze_history_keep(client, monkeypatch):
    """The list must never claim to show more than the server actually
    keeps -- ANALYZE_HISTORY_KEEP is the real cap (see api_analyze()'s
    prune_analyze_results call), not just a display limit picked here."""
    monkeypatch.setattr(app_module, "ANALYZE_HISTORY_KEEP", 3)
    user_id = _make_user("history-cap@example.com")
    for i in range(5):
        _make_analysis(user_id, f"Exercise {i}", overall_score=50 + i, reps=i)
    _login(client, user_id)

    html = client.get("/analyze/history").get_data(as_text=True)

    shown = sum(html.count(f"Exercise {i}") for i in range(5))
    assert shown == 3, f"expected exactly 3 entries rendered, found {shown}"
    # The 3 shown must be the newest (highest id / most recently inserted),
    # not an arbitrary 3 -- get_analyze_results already orders DESC, this
    # just confirms the page didn't reorder or reverse that.
    assert "Exercise 4" in html
    assert "Exercise 3" in html
    assert "Exercise 2" in html
    assert "Exercise 0" not in html
    assert "Exercise 1" not in html


def test_detail_page_opens_own_analysis(client):
    user_id = _make_user("detail-owner@example.com")
    result_id = _make_analysis(user_id, "Overhead Press", overall_score=88, reps=6)
    _login(client, user_id)

    res = client.get(f"/analyze/history/{result_id}")

    assert res.status_code == 200
    assert "Overhead Press" in res.get_data(as_text=True)


def test_detail_page_refuses_another_users_analysis(client):
    """The core safety property: guessing an id must not open someone
    else's stored video/feedback."""
    owner_id = _make_user("detail-victim@example.com")
    result_id = _make_analysis(owner_id, "Deadlift", overall_score=95, reps=5)

    attacker_id = _make_user("detail-attacker@example.com")
    _login(client, attacker_id)

    res = client.get(f"/analyze/history/{result_id}")

    assert res.status_code == 302
    assert res.headers["Location"].endswith("/analyze/history")
    assert "Deadlift" not in res.get_data(as_text=True)


def test_detail_page_redirects_for_a_nonexistent_id(client):
    user_id = _make_user("detail-missing@example.com")
    _login(client, user_id)

    res = client.get("/analyze/history/999999")

    assert res.status_code == 302
    assert res.headers["Location"].endswith("/analyze/history")


def test_analyze_page_links_to_the_history_page_for_a_user_with_results(client):
    """The 'View full logs' pill itself -- present in the served HTML
    (toggled visible client-side only when serverHistory is non-empty, but
    the href has to actually be there for that toggle to do anything)."""
    user_id = _make_user("recent-strip@example.com")
    _make_analysis(user_id)
    _login(client, user_id)

    html = client.get("/analyze").get_data(as_text=True)

    assert 'id="an-view-full-logs"' in html
    assert 'href="/analyze/history"' in html


def test_analyze_latest_still_works_after_the_refactor(client):
    """_render_analyze_result_page is now shared between analyze_latest and
    analyze_history_detail_page -- pin that the extraction didn't change
    analyze_latest's own behavior."""
    user_id = _make_user("latest-still-works@example.com")
    _make_analysis(user_id, "Lat Pulldown", overall_score=60, reps=12)
    _login(client, user_id)

    res = client.get("/analyze/latest")

    assert res.status_code == 200
    assert "Lat Pulldown" in res.get_data(as_text=True)
