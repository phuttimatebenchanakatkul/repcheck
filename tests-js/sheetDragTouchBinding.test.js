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
// six on Nutrition), so every touch-scroll on every screen had a
// scroll-blocking listener in its way. Counted at runtime in a real browser
// against the running app: 6 such overlays on /nutrition, 3 on every other
// page. The counts are measured; the resulting scroll win is not -- closed
// overlays are also pointer-events:none and opacity:0, and some engines may
// already exclude them from the blocking region. jsdom cannot settle that
// either: it has no compositor and ignores the `passive` option entirely, so
// these tests assert the listener contract, not the frame times.
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

// A sheet that belongs to a PAGE rather than to the shell: it starts inside
// <main>, which is what makes openBottomSheet mark it data-pc-page-sheet on
// the way to <body>, and the marker is what the repcheck:page-will-swap
// handler looks for when a tab swap force-closes a sheet the leaving page
// left open.
function mountPageSheet() {
  document.body.innerHTML = `<main class="main">${sheetFixture()}</main>`;
  loadSheetHelpers();
  const closeCb = vi.fn();
  window.bindSheetDrag(overlay(), ".mt-sheet", ".mt-sheet-handle", closeCb);
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

  it("does not bind a second copy when the sheet is opened while already open", () => {
    // Several sheets re-open themselves over an open one (the afterClose
    // pattern), and a second arm() must not stack a second scroll-blocking
    // touchmove on the same overlay -- disarm removes one handler per type,
    // so a duplicate would survive the close forever.
    mount();
    openSheet();

    const log = trackTouchListeners(overlay());
    openSheet();
    expect(log).toEqual([]);
  });

  it("disarming an already-disarmed sheet does nothing", () => {
    mount();
    openSheet();

    const log = trackTouchListeners(overlay());
    overlay()._sheetDragDisarm();
    overlay()._sheetDragDisarm();
    expect(log).toEqual([
      "-touchstart",
      "-touchmove",
      "-touchend",
      "-touchcancel",
    ]);
  });

  it("closing a sheet that was never open touches no listeners", () => {
    // closeBottomSheet returns early when the overlay carries neither
    // .is-in nor .is-open -- it still runs the caller's callback, and it
    // must not reach the disarm below that return.
    mount();
    const log = trackTouchListeners(overlay());
    const done = vi.fn();

    window.closeBottomSheet(overlay(), ".mt-sheet", done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(log).toEqual([]);
  });

  it("disarms a page's sheet left open when the tab swaps away", () => {
    // The iOS back-swipe honours the gesture over a scrim, so a page can
    // leave with its sheet still up. That path force-closes the sheet
    // without going through closeBottomSheet, so it owns its own disarm --
    // otherwise the departed page's overlay keeps a full-viewport
    // scroll-blocking touch region alive on the arriving screen.
    mountPageSheet();
    openSheet();
    expect(overlay().parentElement).toBe(document.body);
    expect(overlay().hasAttribute("data-pc-page-sheet")).toBe(true);

    const log = trackTouchListeners(overlay());
    document.dispatchEvent(new Event("repcheck:page-will-swap"));

    expect(log).toEqual([
      "-touchstart",
      "-touchmove",
      "-touchend",
      "-touchcancel",
    ]);
    expect(overlay().classList.contains("is-open")).toBe(false);
  });

  it("leaves an already-closed page sheet alone when the tab swaps away", () => {
    mountPageSheet();
    openSheet();
    window.closeBottomSheet(overlay(), ".mt-sheet");
    settleClose();

    const log = trackTouchListeners(overlay());
    document.dispatchEvent(new Event("repcheck:page-will-swap"));

    // Closing already disarmed it; the swap handler returns before its own
    // disarm because the sheet carries neither .is-in nor .is-open.
    expect(log).toEqual([]);
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

  it("arms a sheet that was bound after it was opened", () => {
    // static/coaching.js:1857 and :2369 create their overlay, open it, and
    // only THEN bind the drag. Arming solely from openBottomSheet would find
    // no _sheetDragArm yet and silently skip, leaving those two sheets with
    // swipe-to-dismiss permanently dead -- a failure with no error and no
    // visible symptom until someone tries the gesture.
    document.body.innerHTML = sheetFixture();
    loadSheetHelpers();

    window.openBottomSheet(overlay(), ".mt-sheet");
    const log = trackTouchListeners(overlay());
    window.bindSheetDrag(overlay(), ".mt-sheet", ".mt-sheet-handle", () => {});

    expect(log).toEqual([
      "+touchstart",
      "+touchmove:blocking",
      "+touchend",
      "+touchcancel",
    ]);
  });

  it("does not arm a sheet bound while it is closed", () => {
    // The mirror of the case above: binding a sheet nobody has opened must
    // stay inert, or the fix hands back the always-on listeners it removed.
    document.body.innerHTML = sheetFixture();
    loadSheetHelpers();

    const log = trackTouchListeners(overlay());
    window.bindSheetDrag(overlay(), ".mt-sheet", ".mt-sheet-handle", () => {});

    expect(log).toEqual([]);
  });

  it("disarms a sheet closed before its open animation flips the classes", () => {
    // openBottomSheet arms synchronously but only adds .is-in/.is-open two
    // frames later. A close inside that window used to hit closeBottomSheet's
    // not-open early return and strand the scroll-blocking touchmove on an
    // invisible full-viewport overlay -- reintroducing, on a race, exactly
    // the bug this change exists to remove. TODOS.md records a scroll-lock
    // leak through the same two frames, so the window is real.
    mount();
    window.openBottomSheet(overlay(), ".mt-sheet");
    // Deliberately NOT settling the double rAF.
    expect(overlay().classList.contains("is-open")).toBe(false);

    const log = trackTouchListeners(overlay());
    window.closeBottomSheet(overlay(), ".mt-sheet");

    expect(log).toEqual([
      "-touchstart",
      "-touchmove",
      "-touchend",
      "-touchcancel",
    ]);
  });

  it("watches the visual viewport only while a sheet is up", () => {
    // The vars it writes (--pc-vvt/--pc-vvh) are read by five sheet-overlay
    // rules and nothing else, but the subscription that keeps them live sits
    // on the scroll path: on iOS visualViewport "scroll" fires right through
    // rubber-banding and every URL-bar show/hide, and each call writes two
    // custom properties on <html>, invalidating style document-wide.
    mount();
    expect(window.RepCheck.viewportTracked()).toBe(false);

    openSheet();
    expect(window.RepCheck.viewportTracked()).toBe(true);

    window.closeBottomSheet(overlay(), ".mt-sheet");
    settleClose();
    expect(window.RepCheck.viewportTracked()).toBe(false);
  });

  it("keeps watching while an outer sheet is still up", () => {
    // Sheets nest -- a sheet's afterClose opens another, the check-in sheet
    // sits over the wizard -- so the inner one closing must not unsubscribe
    // out from under the outer one.
    mount();
    const outer = overlay();
    const inner = document.createElement("div");
    inner.className = "log-sheet-overlay";
    inner.innerHTML = '<div class="log-sheet"></div>';
    document.body.appendChild(inner);

    openSheet();
    window.openBottomSheet(inner, ".log-sheet");
    vi.advanceTimersByTime(50);
    expect(window.RepCheck.viewportTracked()).toBe(true);

    window.closeBottomSheet(inner, ".log-sheet");
    settleClose();
    expect(window.RepCheck.viewportTracked()).toBe(true);

    window.closeBottomSheet(outer, ".mt-sheet");
    settleClose();
    expect(window.RepCheck.viewportTracked()).toBe(false);
  });

  it("heals when a sheet is torn out of the DOM while it is still up", () => {
    // static/nav_scope.js's release() takes an adopted page sheet away with
    // its page, open or not, and nothing tells the tracker. A counter would
    // never come back down from that -- pinning the subscription on for the
    // rest of the session, which is the always-on cost this scoping exists to
    // remove, restored silently. Membership is re-derived from the live
    // document instead, so the next open or close clears the stale entry.
    mount();
    openSheet();
    expect(window.RepCheck.viewportTracked()).toBe(true);

    overlay().remove();

    // Any later open/close is enough to notice the vanished sheet.
    const other = document.createElement("div");
    other.className = "log-sheet-overlay";
    other.innerHTML = '<div class="log-sheet"></div>';
    document.body.appendChild(other);
    window.openBottomSheet(other, ".log-sheet");
    vi.advanceTimersByTime(50);
    window.closeBottomSheet(other, ".log-sheet");
    settleClose();

    expect(window.RepCheck.viewportTracked()).toBe(false);
  });

  it("counts a re-open of an already-open sheet once", () => {
    // Nutrition's barcode-photo flow re-opens the sheet it is already inside,
    // and a fast double-tap does the same on any sheet. Each extra open used
    // to add a lock nothing ever removed, so the page stayed pinned at
    // position:fixed with no sheet visible until a reload.
    mount();
    openSheet();
    expect(window.__pcSheetLockCount).toBe(1);

    window.openBottomSheet(overlay(), ".mt-sheet");
    window.openBottomSheet(overlay(), ".mt-sheet");
    vi.advanceTimersByTime(50);
    expect(window.__pcSheetLockCount).toBe(1);

    window.closeBottomSheet(overlay(), ".mt-sheet");
    settleClose();
    expect(window.__pcSheetLockCount).toBe(0);
    expect(document.documentElement.classList.contains("pc-sheet-locked")).toBe(false);
  });

  it("cancels the touchmove, which is the only thing non-passive buys", () => {
    // Without this the suite pins the listener's FLAG and not its effect:
    // deleting `if (e.cancelable) e.preventDefault()` left all tests green,
    // so a regression could keep paying the full scroll-blocking cost and
    // deliver nothing for it.
    mount();
    openSheet();

    touch(handle(), "touchstart", 400);
    // Inside the 6px deadzone: nothing to cancel yet.
    expect(touch(handle(), "touchmove", 404).defaultPrevented).toBe(false);
    // Past it, the drag owns the gesture.
    expect(touch(handle(), "touchmove", 500).defaultPrevented).toBe(true);
  });

  it("ignores a descendant's transitionend, so the close is not cut short", () => {
    // transitionend bubbles. The sheet's exit is 480ms, but its close button
    // and search box run 0.15s transitions that end as the close starts, and
    // with { once: true } whichever bubbled up first consumed the handler.
    // Measured on the real page before this guard: the food-search sheet went
    // display:none at 50ms into a 480ms slide -- it blinked out of existence
    // instead of sliding away.
    mount();
    openSheet();
    window.closeBottomSheet(overlay(), ".mt-sheet");

    handle().dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(overlay().style.display).toBe("");

    // Only the sheet's own transition ends it.
    sheet().dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(overlay().style.display).toBe("none");
  });

  it("unlocks a page sheet swapped away before its open animation lands", () => {
    // The mirror of closeBottomSheet's hoisted disarm, for the other close
    // path. Measured on the real page before the fix: nothing removed, the
    // lock count stuck at 1, and <body> left position:fixed -- so the screen
    // being navigated TO could not scroll at all.
    mountPageSheet();
    window.openBottomSheet(overlay(), ".mt-sheet"); // NOT settling the double rAF
    expect(overlay().classList.contains("is-open")).toBe(false);

    const log = trackTouchListeners(overlay());
    document.dispatchEvent(new Event("repcheck:page-will-swap"));

    expect(log).toEqual([
      "-touchstart",
      "-touchmove",
      "-touchend",
      "-touchcancel",
    ]);
    expect(overlay()._sheetIsUp).toBe(false);
    expect(window.__pcSheetLockCount).toBe(0);
    expect(document.documentElement.classList.contains("pc-sheet-locked")).toBe(false);
  });

  it("refuses to latch an overlay whose sheet selector matches nothing", () => {
    // The latch used to be set before the bail, so one bad bind disabled the
    // overlay's arm, disarm and hide for the life of the page -- and refused
    // every later, correct bind.
    document.body.innerHTML = sheetFixture();
    loadSheetHelpers();
    window.bindSheetDrag(overlay(), ".not-a-sheet", ".mt-sheet-handle", () => {});
    expect(overlay()._dragBound).toBeUndefined();

    // The real bind still works afterwards.
    window.bindSheetDrag(overlay(), ".mt-sheet", ".mt-sheet-handle", () => {});
    const log = trackTouchListeners(overlay());
    openSheet();
    expect(log).toContain("+touchmove:blocking");
  });

  it("still fires the callback when closing a sheet that was never open", () => {
    // The early return moved down past the disarm; the callback contract for
    // a never-opened sheet has to survive that move.
    mount();
    const cb = vi.fn();
    window.closeBottomSheet(overlay(), ".mt-sheet", cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
