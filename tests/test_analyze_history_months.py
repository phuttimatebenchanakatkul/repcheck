"""Month-grouped headings on the analysis history list ("July 2026",
"August 2026", ...) -- one heading per calendar month that actually has an
entry, inserted before that month's first entry, no heading for a month
with zero entries.

The grouping itself runs client-side (see the applyMonthHeadings() function
in templates/analyze_history.html), computed from each entry's LOCAL date --
deliberately not the server's UTC created_at, matching how the page already
computes "Today"/"Yesterday" labels in local time (see applyDates() in the
same file). Grouping by UTC month instead would put an entry recorded near
midnight UTC under the wrong heading for any user outside UTC, and would
disagree with the "Today"/"Yesterday" label immediately next to it on the
same row. There's no JS test runner in this repo (pytest/Flask only), so
these are structural pins against the template source plus a check on the
server-side prerequisite the client logic depends on: entries reaching the
page in strict newest-first order with their real created_at values intact.
"""

import pytest

import app as app_module
import database
from database import create_local_user

TEMPLATE_PATH = "templates/analyze_history.html"


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


def _make_analysis_at(user_id, created_at, exercise_label="Bicep Curl", overall_score=72, reps=10):
    """save_analyze_result() always stamps created_at as datetime('now'),
    so seeding entries in specific past months needs a direct insert --
    same table, same columns, just with an explicit created_at instead of
    letting the column default fire."""
    with database.get_db() as conn:
        conn.execute(
            """INSERT INTO analyze_results
               (user_id, exercise_label, overall_score, stretch_score, squeeze_score, favored, reps, feedback_text, video_filename, created_at)
               VALUES (?, ?, ?, 70, 65, NULL, ?, 'Some feedback.', NULL, ?)""",
            (user_id, exercise_label, overall_score, reps, created_at),
        )


# ---------- the template source (client-side logic has no JS test runner) ----------

def _template_source():
    return open(TEMPLATE_PATH, encoding="utf-8").read()


def test_month_grouping_function_is_present():
    src = _template_source()
    assert "applyMonthHeadings" in src, "the month-grouping function is gone"
    assert "ah-month-heading" in src


def test_month_grouping_uses_local_date_not_utc():
    """The whole reason this runs client-side instead of being computed
    server-side from the UTC created_at column: local time has to match
    the "Today"/"Yesterday" label on the same row. Pin against a
    regression back to UTC methods (getUTCFullYear/getUTCMonth), which
    would silently misfile entries near midnight UTC for non-UTC users."""
    src = _template_source()
    assert "getFullYear()" in src
    assert "getMonth()" in src
    assert "getUTCFullYear" not in src
    assert "getUTCMonth" not in src


def test_month_heading_uses_long_month_and_numeric_year():
    """"July 2026", not "Jul '26" or similar -- matches what was asked for."""
    src = _template_source()
    assert '{ month: "long", year: "numeric" }' in src


def test_list_is_fully_rebuilt_before_reinserting():
    """applyMonthHeadings() re-runs on every language change (see the
    repcheck:language-changed listener) to relabel headings. By that point
    every item is nested inside the PREVIOUS run's per-month .ah-card box,
    not a direct child of #ah-list -- clearing the container outright
    (rather than trying to detect and undo the old month-box wrapping) is
    what keeps a language toggle from doubling the heading and box count
    instead of just re-labeling them."""
    src = _template_source()
    idx_fn = src.find("function applyMonthHeadings")
    assert idx_fn != -1
    idx_snapshot = src.find("querySelectorAll(\".ah-item\")")
    idx_clear = src.find('list.innerHTML = ""')
    assert idx_snapshot != -1 and idx_clear != -1
    # Snapshot the items BEFORE wiping the container, or the wipe would
    # destroy the very nodes being grouped.
    assert idx_fn < idx_snapshot < idx_clear < idx_clear + 300


def test_new_heading_and_box_only_start_when_the_month_actually_changes():
    """Guards against a heading+box pair being inserted before every single
    item (grouping key must be compared against the PREVIOUS item's key,
    not just always truthy)."""
    src = _template_source()
    assert "lastKey" in src
    assert "key !== lastKey" in src or "lastKey !== key" in src


def test_each_month_gets_its_own_card_box():
    """The actual point of this feature: a NEW .ah-card element per month,
    not one shared box for the whole list (that would put every month's
    entries in the same box the heading now sits outside of)."""
    src = _template_source()
    assert 'currentBox.className = "ah-card"' in src
    # A fresh box is created only where a fresh heading is (inside the same
    # "month changed" branch) -- not once outside the loop.
    idx_box_created = src.find('currentBox.className = "ah-card"')
    idx_heading_created = src.find('heading.className = "ah-month-heading"')
    idx_branch = src.find("if (key !== lastKey)")
    assert idx_branch != -1
    assert idx_branch < idx_heading_created < idx_box_created


