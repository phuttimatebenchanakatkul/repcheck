// Tab switching without loading a document.
//
// Why this exists, measured rather than guessed: a screen recording of seven
// tab switches (iphonecookie.mp4) showed every one of them blanking the phone
// completely, 83-215ms each, status bar the only thing left. That gap is not
// an animation that failed to run -- it is the truth of a multi-page app.
// Between two documents there is nothing rendered at all: not the page, not
// the bottom bar. Caching the assets, warming the next page and letting the
// tap reuse it all shortened the gap; none of them could remove it, because
// something has to be on screen during it, and during a document swap
// nothing is.
//
// So the tab bar no longer loads documents. It fetches the next page, puts
// its <main> in place of this one, and runs its scripts. The shell -- tab
// bar, sidebar, sheets -- is never torn down, so there is nothing to blank.
//
// The three things that make this safe in a codebase that was not built for
// it, each of which is why the obvious version of this file breaks:
//
//   Scripts run in a function scope, not as globals. The page templates
//   declare ~1700 top-level const/let/function names between them. Re-running
//   nutrition.html's scripts as globals on a second visit throws
//   "Identifier already declared" on the first line and leaves the page half
//   built. Inside `new Function(...)` those same declarations are locals: a
//   fresh set per visit, and the page's own scripts still see each other
//   because all of them run in ONE such scope, in document order.
//
//   Document- and window-level bindings are released. Elements go with the
//   swapped-out DOM, but a page that binds to document (the tab pages do, 29
//   times between them) would otherwise leave that binding behind on every
//   visit. static/nav_scope.js records them; this file releases them.
//
//   Anything unexpected falls back to a real navigation. A non-200, a
//   redirect to the login page, a document without a <main>, a script that
//   throws -- all of them end in location.assign(url). The worst outcome is
//   the behaviour we had before this file existed.
//
// Deliberately scoped to the five tab-bar links. Every other link in the app
// is still an ordinary navigation.

