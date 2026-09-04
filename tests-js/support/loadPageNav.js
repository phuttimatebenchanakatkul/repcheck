// Loads the REAL static/nav_scope.js and static/pagenav.js into a jsdom copy
// of the app shell, with a fake server behind them.
//
// pagenav.js is the tab bar that swaps pages instead of loading documents, so
// what has to be exercised is a whole navigation: the fetch, the parse, the
// <main> replacement, the page's own scripts running in their own scope, and
// the release of what the outgoing page bound to document. All of that is
// real code here -- only the network is stubbed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(__dirname, "..", "..", "static");

export function readSource(name) {
  return readFileSync(path.join(STATIC, name), "utf-8");
}

export const TABS = [
  { href: "/home", label: "Home" },
  { href: "/workouts", label: "Workouts" },
  { href: "/nutrition", label: "Nutrition" },
  { href: "/hyrox", label: "HYROX" },
  { href: "/analyze", label: "Analyze" },
];

// base.html brackets its content block with the recorder, and those markers
// sit INSIDE <main> -- which is the part pagenav.js swaps, so every page it
// fetches carries a copy of them and re-runs them inside pagenav.js's own
// bracket. Reproduced here rather than simplified away: the first version of
// this harness left them out, and the nesting bug they cause (the inner stop()
// finalising an empty recording and discarding the real one) only turned up
// by driving the running app.
const OPEN = "<script>if (window.RepCheckNavScope) window.RepCheckNavScope.start();</script>";
const CLOSE = "<script>if (window.RepCheckNavScope) window.RepCheckNavScope.stop();</script>";

