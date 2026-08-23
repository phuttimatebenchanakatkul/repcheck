"""Guards the AI-coaching block's custom-race behaviour in hyrox.js.

hyrox.js is a single hand-rolled ES6 class with no build step and no JS test
runtime wired up for it, so these are source-level regex assertions against
the real file -- the same tradeoff test_hyrox_keyboard_activation.py makes.

Custom races get no AI coaching: the prompt is built around the fixed
standard station list, and a custom race's station mix (and count) is
open-ended, so there is no standard to coach against. That used to render a
grey "AI coaching isn't available for custom races yet" placeholder on the
finish card and in the race-detail modal. The placeholder is gone -- a custom
race now renders nothing at all where the coaching block would be.

Two things about that are worth pinning, and both fail loudly in production
rather than silently:

renderRaceAnalysis() now returns null. It previously always returned an
element, so every call site could append its result unconditionally. Now a
custom race returns null, and a bare
`slot.appendChild(this.renderRaceAnalysis(result))` throws
"TypeError: parameter 1 is not of type 'Node'" -- which blows up the whole
finish card, not just the coaching block. Both call sites must null-check.
This is the regression these tests exist for.

The custom guard must stay ABOVE the auto-analysis fallback. Further down,
renderRaceAnalysis() lazily fires loadRaceAnalysis() whenever there's no
cache entry yet. finishRace() already skips the auto-analysis call for custom
races, but the guard here is what stops that lazy fallback from firing one
anyway the first time a custom result is ever rendered. Deleting the guard
(rather than just its markup) would send custom races to the coaching API.
"""

import re
from pathlib import Path

import pytest

HYROX_JS = Path(__file__).resolve().parent.parent / "static" / "hyrox.js"
I18N_JS = Path(__file__).resolve().parent.parent / "static" / "i18n.js"


@pytest.fixture(scope="module")
def hyrox_src():
    return HYROX_JS.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def i18n_src():
    return I18N_JS.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def render_race_analysis(hyrox_src):
    """The body of renderRaceAnalysis(), from its signature to the next method."""
    start = hyrox_src.index("renderRaceAnalysis(result) {")
    # Methods in this class are indented 4 spaces; the closing brace of the
    # method sits at that same indent on its own line.
    end = hyrox_src.index("\n    }\n", start)
    return hyrox_src[start:end]


def test_custom_race_renders_no_analysis_block(render_race_analysis):
    """A custom race returns null -- no placeholder element, no markup."""
    match = re.search(
        r'if\s*\(\s*result\.category\s*===\s*"custom"\s*\)\s*\{\s*return\s+null;\s*\}',
        render_race_analysis,
    )
    assert match, (
        "renderRaceAnalysis() must return null for custom races. Either the "
        "guard was deleted (custom races would then fall through to the "
        "auto-analysis fallback and hit the coaching API), or it went back to "
        "returning a placeholder element."
    )


def test_no_custom_unavailable_copy_remains(hyrox_src, i18n_src):
    """The removed placeholder's i18n key is gone from both files."""
    assert "unavailableCustom" not in hyrox_src, (
        "hyrox.js still references the removed hyrox.analysis.unavailableCustom "
        "key -- t() would render the raw key string to the user."
    )
    assert "unavailableCustom" not in i18n_src, (
        "i18n.js still defines hyrox.analysis.unavailableCustom, which no "
        "longer has a caller."
    )


def test_flagged_race_still_shows_its_own_notice(render_race_analysis, i18n_src):
    """Removing the custom placeholder must not touch the flagged one."""
    assert re.search(
        r"if\s*\(\s*result\.flagged\s*\)", render_race_analysis
    ), "The flagged-race guard disappeared from renderRaceAnalysis()."
    assert "unavailableFlagged" in render_race_analysis, (
        "The flagged-race notice no longer renders its copy. Flagged races "
        "still need the explanation -- only the custom placeholder was removed."
    )
    assert i18n_src.count('"hyrox.analysis.unavailableFlagged"') >= 2, (
        "hyrox.analysis.unavailableFlagged must stay defined in every locale."
    )


def test_every_call_site_null_checks_the_result(hyrox_src):
    """No caller may append renderRaceAnalysis()'s return value unguarded.

    This is the regression guard: a bare appendChild() of a null return
    throws a TypeError and takes down the entire finish card / detail modal
    for custom races.
    """
    unguarded = re.findall(
        r"appendChild\(\s*this\.renderRaceAnalysis\(", hyrox_src
    )
    assert not unguarded, (
        f"Found {len(unguarded)} call site(s) appending "
        "this.renderRaceAnalysis(...) directly. It returns null for custom "
        "races, so appendChild would throw. Assign to a variable and "
        "null-check before appending."
    )

    # Every call site must exist and be paired with a truthiness check on the
    # variable it was assigned to.
    call_sites = re.findall(
        r"const\s+(\w+)\s*=\s*this\.renderRaceAnalysis\(", hyrox_src
    )
    assert len(call_sites) == 2, (
        f"Expected 2 renderRaceAnalysis() call sites (finish card and race "
        f"detail modal), found {len(call_sites)}: {call_sites}. A new call "
        "site needs its own null check."
    )
    for var in call_sites:
        assert re.search(rf"if\s*\(\s*{re.escape(var)}\s*\)", hyrox_src), (
            f"renderRaceAnalysis() result assigned to '{var}' is never "
            f"null-checked before use."
        )


def test_custom_guard_precedes_the_auto_analysis_fallback(render_race_analysis):
    """The guard must sit above the lazy '!cache' call that fires the API."""
    guard = render_race_analysis.index('result.category === "custom"')
    fallback = render_race_analysis.index("loadRaceAnalysis(")
    assert guard < fallback, (
        "The custom-race guard moved below the auto-analysis fallback. "
        "Custom races would now fire a coaching API request on first render."
    )
