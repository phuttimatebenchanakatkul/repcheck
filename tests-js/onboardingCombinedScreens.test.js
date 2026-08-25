// Source-contract tests for the condensed 7-screen onboarding wizard:
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

describe("gender is its own screen again", () => {
  // It shared a screen with weight and height in 0.2.4.0. Three questions
  // on one screen -- two of them scroll wheels -- was reported as "too much
  // going on", so gender stands alone and the wheels pair up next door.
  const body = fnBody(src, "renderGenderStep");

  it("offers both options and nothing else", () => {
    expect(body).toContain('"set-gender"');
    expect(body).toContain("coaching.gender.male");
    expect(body).toContain("coaching.gender.female");
    expect(body).not.toContain("renderWeightSection");
    expect(body).not.toContain("renderHeightSection");
  });

  it("gates Next on an actual choice", () => {
    expect(body).toContain("renderWizardActions(!!w.gender)");
  });
});

describe("measurements screen pairs weight with height", () => {
  const body = fnBody(src, "renderMeasurementsStep");

  it("appends both ruler sections", () => {
    expect(body).toContain("renderWeightSection()");
    expect(body).toContain("renderHeightSection()");
  });

  it("leaves Next enabled -- both rulers always hold an in-range value, so nothing here can be unanswered", () => {
    expect(body).toContain("renderWizardActions(true)");
  });

  it("no question section appends its own actions row (each combined screen has exactly one shared row)", () => {
    for (const sectionFn of ["renderWeightSection", "renderHeightSection", "renderBodyTypeSection"]) {
      expect(fnBody(src, sectionFn)).not.toContain("renderWizardActions");
    }
    for (const stepFn of ["renderGenderStep", "renderMeasurementsStep", "renderBodyActivityStep", "renderPreferencesStep", "renderDistributionStep"]) {
      const rows = fnBody(src, stepFn).match(/renderWizardActions\(/g) || [];
      expect(rows, `${stepFn} should append exactly one actions row`).toHaveLength(1);
    }
  });
});

describe("both measurement rulers scroll horizontally", () => {
  // The reason is reachability, not looks. As vertical wheels these two
  // were vertical scroll containers covering the middle of the screen, so a
  // downward flick was swallowed by the wheel and the page never moved --
  // leaving Next below the fold and unreachable, while the flick silently
  // changed the value. A pan-x ruler cannot consume a vertical gesture.
  it("both go through the shared horizontal ruler", () => {
    for (const fn of ["renderWeightSection", "renderHeightSection"]) {
      expect(fnBody(src, fn)).toContain("renderHorizontalRuler(");
    }
  });

  it("no vertical scroll container survives anywhere in the wizard's markup", () => {
    expect(src).not.toContain("ob-weight-ruler-scroll");
    expect(src).not.toContain("ob-height-ruler-scroll");
  });

  it("the stylesheet pins the ruler to the horizontal axis", () => {
    const css = read("templates", "onboarding.html");
    const block = css.slice(css.indexOf(".ob-hruler-scroll {"), css.indexOf(".ob-hruler-scroll::-webkit-scrollbar"));
    expect(block).toContain("overflow-x: scroll");
    expect(block).toContain("overflow-y: hidden");
    expect(block).toContain("touch-action: pan-x");
  });

  it("the Next/Back row is sticky so it cannot sit below the fold on the tall screens", () => {
    const css = read("templates", "onboarding.html");
    const block = css.slice(css.indexOf(".ob-wizard-actions {"), css.indexOf(".ob-btn-primary, .ob-btn-secondary"));
    expect(block).toContain("position: sticky");
    expect(block).toContain("bottom: 0");
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

describe("preferences screen gates Next on both of its answers", () => {
  // It carried three questions until distribution moved to its own screen
  // -- the only screen in the wizard that ever did.
  const body = fnBody(src, "renderPreferencesStep");

  it("appends the protein and diet choice grids", () => {
    expect(body).toContain('"set-protein"');
    expect(body).toContain('"set-diet"');
  });

  it("no longer carries distribution", () => {
    expect(body).not.toContain('"set-distribution"');
    expect(body).not.toContain("coaching.wizard.stepDistribution");
  });

  it("requires protein AND diet before Next unlocks", () => {
    expect(body).toContain("renderWizardActions(!!w.proteinPreference && !!w.dietPreference)");
  });
});

describe("distribution is its own final screen", () => {
  const body = fnBody(src, "renderDistributionStep");

  it("is the last entry in STEPS, so it is the screen Next generates from", () => {
    const steps = src.slice(src.indexOf("const STEPS = ["), src.indexOf("const w = {"));
    expect(steps).toContain('"preferences", "distribution",');
  });

  it("asks the distribution question and nothing else", () => {
    expect(body).toContain('"set-distribution"');
    expect(body).not.toContain('"set-protein"');
    expect(body).not.toContain('"set-diet"');
  });

  it("uses the question itself as the big step label (one-question shape, like aspiration/gender)", () => {
    expect(body).toContain('ob-wizard-step-label">${t("coaching.wizard.stepDistribution")}');
    // No section() sub-heading -- that would repeat the title underneath it.
    expect(body).not.toContain("section(");
  });

  it("gates Next on an actual choice", () => {
    expect(body).toContain("renderWizardActions(!!w.distribution)");
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
    "onboarding.step.measurements",
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
