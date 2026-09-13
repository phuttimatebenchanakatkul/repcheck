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
# The tab-bar cap deliberately sits in its own, WIDER block: it has to cover
# the 481-720px band as well, which is where a tablet lands in Split View.
TABBAR_CAP = "@media (min-width: 481px) {"
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


def _media_widths_styling(src, feature, selector, needle):
    """Widths of every `@media (<feature>: Npx)` block whose `selector` rule
    contains `needle`.

    The width is READ OUT of the stylesheet rather than written down here,
    which is the whole point: the tab bar's two inset breakpoints only work
    as a pair, so a test that hardcodes both numbers still passes when one
    of them moves. The canonical header is rebuilt and looked up with the
    same exact match `_block` uses, so a reformatted header returns nothing
    and the caller's own "no block does this any more" assertion fires --
    loudly, rather than silently narrowing the search to nothing.
    """
    found = []
    pattern = r"@media\s*\(" + feature + r":\s*(\d+)px\s*\)\s*\{"
    for width in sorted({int(w) for w in re.findall(pattern, src)}):
        header = "@media (" + feature + ": " + str(width) + "px) {"
        if header not in src:
            continue
        try:
            rule = _rule(_block(src, header), selector)
        except AssertionError:
            continue
        if needle in rule:
            found.append(width)
    return found


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
    """Stretched wide the tab bar is five icons a thumb apart.

    The inset expression has to hold in every skin: `100%` resolves against
    the transformed <body> above 721px, so it is (720-420)/2 in the tablet
    column, and against the viewport below it; inside the 390px desk frame
    the calc goes negative and max() hands back the phone's own 12px. Losing
    it makes the tab bar sparse and blows the active-tab bubble up to ~136px
    wide.
    """
    tabbar = _rule(_block(STYLE_CSS.read_text(encoding="utf-8"), TABBAR_CAP),
                   ".mobile-tabbar")

    assert "420px" in tabbar, "the tab bar must be capped, not full-width"
    assert tabbar.count("max(12px") == 2, (
        "both left and right insets must fall back to the phone's 12px when "
        "the box is narrower than the bar"
    )


def test_the_tab_bar_cap_also_covers_the_split_view_band():
    """The cap must start ABOVE the phone breakpoint, not at 721px.

    It used to live in the `min-width: 721px` block, which left 481-720px
    uncovered -- and that band is exactly where an iPad sits in Split View.
    Measured before this moved: a 720px viewport rendered a 696px-wide bar
    that snapped to 420px at 721px, so dragging a split-view divider across
    the boundary jumped the bar by 276px, and everywhere below it the five
    destinations were spread across the full width of a tablet.

    This test pins only where the cap STARTS. It deliberately does not claim
    to catch a moved phone breakpoint -- an earlier version of this docstring
    did, and that was wrong: widening `max-width: 480px` to 520px while
    leaving the cap at 481 left every test here green while the cap silently
    stripped the 8px gutters off real phones. Pinning the two breakpoints
    against each other is test_the_tab_bar_inset_breakpoints_are_adjacent's
    job, and the cascade is
    test_the_tab_bar_cap_is_the_last_word_on_the_bar_insets'.
    """
    src = STYLE_CSS.read_text(encoding="utf-8")

    headers = re.findall(
        r"@media\s*\(min-width:\s*(\d+)px\s*\)\s*\{", src
    )
    caps = []
    for width in sorted({int(w) for w in headers}):
        header = "@media (min-width: " + str(width) + "px) {"
        if header not in src:
            continue
        try:
            rule = _rule(_block(src, header), ".mobile-tabbar")
        except AssertionError:
            continue
        if "420px" in rule:
            caps.append(width)

    assert caps, "no min-width block caps .mobile-tabbar at 420px any more"

    start = min(caps)
    # Over integers these two bounds are exactly `start == 481`, which is the
    # intent -- written as a pair so a failure says WHICH way it went wrong.
    assert start <= 481, (
        "the tab-bar cap starts at " + str(start) + "px, so the "
        "481-" + str(start - 1) + "px split-view band still gets a bar "
        "stretched to the full viewport width. That band is where a tablet "
        "sits in Split View."
    )
    assert start > 480, (
        "the cap starts at " + str(start) + "px, at or below the 480px phone "
        "breakpoint -- that restyles the primary platform, which this "
        "deliberately does not do. If the phone breakpoint itself moved, fix "
        "that first: test_the_tab_bar_inset_breakpoints_are_adjacent is the "
        "one that keeps the pair in step."
    )


