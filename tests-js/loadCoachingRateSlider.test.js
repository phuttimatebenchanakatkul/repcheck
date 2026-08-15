// Guards that the extraction itself stays honest. If static/coaching.js
// changes shape enough that the markers no longer find their targets,
// every other test in tests-js/coachingRateSlider.test.js would silently
// test stale or empty code without this -- so it fails loudly and
// specifically instead. Mirrors loadRateSlider.test.js's identical guard
// for onboarding.js's copy of this same function.
import { describe, expect, it } from "vitest";
import { extractSource } from "./support/loadCoachingRateSlider.js";

describe("extractSource (coaching.js)", () => {
  it("finds the rate constants, renderRateSlider(), and el()", () => {
    const source = extractSource();
    expect(source).toContain("const RATE_REFERENCE_WEIGHT_KG = 75;");
    expect(source).toContain("function renderRateSlider({ isLose, value, weightKg, onChange }) {");
    expect(source).toContain("function el(html) {");
  });
});
