// Between two documents there is nothing on screen -- not the page, not the
// tab bar. Measured on a phone (iphonecookie.mp4, 7 tab switches in 7
// seconds): every single switch blacked the screen out completely for
// 83-215ms. A network round trip for the next page's HTML sits inside that
// gap, and it does not have to.
//
// pointerdown lands ~100ms before the click that navigates -- the tab bar
// already uses that head start to move the bubble -- so nav.js now also
// starts fetching the page there. app.py gives pages a five-second freshness
// window for exactly this hand-off, so the navigation reuses the warmed
// response instead of asking the server again.
//
// The thing that makes this a win rather than a tax: it is the SAME request
// the navigation was going to make. These tests pin the conditions that keep
// it that way -- one per URL, only on a real press of a non-active tab, and
// never on Data Saver -- plus the rule that no failure here may cost the tap
// its navigation.

import { describe, it, expect } from "vitest";
import { loadNav } from "./support/loadNav.js";

describe("tab bar page warming", () => {
  it("starts fetching the tapped tab's page on pointerdown", () => {
    const nav = loadNav({ activeIndex: 0 });

    nav.press(2);

    expect(nav.fetches).toHaveLength(1);
    expect(nav.fetches[0].url).toBe("/nutrition");
    // Same credentials as the navigation, or the warmed response is for a
    // logged-out page and the navigation cannot reuse it.
    expect(nav.fetches[0].options).toEqual({ credentials: "same-origin" });
  });

  it("does not warm the tab you are already on", () => {
    const nav = loadNav({ activeIndex: 1 });

    nav.press(1);

    expect(nav.fetches).toHaveLength(0);
  });

  it("warms each page once, however many times it is pressed", () => {
    // Press, drag off (no navigation), press again. The response from the
    // first press is still in the cache; asking again would be paying twice
    // for one screen.
    const nav = loadNav({ activeIndex: 0 });

    nav.press(3);
    nav.press(3);
    nav.press(3);

    expect(nav.fetches).toHaveLength(1);
  });

  it("spends nothing on maybes when Data Saver is on", () => {
    const nav = loadNav({ activeIndex: 0, saveData: true });

    nav.press(2);

    expect(nav.fetches).toHaveLength(0);
    // The bubble still answers the thumb -- Data Saver is about bytes, not
    // about making the bar feel dead.
    expect(nav.x()).not.toBeNull();
  });

  it("still moves the bubble when the fetch is refused outright", () => {
    // A blocked or refused fetch must never take the tap down with it: the
    // navigation itself is a plain <a href> and works regardless.
    const nav = loadNav({ activeIndex: 0, fetchThrows: true });

    expect(() => nav.press(2)).not.toThrow();
    expect(nav.x()).toBe(nav.items[2].offsetLeft);
  });
});