def test_the_tab_bar_inset_breakpoints_are_adjacent():
    """The phone gutters and the cap are a PAIR; neither may move alone.

    `@media (max-width: 480px)` tightens the bar's insets to 8px on the
    narrowest phones, and the cap block centres it from 481px up. Both
    write `.mobile-tabbar`'s left/right at the same specificity, so they
    are only correct while they are exactly adjacent.

    "Adjacent" here means integer-adjacent (481 == 480 + 1), which is the
    house convention -- the same `max-width: 480px` block already gates
    `.app` padding and `.mt-fab` the same way. It is not strictly what CSS
    considers gapless: (480, 481) is an open interval matched by neither
    rule. That is unreachable in practice (Chromium rounds the layout
    viewport to integer CSS px; page zoom is the only route, and the damage
    is a 36px-too-wide bar across a sub-pixel band), but if anyone ever
    writes the pedantically-correct pairing -- `min-width: 480.02px`, or
    `not all and (max-width: 480px)` -- this test will fail them for being
    right. Update it deliberately if that day comes; do not widen it to
    paper over a real gap.

    A GAP between them is the split-view bug this change fixes, one band
    further down: those widths fall back to the base `left: 12px` and the
    bar stretches to the whole window again.

    An OVERLAP is worse and much quieter. The cap block is later in the
    file, so in any overlapping band it wins on source order and takes the
    8px gutters away from real phones -- the one thing the cap's own
    comment promises it does not do, failing with no error anywhere.

    The test above pins the cap at 481 against a hardcoded 480, so it
    cannot see either case: widening the phone breakpoint to 520 and
    leaving the cap at 481 passes it (checked -- it does). This one reads
    BOTH numbers out of the stylesheet, so the pair has to move together.
    """
    src = STYLE_CSS.read_text(encoding="utf-8")

    phones = _media_widths_styling(src, "max-width", ".mobile-tabbar",
                                   "left: 8px")
    caps = _media_widths_styling(src, "min-width", ".mobile-tabbar", "420px")

    assert phones, (
        "no max-width block tightens .mobile-tabbar's gutters to 8px any "
        "more. That rule is half of a matched pair -- if it moved or went "
        "away, re-check the cap block's lower bound against wherever the "
        "phone gutters live now."
    )
    assert caps, "no min-width block caps .mobile-tabbar at 420px any more"

    phone, cap = max(phones), min(caps)
    assert cap == phone + 1, (
        "the phone gutters stop at " + str(phone) + "px and the tab-bar cap "
        "starts at " + str(cap) + "px. Those have to be adjacent: "
        + ("a gap leaves " + str(phone + 1) + "-" + str(cap - 1) + "px on the "
           "base `left: 12px`, so the bar stretches to the full window there "
           "-- the same full-width bar in a narrower band"
           if cap > phone + 1 else
           "they overlap over " + str(cap) + "-" + str(phone) + "px, where the "
           "cap is later in the file and silently overrides the 8px phone "
           "gutters it is explicitly not supposed to touch")
    )


