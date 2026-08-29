// Loads the REAL static/nav.js -- the bottom tab bar's gliding active
// bubble -- and runs it against a jsdom copy of base.html's tab bar markup.
//
// Two things make this need a loader rather than a bare import:
//
//   * nav.js positions the bubble from offsetLeft/offsetTop/offsetWidth/
//     offsetHeight, and jsdom does no layout at all -- every one of those
//     is 0. The geometry is therefore stubbed onto the items with the real
//     measured values from a 375px-wide viewport, so a regression in the
//     arithmetic (wrong axis, forgetting the pill's padding offset) still
//     shows up as a wrong transform.
//
//   * nav.js registers pointerup/pointercancel/resize/pageshow on `window`.
//     A stub window is passed in so those land somewhere the test can fire
//     them deliberately, and so handlers don't leak from one test into the
//     next through the shared jsdom window.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "..", "..", "static", "nav.js");

export function readSource() {
  return readFileSync(SCRIPT_PATH, "utf-8");
}

// Measured from the running app at 375px wide: a 5px pill padding, then
// five 57x46 items butted together.
export const ITEM_WIDTH = 57;
export const ITEM_HEIGHT = 46;
export const PILL_PADDING = 5;
export const TABS = ["Home", "Workouts", "Nutrition", "HYROX", "Analyze"];

export function offsetLeftFor(index) {
  return PILL_PADDING + index * ITEM_WIDTH;
}

/**
 * Builds base.html's tab bar in jsdom with `activeIndex` marked active,
 * stubs the layout geometry, then evaluates the real nav.js against it.
 */
export function loadNav({ activeIndex = 0 } = {}) {
  document.body.innerHTML = `
    <nav class="mobile-tabbar">
      <div class="mt-pill">
        ${TABS.map(
          (label, i) =>
            `<a href="/${label.toLowerCase()}" class="mt-item${
              i === activeIndex ? " is-active" : ""
            }" aria-label="${label}"></a>`
        ).join("")}
      </div>
    </nav>`;

  const pill = document.querySelector(".mt-pill");
  const items = Array.from(document.querySelectorAll(".mt-item"));
  items.forEach((item, i) => {
    define(item, "offsetLeft", offsetLeftFor(i));
    define(item, "offsetTop", PILL_PADDING);
    define(item, "offsetWidth", ITEM_WIDTH);
    define(item, "offsetHeight", ITEM_HEIGHT);
    // The bounding rect is what the pointerup hit-test reads. Only the x
    // axis varies; y is the same strip for every tab.
    item.getBoundingClientRect = () => ({
      left: offsetLeftFor(i),
      right: offsetLeftFor(i) + ITEM_WIDTH,
      top: 748,
      bottom: 748 + ITEM_HEIGHT,
      width: ITEM_WIDTH,
      height: ITEM_HEIGHT,
    });
  });

  const windowListeners = {};
  const windowStub = {
    addEventListener(type, handler) {
      (windowListeners[type] = windowListeners[type] || []).push(handler);
    },
    // nav.js navigates a drag-committed switch by assigning this directly
    // (a touch that moved this far gets no native click to do it via the
    // real <a href>). Stubbed rather than left off `windowStub` so that
    // assignment doesn't throw -- tests read it back to confirm the tab
    // that was actually released on.
    location: { href: "" },
  };

  // eslint-disable-next-line no-new-func
  new Function("window", readSource())(windowStub);

  const indicator = pill.querySelector(".mt-indicator");

  // The tabs are real <a href> elements (that is the whole point -- they do
  // real navigations), and jsdom logs a loud "Not implemented: navigation"
  // for every click. Swallow the default so the output stays readable;
  // nav.js's own handler is on the pill and still runs.
  document.addEventListener("click", (event) => event.preventDefault());
  const fireWindow = (type, event) =>
    (windowListeners[type] || []).forEach((h) => h(event));

  return {
    pill,
    items,
    indicator,
    windowListeners,
    fireWindow,
    /** windowStub.location -- read back after a drag-committed switch. */
    location: windowStub.location,
    /** Fires a window pointermove at the centre of tab `index`, as if the
     *  finger that pressed elsewhere has dragged onto it. */
    moveTo: (index) => fireWindow("pointermove", {
      clientX: offsetLeftFor(index) + ITEM_WIDTH / 2,
      clientY: 748 + ITEM_HEIGHT / 2,
    }),
    /** The x the bubble is currently translated to, as a number. */
    x: () => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
        indicator.style.transform
      );
      return m ? Number(m[1]) : null;
    },
    y: () => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
        indicator.style.transform
      );
      return m ? Number(m[2]) : null;
    },
    activeLabel: () => {
      const el = pill.querySelector(".mt-item.is-active");
      return el ? el.getAttribute("aria-label") : null;
    },
    /** The coordinates the centre of tab `index` sits at. */
    pointerAt: (index) => ({
      target: items[index],
      clientX: offsetLeftFor(index) + ITEM_WIDTH / 2,
      clientY: 748 + ITEM_HEIGHT / 2,
    }),

    /**
     * Presses tab `index` (or any node inside it). jsdom implements no
     * PointerEvent, so this is a MouseEvent carrying the same three fields
     * nav.js actually reads: target, clientX, clientY.
     */
    press: (index, node) => {
      const event = new window.MouseEvent("pointerdown", {
        bubbles: true,
        clientX: offsetLeftFor(index) + ITEM_WIDTH / 2,
        clientY: 748 + ITEM_HEIGHT / 2,
      });
      (node || items[index]).dispatchEvent(event);
    },

    /** Clicks tab `index`, which is what commits a press. */
    click: (index) =>
      items[index].dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
  };
}

function define(node, prop, value) {
  Object.defineProperty(node, prop, { configurable: true, get: () => value });
}
