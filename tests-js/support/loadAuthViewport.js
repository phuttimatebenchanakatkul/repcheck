// Loads the REAL static/auth_viewport.js -- the script that keeps the pinned
// log in / sign up screen in step with the on-screen keyboard -- and runs it
// against stub globals, in the same style as loadNumericFields.js.
//
// The script is a standalone IIFE taking (window, document), so the stubs
// shadow the jsdom globals: every load gets its own listener registry, and
// nothing leaks onto the shared document between tests. Stubbing is also the
// only way to exercise it at all -- jsdom has no visualViewport, and no
// keyboard to move one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "..", "..", "static", "auth_viewport.js");

export function readSource() {
  return readFileSync(SCRIPT_PATH, "utf-8");
}

/**
 * Evaluates the real auth_viewport.js against a fake phone.
 *
 * @param {object} opts
 *   layoutHeight - the layout viewport height (what the pin measures)
 *   framed       - true to simulate the >=721px desktop device frame
 * @returns a handle with the stub <body> style, a `keyboard()` helper that
 *   moves the visual viewport the way iOS does, and the timers/listeners the
 *   script registered so tests can run them deterministically.
 */
export function loadAuthViewport({ layoutHeight = 812, framed = false } = {}) {
  const timers = [];
  const listeners = { visualViewport: [], window: [], document: [] };
  const bodyStub = { style: {} };

  const visualViewport = {
    height: layoutHeight,
    offsetTop: 0,
    addEventListener(type, handler) {
      listeners.visualViewport.push({ type, handler });
    },
  };

  const windowStub = {
    visualViewport,
    pageYOffset: 0,
    scrollTo(_x, y) { windowStub.pageYOffset = y; },
    matchMedia: (query) => ({ matches: framed && query.includes("721px") }),
    setTimeout(fn) { timers.push(fn); return timers.length; },
    addEventListener(type, handler) { listeners.window.push({ type, handler }); },
  };

  const documentStub = {
    querySelector: (sel) => (sel === ".auth-body" ? bodyStub : null),
    addEventListener(type, handler) { listeners.document.push({ type, handler }); },
  };

  // eslint-disable-next-line no-new-func
  new Function("window", "document", readSource())(windowStub, documentStub);

  function fire(where, type, event) {
    listeners[where]
      .filter((l) => l.type === type)
      .forEach((l) => l.handler(event));
  }

  return {
    body: bodyStub,
    window: windowStub,
    visualViewport,
    /** Runs every pending setTimeout callback, in registration order. */
    runTimers() {
      while (timers.length) timers.shift()();
    },
    /**
     * What iOS does when a field is tapped: the visual viewport shrinks by the
     * keyboard's height AND slides down inside the layout viewport, so a
     * position:fixed <body> is left sitting `offsetTop` px above the strip you
     * can actually see.
     */
    keyboard({ height, offsetTop }) {
      visualViewport.height = height;
      visualViewport.offsetTop = offsetTop;
      fire("visualViewport", "resize");
      fire("visualViewport", "scroll");
    },
    focusIn(target) { fire("document", "focusin", { target }); },
    focusOut(target) { fire("document", "focusout", { target }); },
    resizeWindow() { fire("window", "resize"); },
  };
}
