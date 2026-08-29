// The log in / sign up screen is pinned (position:fixed) so it cannot scroll or
// bounce on a phone. auth_viewport.js is what keeps that pinned screen usable
// once the keyboard is up, and it has two jobs:
//
//   Stay full size. The screen must NOT shrink into the strip above the
//   keyboard -- that squeezed the card and cut it off mid-field, with iOS's
//   arrows/tick accessory bar butted against a hard edge instead of sitting
//   over the app. The keyboard overlays a full-height screen instead.
//
//   Move to the tapped field. Tap Email and the screen goes to Email; tap
//   Password and it goes to Password. A locked page cannot scroll there on its
//   own, so the script moves it, and brings the submit button along when the
//   button is close enough to follow.
//
// Underneath both: iOS slides the visual viewport down inside the layout
// viewport when the keyboard opens, and a fixed box does not come along. Left
// uncompensated the whole card slides off the top of the screen -- the 0.4.7.0
// bug. Every position written here is offsetTop + reveal.

import { describe, it, expect } from "vitest";
import { loadAuthViewport } from "./support/loadAuthViewport.js";

// An iPhone 13: 812pt tall, ~336pt of keyboard plus accessory bar, and iOS
// sliding the visible strip down inside the layout viewport to clear it.
const KEYBOARD = { height: 476, offsetTop: 120 };

describe("auth viewport sync", () => {
  it("writes nothing at rest, so the still screen stays still", () => {
    const phone = loadAuthViewport();

    expect(phone.body.style.transform).toBe("");
  });

  it("never shrinks the screen -- the keyboard overlays it", () => {
    const phone = loadAuthViewport();

    phone.tap("email", KEYBOARD);

    // No height is written at all: <body> keeps the full height `inset: 0`
    // gives it, so the card renders at the size the design was measured at and
    // the keyboard draws on top of it.
    expect(phone.body.style.height).toBeUndefined();
  });

  it("follows the visual viewport instead of sliding off the top", () => {
    // A field already inside the visible strip needs no reveal, so what is
    // left is the offsetTop compensation on its own.
    const phone = loadAuthViewport({ fields: [{ name: "email", top: 200, height: 44 }], submit: null });

    phone.tap("email", KEYBOARD);

    expect(phone.body.style.transform).toBe("translateY(120px)");
  });

  it("goes to Email when you tap Email", () => {
    const phone = loadAuthViewport();

    phone.tap("email", KEYBOARD);

    const rect = phone.rect("email");
    const strip = phone.strip();
    expect(rect.top).toBeGreaterThanOrEqual(strip.top);
    expect(rect.bottom).toBeLessThanOrEqual(strip.bottom);
  });

  it("goes to Password when you then tap Password", () => {
    const phone = loadAuthViewport();
    phone.tap("email", KEYBOARD);

    phone.tap("password", KEYBOARD);

    const rect = phone.rect("password");
    const strip = phone.strip();
    expect(rect.top).toBeGreaterThanOrEqual(strip.top);
    expect(rect.bottom).toBeLessThanOrEqual(strip.bottom);
  });

  it("brings the submit button along, so Log in is never stranded", () => {
    const phone = loadAuthViewport();

    phone.tap("password", KEYBOARD);

    // The button sits 70px below the password field -- close enough to follow.
    expect(phone.rect("submit").bottom).toBeLessThanOrEqual(phone.strip().bottom);
  });

  it("keeps the focused field visible when the button is too far to follow", () => {
    // A tall gap between field and button: hauling the button up would push the
    // field you are typing in off the top of the screen, so the field wins.
    const phone = loadAuthViewport({
      fields: [{ name: "email", top: 380, height: 44 }],
      submit: { top: 700, height: 48 },
    });

    phone.tap("email", KEYBOARD);

    const rect = phone.rect("email");
    const strip = phone.strip();
    expect(rect.top).toBeGreaterThanOrEqual(strip.top);
    expect(rect.bottom).toBeLessThanOrEqual(strip.bottom);
  });

  it("never pushes the card DOWN past where the design puts it", () => {
    // A field sitting right at the top edge of the visible strip is within a
    // hair of the gap the reveal likes to keep. Closing that hair would mean
    // moving the card DOWN, and the reveal only ever lifts -- so the position
    // stays the plain offsetTop compensation.
    const phone = loadAuthViewport({ fields: [{ name: "email", top: 5, height: 44 }], submit: null });

    phone.tap("email", KEYBOARD);

    expect(phone.body.style.transform).toBe("translateY(120px)");
  });

  it("returns to rest when the keyboard goes away", () => {
    const phone = loadAuthViewport();
    phone.tap("password", KEYBOARD);

    phone.dismiss();

    expect(phone.body.style.transform).toBe("");
  });

  it("does not bounce back to rest while moving between fields", () => {
    const phone = loadAuthViewport();
    phone.tap("email", KEYBOARD);

    // focusout for Email fires before focusin for Password; the screen must
    // stay on the new field rather than snapping home in between.
    phone.tap("password", KEYBOARD);

    expect(phone.body.style.transform).not.toBe("");
  });

  it("undoes a document scroll, since the locked page has nothing to scroll", () => {
    const phone = loadAuthViewport();

    phone.window.pageYOffset = 90;
    phone.keyboard(KEYBOARD);

    expect(phone.window.pageYOffset).toBe(0);
  });

  it("leaves the desktop device frame alone", () => {
    // Above 721px <body> IS the simulated phone -- a fixed-size transformed box
    // -- so moving it would slide the phone around the desk.
    const desktop = loadAuthViewport({ layoutHeight: 900, framed: true });

    desktop.tap("email", { height: 500, offsetTop: 120 });

    expect(desktop.body.style.transform).toBe("");
    expect(desktop.body.style.height).toBeUndefined();
  });
});
