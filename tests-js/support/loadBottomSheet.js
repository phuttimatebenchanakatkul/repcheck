// Loads the REAL window.openBottomSheet / window.closeBottomSheet out of
// templates/base.html.
//
// They are the shared bottom-sheet helpers every page's sheets go through,
// and the thing worth exercising about them is not the animation -- it is
// that openBottomSheet RE-PARENTS the sheet to <body>, which takes it out of
// the part of the document static/pagenav.js swaps. That move is the whole
// reason a nutrition sheet could outlive the nutrition page.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "base.html");

// Starts at the RepCheck scroller/viewport shim rather than at
// openBottomSheet itself: openBottomSheet calls RepCheck.trackViewport(),
// which is defined in that shim, so a slice starting below it evaluates an
// openBottomSheet whose collaborator does not exist. Everything between the
// two is setup these helpers depend on anyway (RepCheck.framed,
// updatePcViewportVars, the scroller accessors).
const START_MARKER = "window.RepCheck = window.RepCheck || {};";
const END_MARKER = "\n      </script>";

/**
 * @param {{framed?: boolean}} opts
 * @returns {{openBottomSheet: Function, closeBottomSheet: Function}}
 */
export function loadBottomSheet({ framed = false } = {}) {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER, start);
  if (start === -1 || end === -1) {
    throw new Error(
      "loadBottomSheet: could not find the bottom-sheet helpers in " +
        "templates/base.html -- the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);

  // The nesting counters are initialised once per document, above the
  // extracted range.
  window.__pcSheetLockCount = window.__pcSheetLockCount || 0;
  window.RepCheck = window.RepCheck || {};
  // The real RepCheck.framed() is inside the range now, and it asks
  // window.matchMedia, which jsdom does not implement. Stub it so the shim can
  // evaluate at all; the answer it gives is replaced below.
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }

  // eslint-disable-next-line no-new-func
  new Function("window", "document", "RepCheck", source)(window, document, window.RepCheck);

  // AFTER the eval, which defines the real framed(): the phone layout, not the
  // desktop device frame, is the case these tests are about.
  window.RepCheck.framed = () => framed;
  return {
    openBottomSheet: window.openBottomSheet,
    closeBottomSheet: window.closeBottomSheet,
  };
}
