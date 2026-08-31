// Loads the REAL renderRateSlider() out of static/coaching.js and runs it
// in jsdom, rather than a hand-copied duplicate that can silently drift
// from what actually ships. Mirrors loadRateSlider.js's identical harness
// for onboarding.js's copy of this same function -- see that file's header
// for the full rationale (an inline wizard <script> with no module
// boundary means extraction by source markers is the option available).
//
// If the markers below stop matching, extraction throws immediately and
// loudly (see ../loadCoachingRateSlider.test.js) rather than silently
// testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACHING_PATH = path.join(__dirname, "..", "..", "static", "coaching.js");

const CONST_START_MARKER = "const RATE_REFERENCE_WEIGHT_KG = 75;";
const CONST_END_MARKER = "// ---------- Small local helpers ----------";
const SLIDER_START_MARKER = "function renderRateSlider({ isLose, value, weightKg, onChange }) {";
const SLIDER_END_MARKER = "function daysSince(dateIso) {";
const EL_START_MARKER = "function el(html) {";
const EL_END_MARKER = "// Small fixed-position confirmation/error toast";

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `loadCoachingRateSlider: could not find ${label} in static/coaching.js -- ` +
        "the extraction markers moved or the code was renamed/removed. Update the markers in loadCoachingRateSlider.js."
    );
  }
  return source.slice(start, end);
}

export function extractSource() {
  const source = readFileSync(COACHING_PATH, "utf-8");
  const constants = sliceBetween(source, CONST_START_MARKER, CONST_END_MARKER, "the rate constants block");
  const slider = sliceBetween(source, SLIDER_START_MARKER, SLIDER_END_MARKER, "renderRateSlider()");
  const elHelper = sliceBetween(source, EL_START_MARKER, EL_END_MARKER, "el()");
  return `${constants}\n${slider}\n${elHelper}`;
}

/**
 * Evaluates the real renderRateSlider() against fresh mocks. Every call
 * gets its own factory, so tests can run in any order without bleeding
 * state into each other (mirrors loadRateSlider.js's per-call freshness).
 */
export function loadCoachingRateSlider() {
  // Small, real-copy I18N dict (not raw key passthrough) so a badge
  // assertion is checking the same text a user would actually see -- same
  // convention loadRateSlider.js's mock t() uses. Must match
  // static/i18n.js's English strings for these keys (shared with
  // onboarding.js's identical feature).
  const I18N = {
    "coaching.wizard.lossRate": "Rate of weight loss —",
    "coaching.wizard.gainRate": "Rate of weight gain —",
    "coaching.wizard.perWeek": "% / week",
    "coaching.wizard.perWeekLabel": "Per Week",
    "coaching.wizard.perMonthLabel": "Per Month",
    "coaching.wizard.percentBodyweightUnit": "% BW",
    "coaching.wizard.rateLost": "lost",
    "coaching.wizard.rateGained": "gained",
    "coaching.wizard.rateSlower": "Slower",
    "coaching.wizard.rateStandard": "Standard",
    "coaching.wizard.rateStandardRecommended": "Standard (Recommended)",
    "coaching.wizard.rateFaster": "Faster",
  };
  const t = (key, vars) => {
    let s = I18N[key] || key;
    if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
    return s;
  };
  const RepCheckUnits = {
    weightUnitLabel: () => "kg",
    // Mirrors the real kgToDisplay()'s "1 decimal, kg" rounding exactly --
    // this harness only ever tests kg mode, never lb.
    kgToDisplay: (kg) => Math.round(kg * 10) / 10,
  };

  const source = extractSource();
  const factory = new Function(
    "t",
    "RepCheckUnits",
    `${source}\nreturn { renderRateSlider };`
  );
  const { renderRateSlider } = factory(t, RepCheckUnits);
  return { renderRateSlider };
}
