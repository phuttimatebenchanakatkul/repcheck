// A bottom sheet must not outlive the page it belongs to.
//
// The bug, from a phone screenshot: open the food-analysis sheet on
// Nutrition, close it, tap another tab, then open a recent analysis -- and
// the whole food sheet is sitting at the bottom of that screen, unstyled and
// fully readable. "Log food", the close button, the food's name, the macro
// donut, 1081 calories.
//
// Two things combine to produce it. window.openBottomSheet re-parents a
// sheet to <body> so it escapes the transformed stacking context inside
// .app -- which also takes it out of <main>, the only part of the document
// static/pagenav.js replaces on a tab swap. And a page template's CSS is
// inline INSIDE that <main> (.af-modal-overlay is declared nowhere else), so
// the swap takes the rules away and leaves the markup behind: a
// position:fixed, opacity:0 overlay becomes ordinary block content at the
// end of the body.
//
// static/nav_scope.js already removes body-level nodes a page put there --
// but only ones added while the page's own scripts were running. A sheet is
// moved when a thumb opens it, long after that, which is the hole these
// tests close.

import { describe, it, expect } from "vitest";
import { loadPageNav, page } from "./support/loadPageNav.js";
import { loadBottomSheet } from "./support/loadBottomSheet.js";

const NUTRITION_MAIN = `
  <style>.af-modal-overlay { position: fixed; opacity: 0; }</style>
  <div class="af-modal-overlay" id="af-modal-overlay">
    <div class="af-modal"><div class="af-modal-title">Log food</div></div>
  </div>`;

const HOME = page({ href: "/home", title: "RepCheck - Home", body: "<h1>Home</h1>" });

function bootNutrition() {
  const nav = loadPageNav({
    startHref: "/nutrition",
    startMain: NUTRITION_MAIN,
    routes: { "/home": HOME },
  });
  return { nav, sheet: loadBottomSheet() };
}

describe("a page's bottom sheet and a tab swap", () => {
  it("does not leave the sheet behind in the body when the page is swapped away", async () => {
    const { nav, sheet } = bootNutrition();
    const overlay = document.getElementById("af-modal-overlay");

    // Opened by a thumb, which is the point: the page's scripts finished
    // running long before this, so nav_scope.js is not recording any more.
    sheet.openBottomSheet(overlay, ".af-modal");
    await nav.settle();
    expect(overlay.parentElement).toBe(document.body); // it really did move

    sheet.closeBottomSheet(overlay, ".af-modal");
    await nav.settle();

    await nav.tap("/home");

    expect(document.getElementById("af-modal-overlay")).toBe(null);
    expect(document.body.textContent).not.toContain("Log food");
  });

  it("takes the sheet with it even if it is still open when the page leaves", async () => {
    // Reachable with the iOS back-swipe, which pagenav.js honours over an
    // open sheet -- the gesture does not care that a scrim is on screen.
    const { nav, sheet } = bootNutrition();
    const overlay = document.getElementById("af-modal-overlay");

    sheet.openBottomSheet(overlay, ".af-modal");
    await nav.settle();

    await nav.tap("/home");

    expect(document.getElementById("af-modal-overlay")).toBe(null);
  });

  it("unpins the body when an open sheet is swapped away, so the next page scrolls", async () => {
    // openBottomSheet pins <body> to position:fixed -- the iOS fix for the
    // page panning behind an open sheet. closeBottomSheet is what undoes it,
    // and a swap is not a close: without this the arriving page is frozen at
    // the departed page's scroll offset, with no sheet on screen to explain
    // why nothing moves.
    const { nav, sheet } = bootNutrition();
    const overlay = document.getElementById("af-modal-overlay");

    sheet.openBottomSheet(overlay, ".af-modal");
    await nav.settle();
    expect(document.body.style.position).toBe("fixed");

    await nav.tap("/home");

    expect(document.body.style.position).toBe("");
    expect(document.documentElement.classList.contains("pc-sheet-locked")).toBe(false);
    expect(window.__pcSheetLockCount).toBe(0);
  });

  it("leaves the shell's own sheets alone -- they belong to no page", async () => {
    // The tab-bar "+" menu, the log-weight modal and the goal-adjust modal
    // are rendered by base.html OUTSIDE <main>. They survive every swap by
    // design, and removing them would break the shell rather than fix a page.
    const { nav, sheet } = bootNutrition();
    const shellSheet = document.createElement("div");
    shellSheet.className = "mt-sheet-overlay";
    shellSheet.id = "mt-fab-overlay";
    shellSheet.innerHTML = '<div class="mt-sheet"></div>';
    document.querySelector(".app").appendChild(shellSheet); // beside <main>, not inside it

    sheet.openBottomSheet(shellSheet, ".mt-sheet");
    await nav.settle();
    sheet.closeBottomSheet(shellSheet, ".mt-sheet");
    await nav.settle();

    await nav.tap("/home");

    expect(document.getElementById("mt-fab-overlay")).not.toBe(null);
  });
});
