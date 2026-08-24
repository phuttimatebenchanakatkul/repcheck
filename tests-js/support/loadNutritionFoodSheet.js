// Loads the REAL food-search bottom-sheet view out of templates/nutrition.html:
// renderModalDefaultSections() (the Recent / Favorites / Custom tab branches),
// scopeSegHtml() (the segmented control), createFoodRowHtml() (the "Create a
// food" row), foodRowHtml()/relogRowEntry() (the data-food vs
// data-relog-entry decision), renderModalResults() (the live-search view that
// must NOT render the segmented control), showModal() (which resets the scope
// back to "recent" on every fresh open), and the delegated modalResultsEl
// click handler that owns [data-scope-tab], [data-create-food],
// [data-relog-entry] and [data-custom-index].
//
// Same extraction-by-source-marker approach as loadNutritionCreateForm.js /
// loadNutritionSwipeDelete.js: non-contiguous regions of the template are
// stitched together and evaluated in one `new Function` factory, so the tests
// exercise the shipped source rather than a hand-copied duplicate of it. No
// marker is a comment added for the tests' benefit -- every one is a line the
// page needs anyway, so extraction can't drift from working code.
//
// Pulled in as real code rather than stubbed, because the behaviour under
// test IS these functions composing:
//   * foodByName            -- decides data-food vs data-relog-entry
//   * entryTotals/scaledMacros -- the macros a data-relog-entry row shows
//   * getRecentFoods/latestEntryForFood/getTopPicksForHour -- the Recent list
//   * renderModalResults    -- the query view, incl. the empty-query handoff
// Only leaf helpers that live far outside the sheet (foodIconHtml,
// customFoodIconMarkup, offResultRowHtml), the network call (fetchOffResults),
// and the navigation the click handler performs (closeModal,
// openCreateFoodModal, openRelogConfirmModal, ...) are injected as parameters.
//
// Concatenation order among the regions doesn't matter for the function
// declarations: the factory body runs top to bottom once, so every
// const/let/function is initialized before any returned function is called.
// The click-handler region is the one piece that *executes* at factory time
// (it registers the listener), and it only reads modalScope/modalOffResults
// when a click actually fires.
//
// If any marker below stops matching, extraction throws immediately and
// loudly rather than silently testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { installSuggestions } from "./loadSuggestions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "nutrition.html");

const REGIONS = [
  {
    // FOOD_LIBRARY itself is a Jinja interpolation (`{{ food_library | tojson }}`)
    // so it can't be extracted -- it's injected instead, and foodByName reads
    // it. That makes "is this name in the library?" (the whole input to
    // relogRowEntry) a per-test fixture rather than a stubbed-out decision.
    name: "foodByName (the FOOD_LIBRARY lookup relogRowEntry branches on)",
    start: "  function foodByName(name) {",
    end: "  function iconForFood(name) {",
  },
  {
    name: "entryTotals/scaledMacros (macros a data-relog-entry row renders from)",
    start: "  function entryTotals(entry) {",
    end: "  // ---------- Goals UI ----------",
  },
  {
    name: "toIsoDate (day-bucketing key for getTopPicksForHour)",
    start: "  function toIsoDate(date) {",
    end: "  function startOfWeek(date) {",
  },
  {
    name: "history-derived suggestions (allLoggedEntries/getRecentFoods/latestEntryForFood/getTopPicksForHour)",
    start: "  function allLoggedEntries() {",
    end: "  // ---------- Add-food / add-ingredient modal ----------",
  },
  {
    // Ends AT `function closeModal()` so closeModal stays injectable as a
    // spy -- the click handler's branches are asserted by whether they
    // close the sheet, and the real closeModal reaches window.closeBottomSheet.
    name: "showModal (resets modalScope to \"recent\" on every fresh open)",
    start: "  function showModal() {",
    end: "  function closeModal() {",
  },
  {
    name: "HEART_* / macroLineFrom / relogRowEntry / foodRowHtml / scopeSegHtml / createFoodRowHtml / renderModalDefaultSections",
    start: "  const HEART_OUTLINE = ",
    end: "  // ---------- Open Food Facts online search (extends FOOD_LIBRARY) ----------",
  },
  {
    name: "escapeHtml/sanitizeBarcodeDigits/escapeAttr",
    start: "  function escapeHtml(text) {",
    end: "  function offResultRowHtml(result, index) {",
  },
  {
    name: "customFoodToResult/customFoodRowHtml (the rows the Custom tab renders)",
    start: "  function customFoodToResult(food) {",
    end: "  // Opens the same result screen a barcode/photo scan produces,",
  },
  {
    // Starts at scoreFoodMatch so the region also carries the
    // modalOffDebounceId/modalOffResults/MODAL_MAX_RESULTS state
    // renderModalResults reads and writes.
    name: "scoreFoodMatch..renderModalResults (the live-query view)",
    start: "  function scoreFoodMatch(name, q, qWordCount) {",
    end: "  // Event delegation on the results container:",
  },
  {
    name: "delegated modalResultsEl click handler ([data-scope-tab], [data-create-food], [data-relog-entry], [data-custom-index], ...)",
    start: "  modalResultsEl.addEventListener(\"click\", (event) => {",
    end: "  modalSearchInput.addEventListener(\"input\"",
  },
];

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  return REGIONS.map(({ name, start, end }) => {
    const s = html.indexOf(start);
    const e = html.indexOf(end);
    if (s === -1 || e === -1 || e <= s) {
      throw new Error(
        `loadNutritionFoodSheet: could not find region "${name}" in templates/nutrition.html -- ` +
          "the extraction markers moved or the code was renamed/reordered. Update start/end markers."
      );
    }
    return html.slice(s, e);
  }).join("\n");
}

