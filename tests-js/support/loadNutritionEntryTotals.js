// Loads the REAL entryTotals()/scaledMacros() out of templates/nutrition.html,
// same extraction-by-source-marker approach as loadSetsRepsBuckets.js. Pure
// functions (no DOM, no external dependencies), so no mocking is needed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "nutrition.html");

const START_MARKER = "function entryTotals(entry) {";
const END_MARKER = "// ---------- Goals UI ----------";

export function loadNutritionEntryTotals() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadNutritionEntryTotals: could not find entryTotals/scaledMacros in " +
        "templates/nutrition.html -- the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);
  const factory = new Function(`${source}\nreturn { entryTotals, scaledMacros };`);
  return factory();
}
