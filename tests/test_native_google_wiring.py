"""The pieces of native Google sign-in that only exist as wiring.

The behaviour is covered properly elsewhere -- tests/test_native_google_handoff.py
for the server, tests-js/native-google-signin.test.js for the bridge. What
neither can see is whether the parts are actually connected, because every
one of these regressions is invisible in a browser and only shows up in a
TestFlight build:

- the auth pages not loading native.js, so the button stays a plain link
- the button losing its hook, same result
- the Info.plist step not registering repcheck://, so iOS has no idea the
  app owns the scheme and the callback redirect goes nowhere
- the plugins disappearing from package.json, so `cap sync` never copies
  them into the Xcode project

Source-level regex assertions against the real files, the same tradeoff
tests/test_native_bridge_wiring.py already makes and for the same reason.

Mutation-checked: dropping the script tag, the data-google-signin attribute,
the URL-scheme build step, or either plugin fails this file.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

AUTH_PAGES = ("templates/login.html", "templates/signup.html")


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


def test_auth_pages_load_the_bridge():
    """login.html and signup.html are standalone -- they do not extend
    base.html, so they do not inherit its native.js include."""
    for page in AUTH_PAGES:
        assert "asset_url('native.js')" in read(page), (
            f"{page} must load static/native.js, or signInWithGoogle does not "
            "exist and the Google button stays a plain link that signs the "
            "user into Safari instead of the app"
        )


def test_the_google_button_is_hooked_up():
    for page in AUTH_PAGES:
        source = read(page)
        # Anchored to the <a>, not just "the string appears somewhere": the
        # querySelector below also contains data-google-signin, so a looser
        # check still passes with the attribute stripped off the button --
        # which is exactly the regression this is here to catch.
        assert 'auth-google-btn" data-google-signin' in source, (
            f"{page} lost the data-google-signin attribute on the Google button"
        )
        assert "querySelector('[data-google-signin]')" in source, (
            f"{page} no longer looks the button up"
        )
        assert "signInWithGoogle" in source, f"{page} no longer calls signInWithGoogle"
        assert "preventDefault" in source, (
            f"{page} must suppress the plain link when the bridge takes over, "
            "or the webview navigates to Google as well as the in-app browser"
        )


def test_the_bridge_exposes_the_sign_in_entry_point():
    source = read("static/native.js")
    assert "signInWithGoogle: signInWithGoogle" in source, (
        "signInWithGoogle must stay on the RepCheckNative export, it is what "
        "the auth pages call"
    )
    assert "appUrlOpen" in source, (
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
        assert plugin in dependencies, f"{plugin} is required for native Google sign-in"


def test_native_complete_is_reachable_without_a_session():
    """The endpoint that establishes the session cannot itself require one."""
    assert '"auth.native_complete"' in read("app.py"), (
        "auth.native_complete must be in _PUBLIC_ENDPOINTS, or the app "
        "bounces to /login before it can redeem its token and can never "
        "sign in at all"
    )
