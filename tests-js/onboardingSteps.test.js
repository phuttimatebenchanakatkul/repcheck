// The condensed 7-screen onboarding wizard: pins the STEPS list itself and
// the maintain-skips-goal_weight visibility logic (shouldSkipStep/
// visibleSteps/nextVisibleIndex/prevVisibleIndex/lastVisibleIndex), which
// nothing else in the suite exercises. These helpers drive the progress
// dots, Next/Back navigation, and the "back-to-days" retry jump, so a
// regression here strands users on a skipped screen or draws the wrong
// dot count. Runs the REAL code via extraction (see
// support/loadOnboardingSteps.js), not a copy.
import { describe, expect, it } from "vitest";
import { loadOnboardingSteps } from "./support/loadOnboardingSteps.js";

describe("STEPS", () => {
  it("is exactly the seven condensed screens, in order", () => {
    const { STEPS } = loadOnboardingSteps();
    expect(STEPS).toEqual(["aspiration", "gender", "measurements", "goal_weight", "body_activity", "preferences", "distribution"]);
  });

  it("spreads the ten questions as evenly as seven screens allow -- no screen carries three", () => {
    // aspiration 1, gender 1, measurements 2 (weight+height), goal_weight 1,
    // body_activity 2 (body type+activity), preferences 2 (protein+diet),
    // distribution 1 = 10 questions over 7 screens. Ten does not divide by
    // seven, so three-of-two-plus-four-of-one is the flattest split there is.
    const QUESTIONS_PER_STEP = {
      aspiration: 1, gender: 1, measurements: 2, goal_weight: 1,
      body_activity: 2, preferences: 2, distribution: 1,
    };
    const { STEPS } = loadOnboardingSteps();
    const counts = STEPS.map((s) => QUESTIONS_PER_STEP[s]);
    expect(counts).toHaveLength(7);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(Math.max(...counts) - Math.min(...counts)).toBe(1);
  });
});

describe("goal_weight visibility", () => {
  it("skips goal_weight only for maintain -- it's the same number as current weight by definition", () => {
    const maintain = loadOnboardingSteps({ aspiration: "maintain" });
    expect(maintain.shouldSkipStep("goal_weight")).toBe(true);
    expect(maintain.visibleSteps()).toEqual(["aspiration", "gender", "measurements", "body_activity", "preferences", "distribution"]);
  });

  it.each(["lose", "gain", null])("keeps all seven steps visible for aspiration=%s", (aspiration) => {
    const { visibleSteps, shouldSkipStep } = loadOnboardingSteps({ aspiration });
    expect(shouldSkipStep("goal_weight")).toBe(false);
    expect(visibleSteps()).toEqual(["aspiration", "gender", "measurements", "goal_weight", "body_activity", "preferences", "distribution"]);
  });

  it("never skips any other step, whatever the aspiration", () => {
    for (const aspiration of ["lose", "maintain", "gain", null]) {
      const { STEPS, shouldSkipStep } = loadOnboardingSteps({ aspiration });
      for (const step of STEPS.filter((s) => s !== "goal_weight")) {
        expect(shouldSkipStep(step)).toBe(false);
      }
    }
  });
});

describe("navigation over skipped steps", () => {
  // Indices into STEPS: 0=aspiration, 1=gender, 2=measurements,
  // 3=goal_weight, 4=body_activity, 5=preferences, 6=distribution.
  it("Next from measurements jumps over goal_weight straight to body_activity for maintain", () => {
    const { nextVisibleIndex } = loadOnboardingSteps({ aspiration: "maintain" });
    expect(nextVisibleIndex(2)).toBe(4);
  });

  it("Next from measurements lands on goal_weight for lose/gain", () => {
    for (const aspiration of ["lose", "gain"]) {
      const { nextVisibleIndex } = loadOnboardingSteps({ aspiration });
      expect(nextVisibleIndex(2)).toBe(3);
    }
  });

  it("Back from body_activity jumps over goal_weight back to measurements for maintain", () => {
    const { prevVisibleIndex } = loadOnboardingSteps({ aspiration: "maintain" });
    expect(prevVisibleIndex(4)).toBe(2);
  });

  it("Next off the last step walks past the end of STEPS (the generate trigger)", () => {
    // handleClick's "next" branch calls generateAndCalculate() when
    // nextVisibleIndex(...) >= STEPS.length -- pin that the index really
    // does escape the array from the final screen.
    const { STEPS, nextVisibleIndex } = loadOnboardingSteps({ aspiration: "maintain" });
    expect(nextVisibleIndex(STEPS.length - 1)).toBeGreaterThanOrEqual(STEPS.length);
  });

  it("lastVisibleIndex points at distribution regardless of aspiration (back-to-days retry jump)", () => {
    for (const aspiration of ["lose", "maintain", "gain"]) {
      const { STEPS, lastVisibleIndex } = loadOnboardingSteps({ aspiration });
      expect(STEPS[lastVisibleIndex()]).toBe("distribution");
    }
  });
});
