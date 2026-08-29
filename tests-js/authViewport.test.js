// The log in / sign up screen is pinned (position:fixed) so it cannot scroll
// or bounce on a phone. That pin is anchored to the LAYOUT viewport, and the
// keyboard moves the VISUAL one, so auth_viewport.js has to write both the
// visible height and the visible OFFSET back onto <body>.
//
// The offset half is the one that was missing, and its symptom is nasty: tap
// the email field and the whole card slides up off the top of the screen, so
// you are typing into a field you cannot see. Height alone does not catch it --
// it makes the box the right size in the wrong place.

import { describe, it, expect } from "vitest";
import { loadAuthViewport } from "./support/loadAuthViewport.js";

describe("auth viewport sync", () => {
  it("writes back the geometry it already had when no keyboard is up", () => {
    const phone = loadAuthViewport({ layoutHeight: 812 });

    expect(phone.body.style.height).toBe("812px");
    // No translate at rest, or the still screen would not be still.
    expect(phone.body.style.transform).toBe("");
  });

  it("follows the visual viewport down when the keyboard pushes it", () => {
    const phone = loadAuthViewport({ layoutHeight: 812 });

    // iPhone 13-ish: 336px of keyboard, and iOS slides the visible strip 120px
    // down inside the layout viewport to clear the focused field.
    phone.keyboard({ height: 476, offsetTop: 120 });

    expect(phone.body.style.height).toBe("476px");
    expect(phone.body.style.transform).toBe("translateY(120px)");
  });

  it("returns to rest when the keyboard goes away", () => {
    const phone = loadAuthViewport({ layoutHeight: 812 });
    phone.keyboard({ height: 476, offsetTop: 120 });

    phone.keyboard({ height: 812, offsetTop: 0 });

    expect(phone.body.style.height).toBe("812px");
    expect(phone.body.style.transform).toBe("");
  });

  it("undoes a document scroll, since the locked page has nothing to scroll", () => {
    const phone = loadAuthViewport({ layoutHeight: 812 });

    // iOS dragging the whole locked page up to reveal the field.
    phone.window.pageYOffset = 90;
    phone.keyboard({ height: 476, offsetTop: 120 });

    expect(phone.window.pageYOffset).toBe(0);
  });

  it("re-syncs after the keyboard animation, which outlasts the last event", () => {
    const phone = loadAuthViewport({ layoutHeight: 812 });
    const field = { scrollIntoView: () => { calls += 1; } };
    let calls = 0;

    phone.focusIn(field);
    // The late adjustment: iOS settles the offset after its final event.
    phone.visualViewport.height = 476;
    phone.visualViewport.offsetTop = 150;
    phone.runTimers();

    expect(phone.body.style.transform).toBe("translateY(150px)");
    // ...and the field itself is parked in the visible strip.
    expect(calls).toBe(1);
  });

  it("leaves the desktop device frame alone", () => {
    // Above 721px <body> IS the simulated phone -- a fixed-size transformed
    // box -- so writing a viewport height or a translate onto it would resize
    // and slide the phone rather than its contents.
    const desktop = loadAuthViewport({ layoutHeight: 900, framed: true });

    desktop.keyboard({ height: 500, offsetTop: 120 });

    expect(desktop.body.style.height).toBe("");
    expect(desktop.body.style.transform).toBe("");
  });
});
