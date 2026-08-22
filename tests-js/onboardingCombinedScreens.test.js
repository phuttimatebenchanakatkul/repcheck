// Source-contract tests for the condensed 5-screen onboarding wizard:
// per-screen Next gating, the section() composition of the combined
// screens, scroll preservation on option taps, and the new step-title
// i18n keys. Same deliberate "assert the exact wiring exists in the raw
// source" approach as streakMarkCallSites.test.js -- jsdom can't cheaply
// drive the whole wizard IIFE (it binds to #ob-body/#ob-progress/.ob-card
// and calls render() at load), so the composed renderers are pinned
// structurally instead. What this catches: a combined screen that drops a
// question section, a gating predicate that stops requiring one of its
// screen's answers (letting users Next past an unanswered question), an
// option-tap handler that regresses to full render() (snapping the tall
// combined screens back to the top on every tap), or a step title key
// that's referenced but never defined. What it can NOT catch: the actual
// rendered DOM or real scroll behavior -- that was verified by hand in a
// real browser for this change [->E2E].

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(root, "..", ...parts), "utf-8");

const src = read("static", "onboarding.js");

// Everything from a renderer's declaration up to the next function
// declaration -- wide enough to hold the whole body, narrow enough that an
// assertion can't accidentally match a neighbouring renderer.
function fnBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `function ${name}() should exist in static/onboarding.js`).toBeGreaterThan(-1);
  const next = source.indexOf("\n  function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("about_you screen composes gender + weight + height and gates Next on gender only", () => {
  const body = fnBody(src, "renderAboutYouStep");

  it("appends all three question sections", () => {
    expect(body).toContain("renderGenderSection()");
    expect(body).toContain("renderWeightSection()");
    expect(body).toContain("renderHeightSection()");
  });

  it("gates on !!w.gender -- the rulers always hold an in-range value, so gender is the only answer that can be missing", () => {
    expect(body).toContain("renderWizardActions(!!w.gender)");
  });

  it("no question section appends its own actions row (each combined screen has exactly one shared row)", () => {
    for (const sectionFn of ["renderGenderSection", "renderWeightSection", "renderHeightSection", "renderBodyTypeSection"]) {
      expect(fnBody(src, sectionFn)).not.toContain("renderWizardActions");
    }
    for (const stepFn of ["renderAboutYouStep", "renderBodyActivityStep", "renderPreferencesStep"]) {
      const rows = fnBody(src, stepFn).match(/renderWizardActions\(/g) || [];
      expect(rows, `${stepFn} should append exactly one actions row`).toHaveLength(1);
    }
  });
});

describe("body_activity screen gates Next on both of its answers", () => {
  const body = fnBody(src, "renderBodyActivityStep");

  it("appends the body-type section and the activity choice grid", () => {
    expect(body).toContain("renderBodyTypeSection()");
    expect(body).toContain('"set-activity"');
  });

  it("requires body-fat range AND activity level before Next unlocks", () => {
    expect(body).toContain("renderWizardActions(!!w.bodyFatRangeId && !!w.activityLevel)");
  });

  it("keeps the wide-card layout keyed to this step (the body-type grid needs it)", () => {
    expect(src).toContain('wrapEl.classList.toggle("is-wide", currentStep() === "body_activity")');
  });
});

describe("preferences screen gates Next on all three of its answers", () => {
  const body = fnBody(src, "renderPreferencesStep");

  it("appends protein, diet, and distribution choice grids", () => {
    expect(body).toContain('"set-protein"');
    expect(body).toContain('"set-diet"');
    expect(body).toContain('"set-distribution"');
  });

  it("requires protein AND diet AND distribution before Next unlocks", () => {
    expect(body).toContain("renderWizardActions(!!w.proteinPreference && !!w.dietPreference && !!w.distribution)");
  });
});

describe("option taps preserve the page scroll position", () => {
  // A full render() replaces #ob-body's children and snaps the window back
  // to the top -- fine for one-question screens, unusable on the tall
  // combined ones. Every same-screen select action must therefore go
  // through renderKeepingScroll(), and navigation actions must NOT (a new
  // screen should start at the top).
  const handler = fnBody(src, "handleClick");

  // One branch = from its `action === "..."` check up to the next one
  // (set-gender's runs several lines; the rest are one-liners).
  function branchFor(action) {
    const start = handler.indexOf(`action === "${action}"`);
    expect(start, `handleClick should handle "${action}"`).toBeGreaterThan(-1);
    const next = handler.indexOf("action === ", start + 1);
    return handler.slice(start, next === -1 ? handler.length : next);
  }

  it.each(["set-aspiration", "set-gender", "set-body-type", "set-activity", "set-protein", "set-diet", "set-distribution"])(
    "%s re-renders via renderKeepingScroll()",
    (action) => {
      expect(branchFor(action)).toContain("renderKeepingScroll()");
    }
  );

  it.each(["start", "back", "next", "back-to-days"])("navigation action %s uses a plain render()", (action) => {
    const firstRenderCall = branchFor(action).match(/render(KeepingScroll)?\(\)/);
    expect(firstRenderCall).not.toBeNull();
    expect(firstRenderCall[0]).toBe("render()");
  });

  it("renderKeepingScroll() saves scrollY before render() and restores it after", () => {
    const body = fnBody(src, "renderKeepingScroll");
    expect(body).toMatch(/const y = window\.scrollY;\s*\n\s*render\(\);\s*\n\s*window\.scrollTo\(0, y\);/);
  });

  it("set-gender still invalidates a body-fat range from the other gender's table", () => {
    // Matters more in the combined flow: body_activity's Next re-locks on
    // this reset when the user goes Back and switches gender -- without it
    // a stale opposite-gender range id flows into the generated profile.
    expect(branchFor("set-gender")).toContain("bodyFatRangesFor(value).some((r) => r.id === w.bodyFatRangeId)");
  });
});

describe("the combined-screen step titles exist in both locales", () => {
  // tests/test_i18n_key_parity.py already guarantees en/th parity for
  // every key that exists -- what it can NOT catch is a key referenced by
  // onboarding.js that's missing from BOTH tables (t() would render the
  // raw key into the page in every language). So pin existence here, in
  // each locale block, for the four keys this change introduced.
  const i18n = read("static", "i18n.js");
  const enBlock = i18n.slice(i18n.indexOf("    en: {"), i18n.indexOf("    th: {"));
  // Bounded at the first function after the th table, not end-of-file --
  // ~95 lines of runtime code (getLang/t/etc.) follow the tables, and an
  // unbounded slice would let a key string in that code satisfy the
  // "defined in Thai" check without a th translation existing.
  const thStart = i18n.indexOf("    th: {");
  const thEnd = i18n.indexOf("function ", thStart);
  const thBlock = i18n.slice(thStart, thEnd === -1 ? i18n.length : thEnd);
  const NEW_KEYS = [
    "onboarding.step.aboutYou",
    "onboarding.step.height",
    "onboarding.step.bodyActivity",
    "onboarding.step.preferences",
  ];

  it.each(NEW_KEYS)("%s is defined in English and Thai", (key) => {
    expect(enBlock).toContain(`"${key}":`);
    expect(thBlock).toContain(`"${key}":`);
  });

  it("onboarding.js actually uses each new key (no dead translations, no stale references)", () => {
    for (const key of NEW_KEYS) {
      expect(src).toContain(`"${key}"`);
    }
  });
});
