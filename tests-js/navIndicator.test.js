import { describe, it, expect, beforeEach } from "vitest";
import {
  loadNav,
  offsetLeftFor,
  readSource,
  ITEM_WIDTH,
  ITEM_HEIGHT,
  PILL_PADDING,
} from "./support/loadNav.js";

// static/nav.js -- the bottom tab bar's active "bubble".
//
// The behaviour that matters is that the bubble moves the moment the thumb
// lands, not when the next page finishes loading: every tab is a real
// document navigation, and waiting for it is exactly what made switching
// pages read as a refresh rather than as a menu moving.

describe("nav.js -- the gliding tab bar bubble", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("places the bubble on the active tab and takes the highlight over from CSS", () => {
    const nav = loadNav({ activeIndex: 2 });

    expect(nav.indicator).not.toBeNull();
    expect(nav.x()).toBe(offsetLeftFor(2));
    expect(nav.y()).toBe(PILL_PADDING);
    expect(nav.indicator.style.width).toBe(`${ITEM_WIDTH}px`);
    expect(nav.indicator.style.height).toBe(`${ITEM_HEIGHT}px`);
    // .has-indicator is what tells style.css to drop the active <a>'s own
    // background and hand mt-active-bubble over to this element. Without
    // it there would be two highlights, and two elements sharing one
    // view-transition-name makes the browser abort the whole transition.
    expect(nav.pill.classList.contains("has-indicator")).toBe(true);
  });

  it("does not animate into its starting position on first paint", () => {
    const nav = loadNav({ activeIndex: 1 });
    // Suppressed for the initial placement and handed straight back, so
    // the first real move still transitions.
    expect(nav.indicator.style.transition).toBe("");
  });

  it("moves on pointerdown -- before any click or navigation", () => {
    const nav = loadNav({ activeIndex: 0 });

    nav.press(3);

    expect(nav.x()).toBe(offsetLeftFor(3));
    // The move is only a preview at this point: nothing has navigated, so
    // the document's own idea of the active tab must not have changed yet.
    expect(nav.activeLabel()).toBe("Home");
  });

  // Every tab's only content is an <svg>, so in practice the press always
  // lands on a child rather than on the .mt-item itself.
  it("moves from a press on the icon inside a tab, not just the tab itself", () => {
    const nav = loadNav({ activeIndex: 0 });
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    nav.items[2].appendChild(icon);

    nav.press(2, icon);

    expect(nav.x()).toBe(offsetLeftFor(2));
  });

  it("ignores a press on the tab that is already active", () => {
    const nav = loadNav({ activeIndex: 2 });

    nav.press(2);

    expect(nav.x()).toBe(offsetLeftFor(2));
    expect(nav.activeLabel()).toBe("Nutrition");
  });

  it("puts the bubble back when the press is dragged off the tab", () => {
    const nav = loadNav({ activeIndex: 0 });

    nav.press(4);
    expect(nav.x()).toBe(offsetLeftFor(4));

    // Lifted well away from the bar: no click is coming.
    nav.fireWindow("pointerup", { clientX: 5, clientY: 200 });

    expect(nav.x()).toBe(offsetLeftFor(0));
    expect(nav.activeLabel()).toBe("Home");
  });

  it("puts the bubble back when the gesture is cancelled", () => {
    const nav = loadNav({ activeIndex: 1 });

    nav.press(3);
    nav.fireWindow("pointercancel", {});

    expect(nav.x()).toBe(offsetLeftFor(1));
  });

  it("keeps the bubble where the thumb put it when the lift lands on the tab", () => {
    const nav = loadNav({ activeIndex: 0 });

    nav.press(1);
    // A lift inside the pressed tab means a click is on its way. Reverting
    // here (an earlier version deferred the decision to a setTimeout and
    // raced the click) makes the bubble snap back and then slide forward
    // again -- the exact stutter this whole file exists to remove.
    nav.fireWindow("pointerup", nav.pointerAt(1));

    expect(nav.x()).toBe(offsetLeftFor(1));
  });

  it("commits the move and transfers is-active on click", () => {
    const nav = loadNav({ activeIndex: 0 });

    nav.press(3);
    nav.fireWindow("pointerup", nav.pointerAt(3));
    nav.click(3);

    expect(nav.x()).toBe(offsetLeftFor(3));
    expect(nav.activeLabel()).toBe("HYROX");
    // Exactly one -- a second .is-active would duplicate the
    // view-transition-name and abort the page transition.
    expect(document.querySelectorAll(".mt-item.is-active")).toHaveLength(1);
  });

  it("does not revert after a commit when a stray pointerup arrives", () => {
    const nav = loadNav({ activeIndex: 0 });

    nav.press(2);
    nav.click(2);
    nav.fireWindow("pointerup", { clientX: 0, clientY: 0 });

    expect(nav.x()).toBe(offsetLeftFor(2));
    expect(nav.activeLabel()).toBe("Nutrition");
  });

  it("re-measures on a restore from the back/forward cache", () => {
    const nav = loadNav({ activeIndex: 1 });

    // A preview that the restored page never committed.
    nav.press(4);
    nav.fireWindow("pageshow", { persisted: true });

    expect(nav.x()).toBe(offsetLeftFor(1));
  });

  it("listens for the events that can move the tabs without a navigation", () => {
    const nav = loadNav();
    // Rotation and the iOS keyboard resize the bar under a stale bubble.
    expect(Object.keys(nav.windowListeners).sort()).toEqual([
      "pageshow",
      "pointercancel",
      "pointerup",
      "resize",
    ]);
  });

  // Every page shares base.html, including ones that hide the bar
  // (html.an-result) and desktop widths that render the sidebar instead, so
  // a missing .mt-pill has to be a no-op rather than a thrown error that
  // takes the rest of the page's scripts down with it.
  it("does nothing at all when the page has no tab bar", () => {
    document.body.innerHTML = "<main></main>";

    expect(() =>
      // eslint-disable-next-line no-new-func
      new Function("window", readSource())({ addEventListener() {} })
    ).not.toThrow();
    expect(document.querySelector(".mt-indicator")).toBeNull();
  });
});
