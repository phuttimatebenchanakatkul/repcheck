"""Pins the build step that hides the WKWebView's native scroll indicators.

CSS cannot do this. `*::-webkit-scrollbar { display: none; }` is the standard
web fix for this and it does NOT work in WKWebView -- verified before writing
this, not assumed: WKWebView is a long-documented exception that ignores the
pseudo-element entirely, unlike Safari/Chrome. The only real fix is the
native UIScrollView property underneath the webview
(`showsVerticalScrollIndicator` / `showsHorizontalScrollIndicator`), which
has no capacitor.config.json equivalent -- Capacitor exposes `contentInset`
but nothing for scroll indicators.

ios/ is regenerated from scratch every build (see codemagic.yaml's "Generate
the iOS project" step), so this can only be a build-time patch, not a
checked-in native file. It targets SceneDelegate.swift, where the template
Capacitor 8 ships instantiates CAPBridgeViewController and makes it visible
-- verified by extracting the actual template archive this repo's own
pinned node_modules/@capacitor/cli contains
(node_modules/@capacitor/cli/assets/ios-spm-template.tar.gz), not assumed
from memory or a version other than the one this repo builds with.

The patch script itself was extracted from codemagic.yaml and run against a
copy of that real template file before ever going near a build: confirms the
substitution matches and produces valid Swift, and confirms it fails loudly
(exit 1, not a silent no-op) if Capacitor ever changes that block enough to
break the match -- both verified by mutation, not assumed.

Source-level assertions against the real file, the same tradeoff
tests/test_native_oauth_wiring.py already makes for the same reason: this
build step is invisible in a browser and only shows up in a TestFlight build.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_build_hides_the_native_scroll_indicators():
    workflow = read("codemagic.yaml")
    assert "showsVerticalScrollIndicator = false" in workflow, (
        "the build must set the webview's scrollView.showsVerticalScrollIndicator "
        "to false -- CSS cannot do this in WKWebView, see this file's module "
        "docstring for why"
    )
    assert "showsHorizontalScrollIndicator = false" in workflow, (
        "same as vertical -- both directions need the native property set, "
        "not just one"
    )


def test_the_patch_runs_before_the_scene_delegate_could_be_read_elsewhere():
    """The patch step must come after cap sync (which writes
    SceneDelegate.swift in the first place) and it targets the file by its
    real generated path, not a guess -- a wrong path makes the patch a
    silent no-op on a file that never gets modified, which not-founding
    check below is what stops."""
    workflow = read("codemagic.yaml")
    generate_index = workflow.index("Generate the iOS project")
    patch_index = workflow.index("Hide the WKWebView's native scroll indicators")
    assert generate_index < patch_index, (
        "the scroll-indicator patch must run after cap sync generates "
        "ios/App/App/SceneDelegate.swift, or the file will not exist yet"
    )
    assert "ios/App/App/SceneDelegate.swift" in workflow


def test_the_patch_fails_loudly_if_the_template_no_longer_matches():
    """Capacitor's iOS template is Ionic's, not ours -- a future CLI upgrade
    could restructure SceneDelegate.swift and silently strand this patch. It
    must error out (exit 1) rather than pass through a webview that still
    shows scroll indicators with no signal anything is wrong."""
    workflow = read("codemagic.yaml")
    assert "sys.exit(1)" in workflow, (
        "the patch script must exit non-zero when its anchor text is not "
        "found in SceneDelegate.swift, so a future Capacitor template change "
        "fails the build instead of silently doing nothing"
    )


def test_the_patch_reads_the_webview_not_reassigns_it():
    """CAPBridgeViewController.webView is `public fileprivate(set)` (verified
    against the vendored Swift source in
    node_modules/@capacitor/ios/Capacitor/Capacitor/CAPBridgeViewController.swift)
    -- readable outside the Capacitor module, but its SETTER is not. The
    patch must only read .webView and mutate .scrollView on it, never assign
    a new value to .webView itself, or the patched Swift will not compile."""
    workflow = read("codemagic.yaml")
    assert "bridgeViewController.webView = " not in workflow.replace(
        "bridgeViewController.webView?.scrollView", ""
    ), (
        "must not reassign .webView -- CAPBridgeViewController.webView's "
        "setter is fileprivate to the Capacitor module and this file is not "
        "in that module"
    )
