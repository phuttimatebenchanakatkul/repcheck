"""RepCheck has to lay itself out for an iPad, not be magnified onto one.

Apple rejected 0.7.1 (33) on 2026-09-08 under Guideline 4, reviewed on an
iPad Air 11-inch: "your UI is zoomed in and hard to read". Two separate
things caused that, and this file guards both, because both are the kind of
change that looks harmless in a diff and only shows up weeks later in a
review rejection.

1. The BUILD shipped iPhone-only (TARGETED_DEVICE_FAMILY = 1). An
   iPhone-only app still installs on an iPad, where iPadOS runs it in
   compatibility mode: it renders the app's 390pt iPhone canvas and scales
   that up to the iPad's screen. Everything is literally magnified. No CSS
   can fix it -- the web app never gets an iPad-sized viewport at all.

2. The CSS drew a simulated PHONE, bezel and all, on a dark "desk"
   whenever the window was wider than 720px. An iPad is 820pt wide in
   portrait and 1180pt in landscape, so a native iPad app rendered a
   drawn-on phone using about a fifth of the screen.

These are source-level assertions against the real files rather than
behavioural tests, which is the tradeoff CLAUDE.md describes for CSS and
build config with no module boundary to test through. Every assertion here
was mutation-checked: revert the thing it guards and the test fails.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLE_CSS = ROOT / "static" / "style.css"
TOUR_CSS = ROOT / "static" / "tour.css"
COACH_HTML = ROOT / "templates" / "coach.html"
CODEMAGIC = ROOT / "codemagic.yaml"

SHARED = "@media (min-width: 721px) {"
DESK = "@media (min-width: 721px) and (hover: hover) and (pointer: fine)"


def _block(src, header):
    """The body of the `@media ...` block whose header line is `header`."""
    # An explicit failure, not a bare ValueError out of str.index: the media
    # conditions here are load-bearing and ARE meant to be pinned, so the
    # common way this trips is someone reordering or renaming a gate. Say so
    # rather than making them read a traceback to find out.
    assert header in src, (
        f"no {header!r} block in the stylesheet. The wide-screen media gates "
        "are deliberately pinned by these tests -- if you reordered or "
        "renamed one, update the constants at the top of this file and "
        "re-check that the layout still does what the block comment claims."
    )
    start = src.index(header)
    i = src.index("{", start)
    depth, j = 0, i
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1 : j]
        j += 1
    raise AssertionError(f"unterminated block for {header!r}")


def _rule(block, selector):
    """Declarations of the rule whose selector LIST contains `selector`.

    Tolerant of grouping on purpose: `.auth-body, .ob-body { ... }` should
    satisfy a lookup for either one, and adding a third selector to a group
    should not break an unrelated assertion.
    """
    body = re.sub(r"/\*.*?\*/", "", block, flags=re.S)
    for m in re.finditer(r"([^{}]*)\{([^{}]*)\}", body):
        if selector in [s.strip() for s in m.group(1).split(",")]:
            return m.group(2)
    raise AssertionError(f"no rule whose selectors include {selector!r}")


def _yaml_step(src, name):
    """One codemagic.yaml `- name:` step's body, up to the next step.

    Scoped deliberately: asserting `"exit 1" in src` over the whole file is
    satisfied by any unrelated step that happens to contain one (there is
    such a step at line ~174), which silently turns a test of the guard's
    teeth into a test of nothing.
    """
    marker = f"- name: {name}"
    assert marker in src, f"no {marker!r} step in codemagic.yaml"
    start = src.index(marker)
    nxt = src.find("\n      - name:", start + len(marker))
    return src[start : nxt if nxt != -1 else len(src)]


# --------------------------------------------------------------------------
# The build
# --------------------------------------------------------------------------

def test_the_app_is_not_built_iphone_only():
    """The ipa must ship Universal, or iPadOS magnifies it on an iPad.

    codemagic.yaml used to rewrite every TARGETED_DEVICE_FAMILY in the
    generated Xcode project to 1. That single line is what put a scaled-up
    iPhone canvas in front of the reviewer.
    """
    src = CODEMAGIC.read_text(encoding="utf-8")

    # The rewrite itself: any assignment of the iPhone-only value, anywhere.
    assert not re.search(r"""replace\(\s*['"]TARGETED_DEVICE_FAMILY""", src), (
        "codemagic.yaml is rewriting TARGETED_DEVICE_FAMILY again. Shipping "
        "iPhone-only is what caused the Guideline 4 rejection of build 33: "
        "iPadOS runs an iPhone-only app scaled up, and no CSS can undo that."
    )


def test_the_universal_guard_actually_fails_the_build():
    """A guard that detects iPhone-only but does not `exit 1` is decoration.

    Scoped to the step's own body -- see _yaml_step. Capacitor's template
    already defaults to "1,2", so there is nothing to patch here, only
    something to ASSERT: if a future template change hands back an
    iPhone-only project, the build must go red rather than quietly shipping
    the exact binary Apple already rejected.
    """
    step = _yaml_step(
        CODEMAGIC.read_text(encoding="utf-8"),
        "Ship as a Universal app (iPhone + iPad)",
    )

    # Counts every occurrence, and counts how many are Universal...
    assert re.search(r'grep -c "TARGETED_DEVICE_FAMILY"', step), (
        "the Universal step must count every TARGETED_DEVICE_FAMILY in the "
        "generated project"
    )
    assert re.search(r"""grep -c 'TARGETED_DEVICE_FAMILY = "1,2";'""", step), (
        "the Universal step must count how many of them are Universal"
    )
    # ...and requires the two counts to agree. A pattern check ("no line says
    # 1" + "some line says 1,2") passes a project where the App target went
    # iPhone-only while Capacitor's target stayed Universal -- and the App
    # target is the one the store lists.
    assert re.search(r'\[ "\$UNIVERSAL" -ne "\$TOTAL" \]', step), (
        "the guard must require EVERY device-family setting to be Universal, "
        "not merely that one of them is"
    )
    # ...and every failure path stops the build.
    assert step.count("exit 1") >= 2, (
        "both branches of the Universal guard must exit non-zero. Without "
        "that the step prints a warning and ships iPhone-only anyway, which "
        "is precisely the rejection this whole change exists to fix."
    )


# --------------------------------------------------------------------------
# The CSS: which skin a wide screen gets
# --------------------------------------------------------------------------

def test_the_phone_bezel_needs_two_signals_that_say_desktop():
    """The simulated phone is a DESKTOP presentation, never a tablet layout.

    Gated on input capability rather than width: an iPad is wider than
    721px in BOTH orientations, so any width-only rule catches every one of
    them. And gated on two signals rather than one, so a single wrong
    reading on some future device cannot put a fake phone in front of a
    reviewer -- the cost of that being wrong is a whole review cycle.
    """
    src = STYLE_CSS.read_text(encoding="utf-8")

    desk = _block(src, DESK)
    assert "border: 11px solid" in desk, (
        "the device frame's bezel should live in the desk block -- if it "
        "moved, re-point this test at wherever it went"
    )
    assert "radial-gradient" in desk, "the desk gradient belongs to the desk block"
    # The desk skin's own size, so it cannot silently lose the thing that
    # makes it a phone and become an unstyled 720px column on a dark desk.
    assert "width: 390px" in desk, "the desk frame is a 390px phone"
    assert "--app-h: min(844px" in desk, "the desk frame is a phone-height box"

    # Nothing that draws a phone may sit in a block a tablet also matches.
    shared = _block(src, SHARED)
    for phone_ism in (
        "border: 11px solid",
        "border-radius: 46px",
        "radial-gradient",
        "box-shadow:",
    ):
        assert phone_ism not in shared, (
            f"{phone_ism!r} is in the shared >=721px block, so it applies on "
            "an iPad too. A native iPad app must not draw a fake phone."
        )


def test_the_tablet_layout_is_the_default_not_the_exception():
    """A wide screen gets the readable column unless it PROVES it is a desk.

    If this ever inverts -- the desk as the default, the tablet as the
    special case -- then any device whose media features read unexpectedly
    falls back to a fake phone. That is the exact shape of the 0.7.1
    rejection, so the direction is the thing being pinned here.
    """
    shared = _block(STYLE_CSS.read_text(encoding="utf-8"), SHARED)

    assert "--app-h: 100dvh" in shared, (
        "the default wide-screen box should fill the screen height, not "
        "letterbox itself"
    )
    assert "width: min(100vw, 720px)" in shared, (
        "the default wide-screen box should be a readable centred column"
    )
    assert "background: var(--bg)" in shared, (
        "the default surround must be the app's own background, not a desk"
    )


def test_the_tab_bar_does_not_stretch_with_the_column():
    """Stretched to 720px the tab bar is five icons a thumb apart.

    The inset expression has to hold in BOTH skins: `100%` resolves against
    the transformed <body>, so it is (720-420)/2 in the tablet column, while
    inside the 390px desk frame the calc goes negative and max() hands back
    the phone's own 12px. Losing it makes the iPad tab bar sparse and blows
    the active-tab bubble up to ~136px wide.
    """
    shared = _block(STYLE_CSS.read_text(encoding="utf-8"), SHARED)
    tabbar = _rule(shared, ".mobile-tabbar")

    assert "420px" in tabbar, "the tab bar must be capped, not full-width"
    assert tabbar.count("max(12px") == 2, (
        "both left and right insets must fall back to the phone's 12px when "
        "the box is narrower than the bar"
    )


def test_the_tablet_column_gets_a_roomier_gutter_than_the_desk_frame():
    """20px in the column, back to the phone's 12px inside the 390px frame."""
    src = STYLE_CSS.read_text(encoding="utf-8")

    shared_app = _rule(_block(src, SHARED), ".app")
    assert "padding-left: 20px" in shared_app, (
        "12px of edge padding on a 720px column reads as content jammed "
        "against the edge"
    )

    desk_app = _rule(_block(src, DESK), ".app")
    assert "padding-left: 12px" in desk_app, (
        "the column's roomier gutter must be put back to the phone's inside "
        "the 390px frame, where it would only narrow the content"
    )


def test_the_short_window_bezel_shrink_is_desk_only():
    """A small iPad window must not grow a bezel just for being short."""
    src = STYLE_CSS.read_text(encoding="utf-8")
    assert f"{DESK} and (max-height: 700px)" in src, (
        "the short-window frame override must carry the full desk gate -- "
        "loosened, it puts an 8px bezel and 34px corners on a tablet"
    )


# --------------------------------------------------------------------------
# The CSS: things that assumed "wide window" meant "no tab bar"
# --------------------------------------------------------------------------

def test_the_coach_chat_is_sized_against_the_app_box():
    """Sizing chat to the WINDOW puts its input under the tab bar.

    The tab-bar clearance used to live only in a `max-width: 720px` block,
    so above 720px the card was sized to the whole window inside a much
    shorter box: the input pill rendered past the desktop frame's clipped
    edge entirely, and sat under the floating tab bar on an iPad.
    """
    src = COACH_HTML.read_text(encoding="utf-8")
    height = re.search(r"\.cc-chat\s*\{[^}]*?height:\s*([^;]+);", src, re.S)
    assert height, ".cc-chat must set a height"
    expr = height.group(1)

    assert "var(--app-h)" in expr, (
        ".cc-chat's height must be measured against --app-h (the app box: "
        "100vh on a phone, the column on a tablet, the frame on a desk), got "
        f"{expr!r}"
    )
    assert "102px" in expr, (
        "and it must still subtract the tab bar's 102px of chrome"
    )


def test_the_tour_mini_bar_clears_the_tab_bar_at_every_width():
    """The tab bar is drawn at every width, so its clearance must be too."""
    src = TOUR_CSS.read_text(encoding="utf-8")
    rule = re.search(r"\.tour-mini\s*\{(.*?)\}", src, re.S)
    assert rule, ".tour-mini must exist"
    assert "84px" in rule.group(1), (
        ".tour-mini's tab-bar clearance must be in its base rule, not in a "
        "max-width:720px block -- above 720px that left it behind the bar"
    )


def test_the_auth_card_stays_centred_in_the_app_box():
    """`display: block` on .auth-body left the login card hard left.

    Invisible in the 390px desk frame (the card is the frame's width),
    glaring in a 720px tablet column. Asserted positively as well as
    negatively: a bare "no `display: block`" check is satisfied by any
    reformatting of the same broken declaration.
    """
    shared = _block(STYLE_CSS.read_text(encoding="utf-8"), SHARED)

    auth_body = _rule(shared, "html body.auth-body")
    assert "display" not in auth_body, (
        "overriding .auth-body's display at >=721px drops auth.css's flex "
        "centring, which puts the login card against the left edge of the "
        f"app box. Got: {auth_body.strip()!r}"
    )
    assert "height: 100%" in auth_body, (
        ".auth-body must still fill the app box so the card centres against "
        "the whole screen rather than against its own content"
    )

    auth_wrap = _rule(shared, ".auth-wrap")
    assert "max-height: 100%" in auth_wrap, (
        "the wrap needs max-height, not height: a hard height re-imposes the "
        "block-layout stretch that broke the centring, while max-height "
        "keeps the overflow safety net for a short screen with a keyboard up"
    )


def test_onboarding_has_a_scroller_inside_the_app_box():
    """Without one there is no scrollport at all, and Next is unreachable.

    <body> is a fixed-height box with `overflow: hidden` at >=721px, and so
    is <html>. Onboarding is standalone -- no .app, no base.html -- so if
    .ob-wrap does not scroll, anything below the box's bottom edge is
    clipped with no gesture that can reach it. A combined step runs to
    about twice a phone viewport, and this is the screen App Review lands
    on immediately after signing up.
    """
    shared = _block(STYLE_CSS.read_text(encoding="utf-8"), SHARED)

    ob_wrap = _rule(shared, ".ob-wrap")
    assert "overflow-y: auto" in ob_wrap, (
        "onboarding's wrapper must be a scroller inside the app box"
    )
    assert "max-height: 100%" in ob_wrap, (
        "max-height, not height, so a short step still centres its card"
    )
    # `html body.ob-body`, not `.ob-body`: onboarding sets its own
    # `min-height: 100vh` in an inline <style> that loads after style.css, so
    # anything less specific silently loses and the release never happens.
    ob_body = _rule(shared, "html body.ob-body")
    assert "min-height: 0" in ob_body, (
        "onboarding's own `min-height: 100vh` has to be released, or the box "
        "stays at the large viewport while its height is the dynamic one, "
        "putting the bottom of the card below the clipped edge"
    )


def test_onboarding_scroll_cues_do_not_read_the_window():
    """window.scrollY is pinned at 0 once .ob-wrap is the scroller.

    Reading it there makes the "more questions below" cue believe the page
    can never scroll and leaves its button inert, and restores every
    option-tap rebuild to the top of the wizard.
    """
    src = (ROOT / "static" / "onboarding.js").read_text(encoding="utf-8")

    assert "function scrollerEl()" in src, (
        "onboarding.js needs a scroller shim -- it has no base.html and so "
        "no RepCheck.scroller() to borrow"
    )
    # The shim itself is allowed to fall back to the window; nothing else is.
    outside_shim = src.split("function scrollerEl()", 1)[1]
    outside_shim = outside_shim.split("function currentStep()", 1)[1]
    for windowism in ("window.scrollY", "window.scrollTo(", "window.scrollBy(",
                      "window.innerHeight"):
        assert windowism not in outside_shim, (
            f"{windowism} outside the scroller shim: it reads the window, "
            "which is not the scroller from 721px up"
        )
