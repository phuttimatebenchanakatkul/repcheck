// Loads the REAL per-exercise sets/reps editor wiring out of
// templates/workouts.html and runs it in jsdom, rather than maintaining a
// hand-copied duplicate that can silently drift from what actually ships.
// Same extraction-by-source-marker approach as loadReviewStep.js, applied
// to the editor's own block (it lives earlier in the file, next to the
// pre-existing exercise-detail modal wiring, not inside
// renderSplitStepReview itself).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "workouts.html");

const START_MARKER = "// ---------- Split wizard review step: per-exercise sets/reps editor ----------";
const END_MARKER = "function loadLog() {";

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadExercisePrescriptionEditor: could not find the editor wiring in " +
        "templates/workouts.html -- the extraction markers moved. Update START/END markers."
    );
  }
  return html.slice(start, end);
}

// Mirrors the static <div id="split-ex-editor-overlay">...</div> markup in
// templates/workouts.html -- the extracted source calls document.getElementById
// for each of these ids at module-eval time, so they must already exist.
const EDITOR_MARKUP = `
  <div class="split-ex-editor-overlay" id="split-ex-editor-overlay">
    <div class="split-ex-editor-modal">
      <div class="split-ex-editor-head">
        <div class="split-ex-editor-title-row">
          <span class="split-ex-editor-icon" id="split-ex-editor-icon"></span>
          <span class="split-ex-editor-title" id="split-ex-editor-title"></span>
        </div>
        <button type="button" class="split-ex-editor-close" id="split-ex-editor-close" aria-label="Close">&times;</button>
      </div>
      <div class="split-ex-editor-body">
        <div class="split-ex-editor-stats">
          <div class="split-ex-editor-stat" id="split-ex-editor-sets-box">
            <input type="number" class="split-ex-editor-input" id="split-ex-editor-sets-input" min="1" max="20">
            <div class="split-ex-editor-label" id="split-ex-editor-sets-label"></div>
            <div class="split-ex-editor-base" id="split-ex-editor-sets-base"></div>
          </div>
          <div class="split-ex-editor-stat" id="split-ex-editor-reps-box">
            <input type="number" class="split-ex-editor-input" id="split-ex-editor-reps-input" min="1" max="50">
            <div class="split-ex-editor-label" id="split-ex-editor-reps-label"></div>
            <div class="split-ex-editor-base" id="split-ex-editor-reps-base"></div>
          </div>
        </div>
        <button type="button" class="split-ex-editor-reset" id="split-ex-editor-reset"></button>
        <button type="button" class="split-ex-editor-howto" id="split-ex-editor-howto"></button>
      </div>
    </div>
  </div>
`;

/**
 * Evaluates the real editor wiring against a fresh set of mocks and returns
 * the callable pieces a test needs. `prescriptions` is a plain object the
 * test owns -- getPrescription()/getSetsRepsDefault() are backed by it, so
 * assertions can read the same store the editor just wrote to.
 */
export function loadExercisePrescriptionEditor() {
  document.body.innerHTML = EDITOR_MARKUP;

  const calls = { howtoOpenedWith: null, rerendered: false };

  const I18N = {
    "workouts.wizard.sets": "Sets",
    "workouts.wizard.reps": "Reps",
    "workouts.wizard.standardValue": "Standard: {n}",
    "workouts.wizard.resetToStandard": "Reset to standard",
    "workouts.wizard.howToPerform": "How to perform →",
  };
  const RepCheckI18n = {
    t(key, vars) {
      let s = I18N[key] || key;
      if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
      return s;
    },
  };

  function exerciseIconHtml(name) {
    return `<img alt="" src="/static/icon-for-${name}.svg">`;
  }
  function openExerciseDetailModal(name) {
    calls.howtoOpenedWith = name;
  }
  function getSetsRepsDefault(name) {
    return /curl|pushdown|raise/i.test(name) ? { sets: 3, reps: 10 } : { sets: 4, reps: 8 };
  }
  const prescriptions = {};
  // JSON.stringify, matching the real prescriptionKey() -- see its comment
  // in templates/workouts.html for why a "::"-joined string collides on
  // free-text day labels/exercise names.
  function getPrescription(label, name) {
    const key = JSON.stringify([label, name]);
    if (!prescriptions[key]) prescriptions[key] = getSetsRepsDefault(name);
    return prescriptions[key];
  }
  function reviewRerenderCarousel() {
    calls.rerendered = true;
  }
  // Real implementation, not a stub -- document.body.innerHTML = EDITOR_MARKUP
  // above already makes the overlay a direct child of body, so this is a
  // harmless no-op here, exactly like it would be in production once the
  // overlay's already been moved.
  function moveOverlayToBody(el) {
    if (el && el.parentElement !== document.body) document.body.appendChild(el);
  }

  const source = extractSource();
  const factory = new Function(
    "RepCheckI18n",
    "exerciseIconHtml",
    "openExerciseDetailModal",
    "getPrescription",
    "getSetsRepsDefault",
    "reviewRerenderCarousel",
    "moveOverlayToBody",
    `${source}\nreturn { openExercisePrescriptionEditor, closeExercisePrescriptionEditor };`
  );

  const { openExercisePrescriptionEditor, closeExercisePrescriptionEditor } = factory(
    RepCheckI18n,
    exerciseIconHtml,
    openExerciseDetailModal,
    getPrescription,
    getSetsRepsDefault,
    reviewRerenderCarousel,
    moveOverlayToBody
  );

  return {
    openExercisePrescriptionEditor,
    closeExercisePrescriptionEditor,
    prescriptions,
    getPrescription,
    calls,
    overlay: document.getElementById("split-ex-editor-overlay"),
    setsInput: document.getElementById("split-ex-editor-sets-input"),
    repsInput: document.getElementById("split-ex-editor-reps-input"),
    setsBox: document.getElementById("split-ex-editor-sets-box"),
    repsBox: document.getElementById("split-ex-editor-reps-box"),
    setsBase: document.getElementById("split-ex-editor-sets-base"),
    repsBase: document.getElementById("split-ex-editor-reps-base"),
    resetBtn: document.getElementById("split-ex-editor-reset"),
    closeBtn: document.getElementById("split-ex-editor-close"),
    howtoBtn: document.getElementById("split-ex-editor-howto"),
    title: document.getElementById("split-ex-editor-title"),
  };
}
