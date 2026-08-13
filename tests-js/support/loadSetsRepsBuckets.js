// Loads the REAL getSetsRepsBucket()/getSetsRepsText()/getSetsRepsDefault()
// out of templates/workouts.html, same extraction-by-source-marker approach
// as loadReviewStep.js. These are pure functions (no DOM, no external
// dependencies), so no mocking is needed -- just eval and return them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "workouts.html");

const START_MARKER = "// Single source of truth for the sets/reps buckets";
const END_MARKER = "function renderTodaysPlanCard() {";

export function loadSetsRepsBuckets() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadSetsRepsBuckets: could not find the sets/reps bucket functions in " +
        "templates/workouts.html -- the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);
  const factory = new Function(`${source}\nreturn { getSetsRepsBucket, getSetsRepsText, getSetsRepsDefault };`);
  return factory();
}
