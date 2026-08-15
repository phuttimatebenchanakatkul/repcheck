// Loads the REAL findEntry/deleteEntry/openDeleteConfirm/closeDeleteConfirm/
// wireSwipeToDelete out of templates/nutrition.html, same extraction-by-
// source-marker approach as loadWorkoutSync.js -- this is a near-identical
// port of workouts.html's swipe-to-delete, so the same testing tradeoff
// applies (inline script, no module boundary).
//
// The confirm-dialog wiring (openDeleteConfirm/closeDeleteConfirm's click/
// Escape/backdrop listeners) attaches at source-eval time, so the caller
// MUST have #nl-confirm-overlay/#nl-confirm-title/#nl-confirm-sub/
// #nl-confirm-cancel/#nl-confirm-delete already in the jsdom document
// before calling loadNutritionSwipeDelete() -- see buildConfirmOverlayDom().
//
// If the markers below stop matching, extraction throws immediately and
// loudly rather than silently testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "nutrition.html");

const START_MARKER = "  function findEntry(id) {";
const END_MARKER = "  function wireTimelineEvents() {";

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadNutritionSwipeDelete: could not find findEntry()..wireSwipeToDelete() in " +
        "templates/nutrition.html -- the extraction markers moved or the functions were " +
        "renamed/reordered. Update START/END markers."
    );
  }
  return html.slice(start, end);
}

// Mirrors the markup in templates/nutrition.html's confirm-before-delete
// overlay (id="nl-confirm-overlay" etc.) closely enough for
// openDeleteConfirm/closeDeleteConfirm's DOM lookups and listeners to work.
export function buildConfirmOverlayDom() {
  const overlay = document.createElement("div");
  overlay.id = "nl-confirm-overlay";
  overlay.innerHTML = `
    <div class="nl-confirm">
      <div class="nl-confirm-title" id="nl-confirm-title"></div>
      <div class="nl-confirm-sub" id="nl-confirm-sub"></div>
      <button type="button" id="nl-confirm-cancel">Cancel</button>
      <button type="button" id="nl-confirm-delete">Delete</button>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Evaluates the real findEntry/deleteEntry/openDeleteConfirm/
 * closeDeleteConfirm/wireSwipeToDelete functions against fresh mocks. Every
 * call gets its own log/EXPANDED/calls state so tests can run in any order
 * without bleeding into each other.
 *
 * `log` is passed by reference and mutated in place (nutrition.html's
 * deleteEntry does `log[dateForEntry] = ...`, never reassigns `log`
 * itself), so no get/set accessor dance is needed the way loadWorkoutSync.js
 * needs one for workouts.html's `let log = ...` reassignment.
 */
export function loadNutritionSwipeDelete({ initialLog = {}, selectedDate = "2026-08-15", timelineEl } = {}) {
  const source = extractSource();
  const log = JSON.parse(JSON.stringify(initialLog));
  const EXPANDED = new Set();
  const calls = { saveLog: 0, renderTimeline: 0, renderSummary: 0, persistRemoveLogEntry: [] };

  const factory = new Function(
    "log",
    "selectedDate",
    "EXPANDED",
    "saveLog",
    "renderTimeline",
    "renderSummary",
    "persistRemoveLogEntry",
    "RepCheckI18n",
    "timelineEl",
    `${source}
    return { findEntry, deleteEntry, openDeleteConfirm, closeDeleteConfirm, wireSwipeToDelete };`
  );

  const result = factory(
    log,
    selectedDate,
    EXPANDED,
    () => { calls.saveLog++; },
    () => { calls.renderTimeline++; },
    () => { calls.renderSummary++; },
    (date, id) => { calls.persistRemoveLogEntry.push({ date, id }); },
    { t: (key) => key },
    timelineEl
  );

  result.log = log;
  result.EXPANDED = EXPANDED;
  result.calls = calls;
  return result;
}
