// Loads the REAL step list + skip/navigation helpers out of
// static/onboarding.js (STEPS, shouldSkipStep, visibleSteps,
// nextVisibleIndex, prevVisibleIndex, lastVisibleIndex) and evaluates them
// against an injected wizard-state object, rather than a hand-copied
// duplicate that can silently drift from what actually ships. Extraction
// by source markers is the same tradeoff loadRateSlider.js /
// loadReviewStep.js already make for the same reason (an inline wizard
// IIFE with no module boundary) -- see those files' headers for the full
// rationale.
//
// If the markers below stop matching, extraction throws immediately and
// loudly (see ../loadOnboardingSteps.test.js) rather than silently testing
// stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONBOARDING_PATH = path.join(__dirname, "..", "..", "static", "onboarding.js");

const STEPS_START_MARKER = "const STEPS = [";
const STEPS_END_MARKER = "const w = {";

export function extractSource() {
  const source = readFileSync(ONBOARDING_PATH, "utf-8");
  const start = source.indexOf(STEPS_START_MARKER);
  const end = source.indexOf(STEPS_END_MARKER, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadOnboardingSteps: could not find the STEPS/skip-logic block in static/onboarding.js -- " +
        "the extraction markers moved or the code was renamed/removed. Update the markers in loadOnboardingSteps.js."
    );
  }
  return source.slice(start, end);
}

/**
 * Evaluates the real STEPS array and visibility helpers against a caller-
 * supplied wizard state (only `aspiration` matters to them). Every call
 * gets its own factory, so tests can run in any order without bleeding
 * state into each other (mirrors loadRateSlider.js's per-call freshness).
 */
export function loadOnboardingSteps(w = { aspiration: null }) {
  const source = extractSource();
  const factory = new Function(
    "w",
    `${source}\nreturn { STEPS, shouldSkipStep, visibleSteps, nextVisibleIndex, prevVisibleIndex, lastVisibleIndex };`
  );
  return factory(w);
}
