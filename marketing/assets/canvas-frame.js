/* WHICH HOSTS SHOW THE 1080x566 INSTAGRAM CANVAS.
 *
 * Both Render static sites publish this same directory from the same branch,
 * so there is no per-site build to vary and no CSS media feature that can see
 * a hostname. The frame is therefore a class, added here and scoped in
 * styles.css under `html.rc-canvas` -- without it the page is the ordinary
 * full-bleed site it was before the canvas existed.
 *
 *   repcheck-marketing.onrender.com -> the canvas, for the Instagram post
 *   repcheckofficials.onrender.com  -> the normal site
 *
 * Loaded from <head> as a blocking classic script, deliberately: it has to
 * decide before the first paint or the page renders full-bleed and snaps into
 * the frame a moment later. It is a few hundred bytes with no dependencies,
 * so the cost of blocking is smaller than the flash would be.
 *
 * Not an inline <script>: the CSP is `script-src 'self'` with no nonce, and
 * tests/test_marketing_site_compliance.py fails the build if any page carries
 * one.
 */
(function () {
  "use strict";

  var CANVAS_HOSTS = ["repcheck-marketing.onrender.com"];

  // ?canvas=1 forces it on and ?canvas=0 forces it off, for previewing either
  // shape from localhost or from the other site without editing this list.
  var forced = /[?&]canvas=([01])/.exec(window.location.search);

  var on = forced
    ? forced[1] === "1"
    : CANVAS_HOSTS.indexOf(window.location.hostname) !== -1;

  if (on) document.documentElement.classList.add("rc-canvas");
})();
