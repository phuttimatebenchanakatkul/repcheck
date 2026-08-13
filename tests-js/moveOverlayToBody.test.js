// Regression coverage for moveOverlayToBody() -- caught by /ship's
// adversarial review with a real coordinate click + screenshot: the sets/reps
// editor and the exercise-detail modal both rendered "open" (correct DOM
// state, correct z-index) but were completely invisible, because they were
// still nested inside .app in the DOM. .app gets a scale-down transform
// whenever a bottom sheet is open (the "page recedes behind me" effect),
// and a CSS transform creates a new stacking context + containing block for
// position: fixed descendants -- trapping any fixed-position overlay still
// nested inside it below any sibling overlay already living at the body
// level (like .split-modal-overlay, which openBottomSheet re-parents to
// <body> the moment it opens). No z-index value, however high, escapes that.
import { beforeEach, describe, expect, it } from "vitest";
import { loadMoveOverlayToBody } from "./support/loadMoveOverlayToBody.js";

const moveOverlayToBody = loadMoveOverlayToBody();

describe("moveOverlayToBody", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("re-parents an overlay nested inside another element to be a direct child of body", () => {
    document.body.innerHTML = `<div id="app"><main><div id="overlay"></div></main></div>`;
    const overlay = document.getElementById("overlay");
    expect(overlay.parentElement.tagName).toBe("MAIN"); // starts trapped

    moveOverlayToBody(overlay);

    expect(overlay.parentElement).toBe(document.body);
  });

  it("is a no-op when the overlay is already a direct child of body", () => {
    document.body.innerHTML = `<div id="overlay"></div>`;
    const overlay = document.getElementById("overlay");
    const bodyChildCountBefore = document.body.children.length;

    moveOverlayToBody(overlay);

    expect(overlay.parentElement).toBe(document.body);
    expect(document.body.children.length).toBe(bodyChildCountBefore); // didn't move/duplicate it
  });

  it("does not throw when passed null or undefined", () => {
    expect(() => moveOverlayToBody(null)).not.toThrow();
    expect(() => moveOverlayToBody(undefined)).not.toThrow();
  });

  it("preserves the overlay's own children and attributes across the move", () => {
    document.body.innerHTML = `<main><div id="overlay" class="split-ex-editor-overlay" data-foo="bar"><span>content</span></div></main>`;
    const overlay = document.getElementById("overlay");

    moveOverlayToBody(overlay);

    expect(overlay.parentElement).toBe(document.body);
    expect(overlay.className).toBe("split-ex-editor-overlay");
    expect(overlay.dataset.foo).toBe("bar");
    expect(overlay.querySelector("span").textContent).toBe("content");
  });
});
