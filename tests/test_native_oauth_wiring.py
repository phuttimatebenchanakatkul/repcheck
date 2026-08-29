"""The pieces of native Google and Apple sign-in that only exist as wiring.

The behaviour is covered properly elsewhere -- tests/test_native_google_handoff.py
and tests/test_apple_oauth_callback.py for the server,
tests-js/native-google-signin.test.js for the bridge. What none of them can
see is whether the parts are actually connected, because every one of these
regressions is invisible in a browser and only shows up in a TestFlight
build:

- the auth pages not loading native.js, so the buttons stay plain links
- a button losing its hook, same result
- the Info.plist step not registering repcheck://, so iOS has no idea the
  app owns the scheme and the callback redirect goes nowhere
- the plugins disappearing from package.json, so `cap sync` never copies
  them into the Xcode project

Both providers need identical wiring for identical reasons: neither Google
nor Apple will authorize inside an embedded webview, so both run in
SFSafariViewController and both come home over repcheck://.

Source-level regex assertions against the real files, the same tradeoff
tests/test_native_bridge_wiring.py already makes and for the same reason.

Mutation-checked: dropping the script tag, either data-*-signin attribute,
either provider's lookup, the URL-scheme build step, or either plugin fails
this file.
"""

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

AUTH_PAGES = ("templates/login.html", "templates/signup.html")

# (button class, hook attribute, bridge entry point)
PROVIDERS = (
    ("auth-google-btn", "data-google-signin", "signInWithGoogle"),
    ("auth-apple-btn", "data-apple-signin", "signInWithApple"),
)


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


def test_auth_pages_load_the_bridge():
    """login.html and signup.html are standalone -- they do not extend
    base.html, so they do not inherit its native.js include."""
    for page in AUTH_PAGES:
        assert "asset_url('native.js')" in read(page), (
            f"{page} must load static/native.js, or the sign-in entry points "
            "do not exist and both OAuth buttons stay plain links that sign "
            "the user into Safari instead of the app"
        )


@pytest.mark.parametrize("button_class,hook,entry_point", PROVIDERS)
def test_the_oauth_button_is_hooked_up(button_class, hook, entry_point):
    for page in AUTH_PAGES:
        source = read(page)
        # Anchored to the <a>, not just "the string appears somewhere": the
        # provider table below also contains the attribute name, so a looser
        # check still passes with it stripped off the button -- which is
        # exactly the regression this is here to catch.
        assert f'{button_class}" {hook}' in source, (
            f"{page} lost the {hook} attribute on the {button_class} button"
        )
        assert f"'[{hook}]'" in source, f"{page} no longer looks that button up"
        assert entry_point in source, f"{page} no longer calls {entry_point}"
        assert "preventDefault" in source, (
            f"{page} must suppress the plain link when the bridge takes over, "
            "or the webview navigates to the provider as well as the in-app browser"
        )


@pytest.mark.parametrize("button_class,hook,entry_point", PROVIDERS)
def test_the_bridge_exposes_the_sign_in_entry_point(button_class, hook, entry_point):
    source = read("static/native.js")
    assert f"{entry_point}: {entry_point}" in source, (
        f"{entry_point} must stay on the RepCheckNative export, it is what "
        "the auth pages call"
    )


def test_the_bridge_listens_for_the_callback():
    assert "appUrlOpen" in read("static/native.js"), (
        "without the appUrlOpen listener the repcheck:// callback is never "
        "received and sign-in dead-ends in the browser"
    )


def test_the_build_registers_the_url_scheme():
    """iOS only routes repcheck:// back to the app if Info.plist claims it,
    and the Xcode project is regenerated from scratch every build -- so this
    has to be a build step, not something set once by hand."""
    workflow = read("codemagic.yaml")
    assert "CFBundleURLSchemes" in workflow, "the build must register a URL scheme"
    assert "string repcheck" in workflow, (
        "the registered scheme must be repcheck, matching NATIVE_URL_SCHEME "
        "in auth.py and NATIVE_AUTH_SCHEME in static/native.js"
    )


def test_the_scheme_matches_on_both_sides():
    """Three files independently spell this scheme. They have to agree."""
    assert 'NATIVE_URL_SCHEME = "repcheck"' in read("auth.py")
    assert 'NATIVE_AUTH_SCHEME = "repcheck://auth"' in read("static/native.js")


def test_the_capacitor_plugins_are_declared():
    """cap sync copies the native halves out of node_modules -- a plugin
    missing here is missing from the Xcode project, and the bridge degrades
    to the broken web behaviour without saying anything."""
    package = json.loads(read("package.json"))
    dependencies = package["dependencies"]
    for plugin in ("@capacitor/browser", "@capacitor/app"):
        assert plugin in dependencies, f"{plugin} is required for native OAuth sign-in"


def test_native_complete_is_reachable_without_a_session():
    """The endpoint that establishes the session cannot itself require one."""
    assert '"auth.native_complete"' in read("app.py"), (
        "auth.native_complete must be in _PUBLIC_ENDPOINTS, or the app "
        "bounces to /login before it can redeem its token and can never "
        "sign in at all"
    )


def test_apple_endpoints_are_reachable_without_a_session():
    """Same reasoning: the sign-in flow itself cannot require a session."""
    source = read("app.py")
    assert '"auth.apple_login", "auth.apple_callback"' in source, (
        "the Apple sign-in endpoints must be in _PUBLIC_ENDPOINTS, or a "
        "logged-out visitor is bounced to /login before the flow can start"
    )
