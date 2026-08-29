// Native-shell bridge (RepCheckNative).
//
// RepCheck is a server-rendered web app that is ALSO shipped as an iOS app:
// a Capacitor shell whose webview loads the live site (see capacitor.config.json
// and IOS_APP_STORE.md). Apple rejects apps that are only a website in a
// wrapper -- Guideline 4.2, "Minimum Functionality" -- so inside the shell the
// photo and video flows have to go through real native APIs rather than the
// browser's <input type="file"> picker.
//
// The web app has no build step, so this file does NOT import the plugin
// packages. Capacitor registers every installed plugin on window.Capacitor
// .Plugins at runtime inside the native shell, and that global is the only
// thing this file touches. The npm packages exist purely so `npx cap sync`
// can copy the native halves into the Xcode project; nothing here is bundled.
//
// Every entry point degrades to exactly the behaviour that shipped before it:
// in a normal browser there is no window.Capacitor, so openCamera/openLibrary
// click the same hidden <input> the call site already had, and that input's
// existing change listener runs untouched. The native path is additive -- if
// it is missing, broken, or the user cancels, the app behaves like the web.

(function (window, document) {
  "use strict";

  // Capacitor's Camera plugin takes plain strings for these; the exported
  // TS enums are only sugar over the same values, and importing them would
  // mean a bundler.
  var CAMERA_SOURCE = { camera: "CAMERA", library: "PHOTOS" };
  var RESULT_URI = "uri";

  function capacitor() {
    return window.Capacitor || null;
  }

  /** True only inside the packaged iOS/Android shell, never in a browser. */
  function isNative() {
    var cap = capacitor();
    return Boolean(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  }

  function platform() {
    var cap = capacitor();
    return (cap && typeof cap.getPlatform === "function" && cap.getPlatform()) || "web";
  }

  /**
   * A registered Capacitor plugin, or null. Null is an ordinary outcome, not
   * an error: it is what every browser returns, and it is also what the shell
   * returns for a plugin that was added to package.json but not yet synced
   * into the native project. Callers fall back rather than fail.
   */
  function plugin(name) {
    var cap = capacitor();
    return (cap && cap.Plugins && cap.Plugins[name]) || null;
  }

  /**
   * Capacitor signals "user backed out of the camera" by throwing, the same
   * way it signals a real failure. Cancelling is not an error and must not be
   * logged or surfaced -- the user pressing Cancel is the feature working.
   */
  function isCancellation(error) {
    var message = String((error && error.message) || error || "").toLowerCase();
    return message.indexOf("cancel") !== -1 || message.indexOf("no image picked") !== -1;
  }

  function extensionFor(format) {
    if (format === "png") return "png";
    if (format === "webp") return "webp";
    return "jpg";
  }

  /**
   * Turn a Camera result into a File, so native photos arrive at the existing
   * upload code in exactly the shape an <input type="file"> would have given
   * it. Everything downstream (useAfImage, the check-in photo slots, the
   * /api/* multipart posts) then needs no native-specific branch at all.
   */
  async function photoToFile(photo) {
    var path = photo && (photo.webPath || photo.path);
    if (!path) return null;
    var response = await window.fetch(path);
    var blob = await response.blob();
    var extension = extensionFor(photo.format);
    return new window.File([blob], "photo." + extension, {
      type: blob.type || "image/" + (extension === "jpg" ? "jpeg" : extension),
    });
  }

  /**
   * Open the native camera or photo library and resolve with a File.
   *
   * Resolves null for every "carry on as if nothing happened" outcome:
   * running in a browser, the plugin not being present, the user cancelling,
   * or a permission the user declined. Callers treat null as "no photo", not
   * as a failure to report.
   */
  async function pickImage(options) {
    var settings = options || {};
    var Camera = plugin("Camera");
    if (!Camera || !isNative()) return null;

    var photo;
    try {
      photo = await Camera.getPhoto({
        source: CAMERA_SOURCE[settings.source] || CAMERA_SOURCE.camera,
        resultType: RESULT_URI,
        quality: typeof settings.quality === "number" ? settings.quality : 85,
        // The photo goes straight to an AI estimate or a private progress
        // log; cropping it first is friction with no payoff, and saving a
        // copy into the user's camera roll is a surprise nobody asked for.
        allowEditing: false,
        saveToGallery: false,
        correctOrientation: true,
      });
    } catch (error) {
      if (!isCancellation(error)) {
        // Genuine failure (no camera, plugin misconfigured). The caller still
        // gets null and carries on -- a broken camera must not break logging.
        console.warn("RepCheckNative: camera failed", error);
      }
      return null;
    }

    try {
      return await photoToFile(photo);
    } catch (error) {
      console.warn("RepCheckNative: could not read the captured photo", error);
      return null;
    }
  }

  /**
   * The one call sites actually use. Native: open the real camera and hand
   * the File to onFile. Web: click the hidden input exactly as before and
   * let its own change listener deliver the File. Same outcome either way,
   * so no call site needs to know which shell it is running in.
   */
  function openCamera(fallbackInput, onFile) {
    return openWith("camera", fallbackInput, onFile);
  }

  function openLibrary(fallbackInput, onFile) {
    return openWith("library", fallbackInput, onFile);
  }

  function openWith(source, fallbackInput, onFile) {
    if (!isNative()) {
      if (fallbackInput) fallbackInput.click();
      return Promise.resolve(null);
    }
    return pickImage({ source: source }).then(function (file) {
      if (file && typeof onFile === "function") onFile(file);
      // A native cancel must NOT fall through to clicking the hidden input --
      // that would reopen a second, web-style picker over the one the user
      // just dismissed.
      return file;
    });
  }

  /**
   * Fire-and-forget haptic tap (finishing a set, logging a meal). Silent
   * everywhere it is unavailable, which is every browser.
   */
  function haptic(style) {
    var Haptics = plugin("Haptics");
    if (!Haptics || typeof Haptics.impact !== "function") return;
    try {
      var result = Haptics.impact({ style: style || "MEDIUM" });
      if (result && typeof result.catch === "function") result.catch(function () {});
    } catch (error) {
      /* haptics are decoration -- never let them reach the user */
    }
  }

  // ---- Google sign-in ----
  //
  // In a browser the "Continue with Google" button is an ordinary link and
  // everything below is dead code. Inside the shell it cannot be: Google
  // refuses OAuth in an embedded webview, and Capacitor sends off-origin
  // navigations to Safari anyway -- which is what made the button appear to
  // work and then dump the user on the website, signed in to a browser they
  // could not see, because the session cookie went to Safari's jar.
  //
  // So the flow runs in SFSafariViewController (allowed by Google, and what
  // the Browser plugin opens), the server hands back a one-time token over
  // the repcheck:// scheme, and the webview redeems it for its own session.

  var NATIVE_AUTH_SCHEME = "repcheck://auth";
  var authListenerBound = false;

  /** Pull ?token= out of the callback URL without needing a URL parser. */
  function tokenFromUrl(url) {
    var match = /[?&]token=([^&#]+)/.exec(String(url || ""));
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * Listen for the shell being reopened by repcheck://auth?token=...
   *
   * Bound once, and bound as soon as this file runs rather than when the
   * button is pressed: iOS can deliver the URL before any handler attached
   * inside the click would exist, and a missed event strands the user on the
   * login page with no way back.
   */
  function bindAuthListener() {
    if (authListenerBound || !isNative()) return;
    var App = plugin("App");
    if (!App || typeof App.addListener !== "function") return;
    authListenerBound = true;
    App.addListener("appUrlOpen", function (event) {
      var url = event && event.url;
      if (!url || url.indexOf(NATIVE_AUTH_SCHEME) !== 0) return;
      var token = tokenFromUrl(url);
      if (!token) return;
      var Browser = plugin("Browser");
      // Close the sign-in browser before navigating. If it is left open the
      // user lands back on a logged-in app hidden behind a stale Google page.
      if (Browser && typeof Browser.close === "function") {
        try {
          var closing = Browser.close();
          if (closing && typeof closing.catch === "function") closing.catch(function () {});
        } catch (error) {
          /* already closed by the user -- not a failure */
        }
      }
      window.location.assign("/auth/native-complete?token=" + encodeURIComponent(token));
    });
  }

  /**
   * Start Google sign-in from inside the shell.
   *
   * Returns true if it took over, false if the caller should let the plain
   * link proceed -- which is what happens in every browser, and also if the
   * Browser plugin is missing because the native project was not synced.
   */
  function signInWithGoogle(href) {
    if (!isNative()) return false;
    var Browser = plugin("Browser");
    if (!Browser || typeof Browser.open !== "function") return false;

    bindAuthListener();

    // Tell the server this is the shell, so the callback hands back a token
    // instead of setting a cookie in a browser the app cannot read.
    var url = String(href || "/auth/google");
    url += (url.indexOf("?") === -1 ? "?" : "&") + "native=1";

    try {
      var opening = Browser.open({ url: new URL(url, window.location.origin).href });
      if (opening && typeof opening.catch === "function") {
        opening.catch(function () {
          // Could not open the in-app browser: fall back to the plain link
          // rather than leaving a button that silently does nothing.
          window.location.assign(url);
        });
      }
    } catch (error) {
      window.location.assign(url);
      return true;
    }
    return true;
  }

  // The listener has to exist before the user ever taps the button.
  bindAuthListener();

  window.RepCheckNative = {
    isNative: isNative,
    platform: platform,
    pickImage: pickImage,
    openCamera: openCamera,
    openLibrary: openLibrary,
    haptic: haptic,
    signInWithGoogle: signInWithGoogle,
    // Exposed for tests: the pure parts, so the conversion and the
    // cancel/error split can be exercised without a plugin.
    _internals: {
      plugin: plugin,
      isCancellation: isCancellation,
      photoToFile: photoToFile,
      extensionFor: extensionFor,
      tokenFromUrl: tokenFromUrl,
      bindAuthListener: bindAuthListener,
    },
  };
})(window, document);
