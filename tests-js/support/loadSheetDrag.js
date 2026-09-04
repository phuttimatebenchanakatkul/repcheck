// Loads the REAL window.bindSheetDrag (swipe-to-dismiss) out of
// templates/base.html, alongside the openBottomSheet / closeBottomSheet pair
// that arms and disarms its touch listeners.
//
// Only bindSheetDrag is extracted here. The open/close pair already has an
// extractor -- ./loadBottomSheet.js -- and it pulls the same script block out
// of the same file, so a second copy of those markers would mean a rename of
// openBottomSheet silently breaking one loader and not the other. The three
// helpers attach themselves to `window` independently, so they do not need a
// shared eval scope to see each other.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBottomSheet } from "./loadBottomSheet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "base.html");

const DRAG_START = "window.bindSheetDrag = function(";
const DRAG_END = "// iOS Safari quirk this pair also has to work around";

export function loadSheetHelpers() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(DRAG_START);
  const end = html.indexOf(DRAG_END, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadSheetDrag: could not find bindSheetDrag in templates/base.html -- " +
        "the extraction markers moved. Update DRAG_START/DRAG_END in this file."
    );
  }
  // eslint-disable-next-line no-new-func
  new Function(html.slice(start, end))();
  // framed: false is the phone layout -- the case this fix is for, and the
  // one where <body> is the scroller openBottomSheet pins.
  loadBottomSheet({ framed: false });
}

// A sheet overlay shaped like the ones the shell keeps in the DOM between
// uses: full-viewport, position:fixed, present on every page.
export function sheetFixture() {
  return `
    <div class="mt-sheet-overlay" id="mt-fab-overlay">
      <div class="mt-sheet" id="mt-fab-sheet">
        <div class="mt-sheet-handle"></div>
        <div class="qa-rows"></div>
      </div>
    </div>
  `;
}