/**
 * Evaluates the real food-sheet functions against fresh mocks. Every call gets
 * its own DOM (a real #modal-food-results div plus a real search input, both
 * attached to document.body so delegated clicks bubble exactly as they do in
 * the page) and its own module state, so tests can run in any order without
 * bleeding into each other.
 *
 * `t` is the identity-style stub the other loaders use ({ t: (key) => key }),
 * which additionally makes the assertions check WHICH i18n key each label
 * uses -- en/th presence of those keys is covered by
 * tests/test_i18n_key_parity.py.
 *
 * @param {object}   opts
 * @param {object}   opts.initialLog   nutrition log keyed by ISO date (drives getRecentFoods/getTopPicksForHour/latestEntryForFood)
 * @param {object[]} opts.library      stands in for FOOD_LIBRARY: [{ name, calories, protein, fat, carbs }]
 * @param {string[]} opts.favorites    favorited food names
 * @param {object[]} opts.customFoods  this user's own created foods (GET /api/custom-foods shape)
 * @param {object}   opts.modalMode    { type: "add-food" } | { type: "quickadd", topPicksHour } | { type: "add-ingredient", entryId }
 * @param {number}   opts.pendingHour  the hour the sheet was opened from ("top picks" hour for add-food)
 * @param {object[]} opts.offResults   what the debounced Open Food Facts fetch resolves with
 */
