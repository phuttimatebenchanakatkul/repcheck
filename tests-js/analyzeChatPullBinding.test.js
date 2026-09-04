// The analyze "ask" dock opens on a pull-down at the very top of the page.
// Holding that pull preview under the finger means preventDefault(), so its
// touchmove listener has to be non-passive -- and a non-passive touchmove on
// `document` is scroll-blocking for the WHOLE page for as long as it is
// attached: the browser cannot hand a scroll to the compositor until the main
// thread has run the handler and seen whether it cancelled.
//
// It used to be attached for the life of the page, on both screens that mount
// this widget (the analyze result view and the server-rendered result page).
// Past the first few pixels of scroll the handler does nothing at all --
// onTouchStart has already set pulling=false -- but the scroll was still
// paying for it, on exactly the long results page a user scrolls most.
//
// The listener is now tied to the one state a pull can start from: page at the
// top, dock closed. That is a SCROLL-state question, so it is answered from
// the scroll handler and from open()/close(), NOT from onTouchStart.
//
// Arming inside onTouchStart would be the obvious place and is deliberately
// wrong: both WebKit and Chromium decide whether a touch sequence is
// cancelable at touch-DOWN, from the handler regions already committed, so a
// blocking listener added during the dispatch of a passive touchstart arrives
// too late for the gesture in flight -- e.cancelable would come back false and
// preventDefault() would silently do nothing, leaving the preview to follow
// the finger while the page rubber-banded underneath it.
//
// Regression: ISSUE-002 -- found by /qa on 2026-09-04, redesigned after
// /ship's adversarial review flagged the cancelability hazard.
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
  window.dispatchEvent(new Event("scroll"));
}

describe("analyze chat dock: the pull listener follows the scroll state", () => {
  beforeEach(() => {
    // init() tears down the previous instance via window.__agCleanup, which
    // removes touch listeners. Do it here instead, so a test's listener log
    // only ever contains what THIS mount did.
    if (window.__agCleanup) { window.__agCleanup(); window.__agCleanup = null; }
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("is armed at the top of a freshly loaded page", () => {
    // The listener has to exist BEFORE the finger lands, or the pull's
    // preventDefault() is inert. At the top with the dock closed, a pull is
    // possible, so it is armed.
    const log = trackDocumentTouchListeners();
    mountWidget();
    expect(log).toContain("+touchmove:blocking");
    expect(log).toContain("+touchstart");
  });

  it("comes off as soon as the page is scrolled, and goes back on at the top", () => {
    // This is the whole win: a long analyze result scrolls without the
    // compositor waiting on the main thread.
    mountWidget();
    const log = trackDocumentTouchListeners();

    scrollTo(240);
    expect(log).toEqual(["-touchmove"]);

    scrollTo(0);
    expect(log).toEqual(["-touchmove", "+touchmove:blocking"]);
  });

  it("comes off while the dock is open and back on when it closes", () => {
    mountWidget();
    const log = trackDocumentTouchListeners();

    touch("touchstart", 10);
    touch("touchmove", 90); // past PULL_OPEN (64)
    touch("touchend", 90);
    expect(dock().classList.contains("is-open")).toBe(true);
    expect(log).toContain("-touchmove");

    log.length = 0;
    document.getElementById("ac-toggle").click(); // toggle shut
    expect(dock().classList.contains("is-open")).toBe(false);
    expect(log).toContain("+touchmove:blocking");
  });

  it("never arms the pull on the docked bar", () => {
    // templates/result.html renders documentElement.an-result, which has no
    // pull gesture at all -- so it must never pay for one.
    const log = trackDocumentTouchListeners();
    mountWidget(undefined, { bottom: true });
    expect(log.filter((e) => e.includes("touchmove"))).toEqual([]);
    expect(log.filter((e) => e.includes("touchstart"))).toEqual([]);

    // open() and close() also sync the arming, and they ARE reachable on the
    // docked bar -- so the guard has to hold on that path too, not just at
    // init where the bind block is skipped wholesale.
    document.getElementById("ac-toggle").click();
    document.getElementById("ac-toggle").click();
    expect(log.filter((e) => e.includes("touchmove"))).toEqual([]);
  });

  it("does not re-arm on a scroll that is already at the top", () => {
    mountWidget();
    const log = trackDocumentTouchListeners();
    scrollTo(0);
    scrollTo(0);
    expect(log).toEqual([]); // idempotent, no listener churn per scroll event
  });

  it("still previews the pull under the finger", () => {
    mountWidget();
    touch("touchstart", 10);
    touch("touchmove", 60); // 50px, past the 14px jitter deadzone
    expect(dock().classList.contains("is-pulling")).toBe(true);
    expect(dock().style.transform).not.toBe("");
  });

  it("ignores jitter inside the pull deadzone", () => {
    mountWidget();
    touch("touchstart", 10);
    touch("touchmove", 20); // 10px, inside the 14px deadzone
    expect(dock().classList.contains("is-pulling")).toBe(false);
    expect(dock().style.transform).toBe("");
    touch("touchend", 20);
    expect(dock().classList.contains("is-open")).toBe(false);
  });

  it("does not open on a release that stopped short", () => {
    mountWidget();
    touch("touchstart", 10);
    touch("touchmove", 40); // 30px, under PULL_OPEN
    touch("touchend", 40);
    expect(dock().classList.contains("is-open")).toBe(false);
    expect(dock().style.transform).toBe("");
  });

  it("abandons a pull that started before the page was scrolled", () => {
    mountWidget();
    touch("touchstart", 10);
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    touch("touchmove", 40); // the page moved under the finger
    expect(dock().classList.contains("is-pulling")).toBe(false);
    touch("touchend", 40);
    expect(dock().classList.contains("is-open")).toBe(false);
  });
});
