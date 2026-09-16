// On the canvas host (repcheck-marketing.onrender.com) the page keys are the
// site's own. <html> clips and <body> is the scroller, so Page Down, Page Up,
// Home, End and the arrows are caught by a document-level handler in
// marketing/app.js and forwarded to body.scrollTop.
//
// That handler STANDS DOWN the moment anything is focused, because a key
// pressed in the waitlist field is the reader typing, not the reader
// scrolling. Which makes it the reason nothing in the phone mockups may take
// focus on its own: the walkthrough used to focus its own search field on a
// nine-second loop, and for two seconds out of every nine the reader's Page
// Down did nothing at all.
//
// That coupling was prose in three files and an assertion in none. This pins
// it, from both ends: focused means hands off, unfocused means ours.
//
// jsdom does no layout, so scrollTop never moves here -- defaultPrevented is
// the real signal anyway. The handler calls preventDefault() only on the keys
// it takes, and returns without touching the event otherwise.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSource } from "./support/loadMarketingFeatureSwitcher.js";

function mountCanvas({ canvas }) {
  document.documentElement.className = canvas ? "rc-canvas" : "";
  document.body.innerHTML = '<input id="waitlist-ish" type="email">';
  // eslint-disable-next-line no-new-func
  new Function(readSource())();
}

function press(key, init) {
  const evt = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(evt);
  return evt.defaultPrevented;
}

afterEach(() => {
  document.documentElement.className = "";
});

// FIRST, and it has to be. app.js binds the page-key handler to `document`,
// which outlives re-running the script over fresh markup -- there is no handle
// to remove an anonymous listener, and vitest isolates per FILE, not per
// describe. So the "not bound" case can only be observed before any canvas
// mount in this file has bound one. Keep this block at the top.
describe("the ordinary host", () => {
  beforeEach(() => mountCanvas({ canvas: false }));

  it("does not bind the page keys at all -- the window scrolls itself", () => {
    for (const key of ["PageDown", "Home", "End", " "]) {
      expect([key, press(key)]).toEqual([key, false]);
    }
  });
});

describe("the canvas host's page keys", () => {
  beforeEach(() => mountCanvas({ canvas: true }));

  it("takes the scrolling keys while nothing is focused", () => {
    expect(document.activeElement).toBe(document.body);
    for (const key of ["PageDown", "PageUp", "Home", "End", " ", "ArrowDown", "ArrowUp"]) {
      expect([key, press(key)]).toEqual([key, true]);
    }
  });

  it("hands them straight back the moment something is focused", () => {
    // THE REGRESSION GUARD. Anything that focuses on its own -- a mockup's
    // walkthrough, say -- silently takes these keys away from the reader.
    document.getElementById("waitlist-ish").focus();
    for (const key of ["PageDown", "PageUp", "Home", "End", " "]) {
      expect([key, press(key)]).toEqual([key, false]);
    }
  });

  it("leaves modified presses to the browser", () => {
    // Ctrl+Home is "top of document" in some setups and cmd+arrow is
    // word/line movement; neither is ours to redefine.
    expect(press("Home", { ctrlKey: true })).toBe(false);
    expect(press("PageDown", { metaKey: true })).toBe(false);
    expect(press("End", { altKey: true })).toBe(false);
  });

  it("ignores keys that are not scrolling keys", () => {
    expect(press("a")).toBe(false);
    expect(press("Enter")).toBe(false);
    expect(press("Tab")).toBe(false);
  });
});
