"""Every page that renders synced data must handle the re-render event.

account_sync.js no longer reloads the page after hydration when a page
claims "repcheck:data-hydrated" by calling preventDefault(). Anything that
does NOT claim it still falls back to location.reload() -- correct, but it
is exactly the visible refresh this work exists to remove, so a page that
renders from these keys and forgets the handler silently reintroduces it on
that page.

That is invisible in a browser: hydration only changes something when
another device wrote data or this browser is adopting an account, so the
reload will not show up in ordinary local testing. A source-level check is
the thing that actually catches it. This is the deliberate tradeoff CLAUDE.md
describes for hand-rolled JS with no module boundary -- mutation-checked by
deleting a handler and confirming this fails.
"""

import re
from pathlib import Path

import pytest

import app as app_module

ROOT = Path(app_module.__file__).parent
TEMPLATES = ROOT / "templates"
STATIC = ROOT / "static"

HYDRATED_EVENT = "repcheck:data-hydrated"

# Keys whose value is rendered on screen at page load. A page reading one of
# these has a copy on screen that hydration can invalidate.
RENDERED_KEYS = [
    "repcheck_workout_log_v2",
    "repcheck_nutrition_log_v1",
    "repcheck_nutrition_goals_v1",
    "repcheck_weight_log_v1",
    "repcheck_hyrox_history_v1",
    "repcheck_analyze_log_v1",
    "repcheck_coach_chat_v1",
    "repcheck_day_status_v1",
    "repcheck_split_plan_v1",
]

# Files that read a rendered key but legitimately need no handler, each with
# the reason. Anything NOT listed here has to claim the event.
EXEMPT = {
    # Writes the analyze log on the result screen; renders nothing from it.
    "templates/result.html": "write-only",
    # Reads on demand inside the log-weight sheet and the FAB, at the moment
    # the sheet opens -- never from a copy captured at page load.
    "templates/base.html": "reads on open, not at load",
    # The wizard writes these; it is not showing a synced log.
    "static/onboarding.js": "write-only wizard",
    # Reads fresh inside every suggestion query, called when a picker opens.
    "static/suggestions.js": "reads fresh per call",
    # Reads fresh per call, and already redraws consumers through its own
    # UPDATED_EVENT after the server back-fill.
    "static/streak.js": "reads fresh per call, has its own signal",
    # The profile form reads and writes on submit; nothing is rendered from a
    # captured copy.
    "templates/settings.html": "form, not a rendered log",
    # account_sync.js is the dispatcher itself.
    "static/account_sync.js": "the dispatcher",
}


def _sources():
    for path in sorted(TEMPLATES.glob("*.html")) + sorted(STATIC.glob("*.js")):
        rel = f"{path.parent.name}/{path.name}"
        yield rel, path.read_text(encoding="utf-8")


def _reads_a_rendered_key(source):
    return [key for key in RENDERED_KEYS if key in source]


def test_every_page_rendering_synced_data_claims_the_event():
    missing = []
    for rel, source in _sources():
        if rel in EXEMPT:
            continue
        keys = _reads_a_rendered_key(source)
        if not keys:
            continue
        if HYDRATED_EVENT not in source:
            missing.append(f"{rel} (reads {', '.join(keys)})")
    assert not missing, (
        "these render synced data but never listen for "
        f"{HYDRATED_EVENT}, so account_sync.js will fall back to reloading "
        f"the page on them: {missing}"
    )


def test_a_handler_actually_claims_the_event():
    """Listening is not enough -- it has to call preventDefault().

    A listener that redraws but never claims the event leaves the reload
    fallback armed, which looks identical in every test except this one.
    coaching.js is the deliberate exception: it re-renders one card on
    /nutrition, and that page's own handler is what claims it.
    """
    claims_deliberately_delegated = {"static/coaching.js"}
    unclaimed = []
    for rel, source in _sources():
        if HYDRATED_EVENT not in source or rel in EXEMPT:
            continue
        if rel in claims_deliberately_delegated:
            continue
        # The handler body between the event name and the end of the listener.
        block = source.split(HYDRATED_EVENT, 1)[1][:1200]
        if "preventDefault()" not in block:
            unclaimed.append(rel)
    assert not unclaimed, (
        f"these listen for {HYDRATED_EVENT} but never call preventDefault(), "
        f"so account_sync.js still reloads the page: {unclaimed}"
    )


def test_the_exempt_list_has_not_gone_stale():
    """An exemption for a file that no longer reads these keys is a lie.

    Left in place it would silently excuse the file if it ever started
    rendering synced data again.
    """
    stale = []
    for rel in EXEMPT:
        path = ROOT / rel
        if not path.exists():
            stale.append(f"{rel} (file is gone)")
            continue
        if not _reads_a_rendered_key(path.read_text(encoding="utf-8")):
            stale.append(f"{rel} (no longer reads any rendered key)")
    assert not stale, f"exempt entries that no longer apply: {stale}"


def test_account_sync_still_falls_back_to_a_reload():
    """The fallback must survive.

    Deleting it would be the tempting way to guarantee no refresh ever
    happens, and it would leave any unhandled page rendering data the user
    can see is wrong.
    """
    source = (STATIC / "account_sync.js").read_text(encoding="utf-8")
    assert "location.reload()" in source, (
        "the unhandled-hydration fallback is gone -- a page with no handler "
        "would now silently show stale data"
    )
    assert "repcheck_hydrated_reload" in source, (
        "the once-per-session guard on that fallback is gone -- it could loop"
    )


@pytest.mark.parametrize(
    "rel, key",
    [
        ("templates/nutrition.html", "repcheck_nutrition_log_v1"),
        ("templates/workouts.html", "repcheck_workout_log_v2"),
        ("templates/home.html", "repcheck_nutrition_log_v1"),
        ("static/hyrox.js", "repcheck_hyrox_history_v1"),
        ("templates/coach.html", "repcheck_coach_chat_v1"),
        ("templates/weight_history.html", "repcheck_weight_log_v1"),
    ],
)
def test_the_main_data_pages_re_read_rather_than_trusting_a_captured_copy(rel, key):
    """Redrawing is only half of it.

    These pages read their log into a variable once at load. Re-rendering
    without re-reading paints the same pre-hydration data again and looks
    like the handler simply did not work.
    """
    source = (ROOT / rel).read_text(encoding="utf-8")
    assert HYDRATED_EVENT in source, (
        f"{rel} has no {HYDRATED_EVENT} handler at all -- "
        "test_every_page_rendering_synced_data_claims_the_event should have "
        "already caught this"
    )
    block = source.split(HYDRATED_EVENT, 1)[1][:1200]
    reloads_state = re.search(
        r"(loadLog\(\)|loadHistory\(\)|loadWeightLog\(\)|loadJson\(|reloadStoredState\(\)|loadGoals\(\))",
        block,
    )
    assert reloads_state, (
        f"{rel}'s {HYDRATED_EVENT} handler re-renders but never re-reads "
        f"{key} from localStorage"
    )
