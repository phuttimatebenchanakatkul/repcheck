// Loads the REAL static/suggestions.js into the jsdom global and hands back
// the window.RepCheckSuggestions it installs -- the same file the app
// ships, not a hand-copied duplicate. Same standalone-static-file approach
// as loadStreak.js; unlike streak.js this module snapshots nothing at load
// time (every function reads storage when called), but it is still
// re-evaluated per test so a test can never see another test's globals.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUGGESTIONS_PATH = path.join(__dirname, "..", "..", "static", "suggestions.js");

const source = readFileSync(SUGGESTIONS_PATH, "utf-8");

/**
 * Seeds localStorage with `storage` ({ key: value-to-be-JSON-stringified },
 * or a raw string to simulate a corrupt entry), then evaluates
 * suggestions.js.
 */
export function loadSuggestions(storage = {}) {
  localStorage.clear();
  Object.entries(storage).forEach(([key, value]) => {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  });
  delete window.RepCheckSuggestions;
  // eslint-disable-next-line no-eval
  (0, eval)(source);
  return window.RepCheckSuggestions;
}

/** Local-time timestamp for `hour`:`minute` on a day `offset` days from `from`. */
export function atHour(from, offset, hour, minute = 0) {
  const d = new Date(from);
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/**
 * Evaluates suggestions.js into the jsdom global WITHOUT touching
 * localStorage -- for harnesses that load some other piece of the app which
 * calls into RepCheckSuggestions (the food sheet's getRecentFoods /
 * getTopPicksForHour delegate to it), where clearing storage would wipe the
 * fixture that harness just seeded.
 */
export function installSuggestions() {
  delete window.RepCheckSuggestions;
  // eslint-disable-next-line no-eval
  (0, eval)(source);
  return window.RepCheckSuggestions;
}
