// Keeps the pinned auth screen sized to -- and lined up with -- what the phone
// can actually SEE.
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
// After it, there is nothing to scroll: .auth-wrap's `max-height: 100%`
// resolves against a <body> that never shrank, so the safety-net scroller
// auth.css sets up is inert at exactly the moment it is needed. Pinning the
// page without this is what turns "does not scroll" into "cannot reach the
// button".
//
// Two things therefore have to be written back, and BOTH of them, or the screen
// breaks in a different way:
//
//   height. Feeding visualViewport.height onto <body> re-centres the content
//   inside the visible strip and makes `max-height: 100%` mean the visible
//   height, so .auth-wrap scrolls internally IF the content still does not fit.
//
//   offset. When you tap a field, iOS scrolls the VISUAL viewport down inside
//   the layout viewport to clear the keyboard -- visualViewport.offsetTop goes
//   positive. A position:fixed box is anchored to the LAYOUT viewport, so it
//   does not come along: the whole card slides up off the top of the screen and
//   you are typing into a field you cannot see. Height alone does not catch
//   this -- it makes the box the right SIZE in the wrong PLACE. Translating
//   <body> down by offsetTop puts it back under the visible strip.
//
// On a screen with no keyboard up, visualViewport.height equals the layout
// height and offsetTop is 0, so this writes back the geometry the page already
// had and nothing moves -- the still screen stays still.
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
  // Writing a viewport height onto it there would resize the phone itself, and
  // a translate would slide the phone around the desk.
  function framed() {
    return window.matchMedia("(min-width: 721px)").matches;
  }

  // Shorter than the shortest phone iOS 18 runs (a 375x667 SE) by a wide
  // margin, so a real screen never trips it -- this only rejects garbage.
  var MIN_USABLE_HEIGHT = 200;

  function sync() {
    if (framed()) {
      body.style.height = "";
      body.style.transform = "";
      return;
    }
    // Never pin to a height nobody could read or type into. This fires once
    // with vv.height === 0 if sync() runs before the page has been laid out
    // -- the initial call races the browser's own first layout -- and
    // `height: 0` on a pinned, overflow:hidden <body> is an empty screen with
    // no later event guaranteed to correct it. Keeping the last good geometry
    // is always the safer reading of a measurement this implausible.
    if (!(vv.height > MIN_USABLE_HEIGHT)) return;
    // `inset: 0` sets both top and bottom; an explicit height wins over bottom
    // for a fixed-position box, so this is the one property that has to change.
    body.style.height = vv.height + "px";

    // offsetTop is how far the visual viewport has been pushed down inside the
    // layout viewport -- i.e. exactly how far the fixed <body> is now sitting
    // above what you can see. Transform rather than `top` so it never fights
    // the `inset: 0` the stylesheet owns.
    var offset = Math.max(0, Math.round(vv.offsetTop));
    body.style.transform = offset ? "translateY(" + offset + "px)" : "";

    // The page is locked -- <html> is overflow:hidden and <body> is out of
    // flow, so there is nothing here to scroll and any document scroll is iOS
    // having dragged the whole locked page to reveal the field. Put it back;
    // the visible strip is already lined up by the two writes above.
    if (window.pageYOffset) window.scrollTo(0, 0);
  }

  // Focus is where this goes wrong, and the keyboard animates in over ~250ms
  // while iOS keeps adjusting the offset. visualViewport fires through that,
  // but the last adjustment can land after its final event, so re-sync once the
  // animation is over and then park the focused field in the visible strip --
  // .auth-wrap is the scroller that can still move under a locked page.
  function onFocus(event) {
    var field = event.target;
    sync();
    window.setTimeout(function () {
      sync();
      if (field && typeof field.scrollIntoView === "function") {
        field.scrollIntoView({ block: "center" });
        // scrollIntoView is allowed to scroll ancestors all the way up to the
        // document; .auth-wrap moving is the point, the document moving is the
        // bug this whole file exists to undo.
        if (window.pageYOffset) window.scrollTo(0, 0);
      }
    }, 300);
  }

  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  document.addEventListener("focusin", onFocus);
  // Blur has its own tail: the keyboard animating away restores the offset, and
  // the same late-adjustment problem applies in reverse.
  document.addEventListener("focusout", function () {
    window.setTimeout(sync, 300);
  });
  // The frame's height tracks the window 1:1 outside of a keyboard, so a plain
  // window resize can cross the 721px boundary without visualViewport firing.
  window.addEventListener("resize", sync);
})(window, document);
