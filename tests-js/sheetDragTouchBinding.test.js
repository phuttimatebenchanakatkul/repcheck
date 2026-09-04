// Swipe-to-dismiss must not cost the whole app its scroll smoothness.
//
// bindSheetDrag's touchmove handler is NON-passive on purpose -- it calls
// preventDefault() so a downward drag on the sheet moves the sheet instead of
// scrolling it. A non-passive touchmove listener is scroll-blocking: the
// browser cannot hand the gesture to the compositor until the main thread has
// run the handler and seen whether it cancelled the event.
//
// That is fine while the sheet is up. It used to be bound at page load, and
// these overlays are `position: fixed; inset: 0` and stay in the DOM at
// opacity 0 between uses -- so every page carried a full-viewport
// scroll-blocking region at all times (three from base.html's own sheets,
// six on Nutrition), and every touch-scroll on every screen had to wait on
// the main thread before it could move. Measured in a real browser against
// the running app: 6 such overlays live on /nutrition, 3 on every other page.
//
// So the listeners are armed by openBottomSheet and disarmed by
// closeBottomSheet. These tests pin that, and pin that the drag itself still
// works -- the arming is worthless if it breaks the gesture it exists for.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSheetHelpers, sheetFixture } from "./support/loadSheetDrag.js";

const overlay = () => document.getElementById("mt-fab-overlay");
const sheet = () => document.getElementById("mt-fab-sheet");
const handle = () => document.querySelector(".mt-sheet-handle");

// jsdom has no TouchEvent constructor, and the handlers only ever read
// e.touches[0].clientY / e.target / e.cancelable / e.preventDefault.
function touch(target, type, clientY) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  event.touches = type === "touchend" ? [] : [{ clientY, clientX: 0 }];
  target.dispatchEvent(event);
  return event;
}

// Records what actually reaches the overlay's addEventListener, including
// whether the touchmove went on as scroll-blocking.
function trackTouchListeners(el) {
  const log = [];
  const origAdd = el.addEventListener.bind(el);
  const origRemove = el.removeEventListener.bind(el);
  el.addEventListener = (type, handler, opts) => {
    if (String(type).startsWith("touch")) {
      log.push(`+${type}${opts && opts.passive === false ? ":blocking" : ""}`);
    }
    return origAdd(type, handler, opts);
  };
  el.removeEventListener = (type, handler, opts) => {
    if (String(type).startsWith("touch")) log.push(`-${type}`);
    return origRemove(type, handler, opts);
  };
  return log;
}

function mount(opts) {
  document.body.innerHTML = sheetFixture();
  loadSheetHelpers();
  const closeCb = vi.fn(() => window.closeBottomSheet(overlay(), ".mt-sheet"));
  window.bindSheetDrag(overlay(), ".mt-sheet", ".mt-sheet-handle", closeCb, opts);
  return closeCb;
}

// openBottomSheet flips .is-in/.is-open inside a double requestAnimationFrame;
// closeBottomSheet finishes on a 500ms timeout when no transitionend arrives.
function openSheet() {
  window.openBottomSheet(overlay(), ".mt-sheet");
  vi.advanceTimersByTime(50);
}
function settleClose() {
  vi.advanceTimersByTime(501);
}

