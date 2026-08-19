// Loads the REAL renderSplitStepReview() out of templates/workouts.html and
// runs it in jsdom, rather than maintaining a hand-copied duplicate that can
// silently drift from what actually ships. The function is inline in a
// server-rendered Jinja template with no module boundary, so extraction by
// source markers is the option available without restructuring the app --
// the same tradeoff nutrition.html's Python tests already make (see
// tests/test_nutrition_name_escaping.py), just executed instead of pattern
// matched, because this file needs the code to actually run.
//
// If the markers below stop matching, extraction throws immediately and
// loudly (see ../loadReviewStep.test.js) rather than silently testing
// stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "workouts.html");

const START_MARKER = "// Accent tokens cycled across the split's unique day labels.";
const ESCAPE_START_MARKER = "function escapeHtml(text) {";
const ESCAPE_END_MARKER = "// ---------- Exercise detail modal";
const END_MARKER = "const SPLIT_VIEW_MONDAY_FIRST =";

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");

  const escStart = html.indexOf(ESCAPE_START_MARKER);
  const escEnd = html.indexOf(ESCAPE_END_MARKER);
  if (escStart === -1 || escEnd === -1 || escEnd <= escStart) {
    throw new Error(
      "loadReviewStep: could not find escapeHtml/escapeAttr in templates/workouts.html -- " +
        "the extraction markers moved or the helpers were removed. Update START/END markers."
    );
  }

  const reviewStart = html.indexOf(START_MARKER);
  const reviewEnd = html.indexOf(END_MARKER);
  if (reviewStart === -1 || reviewEnd === -1 || reviewEnd <= reviewStart) {
    throw new Error(
      "loadReviewStep: could not find renderSplitStepReview() in templates/workouts.html -- " +
        "the extraction markers moved or the function was renamed. Update START/END markers."
    );
  }

  return html.slice(escStart, escEnd) + "\n" + html.slice(reviewStart, reviewEnd);
}

/**
 * Evaluates the real review-step source against a fresh set of mocks and
 * returns the callable pieces a test needs. Every call gets its own DOM
 * nodes and its own splitWizard, so tests can run in any order without
 * bleeding state into each other.
 */
export function loadReviewStep({ generatedDays, generatedSchedule, rationale = null, suggestedSplitType = "ppl" } = {}) {
  document.body.innerHTML = `
    <div id="split-modal-title"></div>
    <div id="split-modal-body"></div>
  `;

  const calls = { closed: false, replanned: false };

  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const SPLIT_PLAN_KEY = "repcheck_split_plan_v1";
  const splitModalTitle = document.getElementById("split-modal-title");
  const splitModalBody = document.getElementById("split-modal-body");

  const I18N = {
    "workouts.wizard.assignWeekTitle": "Assign your week",
    "workouts.wizard.chooseWorkoutDays": "Choose which day you want to workout",
    "workouts.wizard.restDayNote": "Recovery day — nothing scheduled.",
    "workouts.wizard.howToPerform": "How to perform →",
    "workouts.wizard.whyThisSchedule": "Why this schedule:",
    "workouts.wizard.savePlan": "Save plan",
    "workouts.wizard.rest": "Rest",
    "workouts.wizard.aiChose": "The AI picked {split} for you",
  };
  const RepCheckI18n = {
    t(key, vars) {
      let s = I18N[key] || key;
      if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
      return s;
    },
  };

  function exerciseIconHtml() {
    return "\u{1F3CB}️";
  }
  function getSetsRepsText(name) {
    return /curl|pushdown|raise/i.test(name) ? "3 sets • 10-12 reps" : "4 sets • 8-10 reps";
  }
  // Deterministic stand-in for the real bucket logic (tested for real in
  // reviewStep.test.js's own getSetsRepsDefault-adjacent assertions isn't
  // needed here -- this harness only needs *a* stable default per name so
  // the carousel's "N×N" meta and the is-edited/reset behaviour have
  // something consistent to compare against).
  function getSetsRepsDefault(name) {
    return /curl|pushdown|raise/i.test(name) ? { sets: 3, reps: 10 } : { sets: 4, reps: 8 };
  }
  function exerciseDetail() {
    return { description: ["Controlled range of motion.", "Steady tempo."] };
  }
  function getSplitTypes() {
    return [{ id: "ppl", title: "Push / Pull / Legs" }];
  }
  function closeSplitModal() {
    calls.closed = true;
  }
  function renderTodaysPlanCard() {
    calls.replanned = true;
  }
  // Mirrors the real persistSplitPlan(plan) -- the localStorage write plus
  // the renderTodaysPlanCard() refresh, in one call -- since the save
  // handler now goes through it instead of doing both inline.
  function persistSplitPlan(plan) {
    try {
      localStorage.setItem(SPLIT_PLAN_KEY, JSON.stringify(plan));
    } catch (err) {}
    renderTodaysPlanCard();
  }
  // The real function opens a separate static modal that isn't part of this
  // harness's minimal DOM -- stubbed to just record what it was asked to
  // open, so review-step tests can assert the row wiring calls it with the
  // right (label, name) without pulling in the whole editor's own markup.
  function openExercisePrescriptionEditor(label, name) {
    calls.editorOpenedWith = { label, name };
  }

  const splitWizard = {
    suggestedSplitType,
    type: "ppl",
    daysPerWeek: generatedDays ? generatedDays.length : 0,
    goal: "hypertrophy",
    rationale,
    generatedDays,
    generatedSchedule,
  };

  const source = extractSource();
  // new Function's parameter list becomes the top-level scope of the
  // generated function body, so renderSplitStepReview (declared inside
  // `source`) closes over these exact mocks by name -- the same free
  // variables it references as ambient globals in the real <script> block.
  const factory = new Function(
    "WEEKDAY_NAMES",
    "SPLIT_PLAN_KEY",
    "splitModalTitle",
    "splitModalBody",
    "RepCheckI18n",
    "exerciseIconHtml",
    "getSetsRepsText",
    "getSetsRepsDefault",
    "exerciseDetail",
    "getSplitTypes",
    "closeSplitModal",
    "renderTodaysPlanCard",
    "persistSplitPlan",
    "openExercisePrescriptionEditor",
    "splitWizard",
    "splitModalGeneration",
    `${source}\nreturn { renderSplitStepReview, prescriptionKey, getPrescription };`
  );

  const { renderSplitStepReview, prescriptionKey, getPrescription } = factory(
    WEEKDAY_NAMES,
    SPLIT_PLAN_KEY,
    splitModalTitle,
    splitModalBody,
    RepCheckI18n,
    exerciseIconHtml,
    getSetsRepsText,
    getSetsRepsDefault,
    exerciseDetail,
    getSplitTypes,
    closeSplitModal,
    renderTodaysPlanCard,
    persistSplitPlan,
    openExercisePrescriptionEditor,
    splitWizard,
    0 // splitModalGeneration -- renderSplitStepReview() only increments this local copy; the harness doesn't need to observe it, just needs the free variable to resolve so the extracted source doesn't throw
  );

  return { renderSplitStepReview, prescriptionKey, getPrescription, splitModalBody, splitModalTitle, splitWizard, calls, SPLIT_PLAN_KEY };
}
