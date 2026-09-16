// Loads the REAL food log: marketing/index.html's .what section with
// marketing/app.js evaluated over it, so these tests drive the files that
// actually ship to the pre-launch site rather than a re-implementation.
//
// The mounting is loadMarketingFeatureSwitcher's -- same section, same two
// jsdom accommodations (no <video>, no self-looping workout-log screen), so
// there is one extractor to fix when the markup moves, not two. Everything
// here is the handle on top of it: the visitor's moves, and what the screen
// says back.

import {
  readWhatSection,
  readSource,
} from "./loadMarketingFeatureSwitcher.js";

/**
 * @param {{reducedMotion?: boolean}} [opts]
 *   reducedMotion stubs window.matchMedia BEFORE the script runs, which is the
 *   only moment that matters: app.js reads the query at load and again at the
 *   top of every walkthrough. jsdom ships no matchMedia at all, so without the
 *   stub the `window.matchMedia && ...` guards are simply falsy and the normal
 *   animated path runs -- which is what every other test in this file wants.
 */
export function loadMarketingFoodLog(opts) {
  const reducedMotion = !!(opts && opts.reducedMotion);
  document.body.innerHTML = readWhatSection();
  if (reducedMotion) {
    window.matchMedia = (query) => ({
      matches: /prefers-reduced-motion:\s*reduce/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  } else {
    delete window.matchMedia;
  }
  // eslint-disable-next-line no-new-func
  new Function(readSource())();

  const screen = document.getElementById("nl-screen");
  if (!screen) {
    throw new Error(
      "loadMarketingFoodLog: #nl-screen is missing from marketing/index.html -- " +
        "the food log markup moved. Update the extractor."
    );
  }

  const $ = (sel) => screen.querySelector(sel);
  const text = (sel) => ($(sel) ? $(sel).textContent : null);

  return {
    screen,
    $,
    text,
    // The visitor's own moves, as the page receives them.
    showFoodLog: () => document.querySelector('.feature[data-feature="1"]').click(),
    openSearch: () => $('[data-nl="open-search"]').click(),
    search(query) {
      const input = $("#nl-query");
      input.value = query;
      input.dispatchEvent(new Event("input"));
      return Array.from(screen.querySelectorAll(".nl-result b")).map((b) => b.textContent);
    },
    pickFirstResult: () => screen.querySelector(".nl-result").click(),
    pressEnterInSearch() {
      $("#nl-query").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    },
    setUnit: (unit) => $(`[data-unit="${unit}"]`).click(),
    setAmount(value) {
      const input = $("#nl-amount");
      input.value = String(value);
      input.dispatchEvent(new Event("input"));
    },
    amountValue: () => $("#nl-amount").value,
    queryValue: () => $("#nl-query").value,
    close: () => $('[data-nl="close"]').click(),
    back: () => $('[data-nl="back"]').click(),
    pressEscape: () =>
      screen.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    unitsPressed: () =>
      Array.from(screen.querySelectorAll(".nl-unit-seg button")).map((b) =>
        b.getAttribute("aria-pressed")
      ),
    seg: (key) => $("#nl-seg-" + key),
    add: () => $('[data-nl="add"]').click(),
    removeEntry: (i) => screen.querySelectorAll('[data-nl="remove"]')[i].click(),
    entries: () =>
      Array.from(screen.querySelectorAll(".nl-entry")).map((row) => ({
        name: row.querySelector("b").textContent,
        detail: row.querySelector(".sub").textContent,
        calories: row.querySelector(".nl-entry-kcal").textContent,
      })),
    sheetOpen: () => {
      const open = screen.querySelector(".nl-sheet.is-open");
      return open ? (open.classList.contains("nl-sheet--search") ? "search" : "amount") : null;
    },
  };
}
