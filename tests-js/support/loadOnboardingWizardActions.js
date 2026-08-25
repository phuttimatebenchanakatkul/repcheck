// Loads the REAL renderWizardActions (plus CUE_STEPS, STEPS, currentStep
// and el) out of static/onboarding.js and renders it against an injected
// wizard state, so the "More questions below" cue can be asserted on the
// actual markup instead of on a regex over the source.
//
// The sibling loadOnboardingSteps.js stops at `const w = {`, which is above
// renderWizardActions -- so it cannot reach this code. Rather than widen
// that extractor (its consumers only want the step list), this pulls the
// four slices renderWizardActions needs and stitches them together.
//
// Why behavioural and not just source regex: tests/test_onboarding_scroll_cue.py
// pins the shape of the code (the conditional exists, CUE_STEPS holds the
// right two ids). It cannot catch a live-wiring break -- `CUE_STEPS.includes(
// currentStep)` without the call parens still matches every regex there, and
// would silently drop the cue from every screen. Rendering the function is
// what proves the branch actually fires on the right step.
//
// If any marker below stops matching, extraction throws immediately and
// loudly (see ../loadOnboardingWizardActions.test.js) rather than silently
// testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONBOARDING_PATH = path.join(__dirname, "..", "..", "static", "onboarding.js");

// [startMarker, endMarker] pairs, in the order they are stitched together.
// endMarker is exclusive and is the first thing that follows the slice.
const SLICES = [
  ["const STEPS = [", "  // \"goal_weight\" only makes sense"],
  ["function el(html) {", "  // ---------- State ----------"],
  ["function currentStep() {", "  function renderProgress() {"],
  ["const CUE_STEPS = [", "  // ---------- \"More questions below\" cue ----------"],
];

export function extractSource() {
  const source = readFileSync(ONBOARDING_PATH, "utf-8");
  return SLICES.map(([startMarker, endMarker]) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(
        `loadOnboardingWizardActions: could not extract the block between ` +
          `"${startMarker}" and "${endMarker}" in static/onboarding.js -- the ` +
          `extraction markers moved or the code was renamed/removed. Update ` +
          `SLICES in loadOnboardingWizardActions.js.`
      );
    }
    return source.slice(start, end);
  }).join("\n");
}

/**
 * Renders the real renderWizardActions for a given step id and returns the
 * resulting element. `t` is stubbed to echo its key, so assertions key off
 * the i18n key rather than any one language's copy.
 *
 * Every call builds its own factory, so tests can run in any order without
 * bleeding wizard state into each other (mirrors loadOnboardingSteps.js).
 */
export function renderActionsForStep(stepId, canProceed = true) {
  // One factory over a mutable `w`, so currentStep() and the isFirst branch
  // both read the step under test. Each call builds its own, so tests can
  // run in any order without bleeding state (mirrors loadOnboardingSteps.js).
  const w = { stepIndex: 0 };
  const api = build(w);
  const stepIndex = api.STEPS.indexOf(stepId);
  if (stepIndex === -1) {
    throw new Error(
      `loadOnboardingWizardActions: "${stepId}" is not in STEPS -- the step was ` +
        `renamed or removed, and CUE_STEPS in static/onboarding.js is now stale.`
    );
  }
  w.stepIndex = stepIndex;
  return api.renderWizardActions(canProceed);
}

/** The real STEPS and CUE_STEPS arrays, for tests that enumerate them. */
export function stepIds() {
  const { STEPS, CUE_STEPS } = build({ stepIndex: 0 });
  return { STEPS, CUE_STEPS };
}

function build(w) {
  const factory = new Function(
    "w",
    "t",
    `${extractSource()}
return { renderWizardActions, STEPS, CUE_STEPS };`
  );
  // `t` is stubbed to echo its key, so assertions key off the i18n key
  // rather than any one language's copy.
  return factory(w, (key) => key);
}
