// Loads the REAL exercise-picker search helpers out of templates/index.html
// (the analyze page's inline script), same extraction-by-source-marker
// approach as loadSetsRepsBuckets.js. exSearchCategoryNames() reads the
// page-level EXERCISE_CATEGORIES, so that gets injected rather than mocked
// out -- the caller passes whatever category map it wants to test against.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "index.html");

const START_MARKER = "// A plain substring search over exercise names";
const END_MARKER = "function renderExerciseModalSearch(query) {";

export function loadExerciseSearch(categories) {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadExerciseSearch: could not find the picker search helpers in " +
        "templates/index.html -- the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);
  const factory = new Function(
    "EXERCISE_CATEGORIES",
    `${source}\nreturn { exSearchTerms, exSearchCategoryNames, EX_SEARCH_TERM_ALIASES, EX_SEARCH_CATEGORY_ALIASES };`
  );
  return factory(categories);
}
