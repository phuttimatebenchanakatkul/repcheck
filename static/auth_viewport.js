// Keeps the pinned auth screen sized to what the phone can actually SEE.
//
// auth.css pins <body> to position:fixed on phones so log in and sign up sit
// still -- no scroll, no iOS rubber-band. That pin is measured against the
// LAYOUT viewport, which the on-screen keyboard does not change: iOS shrinks
// the VISUAL viewport and leaves the layout one alone. So with the keyboard up,
// <body> is still full-phone-height, it is still centring its content against
// that full height, and the bottom of the card -- the submit button -- sits
// behind the keyboard.
//
// Before the pin, the page scrolled and you could simply scroll to the button.
// After it, there is nothing to scroll: .auth-wrap's `max-height: 100%` resolves
// against a <body> that never shrank, so the safety-net scroller auth.css sets
// up is inert at exactly the moment it is needed. Pinning the page without this
// is what turns "does not scroll" into "cannot reach the button".
//
// Feeding the visual viewport's height back onto <body> fixes both halves at
// once: the content re-centres inside the visible strip, and `max-height: 100%`
// now means the visible height, so .auth-wrap scrolls internally IF the content
// still does not fit. On a screen with no keyboard up, visualViewport.height
// equals the layout height, so this writes the height it already had and
// nothing moves -- the still screen stays still.
//
// No dependency on base.html: the auth pages are standalone and do not load it
// (which is also why its --pc-vvh plumbing is not available here).

(function (window, document) {
  "use strict";

  var vv = window.visualViewport;
  // No VisualViewport (older browsers) means no keyboard-aware resize to react
  // to either. The CSS pin still holds; this is purely additive.
  if (!vv) return;

  var body = document.querySelector(".auth-body");
  if (!body) return;

  // Above 721px style.css draws the app inside a device frame where <body> IS
  // the phone -- a fixed-size, transformed box that .auth-wrap scrolls inside.
  // Writing a viewport height onto it there would resize the phone itself.
  function framed() {
    return window.matchMedia("(min-width: 721px)").matches;
  }

  function sync() {
    if (framed()) {
      body.style.height = "";
      return;
    }
    // `inset: 0` sets both top and bottom; an explicit height wins over bottom
    // for a fixed-position box, so this is the one property that has to change.
    body.style.height = vv.height + "px";
  }

  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  // The frame's height tracks the window 1:1 outside of a keyboard, so a plain
  // window resize can cross the 721px boundary without visualViewport firing.
  window.addEventListener("resize", sync);
})(window, document);
