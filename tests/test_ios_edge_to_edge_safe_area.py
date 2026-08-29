"""Guards the iOS app rendering edge to edge instead of behind black bars.

capacitor.config.json shipped with `"contentInset": "always"`, which is not
Capacitor's own documented default (`"never"` -- see the @capacitor/cli type
declarations) and is nowhere explained in this repo's history. It sets the
WKWebView scroll view's `contentInsetAdjustmentBehavior` to `.always`
(verified against the vendored Swift source in
node_modules/@capacitor/ios/Capacitor/Capacitor/CAPBridgeViewController.swift,
which assigns `configuration.contentInsetAdjustmentBehavior` straight onto
`aWebView.scrollView` and sets `view = webView` directly -- the web view IS
the full-screen root view, so the black bars are not a frame/sizing issue,
they are UIKit auto-inserting a content inset equal to the safe area and
letting the web view's own background color show through the resulting gap.

The fix has two halves that only work together:

1. contentInset "never" -- stop UIKit from padding the content by the safe
   area at the native level, so the page's own background paints under the
   status bar / Dynamic Island / home indicator instead of the WKWebView's.
2. `viewport-fit=cover` on every served page's viewport meta -- without it,
   `env(safe-area-inset-*)` resolves to its zero fallback everywhere (per the
   WebKit-documented behaviour these CSS rules already assumed), so none of
   the padding this file pins would do anything on a real device even though
   it would look correct in every other tool available to verify it.

Once both are true, content genuinely extends edge to edge, so anything that
used to get free clearance from the native inset -- the topbar's title and
avatar, the auth screens' logo, the onboarding wizard -- needs its OWN
safe-area padding or it sits flush against the notch/Dynamic Island/home
indicator. Three page-root containers needed this (.app, .auth-body,
.ob-body), all pinned below.

A second, independent bug turned up auditing the first: `.app`'s
@media (max-width: 480px) override used a bare `padding: 8px` shorthand,
which matches on every real iPhone in portrait (largest is 430px, well
under 480) and comes after -- same specificity, later source wins -- the
`.app` rule that sets the 82px floating-tab-bar clearance and (after this
fix) the safe-area-inset-top clearance. Reproduced live in a Chromium tab
at 390px width against production's actual style.css: the two rules in
isolation compute `padding-bottom: 8px`, not the intended
`calc(82px + env(safe-area-inset-bottom))` -- i.e. the tab-bar clearance a
prior fix's own comment says is required has been silently broken on every
real phone this whole time, independent of the contentInset bug.

Source-level regex assertions against the real files, the same tradeoff
test_cross_user_name_escaping.py and test_auth_screen_does_not_scroll.py
already make. The CSS cascade claims here (which selector wins at which
breakpoint) were verified by reproducing the exact rule text in a real
browser and reading getComputedStyle -- see the PR description for the
transcript -- not by reasoning about specificity from memory. What could
NOT be verified: the actual safe-area-inset-* pixel values on a real iPhone,
or the visual result in a real WKWebView. This session's only browser is a
Chromium/Android engine (confirmed via navigator.userAgent), which reports
env(safe-area-inset-*) as its zero fallback unconditionally, on every page,
regardless of viewport-fit -- there is no way to simulate a notch/Dynamic
Island/home indicator from this tool. Every assertion below is scoped to
what source inspection and zero-fallback CSS cascade behaviour can actually
prove; the correctness of the max()/env() math past that point rests on the
CSS spec, not on-device observation.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_capacitor_content_inset_is_never_not_always():
    config = read("capacitor.config.json")
    assert '"contentInset": "never"' in config, (
        "capacitor.config.json must set ios.contentInset to \"never\", not "
        "\"always\". \"always\" forces UIKit's UIScrollView.contentInset to "
        "always equal the safe area (contentInsetAdjustmentBehavior = "
        ".always -- see CAPBridgeViewController.swift, which assigns this "
        "straight onto the web view's own scroll view), which is what "
        "produces the black bars above the status bar and below the home "
        "indicator: the web view frame is already full-screen (`view = "
        "webView` in loadView()), so the gap is UIKit's own inset, and its "
        "background color -- not the app's -- shows through. Capacitor's "
        "own documented default is \"never\"; \"always\" was never "
        "explained anywhere in this repo's history."
    )


def test_every_served_page_declares_viewport_fit_cover():
    """Without this, env(safe-area-inset-*) is 0px everywhere, forever.

    That makes every padding fix in this file a silent no-op on a real
    device: it would compute correctly in any tool that fakes env() (none
    exist in this session) and simply never apply on the phone in your
    hand. Scoped to the pages Capacitor's webview can actually load --
    login/signup are the first screen the app shows, onboarding follows
    signup, base.html is every logged-in page.
    """
    served_templates = (
        "templates/base.html",
        "templates/login.html",
        "templates/signup.html",
        "templates/onboarding.html",
    )
    for rel in served_templates:
        content = read(rel)
        viewport_line = next(
            (line for line in content.splitlines() if 'name="viewport"' in line),
            None,
        )
        assert viewport_line is not None, f"{rel} must have a viewport meta tag"
        assert "viewport-fit=cover" in viewport_line, (
            f"{rel}'s viewport meta must include viewport-fit=cover. "
            f"Got: {viewport_line.strip()!r}. Without it, WKWebView (and "
            "Mobile Safari, per WebKit's own iPhone X design guidance) "
            "keeps the page's layout viewport confined to the safe area, "
            "so env(safe-area-inset-*) never resolves to anything but its "
            "zero fallback -- independent of contentInset, and independent "
            "of any padding this file otherwise pins correctly."
        )


def test_app_top_padding_is_safe_area_aware_on_mobile():
    css = read("static/style.css")
    mobile_app_rule = re.search(
        r"\.app \{ flex-direction: column;.*?\}", css
    )
    assert mobile_app_rule, "could not find the mobile .app rule in style.css"
    rule = mobile_app_rule.group(0)
    assert "padding-top: max(12px, env(safe-area-inset-top" in rule, (
        "The mobile .app rule must set padding-top via max(12px, "
        "env(safe-area-inset-top, 0px)), not a flat value. With "
        "contentInset now \"never\" (see capacitor.config.json), this "
        "padding is the ONLY thing keeping the topbar's title and avatar "
        "clear of a notch or Dynamic Island -- a flat 12px was fine only "
        "when the native inset was doing this job for free."
    )
    assert "padding-bottom: calc(82px + env(safe-area-inset-bottom" in rule, (
        "The mobile .app rule's 82px floating-tab-bar clearance must "
        "still be there. If this changed, check whether it moved to a "
        "narrower breakpoint that would need the same protection -- see "
        "test_app_480px_rule_does_not_clobber_the_wider_rule below."
    )


def test_app_480px_rule_does_not_clobber_the_wider_rule():
    """Regression test for the second bug: shorthand `padding` at a later,
    narrower breakpoint silently overwrites BOTH the tab-bar clearance and
    the safe-area clearance set at the wider breakpoint, on every real
    iPhone (max device width 430px, this rule matches at 480px and below).

    Verified live: reproducing the pre-fix two rules in a real browser at
    390px computed padding-bottom: 8px, not calc(82px + ...). Reproducing
    the fixed three declarations below at the same width computed
    padding-bottom: 82px (env() 0-fallback in this tool, so the real number
    is calc(82px + 0) here -- but the point is that fallback is no longer
    being discarded)."""
    css = read("static/style.css")
    narrow_block = re.search(
        r"@media \(max-width: 480px\) \{(.*?)\n\}", css, re.S
    )
    assert narrow_block, "could not find the @media (max-width: 480px) block"
    block = narrow_block.group(1)
    app_rule = re.search(r"\.app \{([^}]*)\}", block)
    assert app_rule, "the 480px block must still style .app"
    declarations = app_rule.group(1)
    assert "padding:" not in declarations, (
        "the .app rule inside @media (max-width: 480px) must not use the "
        "`padding` shorthand. It matches on every real iPhone in portrait "
        "(largest is 430px) at the same time as the wider mobile .app rule "
        "and has equal specificity, so shorthand here silently overwrites "
        "that rule's padding-bottom (the 82px tab-bar clearance) and "
        "padding-top (the safe-area clearance) with a flat value on every "
        "phone -- not an edge case. Use padding-left/padding-right only, "
        "plus padding-top if this breakpoint needs its own value."
    )
    assert "padding-left: 8px" in declarations and "padding-right: 8px" in declarations, (
        "the 480px override should still tighten the horizontal edges to "
        "8px -- that half of the original rule was fine, only the "
        "shorthand form of it was the bug."
    )


def test_auth_body_top_and_bottom_padding_are_safe_area_aware():
    css = read("static/auth.css")
    base_rule = re.search(r"\.auth-body \{(.*?)\n\}", css, re.S)
    assert base_rule, "could not find the base .auth-body rule"
    body = base_rule.group(1)
    assert "padding-top: max(24px, env(safe-area-inset-top" in body, (
        ".auth-body's base rule must set padding-top via max(24px, "
        "env(safe-area-inset-top, 0px)). With contentInset now \"never\", "
        "the RepCheck wordmark sits flush against whatever this padding "
        "is -- a flat 24px is not enough clearance from a notch or "
        "Dynamic Island."
    )
    assert "padding-bottom: max(24px, env(safe-area-inset-bottom" in body, (
        ".auth-body's base rule must set padding-bottom the same way, for "
        "the home indicator."
    )


def test_auth_body_overrides_do_not_clobber_the_safe_area_padding():
    """Both later rules that override .auth-body's padding use the same
    `padding` shorthand pattern that broke .app at 480px -- if either one
    reverts to a flat value, the safe-area clearance silently vanishes at
    exactly the breakpoints most likely to be a real notch/Dynamic-Island
    device (a Dynamic Island phone is always under the 836px desktop-frame
    threshold, and the error state applies at every height)."""
    css = read("static/auth.css")

    compact_block = re.search(
        r"@media \(max-height: 740px\),\s*\n\s*\(min-width: 721px\) and \(max-height: 836px\) \{(.*?)\n\}",
        css,
        re.S,
    )
    assert compact_block, "could not find the compact-height media block"
    compact_auth_body = re.search(r"\.auth-body \{([^}]*)\}", compact_block.group(1))
    assert compact_auth_body, "the compact block must still style .auth-body"
    compact_declarations = compact_auth_body.group(1)
    assert "padding-top: max(16px, env(safe-area-inset-top" in compact_declarations
    assert "padding-bottom: max(16px, env(safe-area-inset-bottom" in compact_declarations

    error_rule = re.search(r"\.auth-has-error \{([^}]*)\}", css)
    assert error_rule, "could not find .auth-has-error"
    error_declarations = error_rule.group(1)
    assert "padding-top: max(12px, env(safe-area-inset-top" in error_declarations
    assert "padding-bottom: max(12px, env(safe-area-inset-bottom" in error_declarations


def test_onboarding_body_padding_is_safe_area_aware():
    onboarding = read("templates/onboarding.html")
    ob_body_rule = re.search(r"body\.ob-body \{(.*?)\n\s*\}", onboarding, re.S)
    assert ob_body_rule, "could not find the body.ob-body rule in onboarding.html"
    body = ob_body_rule.group(1)
    assert "padding-top: max(24px, env(safe-area-inset-top" in body, (
        "body.ob-body must set padding-top via max(24px, "
        "env(safe-area-inset-top, 0px)) -- same reasoning as .auth-body: "
        "flat 24px stopped being enough the moment contentInset became "
        "\"never\"."
    )
    assert "padding-bottom: max(24px, env(safe-area-inset-bottom" in body
