// Loads the REAL static/auth_viewport.js -- the script that keeps the pinned
// log in / sign up screen in step with the on-screen keyboard -- and runs it
// against a simulated phone, in the same style as loadNumericFields.js.
//
// The script is a standalone IIFE taking (window, document), so the stubs
// shadow the jsdom globals: every load gets its own listener registry, and
// nothing leaks onto the shared document between tests. Stubbing is also the
// only way to exercise it at all -- jsdom has no visualViewport, no keyboard to
// move one, and no layout engine to report rects from.
//
// The fake page is the real log in card's geometry: a form whose fields sit at
// fixed positions inside a position:fixed <body>, with getBoundingClientRect
// derived from the translate the script has written. That is what makes the
// reveal assertions real -- the rects move because the script moved the page,
// not because the harness said so.

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
 *   fields       - [{name, top, height}] laid out in layout coordinates with no
 *                  keyboard up; defaults to the log in card at 375x812
 *   submit       - {top, height} for .auth-submit-btn, or null for none
 * @returns a handle exposing the stub <body>, a `keyboard()` helper that moves
 *   the visual viewport the way iOS does, per-field rects, and the timers the
 *   script registered so tests can run them deterministically.
 */
export function loadAuthViewport({
  layoutHeight = 812,
  framed = false,
  fields = [
    { name: "email", top: 380, height: 44 },
    { name: "password", top: 460, height: 44 },
  ],
  submit = { top: 530, height: 48 },
} = {}) {
  const timers = [];
  const listeners = { visualViewport: [], window: [], document: [] };
  const bodyStub = { style: {} };

  // The translate the script has written, in px. Everything the page renders
  // moves with it, which is what the rects below reproduce.
  function shift() {
    const match = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(bodyStub.style.transform || "");
    return match ? parseFloat(match[1]) : 0;
  }
  function rectFor(box) {
    return { top: box.top + shift(), bottom: box.top + box.height + shift() };
  }

  const submitEl = submit && {
    name: "submit",
    getBoundingClientRect: () => rectFor(submit),
  };
  const formEl = {
    querySelector: (sel) => (sel === ".auth-submit-btn" ? submitEl || null : null),
  };
  const els = {};
  for (const field of fields) {
    els[field.name] = {
      name: field.name,
      tagName: "INPUT",
      form: formEl,
      getBoundingClientRect: () => rectFor(field),
    };
  }

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
    activeElement: null,
    body: {},
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

  const handle = {
    body: bodyStub,
    window: windowStub,
    document: documentStub,
    visualViewport,
    fields: els,
    submit: submitEl,
    /** Where an element is currently drawn, keyboard offsets included. */
    rect: (name) => (name === "submit" ? submitEl : els[name]).getBoundingClientRect(),
    /** The strip of the phone the keyboard leaves visible, in layout coords. */
    strip: () => ({
      top: visualViewport.offsetTop,
      bottom: visualViewport.offsetTop + visualViewport.height,
    }),
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
    /** Tap a field: focus it, then let the keyboard animation settle. */
    tap(name, keyboard) {
      documentStub.activeElement = els[name];
      fire("document", "focusout", { target: null });
      fire("document", "focusin", { target: els[name] });
      if (keyboard) handle.keyboard(keyboard);
      handle.runTimers();
    },
    dismiss() {
      documentStub.activeElement = documentStub.body;
      fire("document", "focusout", { target: null });
      handle.keyboard({ height: layoutHeight, offsetTop: 0 });
      handle.runTimers();
    },
    resizeWindow() { fire("window", "resize"); },
  };
  return handle;
}
