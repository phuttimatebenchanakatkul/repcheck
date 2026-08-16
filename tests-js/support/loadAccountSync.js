// Runs the REAL static/account_sync.js in jsdom rather than a hand-copied
// duplicate, same reasoning as loadWorkoutSync.js. That file is a plain
// IIFE with no exports, so there is nothing to import: loading it IS the
// test subject -- it wraps localStorage.setItem/removeItem and fires its
// hydration GET as a side effect of evaluating.
//
// Everything ambient it touches is injected as a parameter of the generated
// function (so those names become the top-level scope the source closes
// over) rather than stubbed globally:
//
//   localStorage / Storage / sessionStorage
//       account_sync works by assigning over localStorage.setItem. Browsers
//       allow that -- it's the standard way to hook storage writes -- but
//       jsdom's Storage routes property assignment through its named-property
//       setter, so the assignment silently becomes an ITEM called "setItem"
//       and the wrapper is never installed. Tests against jsdom's own
//       localStorage therefore exercise nothing. makeStorage() below is a
//       plain object with the same surface (items are own ENUMERABLE
//       properties, so Object.keys() lists exactly the stored keys, which is
//       what the analyze-chat key sweep relies on) and normal assignment
//       semantics. Storage.prototype is that same object, so the source's
//       Storage.prototype.setItem.bind(localStorage) captures the real
//       setter before it's wrapped, exactly as it does in a browser.
//   location    jsdom's location.reload() is unimplemented; this spies instead.
//   navigator   omitting sendBeacon forces every push down the fetch path,
//               which tests can assert on.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(__dirname, "..", "..", "static", "account_sync.js");

export function extractSource() {
  const source = readFileSync(SOURCE_PATH, "utf-8");
  if (!source.includes("var SYNC_KEYS = new Set([")) {
    throw new Error(
      "loadAccountSync: static/account_sync.js no longer defines SYNC_KEYS -- " +
        "the file was restructured and this harness needs updating."
    );
  }
  return source;
}

function makeStorage(initial = {}) {
  const storage = {};
  const method = (value) => ({ value, writable: true, configurable: true, enumerable: false });
  Object.defineProperties(storage, {
    getItem: method(function (key) {
      return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
    }),
    setItem: method(function (key, value) {
      Object.defineProperty(this, key, {
        value: String(value),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }),
    removeItem: method(function (key) {
      delete this[key];
    }),
  });
  Object.entries(initial).forEach(([key, value]) => storage.setItem(key, value));
  return storage;
}

/**
 * Evaluates account_sync.js against fresh storage.
 *
 * `initialLocal` seeds localStorage before load (what this browser already
 * had). Returns that storage so tests can read and write through the same
 * object the source wrapped, plus a reload spy.
 */
export function loadAccountSync({ initialLocal = {}, sendBeacon = null } = {}) {
  const storage = makeStorage(initialLocal);
  const session = makeStorage();
  window.REPCHECK_LOGGED_IN = true;

  const reload = () => { reload.called = true; };
  reload.called = false;

  const factory = new Function(
    "localStorage",
    "sessionStorage",
    "Storage",
    "location",
    "navigator",
    extractSource()
  );
  factory(
    storage,
    session,
    { prototype: storage },
    { reload, pathname: "/", href: "http://localhost/" },
    sendBeacon ? { sendBeacon } : {}
  );

  return {
    storage,
    session,
    reload,
    restore() {
      delete window.REPCHECK_LOGGED_IN;
    },
  };
}
