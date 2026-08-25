// Extracts the REAL fetchJson()/fetchWithSignal() pair out of
// static/coaching.js and evaluates it, rather than testing a hand-copied
// duplicate. Same marker-extraction harness (and same rationale) as
// loadCoachingRateSlider.js: coaching.js is one big IIFE with no module
// boundary, so slicing by source markers is the option available.
//
// If the markers stop matching, extraction throws loudly instead of
// silently testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACHING_PATH = path.join(__dirname, "..", "..", "static", "coaching.js");

const START_MARKER = "const REQUEST_TIMEOUT_MS = 45000;";
const END_MARKER = "function el(html) {";

export function readCoachingSource() {
  return readFileSync(COACHING_PATH, "utf-8");
}

export function extractSource() {
  const source = readCoachingSource();
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadCoachingFetchJson: could not find the fetchJson block in static/coaching.js -- " +
        "the extraction markers moved or the code was renamed/removed. Update the markers in loadCoachingFetchJson.js."
    );
  }
  return source.slice(start, end);
}

/** Evaluates the extracted block and returns its fetchJson. */
export function loadFetchJson() {
  const factory = new Function(`${extractSource()}\nreturn fetchJson;`);
  return factory();
}
