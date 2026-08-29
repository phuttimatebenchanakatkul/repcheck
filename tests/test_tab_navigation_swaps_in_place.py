"""The shell wiring that static/pagenav.js depends on, pinned in base.html.

Tapping a tab used to load a document, and during a document swap nothing is
rendered at all -- not the page, not the bottom bar. Measured on a phone
(iphonecookie.mp4): seven tab switches, seven complete blackouts of 83-215ms.
Caching the assets, warming the next page and letting the tap reuse it each
shortened that gap; none of them removed it, because something has to be on
screen during it. So the tab bar stopped loading documents: pagenav.js fetches
the next page and puts its <main> in place of this one, and the shell is never
torn down.

Three pieces of that live in the template rather than in JS, and each fails
quietly on its own -- the tabs keep working, they just go back to reloading, or
worse, they swap and leak:

1. nav_scope.js must load, and NOT deferred. It wraps document/window listener
   registration before any page script runs; page scripts run inline in the
   body, so a deferred copy would be installed too late to record anything.
2. pagenav.js must load.
3. The content block must be bracketed by the recorder's start/stop markers.
   Without them nothing the page binds to document is ever released, and the
   tab pages bind to document 29 times between them: a handler per visit, and
   the modals they move to <body> pile up carrying duplicate ids until
   getElementById answers with a node from two pages ago.

Source-level assertions against the real template, the same tradeoff
tests/test_cross_user_name_escaping.py makes. The behaviour is covered in
tests-js/pageNav.test.js, and was verified by driving the running app through
every tab three times over: no document loads, no console errors, no duplicate
ids, and a swapped page structurally identical to the same page freshly
loaded.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = (ROOT / "templates" / "base.html").read_text(encoding="utf-8")


def test_the_scope_recorder_loads_before_any_page_script():
    match = re.search(r"<script src=\"\{\{ asset_url\('nav_scope\.js'\) \}\}\"([^>]*)>", BASE)
    assert match, (
        "base.html must load nav_scope.js. It is what records the bindings a "
        "page makes to document and window so pagenav.js can release them "
        "when that page is swapped away."
    )
    assert "defer" not in match.group(1), (
        "nav_scope.js must NOT be deferred. It wraps addEventListener before "
        "page scripts run, and page scripts run inline in the body -- a "
        "deferred copy is installed after they have already bound, records "
        "nothing, and every page then leaks its handlers on every visit."
    )


def test_the_swap_layer_loads():
    assert "pagenav.js" in BASE, (
        "base.html must load pagenav.js -- the tab bar that swaps pages in "
        "place instead of loading a document."
    )


def test_the_content_block_is_bracketed_by_the_recorder():
    start = BASE.index("RepCheckNavScope.start()")
    stop = BASE.index("RepCheckNavScope.stop()")
    block = BASE.index("{% block content %}")
    assert start < block < stop, (
        "The recorder's start()/stop() markers must bracket {% block content "
        "%} exactly. Too narrow and the page's bindings are not recorded; too "
        "wide and the SHELL's bindings are recorded too, and releasing those "
        "on the first swap unbinds the tab bar, the sheets and the language "
        f"switcher. Got start={start}, content={block}, stop={stop}."
    )


def test_the_brackets_stay_inside_main():
    """The markers must sit inside the element pagenav.js swaps.

    That is not an accident of layout: because they are inside <main>, every
    page pagenav.js fetches carries a copy of them and re-runs them inside
    pagenav.js's own bracket. nav_scope.js counts bracket depth for exactly
    this reason. Move them outside <main> and the nesting disappears along
    with the reason for that counter, which is the kind of thing a later
    cleanup removes as dead code.
    """
    main_open = BASE.index('<main class="main">')
    main_close = BASE.rindex("</main>")
    assert main_open < BASE.index("RepCheckNavScope.start()") < main_close
    assert main_open < BASE.index("RepCheckNavScope.stop()") < main_close
