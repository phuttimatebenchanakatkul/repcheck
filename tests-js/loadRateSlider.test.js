// Guards that the extraction itself stays honest. If static/onboarding.js
// changes shape enough that the markers no longer find their targets, every
// other test in tests-js/rateSlider.test.js would silently test stale or
// empty code without this -- so it fails loudly and specifically instead.
import { describe, expect, it } from "vitest";
import { extractSource } from "./support/loadRateSlider.js";

describe("extractSource", () => {
  it("finds the rate constants, el() helper, and renderRateSlider()", () => {
    const source = extractSource();
    expect(source).toContain("const RATE_REFERENCE_WEIGHT_KG = 75;");
    expect(source).toContain("function el(html) {");
    expect(source).toContain("function renderRateSlider({ isLose, value, weightKg, onChange }) {");
  });
});
