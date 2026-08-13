// Loads the REAL sumMacrosForDay() out of templates/full_stats.html, same
// extraction-by-source-marker approach as loadSetsRepsBuckets.js /
// loadHomeMacros.js. full_stats.html has its own copy-pasted
// sumMacrosForDay() (not shared code with home.html), so home.html's
// version being correct doesn't guarantee this one is -- this loader lets
// tests exercise the actual full_stats.html implementation directly.
// Pure function (no DOM, no external dependencies), so no mocking needed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "full_stats.html");

const START_MARKER = "function sumMacrosForDay(entries) {";
const END_MARKER = "// A day counts as \"on target\" within this fraction of the calorie goal.";

export function loadFullStatsMacros() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadFullStatsMacros: could not find sumMacrosForDay in templates/full_stats.html -- " +
        "the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);
  const factory = new Function(`${source}\nreturn { sumMacrosForDay };`);
  return factory();
}
