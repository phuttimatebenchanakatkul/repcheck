"""Guards the log in / sign up screen being one still, non-scrolling page.

Log in and sign up are the first thing anyone sees, in the browser and in
the iOS App Store build alike -- the Capacitor shell has no bundled web
assets, its webview loads the live site straight from the server (see
capacitor.config.json), so these same two templates and this same
stylesheet ARE the App Store app's first screen. They are meant to sit
still: nothing to scroll, and no iOS rubber-band bounce when you drag.

Four separate pieces have to hold for that, and each fails silently -- the
page still renders, it just starts moving again (or, worse, stops being
reachable):

1. The <html> class the page lock keys off. auth.css deliberately does not
   use :has() for this, so if the class goes the lock simply stops applying.
2. The lock itself: <body> pinned to position:fixed. `overflow: hidden`
   alone does not stop iOS panning the page -- the quirk base.html's sheet
   lock documents at length. Dropping to overflow-only would look correct
   in a desktop browser and bounce on a phone.
3. The content actually fitting. Sign up is the taller page, and measured
   at 375x667 -- an iPhone SE, the smallest screen iOS 18 runs -- it was
   47px too tall before the short-viewport block, and over again once the
   error banner renders. A page locked against scrolling whose content does
   not fit does not "stay still", it clips its own submit button, so the
   compaction is load-bearing rather than cosmetic.
4. The keyboard-aware height (auth_viewport.js). The pin is measured against
   the layout viewport, which the on-screen keyboard does not shrink, so
   without it the submit button hides behind the keyboard with nothing left
   to scroll.

Source-level regex assertions against the real files, the same tradeoff
test_cross_user_name_escaping.py makes: there is no build step and no way
to assert computed layout from pytest. The behavioural half was verified in
a real browser, both pages, with and without the error banner, across every
iPhone CSS height from 568 to 956 plus the 740/741 breakpoint boundary. The
measured height budget: log in needs 616px (538 compact), sign up 714px
(634 compact), and either page with an error 560/654px -- so the tightest
supported screen, a 375x667 iPhone SE, clears its worst case by 13px.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUTH_TEMPLATES = ("templates/login.html", "templates/signup.html")


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_auth_templates_carry_the_html_class_the_lock_keys_off():
    for rel in AUTH_TEMPLATES:
        assert 'class="auth-html"' in read(rel), (
            f"{rel} must put class=\"auth-html\" on <html>. auth.css locks the "
            "page via `html.auth-html` rather than a :has() match on the body, "
            "so that the lock does not depend on selector support in whatever "
            "WKWebView the shipped iOS build happens to run. Without the class "
            "the page scrolls and bounces again, with no other symptom."
        )


def test_auth_templates_flag_the_error_state_to_css():
    for rel in AUTH_TEMPLATES:
        assert "auth-has-error" in read(rel), (
            f"{rel} must add `auth-has-error` to <body> when Jinja renders an "
            "error. The banner is ~65px the card is not otherwise sized for, "
            "which pushes sign up back over the height of a 375x667 screen; "
            "auth.css tightens the layout only in that state so the common "
            "no-error screen does not have to look cramped for it."
        )


def test_auth_page_is_pinned_not_merely_overflow_hidden():
    css = read("static/auth.css")
    lock = re.search(
        r"@media \(max-width: 720px\) \{(.*?)\n\}", css, re.S
    )
    assert lock, (
        "auth.css must keep the phone-only lock block (@media (max-width: "
        "720px)). Above 721px style.css draws the app inside a device frame "
        "whose <body> IS the phone, so the lock must stay scoped below it."
    )
    body = lock.group(1)
    assert "position: fixed" in body, (
        "The auth <body> must be pinned with position:fixed inside the "
        "phone-only block. `overflow: hidden` on its own does NOT stop iOS "
        "panning the page -- pinning is what leaves no scrollable area for "
        "the OS to pan into. This is the same fix base.html's bottom-sheet "
        "lock applies, for the same reason."
    )
    assert "overscroll-behavior: none" in body, (
        "The auth page must set overscroll-behavior:none, which is what "
        "stops the rubber-band bounce on browsers that honour it."
    )


def test_short_viewports_compact_the_layout_so_it_still_fits():
    css = read("static/auth.css")
    assert "@media (max-height: 740px)" in css, (
        "auth.css must keep the short-viewport block. Sign up measured 47px "
        "taller than a 375x667 screen without it, and the page is locked "
        "against scrolling -- so losing this does not reintroduce a scroll, "
        "it clips the Sign up button off the bottom of the smallest iPhone "
        "iOS 18 still supports."
    )
    assert ".auth-has-error .auth-card" in css, (
        "The error state needs its own tightening: the generic compaction is "
        "not enough once the banner is on screen."
    )


def test_error_state_tightening_is_not_behind_a_height_breakpoint():
    """The error rules must stay unconditional, not nested in a media query.

    They were nested, at the same 740px breakpoint as the generic compaction,
    and that left a hole big enough to drive an iPhone through: a 13 mini is
    780 CSS px tall, so it took the un-compacted layout, and sign up plus the
    banner measured 793px -- 13px of scroll on a current phone, on the exact
    screen this whole change exists to hold still. Any height breakpoint
    invites the next phone to land just above it, so the error state is
    tightened on every screen height instead.

    Every rule inside a media block in this file is indented; top-level rules
    start at column 0. That is what distinguishes the two here.
    """
    css = read("static/auth.css")
    nested = [
        line for line in css.splitlines()
        if line.startswith((" ", "\t")) and ".auth-has-error" in line
    ]
    assert not nested, (
        "The .auth-has-error rules must stay at the top level of auth.css, not "
        "indented inside an @media block. Found nested: "
        f"{nested!r}. Putting them back behind a height breakpoint reintroduces "
        "the 780px-tall-phone gap (measured: 793px of content in a 780px "
        "viewport) with no visible symptom other than the page scrolling again."
    )


def test_auth_pages_load_the_visual_viewport_sync():
    """The pin needs a keyboard-aware height or the submit button strands.

    iOS shrinks the VISUAL viewport for the on-screen keyboard and leaves the
    layout viewport alone. `position: fixed` + `inset: 0` measures the layout
    one, so with the keyboard up <body> is still full-phone-height, still
    centring against that height, and the submit button sits behind the
    keyboard -- with nothing to scroll, because .auth-wrap's `max-height: 100%`
    resolves against a <body> that never shrank. Pinning the page without this
    script converts "does not scroll" into "cannot reach the button", which is
    a worse bug than the one being fixed.

    Verified in the browser at 375x667: with the visible strip simulated at
    380px, .auth-wrap gains 254px of internal scroll and the button is
    reachable; with no keyboard it writes back the height the page already had
    and nothing moves.
    """
    for rel in AUTH_TEMPLATES:
        assert "auth_viewport.js" in read(rel), (
            f"{rel} must load auth_viewport.js. These pages are standalone and "
            "do not extend base.html, so they get none of its --pc-vvh "
            "viewport plumbing -- this script is the only thing keeping the "
            "pinned layout in step with the on-screen keyboard."
        )


def test_visual_viewport_sync_does_not_resize_the_desktop_device_frame():
    src = read("static/auth_viewport.js")
    assert "visualViewport" in src and "style.height" in src, (
        "auth_viewport.js must drive <body>'s height from visualViewport -- an "
        "explicit height is the one property that beats `inset: 0`'s bottom on "
        "a fixed-position box."
    )
    assert "min-width: 721px" in src, (
        "auth_viewport.js must skip the resize above 721px. There style.css "
        "draws the app inside a device frame where <body> IS the phone (a "
        "fixed-size, transformed box), so writing a viewport height onto it "
        "would resize the simulated phone itself rather than its contents."
    )
