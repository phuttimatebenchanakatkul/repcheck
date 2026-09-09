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
  // Shorter than the shortest phone iOS 18 runs (a 375x667 SE) by a wide
  // margin, so a real screen never trips it -- this only rejects garbage.
  // visualViewport.height reads back 0 if it is measured before the browser
  // has laid the page out, and a 0-height "visible strip" would compute a
  // reveal that throws the card clean off the screen (v0.4.10.1 caught the
  // same measurement pinning <body> to height:0 back when a height was
  // written at all). Keeping the last good position is always the safer
  // reading of a measurement this implausible.
  var MIN_USABLE_HEIGHT = 200;

  // How far the content is currently moved to reveal a field. Never positive:
  // revealing means moving UP, and the resting position is the design's own.
  var reveal = 0;
  var focused = null;

  // Above 721px style.css draws the app inside a fixed-size, transformed box
  // where <body> IS the box and .auth-wrap scrolls inside it. WHICH KIND of
  // box decides what this file is allowed to do, and the two answers are
  // opposites:
  //
  // - desk() -- a mouse-driven desktop. The box is a 390px phone sitting on a
  //   desk and there is no on-screen keyboard to dodge, so this file does
  //   nothing: moving it would slide the phone around the desk.
  // - boxed() but not desk() -- a tablet. The box fills the screen and there
  //   very much IS a keyboard. Doing nothing here is what left the password
  //   field and the Log in button underneath it on an iPad in landscape,
  //   where the strip above the keyboard is ~470pt and the vertically-centred
  //   card runs to ~690. Nothing could reach them either: auth.css only pins
  //   and compacts below 721px, and .auth-wrap has no scroll range while its
  //   content fits.
  function desk() {
    return window.matchMedia(
      "(min-width: 721px) and (hover: hover) and (pointer: fine)"
    ).matches;
  }
  function boxed() {
    return window.matchMedia("(min-width: 721px)").matches;
  }

  // Undo the tablet branch's inline geometry so a resize across a breakpoint
  // never strands it on a layout that does not want it.
  function clearBox() {
    body.style.height = "";
    body.style.top = "";
  }

  function place() {
    if (desk()) {
      clearBox();
      body.style.transform = "";
      return;
    }
    if (boxed()) {
      // Tablet. <body> is BOTH the app box and the flex centring context for
      // the card, and it already carries a translate(-50%, -50%) doing the
      // centring -- writing translateY here would throw the whole box off
      // screen. So resize the box to the strip the keyboard leaves visible
      // and let the flex centring that is already there re-centre the card
      // inside it. .auth-wrap's max-height:100%/overflow-y:auto supplies a
      // scroll range for the rare card taller than the strip.
      //
      // This is deliberately the OPPOSITE of the phone rule at the top of
      // this file ("the screen stays FULL SIZE"). There the card is nearly as
      // tall as the screen, so shrinking <body> to the strip cut it off
      // mid-field. A tablet's card is a fraction of its screen, and the strip
      // is still taller than the card in portrait.
      var strip = vv.height;
      // Same implausible-measurement guard as revealFocused: a 0-height strip
      // read before layout would collapse the box.
      if (!(strip > MIN_USABLE_HEIGHT)) return;
      body.style.height = strip + "px";
      // `top` is a point, not an edge -- the -50% translate centres the box on
      // it -- so this is the middle of the visible strip.
      body.style.top = (Math.max(0, Math.round(vv.offsetTop)) + strip / 2) + "px";
      return;
    }
    clearBox();
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
    // Not on a tablet either: there the box resize in place() has already put
    // the card inside the visible strip, and a translateY on top of it would
    // fight the centring transform.
    if (boxed() || !focused || !focused.getBoundingClientRect) return;
    if (!(vv.height > MIN_USABLE_HEIGHT)) return;

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