describe("bottom-sheet drag: touch listeners are scoped to the open sheet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // openBottomSheet's double rAF never resolves under fake timers otherwise.
    vi.stubGlobal("requestAnimationFrame", (fn) => setTimeout(() => fn(0), 0));
    // closeBottomSheet's cleanup restores the pinned scroll position; jsdom
    // has no scrollTo and logs a "Not implemented" for every close.
    vi.stubGlobal("scrollTo", () => {});
    delete window.RepCheck;
    window.__pcSheetLockCount = 0;
  });

  it("binds nothing to the overlay at page load", () => {
    document.body.innerHTML = sheetFixture();
    loadSheetHelpers();
    const log = trackTouchListeners(overlay());
    window.bindSheetDrag(overlay(), ".mt-sheet", ".mt-sheet-handle", () => {});
    expect(log).toEqual([]);
  });

  it("arms on open and disarms on close", () => {
    mount();
    const log = trackTouchListeners(overlay());

    openSheet();
    expect(log).toEqual([
      "+touchstart",
      "+touchmove:blocking",
      "+touchend",
      "+touchcancel",
    ]);

    log.length = 0;
    window.closeBottomSheet(overlay(), ".mt-sheet");
    // Disarmed immediately, not on the 500ms cleanup: the sheet is already on
    // its way out and has nothing left to drag.
    expect(log).toEqual([
      "-touchstart",
      "-touchmove",
      "-touchend",
      "-touchcancel",
    ]);
    settleClose();
  });

  it("re-arms on a second open", () => {
    mount();
    openSheet();
    window.closeBottomSheet(overlay(), ".mt-sheet");
    settleClose();

    const log = trackTouchListeners(overlay());
    openSheet();
    expect(log).toContain("+touchmove:blocking");
  });

  it("still dismisses on a real downward drag", () => {
    const closeCb = mount();
    openSheet();

    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 560); // 160px, past the 120px default
    expect(sheet().style.transform).toBe("translateY(154px)"); // minus the 6px deadzone
    touch(handle(), "touchend", 560);

    expect(closeCb).toHaveBeenCalledTimes(1);
    settleClose();
    expect(overlay().classList.contains("is-open")).toBe(false);
  });

  it("snaps back on a drag that stops short", () => {
    const closeCb = mount();
    openSheet();

    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 450); // 50px, under the 120px threshold
    touch(handle(), "touchend", 450);

    expect(closeCb).not.toHaveBeenCalled();
    expect(sheet().style.transform).toBe("");
    expect(overlay().classList.contains("is-open")).toBe(true);
  });

  it("cancels a drag in flight when the sheet is closed some other way", () => {
    // A Cancel tap while a finger is still down: the touchend that would have
    // cleared the drag is no longer being listened for, so disarm has to reset
    // the state itself -- and must not re-enter the close it is part of.
    const closeCb = mount();
    openSheet();

    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 500);
    expect(sheet().style.transform).not.toBe("");

    window.closeBottomSheet(overlay(), ".mt-sheet");
    expect(sheet().style.transform).toBe("");
    expect(closeCb).not.toHaveBeenCalled();
    settleClose();
  });

  it("arms a sheet whose drag was bound AFTER it was opened", () => {
    // static/coaching.js builds its overlay, opens it, and only then calls
    // bindSheetDrag. openBottomSheet's synchronous arm therefore runs while
    // _sheetDragArm is still undefined and silently does nothing, so
    // openBottomSheet arms a second time once the sheet is actually on
    // screen. Without that the coaching check-in sheet lost swipe-to-dismiss
    // -- and it has no backdrop click and no close button, so a finger had no
    // way out of it at all.
    document.body.innerHTML = sheetFixture();
    loadSheetHelpers();
    const log = trackTouchListeners(overlay());
    const closeCb = vi.fn(() => window.closeBottomSheet(overlay(), ".mt-sheet"));

    window.openBottomSheet(overlay(), ".mt-sheet");
    window.bindSheetDrag(overlay(), ".mt-sheet", ".mt-sheet-handle", closeCb);
    vi.advanceTimersByTime(50);

    expect(log).toContain("+touchmove:blocking");

    // and the gesture it exists for actually works
    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 560);
    touch(handle(), "touchend", 560);
    expect(closeCb).toHaveBeenCalledTimes(1);
    settleClose();
  });

  it("ignores jitter inside the deadzone", () => {
    const closeCb = mount();
    openSheet();
    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 405); // 5px, inside the 6px deadzone
    expect(sheet().style.transform).toBe("");
    touch(handle(), "touchend", 405);
    expect(closeCb).not.toHaveBeenCalled();
  });

  it("abandons the drag when the finger goes back up past the start", () => {
    const closeCb = mount();
    openSheet();
    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 460);
    expect(sheet().style.transform).not.toBe("");

    touch(handle(), "touchmove", 380); // above where it started
    expect(sheet().style.transform).toBe("");

    // The drag is over: a later downward move must not resume it.
    touch(handle(), "touchmove", 600);
    expect(sheet().style.transform).toBe("");
    touch(handle(), "touchend", 600);
    expect(closeCb).not.toHaveBeenCalled();
  });

  it("strict mode ignores a drag that is neither far nor fast", () => {
    // The mt-fab sheet passes { strict: true } because its body is not a real
    // scroll container, so any slow drag would otherwise dismiss it. 154px
    // over 400ms is 0.385 px/ms -- past the default 120px threshold, but under
    // both strict thresholds (220px, 0.7 px/ms).
    const closeCb = mount({ strict: true });
    openSheet();
    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 560);
    vi.advanceTimersByTime(400);
    touch(handle(), "touchend", 560);
    expect(closeCb).not.toHaveBeenCalled();
  });

  it("strict mode accepts a short but fast flick", () => {
    // The velocity escape: same 154px, thrown in 20ms (7.7 px/ms).
    const closeCb = mount({ strict: true });
    openSheet();
    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 560);
    vi.advanceTimersByTime(20);
    touch(handle(), "touchend", 560);
    expect(closeCb).toHaveBeenCalledTimes(1);
    settleClose();
  });

  it("strict mode accepts a genuinely long drag", () => {
    const closeCb = mount({ strict: true });
    openSheet();
    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 640); // 234px after the deadzone, past 220
    vi.advanceTimersByTime(400); // slow, so this proves the DISTANCE branch
    touch(handle(), "touchend", 640);
    expect(closeCb).toHaveBeenCalledTimes(1);
    settleClose();
  });

  it("leaves a torn-down overlay with no touch listeners", () => {
    mount();
    openSheet();
    const log = trackTouchListeners(overlay());
    window.closeBottomSheet(overlay(), ".mt-sheet");
    settleClose();

    // Nothing re-adds them on the way out.
    expect(log.filter((entry) => entry.startsWith("+"))).toEqual([]);
  });

  // Regression: ISSUE-001 -- a sheet closed in the same tick it opened kept
  // its scroll-blocking touchmove listener for the life of the page.
  // Found by /qa on 2026-09-04 (browser verification, not the unit tests).
  // Report: .gstack/qa-reports/qa-report-repcheck-q0m4-onrender-com-2026-09-04.md
  it("disarms a sheet closed in the same tick it was opened", () => {
    // openBottomSheet only adds is-in/is-open inside a double rAF, so a close
    // landing before those frames run takes closeBottomSheet's early return.
    // The listeners still have to come off -- otherwise the one sheet a fast
    // tap touched goes on blocking that page's scrolling forever, which is
    // the exact cost arming exists to avoid.
    mount();
    const log = trackTouchListeners(overlay());

    window.openBottomSheet(overlay(), ".mt-sheet"); // no timer advance
    window.closeBottomSheet(overlay(), ".mt-sheet");

    expect(log).toEqual([
      "+touchstart",
      "+touchmove:blocking",
      "+touchend",
      "+touchcancel",
      "-touchstart",
      "-touchmove",
      "-touchend",
      "-touchcancel",
    ]);
    settleClose();
  });

  it("disarms a page-owned sheet still open when its page swaps away", () => {
    // base.html's page-will-swap unlock handler strips is-in/is-open by hand
    // instead of calling closeBottomSheet, so it has to disarm too. Without
    // that, a sheet left open when its page swapped kept a full-viewport
    // scroll-blocking touchmove on every page that followed -- the exact
    // leak arming exists to prevent. It is NOT enough that nav_scope usually
    // removes the node: adopt() is itself behind a guard.
    mount();
    overlay().setAttribute("data-pc-page-sheet", "");
    openSheet();

    const log = trackTouchListeners(overlay());
    document.dispatchEvent(new CustomEvent("repcheck:page-will-swap"));

    expect(log).toEqual([
      "-touchstart",
      "-touchmove",
      "-touchend",
      "-touchcancel",
    ]);
  });

  it("ends a drag cleanly on touchcancel", () => {
    // The interruption a phone actually takes: incoming call, system gesture,
    // scroll takeover. touchcancel is routed to the same handler as touchend,
    // so a cancelled drag must leave no transform behind and must not be
    // read as a dismiss.
    const closeCb = mount();
    openSheet();

    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 450);
    expect(sheet().style.transform).not.toBe("");

    touch(handle(), "touchcancel", 450);
    expect(sheet().style.transform).toBe("");
    expect(closeCb).not.toHaveBeenCalled();
    expect(overlay().classList.contains("is-open")).toBe(true);
  });

  it("resets a transform left by a drag the same-tick close interrupted", () => {
    mount();
    window.openBottomSheet(overlay(), ".mt-sheet");
    touch(handle(), "touchstart", 400);
    touch(handle(), "touchmove", 560);
    expect(sheet().style.transform).toBe("translateY(154px)");

    window.closeBottomSheet(overlay(), ".mt-sheet");
    expect(sheet().style.transform).toBe("");
    settleClose();
  });
});
