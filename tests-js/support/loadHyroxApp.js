// Loads the REAL static/hyrox.js out of the app rather than a hand-copied
// duplicate, same reasoning as loadWorkoutChat.js/loadAccountSync.js. Unlike
// those two, HyroxApp is a full ES6 class (~2760 lines) whose constructor
// eagerly touches localStorage, RepCheckI18n, and calls this.render() --
// far too heavy a side-effect surface to trigger just to unit test one
// picker component.
//
// So this loader does NOT instantiate HyroxApp the normal way (`new
// HyroxApp(root)`). It extracts the class definition (plus the handful of
// module-scope helpers/constants a given method needs) and exposes the
// bare class so a test can build an instance with `Object.create
// (HyroxApp.prototype)` -- a real instance of the real class, with the
// real prototype methods, but with the constructor never run. The test is
// then responsible for setting whatever instance fields (`this.foo`) the
// method(s) under test actually read, exactly the way a partial/shallow
// mount works in component-testing frameworks.
//
// This only works for methods that don't transitively call something
// requiring full construction (this.render(), this.root, i18n, etc.) --
// know which fields/globals a method touches before testing it this way,
// or the failure will be a confusing runtime error deep in an unrelated
// branch rather than an assertion failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(__dirname, "..", "..", "static", "hyrox.js");

// The boundary between the app and the code that starts it. It used to be
// the `document.addEventListener("DOMContentLoaded"` line, until hyrox.js
// grew a real bootstrap: static/pagenav.js swaps pages in without loading a
// document, so this file is loaded once and has to boot against several DOMs
// over a session, which DOMContentLoaded alone cannot do. hyrox.js carries
// the matching comment and says not to remove it.
const BOOTSTRAP_MARKER = "\n  // ---- Bootstrap ---";

// Note: no trailing `})();` here -- extractSource returns just the
// function BODY (everything between `(function () {` and its matching
// `}`), not a self-invoking expression. loadHyroxApp() below wraps it in
// `new Function(body)` directly, so the `return` becomes that Function's
// own return value.
const RETURN_STMT = "\n  return { HyroxApp, CUSTOM_STATION_KEYS, STATION_TITLES, stationIconSvg };\n";

export function extractSource() {
  const source = readFileSync(SOURCE_PATH, "utf-8").replace(/\r\n/g, "\n");
  const openMarker = "(function () {";
  const iifeOpen = source.indexOf(openMarker);
  const bootstrapIdx = source.indexOf(BOOTSTRAP_MARKER);
  if (iifeOpen === -1 || bootstrapIdx === -1) {
    throw new Error(
      "loadHyroxApp: could not find the outer IIFE or the bootstrap marker " +
        "in static/hyrox.js -- the file was restructured and this harness " +
        "needs updating (see BOOTSTRAP_MARKER in loadHyroxApp.js)."
    );
  }
  if (!source.includes("class HyroxApp {")) {
    throw new Error("loadHyroxApp: static/hyrox.js no longer defines `class HyroxApp {` -- update the harness.");
  }
  // Body starts right after `(function () {`, ends right before the bootstrap
  // block (which is itself followed by the original `})();` we're
  // deliberately dropping).
  const bodyStart = iifeOpen + openMarker.length;
  const body = source.slice(bodyStart, bootstrapIdx);
  return `${body}${RETURN_STMT}`;
}

/**
 * Evaluates the real hyrox.js source and returns { HyroxApp, ... } for
 * tests to build bare instances from. Does NOT call `new HyroxApp()` --
 * see file header for why.
 */
export function loadHyroxApp() {
  const factory = new Function(extractSource());
  return factory();
}

/**
 * Builds a bare HyroxApp instance -- real prototype, constructor never
 * run. `fields` seeds whatever instance state the method(s) under test
 * read (e.g. { stationPickerCategory: "sled" }).
 */
export function makeBareHyroxApp(fields = {}) {
  const { HyroxApp } = loadHyroxApp();
  const instance = Object.create(HyroxApp.prototype);
  Object.assign(instance, fields);
  return instance;
}
