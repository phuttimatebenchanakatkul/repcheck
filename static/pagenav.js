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

  // ---- Say whether this ran, and if not, why ------------------------------
  // Every way this file can decline to work is silent by design: the tabs stay
  // ordinary links and the app still works. That is right, and it is
  // untraceable. A screen recording (slop.mp4) showed the iPhone app still
  // doing a full page load on every tab tap an hour after this shipped, with
  // the correct scripts served on the page -- and there was no way from here
  // to tell which bail-out fired, or whether this file threw on that WebKit.
  // A phone has no console to ask. So it reports, once per page, and the
  // answer lands in the server log. See /api/nav-state in app.py.
  // Each distinct state is reported once. Repeats are dropped -- a tab tapped
  // five times must not write five identical lines -- but a NEW state always
  // gets through, because "started on, then every swap failed" is the shape
  // of the actual bug and both halves have to be visible.
  var reportedStates = {};
  function report(state) {
    if (reportedStates[state]) return;
    reportedStates[state] = true;
    try {
      var url = "/api/nav-state?s=" + encodeURIComponent(state);
      if (window.navigator && window.navigator.sendBeacon) window.navigator.sendBeacon(url);
      else if (window.fetch) window.fetch(url, { credentials: "same-origin" });
    } catch (err) {
      /* A diagnostic that breaks the thing it is diagnosing is worse than
         no diagnostic. */
    }
  }

  function start() {
    var scope = window.RepCheckNavScope;
    if (!scope) return "off:no-scope";
    if (!window.fetch) return "off:no-fetch";
    if (!window.DOMParser) return "off:no-domparser";
    if (!window.history || !window.history.pushState) return "off:no-pushstate";

    var main = document.querySelector("main.main");
    if (!main) return "off:no-main";
    var pill = document.querySelector(".mt-pill");
    if (!pill) return "off:no-pill";

    try {
      // Escape hatch. If swapping ever misbehaves on a device, this turns the
      // tabs back into ordinary links from the device itself -- no deploy, no
      // waiting for a fix to reach the App Store build:
      //   localStorage.setItem("repcheck_no_swap", "1")
      if (window.localStorage && window.localStorage.getItem("repcheck_no_swap")) {
        return "off:disabled";
      }
    } catch (err) {
      /* No localStorage is not a reason to bail out of navigation. */
    }

    install(scope, main, pill);
    return "on";
  }

  // The guided tour used to bail out here too, whenever repcheck_pending_tour
  // was set. That was a permanent, invisible kill switch on a key nothing
  // clears if a tour is abandoned, and it was not even needed: the tour
  // drives its own navigation with location.href, which this file does not
  // touch. Only tab-bar clicks are intercepted.

  function install(scope, main, pill) {

  var WILL_SWAP = "repcheck:page-will-swap";
  var SWAPPED = "repcheck:page-swapped";
  // Pages already fetched this session, for the back/forward gesture only.
  // Swiping back is a request to see the screen you just left, and that is
  // what the browser's own back/forward cache would give you for free if
  // these were separate documents -- instantly, with no network. Going
  // FORWARD deliberately does not read this: tapping Nutrition asks for
  // Nutrition as it is now, not as it was.
  //
  // The server's HTML is cached, not a snapshot of the live DOM, so restoring
  // goes down exactly the same path as arriving fresh -- parse, swap, run the
  // page's scripts. A snapshot would have to re-run those scripts against a
  // DOM they had already rendered into, and render them twice.
  var pageCache = Object.create(null);
  var cacheOrder = [];
  var CACHE_MAX = 8;

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (err) {
    /* No matchMedia: animate. */
  }

  function remember(url, html) {
    var key = pathOf(url);
    if (!pageCache[key]) cacheOrder.push(key);
    pageCache[key] = html;
    while (cacheOrder.length > CACHE_MAX) delete pageCache[cacheOrder.shift()];
  }

  function pathOf(url) {
    var a = document.createElement("a");
    a.href = url;
    return a.pathname + a.search;
  }

  /** Which way the screen should travel: the tab order is the map. */
  function directionTo(url) {
    var items = [].slice.call(pill.querySelectorAll(".mt-item"));
    var from = -1;
    var to = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].classList.contains("is-active")) from = i;
      if (samePage(items[i].getAttribute("href"), url)) to = i;
    }
    if (from === -1 || to === -1) return 1;
    return to >= from ? 1 : -1;
  }

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

  /** Puts a fetched page on screen. Everything here is synchronous, so the
   *  screen never sits half-swapped. */
  function render(html, url, options) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var incoming = doc.querySelector("main.main");
    if (!incoming) throw new Error("no main");

    document.dispatchEvent(new CustomEvent(WILL_SWAP, { detail: { url: url } }));
    scope.release(pageRecords);
    pageRecords = null;

    main.innerHTML = incoming.innerHTML;
    document.title = doc.title;
    syncNav(doc);
    window.scrollTo(0, 0);

    runInlineScripts(main);
    reinit();
    return incoming;
  }

  // Two frames, and a timer under them. The second frame is not superstition:
  // the start class has to be painted before it is removed, or the browser
  // coalesces both styles into one change and there is nothing to animate
  // from.
  //
  // The timer is the part that matters for correctness. A hidden page gets no
  // frames AT ALL -- the app in the background, iOS mid-transition, a webview
  // that has not been shown yet -- so a swap that happens then would leave
  // the start class on forever and the screen sitting at opacity 0. Caught
  // exactly that way: driving the app with the browser pane hidden left every
  // swapped-in screen invisible, and the class still on <main> afterwards.
  // Whichever comes first wins; the removal runs once.
  function afterPaint(fn) {
    var done = false;
    function once() {
      if (done) return;
      done = true;
      fn();
    }
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(once);
      });
    }
    window.setTimeout(once, 80);
  }

  function enter(direction) {
    if (reduceMotion) return;
    // Start the new screen offset the way it arrived from, then let it
    // settle. The class carries `transition: none` so this start state is not
    // itself animated -- removing it after a paint is what animates.
    main.classList.add(direction > 0 ? "pn-enter-right" : "pn-enter-left");
    afterPaint(function () {
      main.classList.remove("pn-enter-right", "pn-enter-left");
    });
  }

  function clearMotion() {
    main.classList.remove("pn-enter-left", "pn-enter-right");
  }

  // Coming back to a page that was hidden mid-swap: whatever the transition
  // was in the middle of, the screen must be readable now. Cheap, and the
  // last line of defence against a screen stuck at opacity 0.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) clearMotion();
  });

  function swap(url, options) {
    var mine = ++token;
    var opts = options || {};
    var direction = opts.direction || directionTo(url);

    // The back/forward gesture is already animating a snapshot of where it is
    // going. Anything asynchronous here lands after that animation and reads
    // as the screen refreshing itself underneath the gesture, so a page this
    // session has already fetched goes up immediately -- no network, no
    // transition of ours competing with the system's.
    if (opts.fromHistory) {
      var stored = pageCache[pathOf(url)];
      if (stored) {
        try {
          clearMotion();
          render(stored, url, opts);
          return Promise.resolve();
        } catch (err) {
          hardNav(url);
          return Promise.resolve();
        }
      }
    }

    // The history entry goes in FIRST, while the screen you are leaving is
    // still fully drawn. That ordering is the whole fix for "it refreshes
    // when I swipe back".
    //
    // iOS snapshots the page when a navigation commits and shows that
    // snapshot during the back-swipe. The push used to happen down in
    // render(), and the outgoing screen was faded to opacity 0 before that by
    // a leave animation -- so the snapshot iOS stored for the screen you were
    // leaving was a blank one, and swiping back slid that blank in before
    // popstate restored the content. Nothing was reloading; it looked exactly
    // like it was.
    //
    // The leave animation is gone entirely rather than merely reordered
    // around the snapshot. Ordering would leave the fix resting on when
    // exactly WebKit takes the snapshot, which is not ours to know or to
    // depend on; never fading the outgoing screen means no snapshot of it can
    // ever be blank, whenever it is taken. The tap is still answered
    // instantly -- the tab bubble moves on pointerdown, before this even runs
    // -- and only the arriving screen is animated.
    if (!opts.fromHistory) {
      window.history.pushState({ repcheckNav: true }, "", url);
    }

    var fetched = window
      .fetch(url, { credentials: "same-origin", headers: { "X-RepCheck-Nav": "1" } })
      .then(function (response) {
        if (!response.ok) throw new Error("status-" + response.status);
        // Logged out, onboarding, or anything else that redirected us
        // somewhere other than where we asked to go: let the browser take it.
        // The destination is named in the reason -- "did the fetch come back
        // as the login page" is the difference between a session problem and
        // a routing one, and guessing between those has cost enough already.
        if (response.redirected && !samePage(response.url, url)) {
          throw new Error("redirect-to-" + pathOf(response.url));
        }
        return response.text();
      });

    return fetched
      .then(function (html) {
        if (mine !== token) return; // A later tap already won.
        var doc = new DOMParser().parseFromString(html, "text/html");
        var incoming = doc.querySelector("main.main");
        if (!incoming) throw new Error("no main");

        return loadAssets(incoming).then(function () {
          if (mine !== token) return;
          remember(url, html);
          clearMotion();
          enter(direction);
          render(html, url, opts);
        });
      })
      .catch(function (err) {
        if (mine !== token) return;
        clearMotion();
        // A swap that falls back is a full page load, which is the very thing
        // this file exists to remove -- and until now it did so as quietly as
        // it declines to start. The reason goes out before the navigation
        // takes the page away with it.
        report("swap-failed:" + ((err && err.message) || String(err)).slice(0, 60));
        hardNav(url);
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

  // Back and forward -- including the iOS edge-swipe, which is where this
  // matters most. That gesture animates a snapshot of the screen it is
  // heading to and then hands over; anything asynchronous here lands after
  // the animation has finished and reads as the screen refreshing itself.
  // Hence `fromHistory`, which serves a page this session already has
  // immediately, without a fetch and without a transition of ours fighting
  // the system's. Only entries this file pushed are swapped; anything else
  // belongs to a document the browser has to load itself.
  window.addEventListener("popstate", function (event) {
    if (!event.state || !event.state.repcheckNav) return;
    swap(window.location.href, { replace: true, fromHistory: true });
  });

  // The screen the app opened on is the one you land on when you swipe back,
  // and it is the one page this file never fetched -- the browser did, before
  // any of this ran. Ask for it once, quietly, so that first swipe back is
  // instant like every other one. It answers 304 from the copy the browser
  // already holds, so it costs a round trip and no body.
  window.setTimeout(function () {
    window
      .fetch(window.location.href, {
        credentials: "same-origin",
        headers: { "X-RepCheck-Nav": "1" },
      })
      .then(function (response) {
        if (response.ok && !response.redirected) return response.text();
        return null;
      })
      .then(function (html) {
        if (html) remember(window.location.href, html);
      })
      .catch(function () {
        /* The cache is an optimisation; missing it costs a fetch later. */
      });
  }, 1200);

    // The entry the app was loaded into has no state of ours, so a back from
    // the first swapped page would otherwise not be recognised as ours.
    try {
      window.history.replaceState({ repcheckNav: true }, "", window.location.href);
    } catch (err) {
      /* Some webviews refuse replaceState on a fresh entry; swapping still
         works, only the back button falls through to a real navigation. */
    }
  }

  // An exception anywhere above leaves the tabs as ordinary links, which is
  // the old behaviour and safe -- but it must not also leave us guessing.
  // The message goes in the report.
  var state;
  try {
    state = start();
  } catch (err) {
    state = "off:error:" + ((err && err.message) || String(err)).slice(0, 80);
  }
  // Also on the element, for anyone with an inspector in front of them.
  try {
    document.documentElement.setAttribute("data-pagenav", state);
  } catch (err) {
    /* Not worth failing over. */
  }
  report(state);
})(window, document);