def test_the_tab_bar_cap_is_the_last_word_on_the_bar_insets():
    """The cap beats the base rule on SOURCE ORDER and nothing else.

    `.mobile-tabbar { left: 12px; right: 12px }` in the `@media all` block
    and the cap's own `.mobile-tabbar` are the same selector at the same
    specificity, and a media query adds none. So the only reason the cap
    applies at all is that it is written later in the file.

    That makes the cap block's POSITION load-bearing in a way nothing about
    it looks: moved above the `@media all` block -- a plausible tidy-up,
    since it reads like a companion to the breakpoint rules up there -- the
    base 12px wins again and the cap is dead at every width, with the block
    still present, still spelled correctly, and every other assertion in
    this file still green (checked -- all 15 passed on exactly that move).

    Pinned as "last", not "after the base rule", because a NEW inset rule
    added below the cap would break it the same way and deserves the same
    look.
    """
    src = re.sub(r"/\*.*?\*/", "", STYLE_CSS.read_text(encoding="utf-8"),
                 flags=re.S)

    # Only the rules that actually write an inset. `.mobile-tabbar`'s other
    # rules (the sheet-open recede, the an-result hide) set no left/right
    # and cannot override anything here.
    insets = [
        (m.start(), m.group(1))
        for m in re.finditer(r"\.mobile-tabbar\s*\{([^{}]*)\}", src)
        if re.search(r"\bleft\s*:", m.group(1))
    ]
    assert len(insets) >= 2, (
        "expected at least the base inset and the 420px cap to write "
        f".mobile-tabbar's insets, found {len(insets)}"
    )

    caps = [at for at, body in insets if "420px" in body]
    assert len(caps) == 1, (
        f"expected exactly one 420px tab-bar cap, found {len(caps)}. Two "
        "would mean the later one silently decides the width."
    )

    assert caps[0] == max(at for at, _ in insets), (
        "the 420px cap is not the last rule in style.css to set "
        ".mobile-tabbar's left/right. Everything that writes those insets "
        "is `.mobile-tabbar` at identical specificity, so whichever comes "
        "last wins outright -- a cap written above the base `left: 12px` "
        "is inert at every width and shows no error at all."
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


def test_the_surround_is_dimmed_with_the_column_on_a_tablet():
    """A full-bleed overlay is clipped to the column, so its dim stops there.

    Regression: ISSUE-001 -- on an iPad in landscape the tour's backdrop and
    the sheet recede dimmed the 720px app column and left a bright 230px
    band down each side, which reads as a rendering fault rather than a
    design.
    Found by /qa on 2026-09-09.
    Report: .gstack/qa-reports/qa-report-repcheck-2026-09-09.md

    The surround has to be painted to match, because <body> cannot simply be
    widened: its `overflow: hidden` is what gives the desk skin its bezel.
    """
    src = STYLE_CSS.read_text(encoding="utf-8")

    # Tablet-scoped, so the desk skin keeps its gradient behind an open
    # sheet -- there the dim SHOULD stop at the phone's edge.
    # Trailing brace in the header on purpose: without it `src.index`
    # matches a NARROWED gate as a prefix, and a tightened media query
    # would silently pass while the rules never apply.
    dim = _block(src, "@media (min-width: 721px) and (pointer: coarse) {")
    assert "html.tour-dim" in dim, "the tour's surround must be dimmed to match"
    assert "html.pc-sheet-active" in dim, (
        "the sheet recede's surround must be dimmed to match"
    )
    assert "html.pc-sheet-active body" in dim, (
        ".app scales to 0.92 behind a sheet, so <body>'s own background shows "
        "as a ring inside the column and has to be painted too"
    )

    # And NOT in the shared block, which the desk also matches.
    shared = _block(src, SHARED)
    assert "tour-dim" not in shared, (
        "the surround dim is in the shared >=721px block, so it repaints the "
        "desk's gradient too -- there the dim is meant to stop at the bezel"
    )


def test_the_tour_tells_the_stylesheet_when_it_is_dimming():
    """CSS cannot see a descendant overlay, so tour.js has to say so.

    Regression: ISSUE-001 -- see the test above.
    Found by /qa on 2026-09-09.

    A class on <html> rather than `html:has(.tour-overlay.is-visible)`, for
    the reason auth.css already gives for its own lock: it must not depend
    on selector support in whatever WKWebView the shipped shell runs.
    """
    src = (ROOT / "static" / "tour.js").read_text(encoding="utf-8")

    assert 'classList.toggle("tour-dim"' in src, (
        "tour.js must stamp the dim state onto <html> for the stylesheet"
    )
    # Raised when the overlay appears, and cleared on BOTH exits -- a stale
    # tour-dim would leave the whole app tinted with no tour on screen.
    assert src.count("setTourDim(false)") >= 2, (
        "the dim must be cleared on both the hide and the end paths, or it "
        "outlives the tour and tints the app permanently"
    )
    assert "setTourDim(true)" in src, "the dim must be raised when the tour shows"
