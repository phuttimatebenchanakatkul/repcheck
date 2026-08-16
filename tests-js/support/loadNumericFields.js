// Loads the REAL static/numeric_fields.js -- the shared blank-on-focus
// behavior behind every [data-clear-on-focus] number field in the app --
// and runs it in jsdom, rather than a hand-copied duplicate that can
// silently drift from what actually ships.
//
// Unlike the other loaders here, no source-marker extraction is needed:
// numeric_fields.js is a standalone IIFE whose whole body is the unit
// under test. It is evaluated with stub `window`/`document` arguments
// shadowing the jsdom globals, so each load gets its own exports and its
// own record of what it bound -- registering the real focusin/focusout
// listeners on the shared jsdom document would leak handlers from one
// test into the next.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "..", "..", "static", "numeric_fields.js");

export function readSource() {
  return readFileSync(SCRIPT_PATH, "utf-8");
}

/**
 * Evaluates the real numeric_fields.js against stub globals. Returns the
 * handlers it exported plus the document-level listeners it registered, so
 * tests can drive the behavior directly instead of relying on jsdom's
 * focus plumbing (which won't fire focusin for an element that can't take
 * real focus).
 */
export function loadNumericFields() {
  const bound = [];
  const documentStub = {
    addEventListener(type, handler) { bound.push({ type, handler }); },
  };
  const windowStub = {};

  // eslint-disable-next-line no-new-func
  new Function("window", "document", readSource())(windowStub, documentStub);

  return {
    api: windowStub.RepCheckNumericFields,
    bound,
    // Convenience: fire what the real document listener would have fired.
    focusIn: (target) => windowStub.RepCheckNumericFields.handleFocusIn({ target }),
    focusOut: (target) => windowStub.RepCheckNumericFields.handleFocusOut({ target }),
  };
}
