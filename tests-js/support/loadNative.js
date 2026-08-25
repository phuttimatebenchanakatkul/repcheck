// Loads the REAL static/native.js -- the iOS shell's camera bridge -- and
// runs it against stub globals, rather than a hand-copied duplicate that
// could silently drift from what ships.
//
// Same shape as loadNumericFields.js: native.js is a standalone IIFE taking
// (window, document), so each load gets its own window.RepCheckNative and
// its own fake Capacitor. That isolation matters here more than usual --
// the whole unit under test is "what does this do when window.Capacitor is
// present / absent / half-broken", and a shared global would leak one
// test's fake shell into the next.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "..", "..", "static", "native.js");

export function readSource() {
  return readFileSync(SCRIPT_PATH, "utf-8");
}

/**
 * Evaluate native.js against a fake window.
 *
 * @param {object} options
 * @param {object|null} options.capacitor  stands in for window.Capacitor --
 *   null (the default) is a plain browser, which is the path the vast
 *   majority of RepCheck's users are on and the one that must never break.
 * @param {Function} options.fetch  stub for window.fetch, used when turning
 *   a captured photo into a File.
 */
export function loadNative({ capacitor = null, fetch: fetchStub } = {}) {
  const windowStub = {
    Capacitor: capacitor || undefined,
    fetch: fetchStub || (() => Promise.reject(new Error("fetch not stubbed"))),
    // The real File is fine here -- jsdom provides it, and the point of the
    // conversion is that downstream code receives a genuine File.
    File: globalThis.File,
  };
  const documentStub = {};

  // eslint-disable-next-line no-new-func
  new Function("window", "document", readSource())(windowStub, documentStub);

  return { native: windowStub.RepCheckNative, windowStub };
}

/**
 * A fake Capacitor shell. `plugins` are merged onto Capacitor.Plugins, so a
 * test can supply only the plugin it cares about -- and, importantly, can
 * supply NONE, which is the "package.json lists it but the native project
 * was never synced" case that must degrade rather than throw.
 */
export function fakeCapacitor({ native = true, platform = "ios", plugins = {} } = {}) {
  return {
    isNativePlatform: () => native,
    getPlatform: () => platform,
    Plugins: plugins,
  };
}

/** A minimal fetch stub that resolves any URL to one blob. */
export function blobFetch(blob) {
  return () => Promise.resolve({ blob: () => Promise.resolve(blob) });
}
