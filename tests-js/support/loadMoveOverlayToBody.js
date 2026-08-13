// Loads the REAL moveOverlayToBody() out of templates/workouts.html --
// pure DOM helper, no dependencies, so no mocking needed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "workouts.html");

const START_MARKER = "function moveOverlayToBody(el) {";
const END_MARKER = "function escapeHtml(text) {";

export function loadMoveOverlayToBody() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadMoveOverlayToBody: could not find moveOverlayToBody() in " +
        "templates/workouts.html -- the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);
  const factory = new Function(`${source}\nreturn moveOverlayToBody;`);
  return factory();
}
