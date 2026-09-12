// The marketing site's feature switcher: six buttons, one handset, and until
// this pass no way for a screen reader to tell which feature was in it.
//
// is-active is a colour change and nothing more, so a non-sighted visitor got
// six identically-announced buttons and a phone whose contents changed for no
// stated reason. showFeature() now writes aria-pressed alongside the class,
// which turns the six into a radio-style group (WCAG 4.1.2: name, role, VALUE).
//
// Worth real tests rather than a source grep for two reasons. The attribute has
// to be written on the SIX buttons it belongs to and cleared from the five that
// are no longer showing -- setting it true and never resetting it is the usual
// way this gets half-done, and it reads to a screen reader as every feature
// being on at once. And hover is a separate entry point from click on this
// page, so the state can be right one way round and wrong the other.
//
// marketing/ is a separate static deploy and nothing in tests-js reached into
// it before this file; see support/loadMarketingFeatureSwitcher.js for how the
// real script is run over the real markup.

import { describe, it, expect } from "vitest";
import {
  loadMarketingFeatureSwitcher,
  readSource,
} from "./support/loadMarketingFeatureSwitcher.js";

describe("marketing feature switcher", () => {
  it("mounts the six features the page ships with", () => {
    // Guard the guard: every assertion below is over this list, so an
    // extractor that silently matched nothing would make them all vacuous.
    const ui = loadMarketingFeatureSwitcher();

    expect(ui.buttons.length).toBe(6);
    expect(ui.screens.length).toBe(6);
  });

  it("announces the first feature as pressed on load", () => {
    // showFeature(0) runs at the bottom of the switcher block, so this is the
    // state before anyone touches anything.
    const ui = loadMarketingFeatureSwitcher();

    expect(ui.pressed()).toEqual(["true", "false", "false", "false", "false", "false"]);
  });

  it("moves the pressed state to the feature you click", () => {
    const ui = loadMarketingFeatureSwitcher();

    ui.click(3);

    expect(ui.pressed()).toEqual(["false", "false", "false", "true", "false", "false"]);
  });

  it("clears the previous one, so the group never reads as two features at once", () => {
    const ui = loadMarketingFeatureSwitcher();

    ui.click(1);
    ui.click(4);
    ui.click(2);

    // Exactly one pressed, whatever route got us here.
    expect(ui.pressed().filter((v) => v === "true").length).toBe(1);
    expect(ui.pressed()[2]).toBe("true");
  });

  it("keeps what is announced and what is drawn in step", () => {
    // The failure this rules out is a half-applied change: the class toggles
    // and the attribute does not (or vice versa), so a sighted user and a
    // screen-reader user are told about different features.
    const ui = loadMarketingFeatureSwitcher();

    for (const index of [0, 5, 2, 3]) {
      ui.click(index);

      const announced = ui.pressed().map((v) => v === "true");
      expect(announced).toEqual(ui.active());
      expect(ui.shownScreen()).toBe(index);
    }
  });

  it("updates the pressed state on hover too, not just on click", () => {
    // Hovering a feature switches the handset on this page -- it is the main
    // way it gets used with a mouse, and it goes through the same showFeature.
    const ui = loadMarketingFeatureSwitcher();

    ui.hover(5);

    expect(ui.pressed()[5]).toBe("true");
    expect(ui.pressed()[0]).toBe("false");
  });

  it("stays a classic script, since the marketing page loads it as one", () => {
    // index.html includes app.js with a plain <script src>, and the whole file
    // is one IIFE. An `import`/`export` creeping in would make the page load
    // nothing at all, silently -- the same trap CLAUDE.md describes for the
    // app's own inline scripts. new Function() is the parse check that
    // actually answers this (node --check retries as ESM and accepts it).
    expect(() => new Function(readSource())).not.toThrow();
  });
});
