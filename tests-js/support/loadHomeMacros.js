// Loads the REAL sumMacrosForDay() out of templates/home.html, same
// extraction-by-source-marker approach as loadSetsRepsBuckets.js. Pure
// function (no DOM, no external dependencies), so no mocking is needed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "home.html");

const START_MARKER = "function sumMacrosForDay(entries) {";
const END_MARKER = "// ---------- Calories & macros summary card ----------";

export function loadHomeMacros() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadHomeMacros: could not find sumMacrosForDay in templates/home.html -- " +
        "the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);
  const factory = new Function(`${source}\nreturn { sumMacrosForDay };`);
  return factory();
}
