// Guards that the extraction itself stays honest. If templates/workouts.html
// changes shape enough that the markers no longer find their targets, every
// other test in tests-js/ would silently test stale or empty code without
// this -- so it fails loudly and specifically instead.
import { describe, expect, it } from "vitest";
import { extractSource } from "./support/loadReviewStep.js";

describe("extractSource", () => {
  it("finds both escape helpers and the review step function", () => {
    const source = extractSource();
    expect(source).toContain("function escapeHtml(text)");
    expect(source).toContain("function escapeAttr(text)");
    expect(source).toContain("function renderSplitStepReview()");
    expect(source).toContain("const DAY_ACCENTS");
  });
});
