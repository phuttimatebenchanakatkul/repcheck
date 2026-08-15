// Loads the REAL toggleCheckinFlag()/renderCheckinFlagGrid() out of
// static/coaching.js and runs them in jsdom, rather than a hand-copied
// duplicate that can silently drift from what actually ships. Mirrors
// loadCoachingRateSlider.js's identical extraction-by-source-markers
// harness -- see that file's header for the full rationale.
//
// Unlike renderRateSlider() (a standalone function), these are CoachingApp
// class methods that read/write `this.checkin` and call `this.render()`.
// Object-literal method shorthand (`{ toggleCheckinFlag(flagKey, dateIso) { ... } }`)
// uses the exact same syntax as a class body method, so the extracted
// source slices in unmodified and can be called with `.call(fakeThis, ...)`.
//
// If the markers below stop matching, extraction throws immediately and
// loudly (see ../checkinContextFlags.test.js) rather than silently
// testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACHING_PATH = path.join(__dirname, "..", "..", "static", "coaching.js");

const TOGGLE_START_MARKER = "toggleCheckinFlag(flagKey, dateIso) {";
const TOGGLE_END_MARKER = "setCheckinPhoto(angle, file) {";
const GRID_START_MARKER = "renderCheckinFlagGrid(flagKey, action) {";
const GRID_END_MARKER = "ckSectionHead(chipClass, iconSvg, title, sub) {";

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `loadCheckinFlags: could not find ${label} in static/coaching.js -- ` +
        "the extraction markers moved or the code was renamed/removed. Update the markers in loadCheckinFlags.js."
    );
  }
  // The method's own closing brace is already the last real content
  // before endMarker (endMarker is the *next* method's opening line) --
  // just trim the trailing whitespace/comments in between.
  return source.slice(start, end).trimEnd();
}

export function extractSource() {
  const source = readFileSync(COACHING_PATH, "utf-8");
  const toggle = sliceBetween(source, TOGGLE_START_MARKER, TOGGLE_END_MARKER, "toggleCheckinFlag()");
  const grid = sliceBetween(source, GRID_START_MARKER, GRID_END_MARKER, "renderCheckinFlagGrid()");
  return `${toggle},\n${grid}`;
}

/**
 * Evaluates the real toggleCheckinFlag()/renderCheckinFlagGrid() against a
 * fresh fake `this`. Every call gets its own factory and fake context, so
 * tests can run in any order without bleeding state into each other.
 */
export function loadCheckinFlags() {
  const source = extractSource();
  const factory = new Function("RepCheckI18n", `return {\n${source}\n};`);
  const methods = factory({ locale: () => "en-US" });
  return methods; // { toggleCheckinFlag, renderCheckinFlagGrid }
}
