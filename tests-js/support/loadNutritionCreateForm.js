// Loads the REAL renderAfCreateForm()/submitCustomFood()/afExtraServingsListHtml()
// (the "Create Food" af-modal screen) out of templates/nutrition.html, plus
// their real unitToGrams()/UNIT_FACTORS/UNIT_LABELS/unitOptionsHtml(),
// escapeHtml(), and lookupScannedBarcode()
// dependencies -- same extraction-by-source-marker approach as
// loadNutritionSwipeDelete.js/loadWorkoutSync.js.
//
// Five non-contiguous regions of the file are stitched together (unit
// helpers live near the top of the script; the afPreviewUrl/afResult module
// state and lookupScannedBarcode() live in the middle; the create-form
// functions and escapeHtml/escapeAttr live much further down)
// rather than one contiguous slice, since renderAfCreateForm/submitCustomFood/
// lookupScannedBarcode genuinely depend on all of them at render/submit/scan
// time -- concatenation order among them doesn't matter: the factory body
// runs once, top to bottom, before any returned function is ever called, so
// every const/function is already initialized by the time a test invokes
// renderAfCreateForm/submitCustomFood/lookupScannedBarcode.
//
// The afPreviewUrl/afResult region is kept deliberately narrow (just the two
// `let` declarations lookupScannedBarcode assigns into) rather than pulling
// in everything between them and lookupScannedBarcode itself -- that ~480
// line span in between declares its own `const afModalBody = ...` (among
// other things), which would collide with the factory's afModalBody
// parameter and throw a duplicate-declaration SyntaxError.
//
// If any marker below stops matching, extraction throws immediately and
// loudly rather than silently testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "nutrition.html");

const REGIONS = [
  {
    name: "unit helpers (UNIT_FACTORS/UNIT_LABELS/unitToGrams/unitOptionsHtml)",
    start: "  const UNIT_FACTORS = { g: 1, oz: 28.3495, ml: 1 };",
    end: "  // Sane per-day bounds so goals can't be set to something physically",
  },
  {
    // Includes escapeAttr: the barcode field interpolates into an HTML
    // attribute, so renderAfCreateForm calls escapeAttr (not escapeHtml,
    // which leaves quotes intact and would let a quote break out of the
    // attribute) -- extraction has to reach past it or the render throws.
    name: "escapeHtml/sanitizeBarcodeDigits/escapeAttr",
    start: "  function escapeHtml(text) {",
    end: "  function offResultRowHtml(result, index) {",
  },
  {
    name: "afPreviewUrl/afResult module state (assigned into by lookupScannedBarcode)",
    start: "  let afPreviewUrl = null;",
    end: "  let afNote = ",
  },
  {
    name: "lookupScannedBarcode (client-side live-scan digit-stripping)",
    start: "  async function lookupScannedBarcode(barcode) {",
    end: "  // Grams-per-unit for the amount editor below.",
  },
  {
    name: "CUSTOM_FOOD_EMOJIS..submitCustomFood (the create-food form itself)",
    start: "  const CUSTOM_FOOD_EMOJIS = [",
    end: "  // A mirror-symmetric heart path",
  },
];

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  return REGIONS.map(({ name, start, end }) => {
    const s = html.indexOf(start);
    const e = html.indexOf(end);
    if (s === -1 || e === -1 || e <= s) {
      throw new Error(
        `loadNutritionCreateForm: could not find region "${name}" in templates/nutrition.html -- ` +
          "the extraction markers moved or the code was renamed/reordered. Update start/end markers."
      );
    }
    return html.slice(s, e);
  }).join("\n");
}

/**
 * Evaluates the real create-food form functions against fresh mocks. Every
 * call gets its own DOM (a fresh afModalBody div, NOT attached to
 * document.body -- renderAfCreateForm only ever touches its own subtree via
 * afModalBody.innerHTML / afModalBody.querySelector-style getElementById
 * calls, so this mirrors how the real af-modal is scoped) and its own
 * afCreate* module state, so tests can run in any order without bleeding
 * into each other.
 *
 * `fetch` is NOT mocked here -- callers must vi.stubGlobal("fetch", ...)
 * before calling submitCustomFood(), same convention as loadWorkoutSync.js.
 */
export function loadNutritionCreateForm() {
  const source = extractSource();
  const afModalBody = document.createElement("div");
  afModalBody.id = "af-modal-body";
  document.body.appendChild(afModalBody);

  // afModalTitle records the last title renderAfCreateForm asked the
  // af-modal's sticky header to show -- the real setAfModalTitle lives
  // next to that header's element, well outside the extracted regions.
  const calls = { renderAfChoice: 0, renderAfResult: 0, customFoodToResult: 0, afModalTitle: null };

  const factory = new Function(
    "afModalBody",
    "renderAfChoice",
    "selectedDate",
    "log",
    "saveLog",
    "renderTimeline",
    "renderSummary",
    "persistLogEntry",
    "closeAnalyzeFoodModal",
    "customFoodToResult",
    "renderAfResult",
    "setAfModalTitle",
    `${source}
    return {
      renderAfCreateForm, submitCustomFood, afExtraServingsListHtml, wireAfServingRemoveButtons,
      unitToGrams, UNIT_FACTORS, UNIT_LABELS, lookupScannedBarcode,
      get afCreateExtraServings() { return afCreateExtraServings; },
      get afCreateEmoji() { return afCreateEmoji; },
      get afCreateBarcode() { return afCreateBarcode; },
      get customFoods() { return customFoods; },
    };`
  );

  const result = factory(
    afModalBody,
    () => { calls.renderAfChoice++; },
    "2026-08-15",
    {},
    () => {},
    () => {},
    () => {},
    async () => {},
    () => {},
    (food) => { calls.customFoodToResult++; return { food_name: food.name, ingredients: [] }; },
    () => { calls.renderAfResult++; },
    (text) => { calls.afModalTitle = text; }
  );

  result.afModalBody = afModalBody;
  result.calls = calls;
  return result;
}
