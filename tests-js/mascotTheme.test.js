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
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolved from this file, not process.cwd(), so the suite doesn't pass or
// fail based on which directory vitest was invoked from -- same reason
// support/loadMascot.js does it this way.
const CSS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static", "style.css");
const css = readFileSync(CSS_PATH, "utf8");

// Relative luminance, enough to compare two flat hex tokens.
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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

  // The three above all pass if you paste the dark values into the light
  // theme -- a white blob on a white card, invisible, suite green. That is
  // the actual regression this file exists to catch, so check the thing
  // that matters: the body has to be readable against the card it sits on,
  // in each theme independently.
  THEMES.forEach(({ label, selector }) => {
    it(`keeps the body readable against the card on the ${label} theme`, () => {
      const scope = block(selector);
      const ratio = contrast(tokenValue(scope, "--rc-mascot-body"), tokenValue(scope, "--card-bg"));
      expect(ratio, `${label}: body vs card is ${ratio.toFixed(2)}:1`).toBeGreaterThan(3);
    });
  });

  it("does not reuse one theme's greys on the other", () => {
    ["--rc-mascot-body", "--rc-mascot-detail"].forEach((tok) => {
      expect(tokenValue(block(":root"), tok), tok)
        .not.toBe(tokenValue(block(':root[data-theme="dark"]'), tok));
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
