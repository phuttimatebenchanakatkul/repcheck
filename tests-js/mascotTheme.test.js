// The mascot's CSS contract (static/style.css).
//
// static/mascot.js paints entirely through custom properties so one drawing
// serves both themes. That makes the tokens load-bearing in a way no JS test
// can see: mascot.test.js asserts every fill is a var(), but a var() pointing
// at a token nobody declared resolves to nothing and the mascot renders
// invisible -- on ONE theme only, with the whole JS suite still green.
//
// That is not hypothetical. The light-theme values were changed twice while
// building this (near-black was too heavy, then the detail grey was on the
// wrong side of the body grey and washed the sweatband out), and a stray
// comment terminator during one of those edits would have silently killed
// every rule below it.
//
// So: assert the tokens exist in BOTH theme blocks, that the two greys are
// actually distinct within each theme, and that the block still parses.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "static/style.css"), "utf8");

// Grab a top-level block by its exact selector, up to the first closing brace
// at column 0 -- these blocks are flat variable lists, so no nesting to worry
// about.
function block(selector) {
  const start = css.indexOf(selector + " {");
  expect(start, `${selector} block should exist in style.css`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  expect(end, `${selector} block should be closed`).toBeGreaterThan(start);
  return css.slice(start, end);
}

function tokenValue(scope, name) {
  const m = scope.match(new RegExp(name + ":\\s*(#[0-9a-fA-F]{3,8})\\s*;"));
  return m ? m[1].toLowerCase() : null;
}

const THEMES = [
  { label: "light", selector: ":root" },
  { label: "dark", selector: ':root[data-theme="dark"]' },
];

describe("mascot color tokens", () => {
  THEMES.forEach(({ label, selector }) => {
    it(`declares both mascot greys on the ${label} theme`, () => {
      const scope = block(selector);
      expect(tokenValue(scope, "--rc-mascot-body"), `--rc-mascot-body missing from ${label}`).toBeTruthy();
      expect(tokenValue(scope, "--rc-mascot-detail"), `--rc-mascot-detail missing from ${label}`).toBeTruthy();
    });

    // Props (sweatband, crumbs, speed lines, podium outline) are drawn on top
    // of the body. Same value for both means they vanish into it.
    it(`keeps body and detail distinct on the ${label} theme`, () => {
      const scope = block(selector);
      expect(tokenValue(scope, "--rc-mascot-body")).not.toBe(tokenValue(scope, "--rc-mascot-detail"));
    });
  });

  // The eyes and mouth are cut-outs painted in var(--card-bg), so that token
  // has to exist in both themes too or the face fills solid.
  THEMES.forEach(({ label, selector }) => {
    it(`declares --card-bg on the ${label} theme, which the eyes are cut from`, () => {
      expect(tokenValue(block(selector), "--card-bg"), `--card-bg missing from ${label}`).toBeTruthy();
    });
  });
});

describe("mascot layout classes", () => {
  // emptyState() emits exactly these; a renamed class is a silently unstyled
  // block rather than an error.
  ["rc-empty", "rc-empty-art", "rc-empty-title", "rc-empty-q", "rc-empty-sub"].forEach((cls) => {
    it(`styles .${cls}`, () => {
      expect(css).toMatch(new RegExp("\\." + cls + "\\s*[,{]"));
    });
  });
});

describe("style.css integrity", () => {
  // A stray */ truncates every rule after it. Cheap to check, and it caught a
  // real mistake while the mascot tokens were being edited.
  it("has balanced comment markers", () => {
    expect((css.match(/\/\*/g) || []).length).toBe((css.match(/\*\//g) || []).length);
  });
});
