// Keeps track of what a PAGE's own scripts bind to document and window, so
// static/pagenav.js can unbind it when that page is swapped away.
//
// pagenav.js replaces the contents of <main> instead of loading a new
// document. Element listeners die with the elements, but a page that binds to
// document or window -- and the tab pages do, 29 times between them -- leaves
// that binding behind forever. Visit Nutrition, leave, come back, and its
// document-level handlers are registered twice; a third visit, three times.
// Every swipe-to-delete fires as many times as you have visited the page.
//
// So document.addEventListener, window.addEventListener and setInterval are
// wrapped once, here, before any page script runs. They behave exactly as
// before except while `start()` is in effect, when they also record what was
// registered. pagenav.js hands that record back to `release()` on the way out.
//
// Recording is scoped to script execution: base.html brackets its content
// block, and pagenav.js brackets the scripts of a page it swaps in. A page
// that registers a document listener LATER -- inside a fetch callback, say --
// is not recorded and not released. That is the known hole in this, and it
// is bounded: it costs a duplicate handler on a revisit, not a broken page.
// Widening the window to "the whole time the page is on screen" would sweep
// up the shell's own late bindings and unbind those instead, which is worse.
//
// Loaded early and NOT deferred: it has to be in place before the first
// page script runs, and those run inline in the body.

(function (window, document) {
  "use strict";

  var recording = false;
  var records = [];
  // How many brackets are open. See start() for why they nest.
  var depth = 0;
  // The last completed recording, waiting to be collected. base.html closes
  // its bracket while the document is still parsing; pagenav.js is deferred
  // and collects this once it runs.
  var pending = null;

  var docAdd = document.addEventListener.bind(document);
  var docRemove = document.removeEventListener.bind(document);
  var winAdd = window.addEventListener.bind(window);
  var winRemove = window.removeEventListener.bind(window);
  var setIv = window.setInterval.bind(window);
  var clearIv = window.clearInterval.bind(window);
  var setTo = window.setTimeout.bind(window);

  document.addEventListener = function (type, handler, options) {
    if (recording) {
      // A swapped-in page's scripts still say `DOMContentLoaded`, and it has
      // already been and gone -- the document was parsed long before this
      // page arrived. Registering here would mean the handler never runs and
      // the page never initialises. Run it instead, async, which is the
      // closest thing to what the page asked for.
      if (type === "DOMContentLoaded" && document.readyState !== "loading") {
        if (typeof handler === "function") setTo(function () { handler({ type: type }); }, 0);
        else if (handler && typeof handler.handleEvent === "function") {
          setTo(function () { handler.handleEvent({ type: type }); }, 0);
        }
        return undefined;
      }
      records.push(["document", type, handler, options]);
    }
    return docAdd(type, handler, options);
  };

  window.addEventListener = function (type, handler, options) {
    if (recording) {
      // Same reasoning as DOMContentLoaded above: `load` has already fired.
      if (type === "load" && document.readyState === "complete") {
        if (typeof handler === "function") setTo(function () { handler({ type: type }); }, 0);
        return undefined;
      }
      records.push(["window", type, handler, options]);
    }
    return winAdd(type, handler, options);
  };

  window.setInterval = function () {
    var id = setIv.apply(null, arguments);
    // An interval belonging to a page that is no longer on screen is a timer
    // running against a DOM that does not exist any more, forever.
    if (recording) records.push(["interval", id]);
    return id;
  };

  // Pages relocate their overlays and modals to <body> so they escape the
  // stacking contexts inside <main> (workouts.html's moveOverlayToBody(), and
  // the same move in nutrition, weight and logging history). Those nodes are
  // therefore NOT inside the part of the document a swap replaces: leave them
  // and every visit adds another copy, each with the same id as the last, so
  // getElementById starts answering with a dead node from two pages ago.
  //
  // Patched only while recording, and only on document.body -- which exists
  // by then, because recording starts from inside the body.
  var bodyAppend = null;
  var bodyInsert = null;

  function patchBody() {
    var body = document.body;
    if (!body || bodyAppend) return;
    bodyAppend = body.appendChild;
    bodyInsert = body.insertBefore;
    body.appendChild = function (node) {
      var result = bodyAppend.call(body, node);
      if (recording && node && node.nodeType === 1) records.push(["node", node]);
      return result;
    };
    body.insertBefore = function (node, ref) {
      var result = bodyInsert.call(body, node, ref);
      if (recording && node && node.nodeType === 1) records.push(["node", node]);
      return result;
    };
  }

  function unpatchBody() {
    var body = document.body;
    if (!body || !bodyAppend) return;
    body.appendChild = bodyAppend;
    body.insertBefore = bodyInsert;
    bodyAppend = null;
    bodyInsert = null;
  }

  window.RepCheckNavScope = {
    /**
     * Begin recording. Bracket script execution with this, nothing wider.
     *
     * Nests, and has to: base.html's brackets sit inside <main>, which is
     * exactly the part of the document pagenav.js swaps -- so a swapped-in
     * page carries a copy of those markers and re-runs them inside
     * pagenav.js's own bracket. Without the depth count the inner stop()
     * finalised an empty recording and threw the real one away, and every
     * page's bindings and overlays leaked. Measured in the running app:
     * three visits to Workouts left three copies of every modal in the body,
     * all sharing their ids, so getElementById answered with a dead node.
     */
    start: function () {
      depth += 1;
      if (depth > 1) return;
      recording = true;
      records = [];
      patchBody();
    },
    /** Close one bracket. The outermost one finalises the recording. */
    stop: function () {
      depth = Math.max(0, depth - 1);
      if (depth > 0) return null;
      recording = false;
      unpatchBody();
      pending = records;
      records = [];
      return pending;
    },
    /** Collect the last completed recording, once. */
    take: function () {
      var taken = pending;
      pending = null;
      return taken;
    },
    /** Undo a record from stop(): unbind its listeners, cancel its timers. */
    release: function (taken) {
      if (!taken) return;
      for (var i = 0; i < taken.length; i++) {
        var entry = taken[i];
        try {
          if (entry[0] === "document") docRemove(entry[1], entry[2], entry[3]);
          else if (entry[0] === "window") winRemove(entry[1], entry[2], entry[3]);
          else if (entry[0] === "interval") clearIv(entry[1]);
          else if (entry[0] === "node" && entry[1].parentNode) {
            entry[1].parentNode.removeChild(entry[1]);
          }
        } catch (err) {
          /* One bad entry must not strand the rest. */
        }
      }
    },
  };
})(window, document);
