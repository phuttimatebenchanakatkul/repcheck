// Keeps the pinned auth screen lined up with what the phone can actually SEE,
// and moves to whichever field you tapped.
//
// auth.css pins <body> to position:fixed on phones so log in and sign up sit
// still -- no scroll, no iOS rubber-band. That pin is measured against the
// LAYOUT viewport, which the on-screen keyboard does not change: iOS shrinks
// the VISUAL viewport and leaves the layout one alone. Two things follow, and
// this file is both of them.
//
// 1. The screen stays FULL SIZE. An earlier version wrote visualViewport.height
//    onto <body>, which squeezed the whole card into the strip above the
//    keyboard and cut it off mid-field: the keyboard and its little arrows/tick
//    accessory bar ended up butted against a hard edge instead of sitting over
//    the app. So the height is left alone. <body> stays the full height of the
//    phone, the keyboard and its bar draw ON TOP of it, and the design keeps
//    the proportions it was measured at.
//
// 2. Which means something has to bring the focused field out from under the
//    keyboard, because a locked page cannot scroll to it. That is what the
//    reveal below does: tap Email and the screen moves to Email, tap Password
//    and it moves to Password, and it takes the submit button along when the
//    button is close enough to follow -- otherwise "Log in" would sit behind
//    the keyboard with no way to reach it.
//
// One correction underneath both: when you tap a field iOS also slides the
// visual viewport DOWN inside the layout viewport (visualViewport.offsetTop
// goes positive) to clear the keyboard itself. A position:fixed box is anchored
// to the LAYOUT viewport, so it does not come along -- without compensating,
// the whole card slides up off the top of the screen and you are typing into a
// field you cannot see. Every position this file writes is therefore
// `offsetTop + reveal`: glue the pinned body to the visible strip first, then
// move it by however much the focused field needs.
//
// With no keyboard up, offsetTop is 0 and the reveal is 0, so this writes back
// the geometry the page already had and nothing moves -- the still screen stays
// still.
//
// No dependency on base.html: the auth pages are standalone and do not load it
// (which is also why its --pc-vvh plumbing is not available here).

(function (window, document) {
  "use strict";

  var vv = window.visualViewport;
  // No VisualViewport (older browsers) means no keyboard to react to either.
  // The CSS pin still holds; this is purely additive.
  if (!vv) return;

  var body = document.querySelector(".auth-body");
  if (!body) return;

  // Breathing room between the focused field and the top of the keyboard, so
  // the field does not sit flush against it.
  var GAP = 12;
  // How far below the focused field the submit button may sit and still be
  // brought along. Beyond this, hauling it into view would push the field you
  // are typing in off the top of the screen -- the field wins.
  var SUBMIT_REACH = 200;

  // How far the content is currently moved to reveal a field. Never positive:
  // revealing means moving UP, and the resting position is the design's own.
  var reveal = 0;
  var focused = null;

  // Above 721px style.css draws the app inside a device frame where <body> IS
  // the phone -- a fixed-size, transformed box that .auth-wrap scrolls inside.
  // Moving it there would slide the phone around the desk.
  function framed() {
    return window.matchMedia("(min-width: 721px)").matches;
  }

  function place() {
    if (framed()) {
      body.style.transform = "";
      return;
    }
    var offset = Math.max(0, Math.round(vv.offsetTop)) + reveal;
    body.style.transform = offset ? "translateY(" + offset + "px)" : "";

    // The page is locked -- <html> is overflow:hidden and <body> is out of
    // flow, so there is nothing here to scroll and any document scroll is iOS
    // having dragged the whole locked page to reveal the field itself. Put it
    // back; the transform above is what does that job here.
    if (window.pageYOffset) window.scrollTo(0, 0);
  }

  // The bottom edge that has to end up above the keyboard. Normally the focused
  // field, but if its form's submit button is just below it, that instead -- so
  // tapping the last field does not strand the button you are heading for.
  function anchorBottom(field) {
    var bottom = field.getBoundingClientRect().bottom;
    var form = field.form || (field.closest && field.closest(".auth-form"));
    var submit = form && form.querySelector(".auth-submit-btn");
    if (!submit) return bottom;
    var submitBottom = submit.getBoundingClientRect().bottom;
    if (submitBottom > bottom && submitBottom - bottom <= SUBMIT_REACH) {
      return submitBottom;
    }
    return bottom;
  }

  // Move the screen so the focused field sits inside the strip the keyboard
  // leaves visible. Rects and visualViewport offsets are both measured against
  // the layout viewport, so they can be compared directly.
  function revealFocused() {
    if (framed() || !focused || !focused.getBoundingClientRect) return;

    var stripTop = Math.max(0, Math.round(vv.offsetTop));
    var stripBottom = stripTop + vv.height;
    var rect = focused.getBoundingClientRect();
    var delta = 0;

    if (anchorBottom(focused) > stripBottom - GAP) {
      delta = stripBottom - GAP - anchorBottom(focused);
    } else if (rect.top < stripTop + GAP) {
      delta = stripTop + GAP - rect.top;
    }
    if (!delta) return;

    // Clamped at 0: the reveal only ever lifts the content. Letting it go
    // positive would push the card down past where the design puts it.
    reveal = Math.min(0, reveal + delta);
    place();
  }

  function rest() {
    reveal = 0;
    focused = null;
    place();
  }

  function onFocus(event) {
    focused = event.target;
    place();
    revealFocused();
    // The keyboard animates in over ~250ms and iOS keeps adjusting the offset
    // through it; the last adjustment can land after visualViewport's final
    // event, and the strip is not its final size until then.
    window.setTimeout(function () {
      place();
      revealFocused();
    }, 300);
  }

  function onBlur() {
    // Tabbing between fields fires focusout before the next focusin, so let the
    // new focus land first rather than bouncing the screen back to rest.
    window.setTimeout(function () {
      if (document.activeElement && document.activeElement !== document.body &&
          document.activeElement.tagName === "INPUT") {
        return;
      }
      rest();
    }, 300);
  }

  place();
  vv.addEventListener("resize", function () {
    place();
    revealFocused();
  });
  vv.addEventListener("scroll", place);
  document.addEventListener("focusin", onFocus);
  document.addEventListener("focusout", onBlur);
  // The device frame's height tracks the window 1:1 outside of a keyboard, so a
  // plain window resize can cross the 721px boundary without visualViewport
  // firing.
  window.addEventListener("resize", place);
})(window, document);
