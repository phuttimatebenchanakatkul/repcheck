// Behavioural tests for the shared horizontal ruler that backs the weight
// and height questions (static/onboarding.js's renderHorizontalRuler),
// running the REAL function via the marker extractor in
// support/loadHorizontalRuler.js.
//
// The headline case is the silent-corruption guard. Measured in a real
// browser: the moment a step change swaps a ruler out of the DOM its
// scrollLeft snaps from wherever the user left it to 0, and position 0
// decodes to the ruler's MINIMUM. A scroll event around that transition
// therefore used to rewrite the answer to 35kg / 130cm behind the user's
// back -- observed as a saved profile reading 35kg/130cm on a run whose
// calorie targets had just been calculated from 98kg/183cm. jsdom is the
// right place to pin it: the event can be dispatched deterministically
// instead of waiting on a browser race.

import { describe, it, expect, beforeEach } from "vitest";
import { loadHorizontalRuler } from "./support/loadHorizontalRuler.js";

const TICK = 14;
const HALF = TICK / 2;

// Where the browser rests for a given value (scroll-snap centres each
// column, hence the half-tick term the production code also carries).
const scrollLeftFor = (value, min) => (value - min) * TICK + HALF;

function makeRuler({ min = 35, max = 400, value = 70 } = {}) {
  const { renderHorizontalRuler } = loadHorizontalRuler();
  const writes = [];
  const el = renderHorizontalRuler({
    id: "test-ruler",
    min,
    max,
    value,
    format: (v) => `${v} u`,
    ariaLabel: "Test ruler",
    onChange: (v) => writes.push(v),
  });
  const scrollEl = el.querySelector(".ob-hruler-scroll");
  const valueEl = el.querySelector(".ob-hruler-value");
  document.body.appendChild(el);
  // jsdom never lays out, so drive the deferred seek the production code
  // runs on a timeout, then flush it. This is what arms the ruler.
  const seed = async () => { await new Promise((r) => setTimeout(r, 0)); };
  // jsdom does not fire scroll events for scrollLeft writes either.
  const scrollTo = (px) => { scrollEl.scrollLeft = px; scrollEl.dispatchEvent(new Event("scroll")); };
  return { el, scrollEl, valueEl, writes, seed, scrollTo, min };
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("decodes a scroll position into the value the user landed on", () => {
  it("reports the exact value for a mid-range position", async () => {
    const r = makeRuler({ value: 70 });
    await r.seed();
    r.scrollTo(scrollLeftFor(98, r.min));
    expect(r.writes.at(-1)).toBe(98);
    expect(r.valueEl.textContent).toBe("98 u");
    expect(r.scrollEl.getAttribute("aria-valuenow")).toBe("98");
  });

  it("reaches both bounds exactly -- the half-tick term is what keeps the ends addressable", async () => {
    const r = makeRuler({ min: 35, max: 400, value: 70 });
    await r.seed();
    r.scrollTo(scrollLeftFor(35, 35));
    expect(r.writes.at(-1)).toBe(35);
    r.scrollTo(scrollLeftFor(400, 35));
    expect(r.writes.at(-1)).toBe(400);
  });

  it("clamps a position past either end instead of returning an out-of-range value", async () => {
    const r = makeRuler({ min: 35, max: 400, value: 70 });
    await r.seed();
    r.scrollTo(-5000);
    expect(r.writes.at(-1)).toBe(35);
    r.scrollTo(999999);
    expect(r.writes.at(-1)).toBe(400);
  });
});

describe("never writes an answer the user did not make", () => {
  it("ignores the scroll a detached ruler fires when its position resets to 0", async () => {
    const r = makeRuler({ value: 70 });
    await r.seed();
    r.scrollTo(scrollLeftFor(98, r.min));
    expect(r.writes.at(-1)).toBe(98);

    // Exactly what a step change does: swap the ruler out, at which point
    // the browser resets scrollLeft to 0 and can fire one last scroll.
    r.el.remove();
    r.scrollEl.scrollLeft = 0;
    r.scrollEl.dispatchEvent(new Event("scroll"));

    // The answer must still be 98 -- not the ruler's minimum.
    expect(r.writes.at(-1)).toBe(98);
    expect(r.writes).not.toContain(35);
  });

  it("ignores scrolls that arrive before the ruler has been positioned", () => {
    const r = makeRuler({ value: 70 });
    // No seed() -- the deferred seek has not run, so scrollLeft is still 0
    // and would decode to the minimum.
    r.scrollTo(0);
    expect(r.writes).toHaveLength(0);
  });

  it("a ruler whose render was superseded before it was positioned never arms", async () => {
    const r = makeRuler({ value: 70 });
    r.el.remove();          // superseded by a later render...
    await r.seed();         // ...then its deferred seek finally runs
    r.scrollTo(0);
    expect(r.writes).toHaveLength(0);
  });
});

describe("scrolls horizontally so it cannot swallow a vertical page gesture", () => {
  it("is a pan-x scroller -- the fix for an unreachable Next button", () => {
    const r = makeRuler();
    expect(r.scrollEl.className).toContain("ob-hruler-scroll");
    // The axis is what matters: a vertical wheel would consume the
    // downward flick that has to reach the page for Next to be scrollable.
    // Pinned in the stylesheet (touch-action: pan-x / overflow-y: hidden);
    // asserted here as the class contract the CSS hangs off.
    expect(r.el.querySelector(".ob-hruler-window")).not.toBeNull();
  });

  it("exposes itself to assistive tech as a slider with real bounds", () => {
    const r = makeRuler({ min: 130, max: 230, value: 170 });
    expect(r.scrollEl.getAttribute("role")).toBe("slider");
    expect(r.scrollEl.getAttribute("aria-valuemin")).toBe("130");
    expect(r.scrollEl.getAttribute("aria-valuemax")).toBe("230");
    expect(r.scrollEl.getAttribute("aria-valuenow")).toBe("170");
    expect(r.scrollEl.getAttribute("tabindex")).toBe("0");
  });
});
