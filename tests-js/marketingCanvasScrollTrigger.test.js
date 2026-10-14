// On the canvas host <body> is the scroller, and ScrollTrigger must be TOLD
// when it scrolls. ScrollTrigger treats document.body as the viewport and
// listens for `scroll` on the window, but body here is an ordinary scroll
// container inside a clipped <html>, and an element's scroll event does not
// bubble -- so the window never hears it. A mouse wheel woke ScrollTrigger by
// another route, which hid this on the desktop; a phone's touch scroll did
// not. Measured at 390x844 with real touch events before the fix: body
// scrolled to 2420px while the opaque hero sat on top of everything and the
// story never left feature 01.
//
// jsdom has no GSAP and does no layout, so this stubs just enough of
// gsap/ScrollTrigger for app.js's story block to wire itself up, and asserts
// on the one thing that matters: a scroll on body reaches ScrollTrigger.update.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSource, readWhatSection } from "./support/loadMarketingFeatureSwitcher.js";

function stubGsap() {
  const ScrollTrigger = {
    update: vi.fn(),
    defaults: vi.fn(),
    create: vi.fn(),
    clearScrollMemory: vi.fn(),
  };
  // matchMedia().add() never calls back: the zoom and the per-feature
  // timelines are not what this file is about.
  const gsap = {
    registerPlugin: vi.fn(),
    matchMedia: () => ({ add: vi.fn() }),
    set: vi.fn(),
    fromTo: vi.fn(),
  };
  window.gsap = gsap;
  window.ScrollTrigger = ScrollTrigger;
  return ScrollTrigger;
}

function mount({ canvas }) {
  document.documentElement.className = canvas ? "rc-canvas" : "";
  document.body.innerHTML = readWhatSection();
  const ScrollTrigger = stubGsap();
  // eslint-disable-next-line no-new-func
  new Function(readSource())();
  return ScrollTrigger;
}

const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

afterEach(() => {
  document.documentElement.className = "";
  delete window.gsap;
  delete window.ScrollTrigger;
});

describe("the canvas host's scroll story", () => {
  it("hands body to ScrollTrigger as the scroller", () => {
    const ScrollTrigger = mount({ canvas: true });
    expect(ScrollTrigger.defaults).toHaveBeenCalledWith({ scroller: document.body });
  });

  it("updates ScrollTrigger when body scrolls -- the event never reaches the window", async () => {
    const ScrollTrigger = mount({ canvas: true });
    ScrollTrigger.update.mockClear();

    document.body.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextFrame();

    expect(ScrollTrigger.update).toHaveBeenCalled();
  });

  it("coalesces a burst of scroll events into one update per frame", async () => {
    const ScrollTrigger = mount({ canvas: true });
    ScrollTrigger.update.mockClear();

    for (let i = 0; i < 5; i++) document.body.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextFrame();

    expect(ScrollTrigger.update).toHaveBeenCalledTimes(1);
  });
});
