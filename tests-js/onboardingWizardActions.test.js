// Behavioural cover for the "More questions below" cue. The Python suite
// (tests/test_onboarding_scroll_cue.py) pins the SHAPE of the code; this
// pins what the code actually RENDERS, on every step, from the real STEPS
// list -- so a live-wiring break that still matches the regexes (a missing
// call paren, an id typo, a reordered STEPS) fails here instead of shipping.
import { describe, expect, it } from "vitest";
import {
  extractSource,
  renderActionsForStep,
  stepIds,
} from "./support/loadOnboardingWizardActions.js";

const cue = (el) => el.querySelector(".ob-scroll-cue");

describe("extractSource", () => {
  it("finds renderWizardActions and everything it depends on", () => {
    const source = extractSource();
    expect(source).toContain("const STEPS = [");
    expect(source).toContain("function el(html) {");
    expect(source).toContain("function currentStep() {");
    expect(source).toContain("const CUE_STEPS = [");
    expect(source).toContain("function renderWizardActions(canProceed) {");
  });
});

describe("the More-questions-below cue", () => {
  it("renders on the two multi-question screens", () => {
    for (const step of ["body_activity", "preferences"]) {
      const actions = renderActionsForStep(step);
      const pill = cue(actions);
      expect(pill, `${step} should carry the cue`).not.toBeNull();
      expect(pill.dataset.action).toBe("scroll-more");
      expect(pill.textContent).toContain("onboarding.moreBelow");
    }
  });

  it("renders on NO other step", () => {
    const { STEPS, CUE_STEPS } = stepIds();
    const others = STEPS.filter((s) => !CUE_STEPS.includes(s));
    // Guard the guard: if STEPS ever shrinks to just the cue steps this
    // test would vacuously pass, so assert there is something to check.
    expect(others.length).toBeGreaterThan(0);
    for (const step of others) {
      expect(cue(renderActionsForStep(step)), `${step} must not claim more questions`).toBeNull();
    }
  });

  it("covers exactly the screens that ask more than one question", () => {
    const { CUE_STEPS } = stepIds();
    expect([...CUE_STEPS].sort()).toEqual(["body_activity", "preferences"]);
  });

  it("still renders Next on every step, and Back on all but the first", () => {
    const { STEPS } = stepIds();
    for (const step of STEPS) {
      const actions = renderActionsForStep(step);
      expect(actions.querySelector('[data-action="next"]'), step).not.toBeNull();
      const back = actions.querySelector('[data-action="back"]');
      if (STEPS.indexOf(step) === 0) expect(back, step).toBeNull();
      else expect(back, step).not.toBeNull();
    }
  });

  it("disables Next when the screen is not answered yet", () => {
    expect(renderActionsForStep("preferences", false).querySelector('[data-action="next"]').disabled).toBe(true);
    expect(renderActionsForStep("preferences", true).querySelector('[data-action="next"]').disabled).toBe(false);
  });
});
