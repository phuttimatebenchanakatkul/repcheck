// Loads the REAL bottom-sheet helpers out of templates/base.html:
// window.bindSheetDrag (swipe-to-dismiss) and the
// window.openBottomSheet / window.closeBottomSheet pair that arms and
// disarms its touch listeners.
//
// Two slices rather than one, because the shell code sitting BETWEEN them
// (the VisualViewport shim and the RepCheck.framed()/scroller() helpers) is
// not what these tests are about and drags window.matchMedia and
// window.visualViewport in with it. The pair only reaches that code through
// RepCheck.framed(), which the caller stubs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "base.html");

const DRAG_START = "window.bindSheetDrag = function(";
const DRAG_END = "// iOS Safari quirk this pair also has to work around";
const SHEET_START = "window.openBottomSheet = function(";
const SHEET_END = "</script>";

function slice(html, startMarker, endMarker, what) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `loadSheetDrag: could not find ${what} in templates/base.html -- ` +
        "the extraction markers moved. Update the markers in this file."
    );
  }
  return html.slice(start, end);
}

export function loadSheetHelpers() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const source =
    slice(html, DRAG_START, DRAG_END, "bindSheetDrag") +
    "\n" +
    slice(html, SHEET_START, SHEET_END, "openBottomSheet/closeBottomSheet");
  // The pair reads RepCheck.framed() to decide whether to pin <body>.
  // Phone layout (not the desktop device frame) is the case these tests care
  // about, and it is the case the fix is for.
  window.RepCheck = window.RepCheck || { framed: () => false };
  window.__pcSheetLockCount = 0;
  new Function(source)();
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
