// Loads the REAL "Log food" confirm screen out of templates/nutrition.html:
// renderRelogConfirm() plus the ingredient editor it draws
// (afRelogIngredientRowsHtml/afIngredientMacrosText/wireAfRelogIngredients),
// and the helpers whose output the screen IS -- entryTotals/scaledMacros,
// donutChartHtml, escapeHtml, and the unit conversions the amount fields
// round-trip through.
//
// Same extraction-by-source-marker approach as loadNutritionFoodSheet.js:
// non-contiguous regions of the template are stitched together and evaluated
// in one `new Function` factory, so the tests exercise the shipped source
// rather than a hand-copied duplicate. Every marker is a line the page needs
// anyway, so extraction cannot drift from working code; if one stops matching,
// extraction throws loudly instead of silently testing stale source.
//
// Pulled in as real code rather than stubbed, because the behaviour under test
// IS these composing: typing an amount has to reach entryTotals(), which has
// to reach donutChartHtml(), or the sheet shows a calorie count that no longer
// matches what the "Log again" button will write. Only the leaves outside the
// screen -- foodIconHtml (the emoji/photo map) -- and the two exits
// (relogEntry, renderAfChoice) are injected, the exits as spies, since what
// relogEntry() is HANDED is the whole point of the draft copy.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "nutrition.html");

const REGIONS = [
  {
    name: "UNIT_FACTORS/gramsToUnit/unitToGrams/unitOptionsHtml (the amount field's unit round-trip)",
    start: "  const UNIT_FACTORS = { g: 1, oz: 28.3495, ml: 1 };",
    end: "  // Sane per-day bounds so goals can't be set to something physically",
  },
  {
    name: "entryTotals/scaledMacros (the numbers the donut and the total hint show)",
    start: "  function entryTotals(entry) {",
    end: "  // ---------- Goals UI ----------",
  },
  {
    name: "escapeHtml (ingredient names are Gemini-authored)",
    start: "  function escapeHtml(text) {",
    end: "  // Retail barcodes (EAN/UPC) are always numeric",
  },
  {
    name: "donutChartHtml (the ring that has to follow an edited amount)",
    start: "  function donutChartHtml(protein, fat, carbs, calories) {",
    end: "  function renderIngredientsPanel(entry) {",
  },
  {
    name: "renderRelogConfirm + the ingredient editor it wires",
    start: "  function renderRelogConfirm(original, hourForLog, onCancel) {",
    end: "  function renderAfChoice() {",
  },
];

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  return REGIONS.map(({ name, start, end }) => {
    const s = html.indexOf(start);
    const e = html.indexOf(end);
    if (s === -1 || e === -1 || e <= s) {
      throw new Error(
        `loadNutritionRelogConfirm: could not find region "${name}" in templates/nutrition.html -- ` +
          "the extraction markers moved or the code was renamed/reordered. Update start/end markers."
      );
    }
    return html.slice(s, e);
  }).join("\n");
}

/**
 * Renders the real confirm screen for one entry into a fresh #af-modal-body.
 *
 * @param {object} entry        the already-logged entry being re-logged (mutating it is the bug the draft copy exists to prevent)
 * @param {number} [hourForLog] the hour the sheet was pinned to, passed straight through to relogEntry
 * @returns harness handles: the body element, the spies, and small readers for
 *          the numbers on screen.
 */
export function loadNutritionRelogConfirm(entry, hourForLog) {
  const source = extractSource();

  const afModalBody = document.createElement("div");
  afModalBody.id = "af-modal-body";
  document.body.innerHTML = "";
  document.body.append(afModalBody);

  const calls = { relogEntry: [], renderAfChoice: 0 };

  const factory = new Function(
    "afModalBody",
    "foodIconHtml",
    "relogEntry",
    "renderAfChoice",
    `${source}
    return { renderRelogConfirm };`
  );

  const api = factory(
    afModalBody,
    // The real one prefers a curated photo over the emoji; neither is what
    // these tests are about, so it renders something stable and inert.
    (name) => `<span data-icon-for="${name}"></span>`,
    (draft, hour) => calls.relogEntry.push({ draft, hour }),
    () => { calls.renderAfChoice += 1; }
  );

  api.renderRelogConfirm(entry, hourForLog);

  const rows = () => [...afModalBody.querySelectorAll(".nl-ingredient-row")];
  return {
    afModalBody,
    calls,
    rows,
    names: () => rows().map((row) => row.querySelector(".nl-ingredient-name").textContent),
    amountInputs: () => [...afModalBody.querySelectorAll("[data-af-ingredient-index]")],
    unitSelects: () => [...afModalBody.querySelectorAll("[data-af-ingredient-unit-index]")],
    removeButtons: () => [...afModalBody.querySelectorAll("[data-af-remove-ingredient]")],
    macrosText: () => rows().map((row) => row.querySelector("[data-af-ing-macros]").textContent),
    donutCalories: () =>
      Number(afModalBody.querySelector(".mn-donut-calories").textContent),
    totalHint: () => document.getElementById("af-relog-total").textContent,
    logAgain: () => document.getElementById("af-relog-confirm-btn").click(),
    cancel: () => document.getElementById("af-relog-cancel-btn").click(),
  };
}