/** The shell base.html renders, with `activeHref` marked active. */
function shell(activeHref, mainInner) {
  return `
    <div class="app">
      <main class="main">${OPEN}${mainInner}${CLOSE}</main>
    </div>
    <nav class="mobile-tabbar">
      <div class="mt-pill">
        ${TABS.map(
          (tab) =>
            `<a href="${tab.href}" class="mt-item${
              tab.href === activeHref ? " is-active" : ""
            }" aria-label="${tab.label}"><span class="icon"></span></a>`
        ).join("")}
      </div>
    </nav>`;
}

/**
 * A whole page as the server would render it: the shell plus <main>, so
 * pagenav.js can parse it exactly the way it parses a real response.
 */
export function page({ href, title = "RepCheck", body = "", scripts = [], assets = [] }) {
  const assetTags = assets
    .map((url) =>
      url.endsWith(".css")
        ? `<link rel="stylesheet" href="${url}">`
        : `<script src="${url}"></script>`
    )
    .join("");
  const scriptTags = scripts.map((src) => `<script>${src}</script>`).join("");
  return `<!doctype html><html><head><title>${title}</title></head><body>${shell(
    href,
    assetTags + body + scriptTags
  )}</body></html>`;
}

/**
 * Boots the shell on `startHref` and evaluates nav_scope.js + pagenav.js
 * against it.
 *
 * @param routes  {[href]: html} -- what the fake server answers with.
 * @param serverError / redirectTo / missingMain -- failure modes to exercise.
 */
export function loadPageNav({
  startHref = "/home",
  startMain = "",
  startScripts = [],
  routes = {},
  status = 200,
  redirectTo = null,
  reduceMotion = false,
  // A hidden page never runs a requestAnimationFrame callback. Set this to
  // reproduce that: the swap must still finish.
  noFrames = false,
  // Renders the shell without a tab bar, to exercise pagenav.js declining.
  noPill = false,
} = {}) {
  document.head.innerHTML = "<title>RepCheck</title>";
  document.documentElement.removeAttribute("data-pagenav");
  document.body.innerHTML = noPill
    ? '<div class="app"><main class="main"></main></div>'
    : shell(startHref, startMain);

  const requests = [];
  // pagenav.js reports whether it is running to /api/nav-state. That is a
  // diagnostic, not a page fetch, so it is kept out of `requests` -- every
  // assertion about how many pages were fetched would otherwise have to know
  // about it.
  const beacons = [];
  const hardNavs = [];
  const historyEntries = [];
  const loadedAssets = [];

  // jsdom's history/location cannot be reassigned, so both are stubbed. The
  // stub window otherwise forwards to the real jsdom window: pagenav.js uses
  // it for fetch, DOMParser, scrollTo and popstate.
  let current = startHref;
  const windowStub = {
    fetch: (url, options) => {
      if (String(url).startsWith("/api/nav-state")) {
        beacons.push(String(url));
        return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve("") });
      }
      requests.push({ url, options });
      const html = routes[url];
      const response = {
        ok: status >= 200 && status < 300,
        status,
        redirected: Boolean(redirectTo),
        url: redirectTo || url,
        text: () => Promise.resolve(html === undefined ? "" : html),
      };
      return Promise.resolve(response);
    },
    DOMParser: window.DOMParser,
    CustomEvent: window.CustomEvent,
    Promise,
    localStorage: { getItem: () => null },
    scrollTo: () => {},
    addEventListener: (type, handler) => window.addEventListener(type, handler),
    removeEventListener: (type, handler) => window.removeEventListener(type, handler),
    setInterval: (...args) => window.setInterval(...args),
    clearInterval: (id) => window.clearInterval(id),
    setTimeout: (...args) => window.setTimeout(...args),
    requestAnimationFrame: (fn) => (noFrames ? 0 : window.setTimeout(fn, 16)),
    matchMedia: (query) => ({ matches: reduceMotion && query.includes("reduce") }),
    history: {
      pushState: (state, _title, url) => {
        historyEntries.push({ state, url });
        current = url;
      },
      replaceState: (state, _title, url) => {
        historyEntries.push({ state, url, replace: true });
      },
    },
    get location() {
      return {
        href: current,
        assign: (url) => hardNavs.push(url),
      };
    },
  };

  // nav_scope.js patches document/window listener registration, so it gets
  // the same stub window pagenav.js runs against.
  // eslint-disable-next-line no-new-func
  new Function("window", "document", readSource("nav_scope.js"))(windowStub, document);
  // The bracket markers a swapped-in page carries are executed by pagenav.js
  // as plain source, so they resolve `window` to the real one -- exactly as
  // they do in a browser. Publish the recorder there too or the markers are
  // silently inert and the harness cannot see the nesting they cause.
  window.RepCheckNavScope = windowStub.RepCheckNavScope;

  // base.html brackets the page's own scripts with the recorder; the markers
  // rendered into the shell above are inert strings in jsdom (innerHTML does
  // not execute scripts), so the same bracket is applied here for the page
  // this shell started on.
  windowStub.RepCheckNavScope.start();
  startScripts.forEach((src) => new Function(src)());
  windowStub.RepCheckNavScope.stop();

  // Appended stylesheets and scripts never really load in jsdom, so their
  // onload is fired by hand -- otherwise every swap that carries an asset
  // would hang on a promise that never settles.
  const realAppend = document.head.appendChild.bind(document.head);
  document.head.appendChild = (node) => {
    if (node.tagName === "SCRIPT" || node.tagName === "LINK") {
      loadedAssets.push(node.src || node.href);
      const result = realAppend(node);
      if (node.onload) node.onload();
      return result;
    }
    return realAppend(node);
  };

  // pagenav.js listens for clicks on `document` -- it swaps every internal
  // link now, not only the five tabs, and there is no one element that all of
  // them are inside. Every test in a file shares one jsdom document, so
  // without this the copy loaded by the PREVIOUS test is still bound: it
  // handles the click first, preventDefault()s it, and this test's copy then
  // sees defaultPrevented and stands down. Nothing like this happens in a
  // browser, where pagenav.js is evaluated once per document -- it is the
  // price of re-evaluating it per test, so it is paid here rather than with a
  // guard in the shipped file.
  const stale = globalThis.__pagenavDocListeners || [];
  stale.forEach(([type, handler]) => document.removeEventListener(type, handler));
  const bound = [];
  globalThis.__pagenavDocListeners = bound;
  const docAdd = document.addEventListener;
  document.addEventListener = function (type, handler, options) {
    bound.push([type, handler]);
    return docAdd.call(document, type, handler, options);
  };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", readSource("pagenav.js"))(windowStub, document);
  document.addEventListener = docAdd;

  // Long enough to cover pagenav.js's leave animation (110ms) plus the two
  // frames it waits before animating the new screen in. Shorter than that and
  // every assertion here races the swap it is asserting about.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  return {
    window: windowStub,
    requests,
    /** The /api/nav-state reports pagenav.js sent, in order. */
    beacons,
    /** What it told the server about itself, e.g. "on" or "off:no-pill". */
    state: () => document.documentElement.getAttribute("data-pagenav"),
    hardNavs,
    historyEntries,
    loadedAssets,
    main: () => document.querySelector("main.main"),
    title: () => document.title,
    activeHref: () => {
      const el = document.querySelector(".mt-item.is-active");
      return el ? el.getAttribute("href") : null;
    },
    /** Taps a tab the way a thumb does, then lets the swap settle. */
    async tap(href, init = {}) {
      const link = document.querySelector(`.mt-item[href="${href}"]`);
      link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
      await settle();
      await settle();
      await settle();
    },
    /**
     * Taps any element, not just a tab -- pagenav.js swaps every internal
     * link now. Returns the click event so a test can ask whether it was
     * intercepted at all (defaultPrevented) rather than only what followed.
     */
    async clickOn(selector, init = {}) {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`no element matches ${selector}`);
      const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      el.dispatchEvent(event);
      await settle();
      await settle();
      await settle();
      return event;
    },
    settle,
    /** Fires the browser's popstate for an entry pagenav.js pushed. */
    async back(href) {
      current = href;
      window.dispatchEvent(
        Object.assign(new window.Event("popstate"), { state: { repcheckNav: true } })
      );
      await settle();
      await settle();
      await settle();
    },
  };
}