(function (window, document) {
  "use strict";

  var scope = window.RepCheckNavScope;
  if (!scope) return;
  if (!window.fetch || !window.DOMParser || !window.history || !window.history.pushState) return;

  var main = document.querySelector("main.main");
  var pill = document.querySelector(".mt-pill");
  if (!main || !pill) return;

  try {
    // The guided tour drives its own navigation between pages and expects
    // each step to land in a freshly loaded document. Leave it entirely alone.
    if (window.localStorage && window.localStorage.getItem("repcheck_pending_tour")) return;
    // Escape hatch. If swapping ever misbehaves on a device, this turns the
    // tabs back into ordinary links from the device itself -- no deploy, no
    // waiting for a fix to reach the App Store build:
    //   localStorage.setItem("repcheck_no_swap", "1")
    if (window.localStorage && window.localStorage.getItem("repcheck_no_swap")) return;
  } catch (err) {
    /* No localStorage is not a reason to bail out of navigation. */
  }

  var WILL_SWAP = "repcheck:page-will-swap";
  var SWAPPED = "repcheck:page-swapped";

  // Records for the page currently on screen. The first set comes from
  // base.html, which brackets its content block with the same recorder and
  // closes the bracket while the document is still parsing -- this file is
  // deferred, so it collects rather than closes.
  var pageRecords = scope.take();
  // Which URLs' scripts and stylesheets are already in this document. Seeded
  // with what the first page brought so nothing is loaded twice.
  var loaded = Object.create(null);
  var token = 0;

  function markLoaded(nodes, attr) {
    for (var i = 0; i < nodes.length; i++) {
      var value = nodes[i].getAttribute(attr);
      if (value) loaded[absolute(value)] = true;
    }
  }
  markLoaded(document.querySelectorAll("script[src]"), "src");
  markLoaded(document.querySelectorAll('link[rel="stylesheet"]'), "href");

  function absolute(url) {
    var a = document.createElement("a");
    a.href = url;
    return a.href;
  }

  function samePage(a, b) {
    var x = document.createElement("a");
    var y = document.createElement("a");
    x.href = a;
    y.href = b;
    return x.pathname === y.pathname && x.search === y.search;
  }

  function hardNav(url) {
    window.location.assign(url);
  }

  // ---- Loading what the incoming page brings with it ----------------------
  // Page templates carry their own <link rel=stylesheet> and <script src>
  // (hyrox.css, hyrox.js, coaching.js, the exercise/food libraries). They are
  // loaded once and then stay: re-adding an already-loaded script would run
  // it a second time, and those files bind at module level.
  function loadAsset(node) {
    return new Promise(function (resolve) {
      var url = absolute(node.getAttribute(node.tagName === "SCRIPT" ? "src" : "href"));
      if (loaded[url]) return resolve();
      loaded[url] = true;
      var el = document.createElement(node.tagName);
      if (node.tagName === "SCRIPT") {
        el.src = url;
        el.async = false;
      } else {
        el.rel = "stylesheet";
        el.href = url;
      }
      // A stylesheet or script that fails to load must not hang the swap --
      // the page is still better off rendered than not.
      el.onload = el.onerror = function () { resolve(); };
      document.head.appendChild(el);
    });
  }

  function loadAssets(fragment) {
    var nodes = [].slice.call(fragment.querySelectorAll('link[rel="stylesheet"]'))
      .concat([].slice.call(fragment.querySelectorAll("script[src]")));
    return nodes.reduce(function (chain, node) {
      return chain.then(function () { return loadAsset(node); });
    }, Promise.resolve());
  }

  // ---- Running the incoming page's own scripts ----------------------------
  // One function scope for all of them together, in document order, so the
  // page's scripts still see each other's declarations while a second visit
  // gets a clean set rather than a redeclaration error.
  function runInlineScripts(fragment) {
    var sources = [];
    var nodes = fragment.querySelectorAll("script:not([src])");
    for (var i = 0; i < nodes.length; i++) {
      var type = nodes[i].getAttribute("type");
      // Skip anything that is not executable JavaScript -- JSON-LD, templates.
      if (type && !/^(text|application)\/(java|ecma)script$/i.test(type)) continue;
      sources.push(nodes[i].textContent);
    }
    if (!sources.length) return;
    scope.start();
    try {
      // No "use strict" prepended: the page scripts were written for, and run
      // under, sloppy mode in their own <script> tags.
      new Function(sources.join("\n;\n"))();
    } finally {
      pageRecords = scope.stop();
    }
  }

  // ---- The shell bits that do change between pages ------------------------
  function syncNav(doc) {
    var incoming = doc.querySelectorAll(".mt-item, .sidebar-nav a");
    var current = document.querySelectorAll(".mt-item, .sidebar-nav a");
    if (incoming.length !== current.length) return;
    for (var i = 0; i < current.length; i++) {
      current[i].classList.toggle("is-active", incoming[i].classList.contains("is-active"));
    }
  }

  function reinit() {
    // Shared modules that painted the DOM this swap just replaced. Each is
    // a public entry point, so nothing here reaches into their internals.
    try {
      if (window.RepCheckI18n && window.RepCheckI18n.applyI18n) window.RepCheckI18n.applyI18n(main);
    } catch (err) { /* A translation pass must not take the page with it. */ }
    try {
      if (window.RepCheckStreak && window.RepCheckStreak.refresh) window.RepCheckStreak.refresh();
    } catch (err) { /* Nor a streak repaint. */ }
    // hyrox.js and coaching.js boot themselves off this: they are loaded once
    // and cannot rely on DOMContentLoaded for a page that arrives later.
    document.dispatchEvent(new CustomEvent(SWAPPED, { detail: { url: window.location.href } }));
  }

  function swap(url, options) {
    var mine = ++token;
    var push = !(options && options.replace);

    return window
      .fetch(url, { credentials: "same-origin", headers: { "X-RepCheck-Nav": "1" } })
      .then(function (response) {
        if (!response.ok) throw new Error("status " + response.status);
        // Logged out, onboarding, or anything else that redirected us
        // somewhere other than where we asked to go: let the browser take it.
        if (response.redirected && !samePage(response.url, url)) throw new Error("redirected");
        return response.text();
      })
      .then(function (html) {
        if (mine !== token) return; // A later tap already won.
        var doc = new DOMParser().parseFromString(html, "text/html");
        var incoming = doc.querySelector("main.main");
        if (!incoming) throw new Error("no main");

        return loadAssets(incoming).then(function () {
          if (mine !== token) return;

          document.dispatchEvent(new CustomEvent(WILL_SWAP, { detail: { url: url } }));
          scope.release(pageRecords);
          pageRecords = null;

          main.innerHTML = incoming.innerHTML;
          document.title = doc.title;
          syncNav(doc);
          if (push) window.history.pushState({ repcheckNav: true }, "", url);
          window.scrollTo(0, 0);

          runInlineScripts(main);
          reinit();
        });
      })
      .catch(function () {
        if (mine === token) hardNav(url);
      });
  }

  // ---- Wiring -------------------------------------------------------------
  pill.addEventListener("click", function (event) {
    // Let the browser have anything that is not a plain left click on a tab:
    // modified clicks open tabs, and that is a real navigation.
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;
    var node = event.target;
    while (node && node !== pill && !(node.classList && node.classList.contains("mt-item"))) {
      node = node.parentNode;
    }
    if (!node || node === pill) return;
    var href = node.getAttribute("href");
    if (!href || samePage(href, window.location.href)) {
      // Already here: swallow the click rather than reloading the page.
      if (href) event.preventDefault();
      return;
    }
    event.preventDefault();
    swap(href);
  });

  // Back and forward. Only entries this file pushed are swapped; anything
  // else belongs to a document the browser has to load itself.
  window.addEventListener("popstate", function (event) {
    if (!event.state || !event.state.repcheckNav) return;
    swap(window.location.href, { replace: true });
  });

  // The entry the app was loaded into has no state of ours, so a back from
  // the first swapped page would otherwise not be recognised as ours.
  try {
    window.history.replaceState({ repcheckNav: true }, "", window.location.href);
  } catch (err) {
    /* Some webviews refuse replaceState on a fresh entry; swapping still
       works, only the back button falls through to a real navigation. */
  }
})(window, document);
