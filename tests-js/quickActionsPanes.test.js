// The quick-actions sheet used to stack the five action tiles AND the "More"
// pages (Coach/Friends/Settings/...) in one column, which pushed it past its
// 88%-height cap and made it scroll on short phones. It now holds two panes
// and mounts only one at a time.
//
// These cover the state machine, not the pixels: jsdom reports every
// offsetHeight as 0, so the height morph is untestable here, but which pane
// is mounted, the re-entrancy guard and the reset-on-open path are exactly
// the parts that broke during development. The reset originally listened only
// for the sheet CLOSING, via .is-open/.is-in on the overlay -- but
// openBottomSheet flips those inside a double requestAnimationFrame, which
// never fires while the tab is backgrounded, so the watcher silently missed
// and the sheet reopened on the More pane. Hence the reset-on-open tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadQuickActionsPanes, quickActionsFixture } from "./support/loadQuickActionsPanes.js";

const run = loadQuickActionsPanes();

// Matches the DURATION constant in the block.
const SLIDE_MS = 300;

const actions = () => document.getElementById("qa-pane-actions");
const more = () => document.getElementById("qa-pane-more");
const openBtn = () => document.getElementById("qa-more-open");
const backBtn = () => document.getElementById("qa-more-back");
const fab = () => document.getElementById("mt-fab-btn");
const overlay = () => document.getElementById("mt-fab-overlay");
const panes = () => document.getElementById("qa-panes");

function mount() {
  document.body.innerHTML = quickActionsFixture();
  run();
}

function settle() {
  vi.advanceTimersByTime(SLIDE_MS + 1);
}

describe("quick-actions sliding More pane", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mount();
  });

  it("starts on the actions pane with the More pages unmounted", () => {
    expect(actions().hidden).toBe(false);
    expect(more().hidden).toBe(true);
    expect(openBtn().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows exactly five action buttons and no More links until asked", () => {
    // The whole point of the redesign: five buttons, and the More pages are
    // reachable but not on screen.
    expect(document.querySelectorAll("#qa-pane-actions .qa-tile").length).toBe(5);
    expect(more().hidden).toBe(true);
  });

  it("slides to the More pane and unmounts the tiles", () => {
    openBtn().click();
    settle();

    expect(more().hidden).toBe(false);
    expect(actions().hidden).toBe(true);
    expect(openBtn().getAttribute("aria-expanded")).toBe("true");
  });

  it("mounts both panes mid-slide so the outgoing one can animate out", () => {
    openBtn().click();

    // Before the timer fires, both are in the DOM and stacked.
    expect(actions().hidden).toBe(false);
    expect(more().hidden).toBe(false);
    expect(panes().classList.contains("is-animating")).toBe(true);

    settle();

    expect(panes().classList.contains("is-animating")).toBe(false);
  });

  it("hands sizing back to the live pane once the slide finishes", () => {
    openBtn().click();
    expect(panes().style.height).not.toBe(""); // locked during the slide
    settle();
    expect(panes().style.height).toBe(""); // released after
  });

  it("goes back to the actions pane", () => {
    openBtn().click();
    settle();
    backBtn().click();
    settle();

    expect(actions().hidden).toBe(false);
    expect(more().hidden).toBe(true);
    expect(openBtn().getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll("#qa-pane-actions .qa-tile").length).toBe(5);
  });

  it("ignores a second tap while a slide is still running", () => {
    // A rapid double-tap must not start a second animation on top of the
    // first, which would leave both panes stacked and mounted forever.
    openBtn().click();
    openBtn().click();
    settle();

    expect(more().hidden).toBe(false);
    expect(actions().hidden).toBe(true);
    expect(panes().classList.contains("is-animating")).toBe(false);
  });

  it("reopens on the actions pane after the sheet is dismissed from More", () => {
    openBtn().click();
    settle();
    expect(more().hidden).toBe(false);

    // Dismiss, then reopen with the "+" button.
    document.getElementById("mt-fab-cancel").click();
    fab().click();

    expect(actions().hidden).toBe(false);
    expect(more().hidden).toBe(true);
    expect(openBtn().getAttribute("aria-expanded")).toBe("false");
  });

  it("resets on open even when the overlay classes never change", () => {
    // The regression: openBottomSheet sets .is-open inside a double rAF that
    // never fires in a backgrounded tab, so nothing mutates the overlay's
    // class list and a close-only watcher never runs. Opening must still
    // land on the actions pane.
    openBtn().click();
    settle();
    expect(more().hidden).toBe(false);

    fab().click(); // no overlay class change at all

    expect(actions().hidden).toBe(false);
    expect(more().hidden).toBe(true);
  });

  it("also resets when the overlay drops its open classes", async () => {
    openBtn().click();
    settle();

    overlay().classList.add("is-open");
    overlay().classList.remove("is-open");

    // MutationObserver delivers on the microtask queue, so the reset lands a
    // tick after the class change rather than synchronously with it.
    await Promise.resolve();

    expect(actions().hidden).toBe(false);
    expect(more().hidden).toBe(true);
  });

  it("leaves a fresh sheet alone when reset has nothing to undo", () => {
    const before = panes().className;
    fab().click();

    expect(actions().hidden).toBe(false);
    expect(more().hidden).toBe(true);
    expect(panes().className).toBe(before);
  });

  it("clears the animating state if the sheet is dismissed mid-slide", () => {
    openBtn().click();
    expect(panes().classList.contains("is-animating")).toBe(true);

    fab().click(); // dismissed before the slide finished

    expect(panes().classList.contains("is-animating")).toBe(false);
    expect(actions().hidden).toBe(false);
    expect(more().hidden).toBe(true);
  });

  it("stays usable after being dismissed mid-slide", () => {
    // The busy flag must be cleared by reset, or every later tap is a no-op.
    openBtn().click();
    fab().click();
    settle();

    openBtn().click();
    settle();

    expect(more().hidden).toBe(false);
    expect(actions().hidden).toBe(true);
  });

  it("does not throw when the sheet markup is absent", () => {
    // base.html loads on every page; a template that omits the sheet must
    // not take the whole inline script down with it.
    document.body.innerHTML = "";
    expect(() => run()).not.toThrow();
  });
});