def test_heading_is_appended_before_its_box_not_inside_it():
    """The actual request this feature is for: the heading must be a
    SIBLING of the box in the list, appended before it -- not a child
    appended into the box (which would put it right back inside the
    thing it's supposed to sit outside of)."""
    src = _template_source()
    idx_heading_append = src.find("list.appendChild(heading)")
    idx_box_create = src.find('currentBox = document.createElement("div")')
    idx_box_append = src.find("list.appendChild(currentBox)")
    assert -1 not in (idx_heading_append, idx_box_create, idx_box_append)
    # Heading goes into the list first; the box is created and appended
    # to the list only afterward, as a later sibling.
    assert idx_heading_append < idx_box_create < idx_box_append
    # Items are appended into the BOX, never back into the top-level list.
    assert "currentBox.appendChild(item)" in src
    assert "list.appendChild(item)" not in src


def test_list_container_itself_has_no_card_styling():
    """#ah-list must not carry the ah-card class -- that would put a box
    around the WHOLE list again (headings included), the exact thing this
    feature removes. Per-month boxes are created by JS, not by the
    server-rendered wrapper."""
    src = _template_source()
    assert 'id="ah-list"' in src
    assert '<div id="ah-list">' in src, "the list wrapper must not also carry class=\"ah-card\""


def test_empty_state_still_gets_its_own_card():
    """The empty state ('No analyses yet') isn't part of the month-box
    restructuring -- it's a single message with no month attached, so it
    keeps a plain, dedicated .ah-card around it."""
    src = _template_source()
    assert '<div class="ah-card"><div class="ah-empty"' in src


# ---------- the server-side prerequisite the client logic depends on ----------

def test_entries_reach_the_page_in_strict_newest_first_order(client):
    """Client-side grouping assumes consecutive-in-the-DOM means
    consecutive-in-time. If the server ever stopped sorting DESC (or
    sorted by something other than created_at), the same month's entries
    could end up split by another month's entry in between, and the
    client would emit a spurious duplicate heading for that month."""
    user_id = _make_user("months-order@example.com")
    _make_analysis_at(user_id, "2026-06-15 10:00:00", "June Entry A")
    _make_analysis_at(user_id, "2026-07-01 09:00:00", "July Entry A")
    _make_analysis_at(user_id, "2026-06-20 11:00:00", "June Entry B")
    _make_analysis_at(user_id, "2026-08-05 08:00:00", "August Entry A")
    _make_analysis_at(user_id, "2026-07-10 12:00:00", "July Entry B")
    _login(client, user_id)

    html = client.get("/analyze/history").get_data(as_text=True)

    order = [
        name for name in
        ["August Entry A", "July Entry B", "July Entry A", "June Entry B", "June Entry A"]
        if name in html
    ]
    positions = [html.index(name) for name in order]
    assert positions == sorted(positions), (
        "entries are not in strict newest-first order -- client-side month "
        "grouping depends on this to avoid a duplicate heading for a month "
        "whose entries got split apart"
    )
    # newest-first specifically, not just "in some consistent order"
    assert html.index("August Entry A") < html.index("July Entry B") < html.index("June Entry B")


def test_every_entrys_created_at_reaches_its_item_row(client):
    """The client groups by reading data-created-at off each .ah-item's
    .ah-item-meta -- if the server ever stopped emitting that attribute
    for some row, that entry would silently vanish from grouping (it
    would inherit whatever heading came before it, or none at all)."""
    user_id = _make_user("months-data-attr@example.com")
    _make_analysis_at(user_id, "2026-07-15 10:00:00", "Attributed Entry")
    _login(client, user_id)

    html = client.get("/analyze/history").get_data(as_text=True)

    assert 'data-created-at="2026-07-15 10:00:00"' in html


def test_entries_spanning_three_months_all_render(client):
    user_id = _make_user("months-three@example.com")
    _make_analysis_at(user_id, "2026-06-01 10:00:00", "June Only Entry")
    _make_analysis_at(user_id, "2026-07-01 10:00:00", "July Only Entry")
    _make_analysis_at(user_id, "2026-08-01 10:00:00", "August Only Entry")
    _login(client, user_id)

    html = client.get("/analyze/history").get_data(as_text=True)

    assert "June Only Entry" in html
    assert "July Only Entry" in html
    assert "August Only Entry" in html