export function loadNutritionFoodSheet({
  initialLog = {},
  library = [],
  favorites: favoriteNames = [],
  customFoods: initialCustomFoods = [],
  modalMode = { type: "add-food" },
  pendingHour = null,
  offResults = [],
} = {}) {
  const source = extractSource();
  // nutrition.html's getRecentFoods/getTopPicksForHour delegate to
  // RepCheckSuggestions (static/suggestions.js), which the page gets from
  // base.html -- the extracted source expects it as a global here too.
  installSuggestions();

  const log = JSON.parse(JSON.stringify(initialLog));
  const FOOD_LIBRARY = library.slice();
  const favorites = new Set(favoriteNames);
  // Passed by reference and mutated in place, never reassigned -- matches how
  // nutrition.html's own `customFoods.unshift(data.food)` updates it.
  const customFoods = initialCustomFoods.slice();

  const modalResultsEl = document.createElement("div");
  modalResultsEl.id = "modal-food-results";
  const modalSearchInput = document.createElement("input");
  modalSearchInput.id = "modal-food-search";
  const modalOverlay = document.createElement("div");
  modalOverlay.id = "nl-modal-overlay";
  document.body.append(modalOverlay, modalSearchInput, modalResultsEl);

  const calls = {
    closeModal: 0,
    openCreateFoodModal: 0,
    openQuickMacroModal: 0,
    openScannedResultModal: [],
    openRelogConfirmModal: [],
    openLogAmountModal: [],
    addIngredientToEntry: [],
    toggleFavorite: [],
    fetchOffResults: [],
  };

  const factory = new Function(
    "log",
    "FOOD_LIBRARY",
    "favorites",
    "customFoods",
    "modalResultsEl",
    "modalSearchInput",
    "modalOverlay",
    "modalMode",
    "pendingHour",
    "foodIconHtml",
    "customFoodIconMarkup",
    "offResultRowHtml",
    "RepCheckI18n",
    "fetchOffResults",
    "closeModal",
    "openCreateFoodModal",
    "openQuickMacroModal",
    "openScannedResultModal",
    "openRelogConfirmModal",
    "openLogAmountModal",
    "addIngredientToEntry",
    "toggleFavorite",
    `${source}
    // Makes the closeModal-clears-pendingHour ordering real inside the
    // harness. nutrition.html's own closeModal() sets pendingHour = null, so a
    // handler that closed the sheet BEFORE reading the hour would pass an
    // hour of null in the page while still looking correct against a spy that
    // never clears it. Reassigning the parameter rebinds what the already-
    // registered click handler resolves at call time.
    const __injectedCloseModal = closeModal;
    closeModal = function () { pendingHour = null; __injectedCloseModal(); };
    return {
      showModal, renderModalDefaultSections, renderModalResults,
      scopeSegHtml, createFoodRowHtml, foodRowHtml, relogRowEntry,
      customFoodRowHtml, customFoodToResult,
      getRecentFoods, getTopPicksForHour, latestEntryForFood,
      scaledMacros, foodByName,
      get modalScope() { return modalScope; },
      set modalScope(value) { modalScope = value; },
    };`
  );

  const result = factory(
    log,
    FOOD_LIBRARY,
    favorites,
    customFoods,
    modalResultsEl,
    modalSearchInput,
    modalOverlay,
    modalMode,
    pendingHour,
    (name) => `<img alt="${name}">`,
    (emoji) => `<span class="cf-icon">${emoji || ""}</span>`,
    (res, i) => `<button type="button" class="nl-food-row" data-off-index="${i}">${res.food_name}</button>`,
    { t: (key) => key },
    async (query) => { calls.fetchOffResults.push(query); return offResults; },
    () => { calls.closeModal++; },
    () => { calls.openCreateFoodModal++; },
    () => { calls.openQuickMacroModal++; },
    (res) => { calls.openScannedResultModal.push(res); },
    // Records the hour too: the bug this path fixed was an ORDERING one
    // ("capture before closeModal() clears it"), so a spy that drops the
    // second argument would stay green through a regression.
    (entry, hour) => { calls.openRelogConfirmModal.push({ entry, hour }); },
    (name, hour) => { calls.openLogAmountModal.push({ name, hour }); },
    (entryId, name) => { calls.addIngredientToEntry.push({ entryId, name }); },
    (name) => { calls.toggleFavorite.push(name); }
  );

  result.log = log;
  result.FOOD_LIBRARY = FOOD_LIBRARY;
  result.favorites = favorites;
  result.customFoods = customFoods;
  result.modalResultsEl = modalResultsEl;
  result.modalSearchInput = modalSearchInput;
  result.modalOverlay = modalOverlay;
  result.calls = calls;
  return result;
}

/**
 * The library-list rows, in render order -- the rows foodRowHtml() built,
 * whether they came out as data-food or data-relog-entry. Custom-food rows
 * ([data-custom-index]) and online results ([data-off-index]) share the
 * .nl-food-row class but are NOT these, so they're excluded.
 */
export function libraryRows(el) {
  return [...el.querySelectorAll(".nl-food-list [data-food], .nl-food-list [data-relog-entry]")];
}

/** The visible food names of the library rows, in render order. */
export function rowNames(el) {
  return libraryRows(el).map((r) => r.querySelector(".nl-food-row-name").textContent);
}

/** One row by its visible name, whichever tap-hook attribute it carries. */
export function rowByName(el, name) {
  return libraryRows(el).find((r) => r.querySelector(".nl-food-row-name").textContent === name) || null;
}

/** The rendered macro line of a row ("240 kcal", "18P / 7F / 24C"), or null. */
export function rowMacroText(row) {
  const cal = row.querySelector(".nl-frm-cal");
  const macros = row.querySelector(".nl-frm-macros");
  return cal && macros ? { cal: cal.textContent, macros: macros.textContent } : null;
}

/** The visible names of the custom-food rows, in render order. */
export function customRowNames(el) {
  return [...el.querySelectorAll("[data-custom-index]")].map(
    (r) => r.querySelector(".nl-food-row-name").textContent
  );
}

/** The labels of the segmented control's tabs, in render order. */
export function tabLabels(el) {
  return [...el.querySelectorAll("[data-scope-tab]")].map((t) => t.textContent.trim());
}

/** Which segmented-control tab is rendered as selected. */
export function activeTab(el) {
  const active = [...el.querySelectorAll("[data-scope-tab]")].filter((t) => t.classList.contains("is-active"));
  return active.length === 1 ? active[0].dataset.scopeTab : active.map((t) => t.dataset.scopeTab);
}
