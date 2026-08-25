"""The camera call sites must go through RepCheckNative, not straight to the input.

Apple rejects a web app in a wrapper -- Guideline 4.2, "Minimum
Functionality". RepCheck's answer is that inside the iOS shell the photo
flows use the real native camera (static/native.js), and that only works if
every place that opens a camera actually routes through the bridge. A call
site that goes back to `input.click()` directly still works perfectly in a
browser, which is exactly what makes it easy to reintroduce and impossible
to notice: the regression is invisible until App Review sees a wrapper with
no native functionality in it.

Source-level regex assertions against the real files, matching the tradeoff
tests/test_cross_user_name_escaping.py already makes. The behaviour of the
bridge itself is covered properly in tests-js/native.test.js, against the
real static/native.js in jsdom -- this file only pins that the call sites
are plugged into it, which is textual.

Mutation-checked: reverting any wired call site to a bare .click(), or
dropping the native.js script tag from base.html, fails this file.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


def test_base_html_loads_the_bridge_on_every_page():
    """Every page can open a camera, and each of them assumes
    RepCheckNative already exists, so this cannot be a per-page include."""
    base = read("templates/base.html")

    assert "asset_url('native.js')" in base, "base.html must load static/native.js"
    # Before account_sync.js, which is the first of the shared scripts --
    # anything later could run before the bridge is defined.
    assert base.index("native.js") < base.index("account_sync.js")


def test_food_photo_buttons_go_through_the_bridge():
    nutrition = read("templates/nutrition.html")

    assert nutrition.count("RepCheckNative.openCamera(afCameraInput") == 2, (
        "both af-take-photo-btn handlers must use the native camera"
    )
    assert nutrition.count("RepCheckNative.openLibrary(afUploadInput") == 2
    # The old direct route must be gone from those handlers.
    assert not re.search(
        r'af-take-photo-btn"\)\.addEventListener\("click", \(\) => afCameraInput\.click\(\)\)',
        nutrition,
    ), "a food-photo button went back to clicking the input directly"
    assert not re.search(
        r'af-upload-photo-btn"\)\.addEventListener\("click", \(\) => afUploadInput\.click\(\)\)',
        nutrition,
    )


def test_progress_photo_slots_go_through_the_bridge():
    """Check-in photos are of the user's body -- the most sensitive capture
    in the app, and the one most worth having on a real native path."""
    coaching = read("static/coaching.js")

    assert "RepCheckNative.openCamera(null" in coaching
    assert "setCheckinPhoto(input.dataset.photoInput, file)" in coaching


def test_the_web_path_is_still_guarded():
    """Almost every user is in a browser. The native branch must be behind
    an isNative() check everywhere, or a bridge bug becomes a web outage."""
    coaching = read("static/coaching.js")

    assert "window.RepCheckNative.isNative()" in coaching, (
        "the progress-photo interception must no-op in a browser"
    )
    native = read("static/native.js")
    assert "if (!isNative()) {" in native, (
        "openWith must fall back to the hidden input when not in the shell"
    )


def test_capacitor_config_points_at_production():
    """The shell loads the live site, so a config pointing anywhere else
    (a localhost dev URL left behind) ships an app that cannot start."""
    import json

    config = json.loads(read("capacitor.config.json"))

    assert config["server"]["url"] == "https://repcheck-q0m4.onrender.com"
    assert config["server"]["cleartext"] is False, "the shell must not allow plain HTTP"
    assert config["appId"], "a bundle id is required before an app can be created"


def test_offline_shell_exists_and_is_self_contained():
    """Capacitor copies webDir into the bundle; it is what the webview shows
    with no connection at launch. It has to render with zero network, so no
    external stylesheet, font or script may creep into it."""
    import json

    config = json.loads(read("capacitor.config.json"))
    offline = read(config["webDir"] + "/index.html")

    assert "Try again" in offline
    assert not re.search(r'<(link|script)[^>]+(href|src)="https?://', offline), (
        "the offline page must not reference anything over the network"
    )


def test_web_app_never_imports_the_capacitor_packages():
    """The web app has no build step. static/native.js talks to the runtime
    global window.Capacitor; an `import` here would need a bundler and would
    break the plain <script> load in base.html."""
    native = read("static/native.js")

    assert "@capacitor/" not in native, "native.js must not import the npm packages"
    assert "window.Capacitor" in native
