// Tab switching without loading a document (static/pagenav.js).
//
// The measurement that put this here: a screen recording of seven tab
// switches blanked the phone completely on every one of them, 83-215ms each.
// During a document swap there is nothing on screen at all -- not the page,
// not the tab bar -- and no amount of caching removes that, because something
// has to be rendered during it. So the tab bar stopped loading documents.
//
// What these tests hold onto is the set of things that make that safe in a
// codebase not built for it: page scripts get a fresh scope per visit (the
// templates declare ~1700 top-level names, so re-running them as globals
// throws on the second visit), what a page bound to document is released when
// it leaves, and ANY surprise falls back to a real navigation rather than
// leaving a half-built screen.

import { describe, it, expect } from "vitest";
import { loadPageNav, page } from "./support/loadPageNav.js";

const NUTRITION = page({
  href: "/nutrition",
  title: "RepCheck - Nutrition",
  body: '<h1 id="heading">Nutrition Log</h1>',
});

describe("pagenav", () => {
  it("swaps the screen in place instead of navigating", async () => {
    const nav = loadPageNav({
      startHref: "/home",
      startMain: '<h1 id="heading">Hey James</h1>',
      routes: { "/nutrition": NUTRITION },
    });

    await nav.tap("/nutrition");

    expect(nav.main().textContent).toContain("Nutrition Log");
    // The whole point: no document was loaded.
    expect(nav.hardNavs).toEqual([]);
    expect(nav.historyEntries.at(-1).url).toBe("/nutrition");
    expect(nav.title()).toBe("RepCheck - Nutrition");
  });

  it("moves the active tab to the page that is now on screen", async () => {
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/nutrition": NUTRITION },
    });

    await nav.tap("/nutrition");

    expect(nav.activeHref()).toBe("/nutrition");
  });

  it("runs the incoming page's scripts", async () => {
    const nav = loadPageNav({
      startHref: "/home",
      routes: {
        "/nutrition": page({
          href: "/nutrition",
          body: '<div id="target"></div>',
          scripts: ['document.getElementById("target").textContent = "rendered";'],
        }),
      },
    });

    await nav.tap("/nutrition");

    expect(document.getElementById("target").textContent).toBe("rendered");
  });

  it("gives each visit its own scope, so a second visit does not throw", async () => {
    // The reason this file exists in this shape. nutrition.html alone
    // declares 529 top-level names; re-running them as globals throws
    // "Identifier already declared" on the second visit and leaves the page
    // half built. In a function scope they are locals, freshly made.
    const declaring = page({
      href: "/nutrition",
      body: '<div id="count"></div>',
      scripts: [
        'const FOOD_LIBRARY = ["apple"];\n' +
          'function render() { document.getElementById("count").textContent = FOOD_LIBRARY.length; }\n' +
          "render();",
      ],
    });
    const nav = loadPageNav({
      startHref: "/home",
      startMain: '<h1 id="heading">Hey James</h1>',
      routes: {
        "/nutrition": declaring,
        "/home": page({ href: "/home", body: '<h1 id="heading">Hey James</h1>' }),
      },
    });

    await nav.tap("/nutrition");
    await nav.tap("/home");
    await nav.tap("/nutrition");

    expect(document.getElementById("count").textContent).toBe("1");
    expect(nav.hardNavs).toEqual([]);
    // The mechanism, asserted directly rather than only by its symptom: the
    // page's declarations must not have landed in the global scope, because
    // that is the thing a second visit would collide with.
    expect(typeof globalThis.FOOD_LIBRARY).toBe("undefined");
    expect(typeof globalThis.render).toBe("undefined");
  });

  it("releases what a page bound to document when it leaves", async () => {
    // The tab pages bind to document 29 times between them. Without this, a
    // handler is added per visit and every event fires as many times as you
    // have been to the page.
    const counterPage = page({
      href: "/nutrition",
      body: '<div id="target"></div>',
      scripts: [
        'window.__hits = window.__hits || 0;' +
          'document.addEventListener("click", function () { window.__hits++; });',
      ],
    });
    const nav = loadPageNav({
      startHref: "/home",
      routes: {
        "/nutrition": counterPage,
        "/home": page({ href: "/home" }),
      },
    });

    await nav.tap("/nutrition");
    await nav.tap("/home");
    await nav.tap("/nutrition");
    window.__hits = 0;
    document.dispatchEvent(new window.Event("click"));

    expect(window.__hits).toBe(1);
  });

  it("takes the page's body-level overlays with it when it leaves", async () => {
    // Pages relocate their modals to <body> so they escape the stacking
    // contexts inside <main> (workouts.html's moveOverlayToBody, and the same
    // move in nutrition, weight and logging history). Those nodes sit OUTSIDE
    // the part of the document a swap replaces, so without releasing them,
    // every visit adds another copy carrying the same id -- and
    // getElementById starts answering with a dead node from two pages ago.
    // Caught by driving the real app, not by reading the code: three visits
    // to Nutrition left three log-sheet overlays in the body.
    const withOverlay = page({
      href: "/workouts",
      body: '<div id="exd-overlay" class="exd-modal-overlay"></div>',
      scripts: [
        'var el = document.getElementById("exd-overlay");' +
          "if (el && el.parentElement !== document.body) document.body.appendChild(el);",
      ],
    });
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/workouts": withOverlay, "/home": page({ href: "/home" }) },
    });

    await nav.tap("/workouts");
    expect(document.body.querySelectorAll("#exd-overlay")).toHaveLength(1);

    await nav.tap("/home");
    await nav.tap("/workouts");
    await nav.tap("/home");
    await nav.tap("/workouts");

    expect(document.body.querySelectorAll("#exd-overlay")).toHaveLength(1);
  });

  it("falls back to a real navigation when the server says no", async () => {
    const nav = loadPageNav({
      startHref: "/home",
      startMain: "<h1>Hey James</h1>",
      routes: { "/nutrition": NUTRITION },
      status: 500,
    });

    await nav.tap("/nutrition");

    expect(nav.hardNavs).toEqual(["/nutrition"]);
    // And leaves the screen it could not replace exactly as it was.
    expect(nav.main().textContent).toContain("Hey James");
  });

  it("falls back to a real navigation when the answer is a redirect elsewhere", async () => {
    // Session expired: the server answers /nutrition with the login page.
    // Swapping that into <main> would leave a login form inside the app
    // shell, tab bar and all.
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/nutrition": NUTRITION },
      redirectTo: "/login",
    });

    await nav.tap("/nutrition");

    expect(nav.hardNavs).toEqual(["/nutrition"]);
  });

  it("falls back to a real navigation when the response has no main", async () => {
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/nutrition": "<!doctype html><html><body>nothing here</body></html>" },
    });

    await nav.tap("/nutrition");

    expect(nav.hardNavs).toEqual(["/nutrition"]);
  });

  it("loads a page's own stylesheet and script once, not once per visit", async () => {
    const hyrox = page({
      href: "/hyrox",
      body: '<div id="hyrox-root"></div>',
      assets: ["/static/hyrox.css", "/static/hyrox.js"],
    });
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/hyrox": hyrox, "/home": page({ href: "/home" }) },
    });

    await nav.tap("/hyrox");
    await nav.tap("/home");
    await nav.tap("/hyrox");

    const hyroxAssets = nav.loadedAssets.filter((url) => url.includes("hyrox"));
    expect(hyroxAssets).toHaveLength(2);
  });

  it("tells the page that was loaded once that a new page arrived", async () => {
    // hyrox.js and coaching.js are loaded a single time and boot off this:
    // DOMContentLoaded has long gone by the time a swapped page arrives, and
    // on a second visit the file is already loaded and would never run again.
    const seen = [];
    document.addEventListener("repcheck:page-swapped", () => seen.push(true));
    const nav = loadPageNav({ startHref: "/home", routes: { "/nutrition": NUTRITION } });

    await nav.tap("/nutrition");

    expect(seen).toHaveLength(1);
  });

  it("leaves a modified click to the browser", async () => {
    // Cmd/ctrl-click opens a new tab. That is a real navigation and not ours
    // to swallow.
    const nav = loadPageNav({ startHref: "/home", routes: { "/nutrition": NUTRITION } });

    await nav.tap("/nutrition", { metaKey: true });

    expect(nav.requests).toEqual([]);
    expect(nav.hardNavs).toEqual([]);
  });

  it("does nothing when you tap the tab you are already on", async () => {
    const nav = loadPageNav({ startHref: "/home", routes: { "/home": page({ href: "/home" }) } });

    await nav.tap("/home");

    expect(nav.requests).toEqual([]);
    expect(nav.hardNavs).toEqual([]);
  });

  it("swaps back on the back button", async () => {
    const nav = loadPageNav({
      startHref: "/home",
      startMain: '<h1 id="heading">Hey James</h1>',
      routes: {
        "/nutrition": NUTRITION,
        "/home": page({ href: "/home", body: '<h1 id="heading">Hey James</h1>' }),
      },
    });
    await nav.tap("/nutrition");

    await nav.back("/home");

    expect(nav.main().textContent).toContain("Hey James");
    expect(nav.hardNavs).toEqual([]);
  });
});
