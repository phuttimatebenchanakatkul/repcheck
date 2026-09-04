// The analyze "ask" dock opens on a pull-down at the very top of the page.
// Holding the pull preview under the finger means preventDefault(), so its
// touchmove listener has to be non-passive -- and a non-passive touchmove on
// `document` is scroll-blocking for the WHOLE page for as long as it is
// attached: the browser cannot hand a scroll to the compositor until the main
// thread has run the handler and seen whether it cancelled.
//
// It used to be bound for the life of the page, on both screens that mount
// this widget (the analyze result view and the server-rendered result page).
// Past the first few pixels of scroll the handler does nothing at all --
// onTouchStart has already set pulling=false -- but the scroll was still
// paying for it, on exactly the long results page a user scrolls most.
//
// So it is armed by onTouchStart, only for a pull that can actually open the
// dock, and taken off again at the end of the gesture. These tests pin that,
// and pin that the pull itself still works.
//
// Regression: ISSUE-002 -- found by /qa on 2026-09-04.
// Report: .gstack/qa-reports/qa-report-repcheck-q0m4-onrender-com-2026-09-04.md
import { beforeEach, describe, expect, it } from "vitest";
import { mountWidget, trackDocumentTouchListeners } from "./support/loadAnalyzeChatWidget.js";

const dock = () => document.getElementById("ac-dock");

function touch(type, clientY) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  event.touches = type === "touchend" ? [] : [{ clientY, clientX: 0 }];
  document.dispatchEvent(event);
  return event;
}

function scrollTo(y) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

describe("analyze chat dock: the pull listener is scoped to the pull", () => {
  beforeEach(() => {
    scrollTo(0);
    localStorage.clear();
  });

  it("binds no scroll-blocking touchmove at init", () => {
    document.body.innerHTML = "";
    const log = trackDocumentTouchListeners();
    mountWidget();
    expect(log.filter((e) => e.includes("touchmove"))).toEqual([]);
    // The cheap, passive parts are still bound up front.
    expect(log).toContain("+touchstart");
  });

  it("arms on a pull that starts at the top, and disarms at the end", () => {
    mountWidget();
    const log = trackDocumentTouchListeners();

    touch("touchstart", 10);
    expect(log).toEqual(["+touchmove:blocking"]);

    touch("touchend", 10);
    expect(log).toEqual(["+touchmove:blocking", "-touchmove"]);
  });

  it("never arms when the page is already scrolled", () => {
    mountWidget();
    scrollTo(240);
    const log = trackDocumentTouchListeners();

    touch("touchstart", 400);
    touch("touchmove", 460);
    touch("touchend", 460);

    expect(log.filter((e) => e.includes("touchmove"))).toEqual([]);
  });

  it("disarms mid-gesture once the page is no longer at the top", () => {
    mountWidget();
    const log = trackDocumentTouchListeners();

    touch("touchstart", 10);
    expect(log).toContain("+touchmove:blocking");

    scrollTo(120); // the page moved under the finger
    touch("touchmove", 40);
    expect(log).toContain("-touchmove");
  });

  it("still previews the pull under the finger", () => {
    mountWidget();
    touch("touchstart", 10);
    touch("touchmove", 60); // 50px, past the 14px jitter deadzone
    expect(dock().classList.contains("is-pulling")).toBe(true);
    expect(dock().style.transform).not.toBe("");
  });

  it("still opens on a release past the threshold", () => {
    mountWidget();
    touch("touchstart", 10);
    touch("touchmove", 90); // 80px, past PULL_OPEN (64)
    touch("touchend", 90);
    expect(dock().classList.contains("is-open")).toBe(true);
  });

  it("does not open on a release that stopped short", () => {
    mountWidget();
    touch("touchstart", 10);
    touch("touchmove", 40); // 30px, under PULL_OPEN
    touch("touchend", 40);
    expect(dock().classList.contains("is-open")).toBe(false);
    expect(dock().style.transform).toBe("");
  });
});
