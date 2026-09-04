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

const START_MARKER = "window.openBottomSheet = function(";
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

  // Both live above the extracted range in base.html: the nesting counter is
  // initialised once per document, and RepCheck.framed() answers whether the
  // page is inside the desktop device frame (it is not, on a phone).
  window.__pcSheetLockCount = window.__pcSheetLockCount || 0;
  window.RepCheck = window.RepCheck || {};
  window.RepCheck.framed = () => framed;

  // eslint-disable-next-line no-new-func
  new Function("window", "document", "RepCheck", source)(window, document, window.RepCheck);
  return {
    openBottomSheet: window.openBottomSheet,
    closeBottomSheet: window.closeBottomSheet,
  };
}
