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

  it("restores a swiped-back page with no fetch at all", async () => {
    // The iOS edge-swipe animates a snapshot of the screen it is heading to
    // and then hands over. A fetch here lands after that animation has
    // finished and reads as the screen refreshing itself underneath the
    // gesture -- which is exactly what it was reported as. A page this
    // session already has goes up immediately instead.
    const nav = loadPageNav({
      startHref: "/home",
      startMain: '<h1 id="heading">Hey James</h1>',
      routes: {
        "/nutrition": NUTRITION,
        "/home": page({ href: "/home", body: '<h1 id="heading">Hey James</h1>' }),
      },
    });
    await nav.tap("/nutrition");
    await nav.tap("/home");
    const requestsBefore = nav.requests.length;

    await nav.back("/nutrition");

    expect(nav.main().textContent).toContain("Nutrition Log");
    expect(nav.requests).toHaveLength(requestsBefore);
    expect(nav.hardNavs).toEqual([]);
  });

  it("fetches a swiped-back page it has never seen", async () => {
    // Deep-linked in, or swiped back past what the cache still holds. Better
    // a fetch than an empty screen.
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/nutrition": NUTRITION },
    });

    await nav.back("/nutrition");

    expect(nav.requests.map((r) => r.url)).toEqual(["/nutrition"]);
    expect(nav.main().textContent).toContain("Nutrition Log");
  });

  it("does not serve a tapped tab from the back/forward cache", async () => {
    // Going back asks for the screen you left; tapping Nutrition asks for
    // Nutrition as it is NOW. Serving a tap from the cache would show a food
    // log missing whatever was logged on another device since.
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/nutrition": NUTRITION, "/home": page({ href: "/home" }) },
    });

    await nav.tap("/nutrition");
    await nav.tap("/home");
    await nav.tap("/nutrition");

    expect(nav.requests.filter((r) => r.url === "/nutrition")).toHaveLength(2);
  });

  it("never fades the screen it is leaving", async () => {
    // Not a taste rule. iOS snapshots the page when a navigation commits and
    // replays that snapshot during the back-swipe, so a screen faded out at
    // commit time is stored BLANK -- and swiping back to it slid a blank
    // screen in, which is what "it still refreshes when I swipe back" was.
    // The history entry also goes in while the screen is still whole, so
    // whenever the snapshot is taken it catches a real screen.
    const nav = loadPageNav({
      startHref: "/home",
      startMain: '<h1 id="heading">Hey James</h1>',
      routes: { "/nutrition": NUTRITION },
    });

    document.querySelector('.mt-item[href="/nutrition"]').dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true })
    );

    // Mid-navigation: the URL has already changed, and the outgoing screen is
    // untouched -- no class, nothing to fade it.
    expect(nav.historyEntries.at(-1).url).toBe("/nutrition");
    expect(nav.main().className).toBe("main");
    expect(nav.main().textContent).toContain("Hey James");

    await nav.settle();
    expect(nav.main().textContent).toContain("Nutrition Log");
  });

  it("brings the new screen in from the side the tab order says", async () => {
    const nav = loadPageNav({
      startHref: "/nutrition",
      routes: { "/home": page({ href: "/home" }), "/hyrox": page({ href: "/hyrox" }) },
    });
    const seen = [];
    // The enter class is set and then removed a frame later, so it is caught
    // by watching rather than by looking afterwards.
    const observer = new window.MutationObserver(() => seen.push(nav.main().className));
    observer.observe(nav.main(), { attributes: true, attributeFilter: ["class"] });

    // Home sits left of Nutrition, so its screen arrives from the left.
    await nav.tap("/home");
    expect(seen.join(" ")).toContain("pn-enter-left");

    seen.length = 0;
    // HYROX sits right of Home, so it arrives from the right.
    await nav.tap("/hyrox");
    expect(seen.join(" ")).toContain("pn-enter-right");
    observer.disconnect();
  });

  it("never leaves the new screen faded out when there are no frames", async () => {
    // A hidden page gets no requestAnimationFrame callbacks at all -- the app
    // in the background, iOS mid-transition -- so a swap that lands then
    // would keep the enter class forever and the screen would sit at opacity
    // 0. Found by driving the real app with the browser pane hidden: every
    // swapped-in screen was invisible, class still on <main>.
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/nutrition": NUTRITION },
      noFrames: true,
    });

    await nav.tap("/nutrition");

    expect(nav.main().className).not.toContain("pn-enter-");
    expect(nav.main().textContent).toContain("Nutrition Log");
  });

  it("does not animate for someone who asked for less motion", async () => {
    const nav = loadPageNav({
      startHref: "/home",
      routes: { "/nutrition": NUTRITION },
      reduceMotion: true,
    });

    document.querySelector('.mt-item[href="/nutrition"]').dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true })
    );

    expect(nav.main().className).not.toContain("pn-leave-");
    await nav.settle();
    expect(nav.main().textContent).toContain("Nutrition Log");
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
