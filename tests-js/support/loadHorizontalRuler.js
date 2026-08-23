// Loads the REAL renderHorizontalRuler() out of static/onboarding.js and
// runs it in jsdom, rather than a hand-copied duplicate that can silently
// drift from what actually ships. Extraction by source markers is the same
// tradeoff loadRateSlider.js / loadOnboardingSteps.js already make for the
// same reason (an inline wizard IIFE with no module boundary) -- see those
// files' headers for the full rationale.
//
// If the markers below stop matching, extraction throws immediately and
// loudly (see ../loadHorizontalRuler.test.js) rather than silently testing
// stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONBOARDING_PATH = path.join(__dirname, "..", "..", "static", "onboarding.js");

const EL_START_MARKER = "function el(html) {";
const EL_END_MARKER = "// ---------- State ----------";
const RULER_START_MARKER = "const HRULER_TICK_PX = 14;";
const RULER_END_MARKER = "function renderWeightSection() {";

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `loadHorizontalRuler: could not find ${label} in static/onboarding.js -- ` +
        "the extraction markers moved or the code was renamed/removed. Update the markers in loadHorizontalRuler.js."
    );
  }
  return source.slice(start, end);
}

export function extractSource() {
  const source = readFileSync(ONBOARDING_PATH, "utf-8");
  const elHelper = sliceBetween(source, EL_START_MARKER, EL_END_MARKER, "el()");
  const ruler = sliceBetween(source, RULER_START_MARKER, RULER_END_MARKER, "renderHorizontalRuler()");
  return `${elHelper}\n${ruler}`;
}

/**
 * Evaluates the real renderHorizontalRuler() against fresh mocks. Every
 * call gets its own factory, so tests can run in any order without
 * bleeding state into each other (mirrors loadRateSlider.js's per-call
 * freshness).
 *
 * jsdom has no layout, so getBoundingClientRect() is 0 everywhere and the
 * deferred sizer would compute a 0px pad. Tests that need the ruler
 * "seeded" therefore drive that step explicitly via seed() below rather
 * than relying on real measurement -- what is under test here is the
 * decode math and the write guards, not the pad geometry.
 */
export function loadHorizontalRuler() {
  const source = extractSource();
  const factory = new Function(`${source}\nreturn { renderHorizontalRuler };`);
  return factory();
}
