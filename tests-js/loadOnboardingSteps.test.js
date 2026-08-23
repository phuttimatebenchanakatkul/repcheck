// Guards that the extraction itself stays honest. If static/onboarding.js
// changes shape enough that the markers no longer find their targets, every
// test in tests-js/onboardingSteps.test.js would silently test stale or
// empty code without this -- so it fails loudly and specifically instead.
import { describe, expect, it } from "vitest";
import { extractSource } from "./support/loadOnboardingSteps.js";

describe("extractSource", () => {
  it("finds the STEPS array and every visibility helper", () => {
    const source = extractSource();
    expect(source).toContain("const STEPS = [");
    expect(source).toContain("function shouldSkipStep(step) {");
    expect(source).toContain("function visibleSteps() {");
    expect(source).toContain("function nextVisibleIndex(fromIndex) {");
    expect(source).toContain("function prevVisibleIndex(fromIndex) {");
    expect(source).toContain("function lastVisibleIndex() {");
  });
});
