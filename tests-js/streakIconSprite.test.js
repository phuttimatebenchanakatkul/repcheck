// The streak flame/trophy are an <svg><use href="#rc-flame"> pointing at a
// <symbol> sprite defined once in base.html. That indirection has a silent
// failure mode with no runtime error anywhere: if the sprite is deleted,
// renamed, or moved out of base.html, every <use> resolves to nothing and all
// call sites render an empty 23px box. Nothing throws, no console
// warning, no failing request -- the icons just quietly vanish. Same for the
// .rc-icon rule that sizes them: without it the <svg> has no intrinsic size.
//
// These are structural/source-contract tests, the same "assert the exact
// wiring exists in the right place in the raw source" approach
// streakMarkCallSites.test.js already uses, and for the same reason: jsdom
// does not resolve SVG <use> references, so it cannot tell a working sprite
// from a dangling one. What this catches: a deleted/renamed symbol, a typo'd
// href at any call site, the emoji being reintroduced, the sizing rule being
// dropped, and the flame losing the fill-rule that makes its knockout core a
// hole instead of a solid blob. What it can NOT catch: whether the rendered
// shape actually looks like a flame, or its computed size in a real browser
// -- that needs a browser pass [->E2E].

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(root, "..", ...parts), "utf-8");

// Every place a streak icon is referenced. coaching.js is in this list because
// it builds its badge as a JS template string and so cannot use a Jinja macro
// -- the sprite is the only definition that reaches it, which is exactly why
// deleting the sprite breaks it silently too. home.html is not in this list:
// its hero no longer shows a streak, so it has no icon reference to pin.
const CALL_SITES = [
  { file: ["templates", "streaks.html"], symbols: ["rc-flame", "rc-trophy"] },
  { file: ["templates", "challenges.html"], symbols: ["rc-flame"] },
  { file: ["static", "coaching.js"], symbols: ["rc-flame"] },
];

describe("base.html defines the streak icon sprite", () => {
  const src = read("templates", "base.html");

  it("defines both symbols, so every <use> in the app has a target", () => {
    expect(src).toContain('<symbol id="rc-flame"');
    expect(src).toContain('<symbol id="rc-trophy"');
  });

  it("keeps the flame's knockout core a hole, not a solid blob", () => {
    // The flame is one path holding the outer silhouette AND the inner core.
    // Without fill-rule="evenodd" the core fills solid and the icon reads as
    // an undifferentiated teardrop -- the exact shape that got rejected
    // during design. Pinned because it is a one-attribute silent regression.
    const flame = src.slice(src.indexOf('<symbol id="rc-flame"'));
    const flamePath = flame.slice(0, flame.indexOf("</symbol>"));
    expect(flamePath).toContain('fill-rule="evenodd"');
  });

  it("sizes and colors the icons from CSS rather than hardcoded attributes", () => {
    // currentColor is what makes the icons follow --text and flip with the
    // theme toggle. A hardcoded fill would strand them in one theme.
    const sprite = src.slice(src.indexOf('<symbol id="rc-flame"'));
    const spriteEnd = sprite.slice(0, sprite.lastIndexOf("</symbol>"));
    expect(spriteEnd).toContain('fill="currentColor"');
    expect(spriteEnd).not.toMatch(/fill="#[0-9a-fA-F]{3,6}"/);
  });
});

describe("style.css sizes the streak icons", () => {
  const src = read("static", "style.css");

  it("defines .rc-icon, without which the icons have no intrinsic size", () => {
    expect(src).toMatch(/\.rc-icon\s*\{/);
  });

  it("sizes .rc-icon in em so each call site scales from its own font-size", () => {
    // The remaining call sites render at 22px, 13px and 12px purely because
    // .rc-icon is relative. A px value here would flatten all four to one size.
    const rule = src.slice(src.search(/\.rc-icon\s*\{/));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toMatch(/width:\s*[\d.]+em/);
    expect(body).toMatch(/height:\s*[\d.]+em/);
  });
});

describe.each(CALL_SITES)("$file.1 references the sprite correctly", ({ file, symbols }) => {
  const src = read(...file);
  const spriteIds = (() => {
    const base = read("templates", "base.html");
    return [...base.matchAll(/<symbol id="(rc-[a-z]+)"/g)].map((m) => m[1]);
  })();

  it("uses the streak SVG instead of the OS emoji", () => {
    // The emoji rendered from whatever font the OS supplied, so the same
    // screen looked different per platform and could not be recolored.
    expect(src).not.toMatch(/[\u{1F525}\u{1F3C6}]/u);
  });

  it.each(symbols)("references #%s", (symbol) => {
    expect(src).toContain(`href="#${symbol}"`);
  });

  it("carries the .rc-icon class and an em size floor on every icon", () => {
    // Everything about the size hangs on the .rc-icon hook. An <svg> with no
    // width/height defaults to 300x150px, so a one-character typo in the class
    // does not degrade -- it detonates the layout. The class is asserted here
    // so CI catches the typo, and the width/height attributes are a runtime
    // floor for the same failure (CSS beats presentation attributes, so they
    // change nothing whenever the stylesheet actually loaded).
    const icons = [...src.matchAll(/<svg\b[^>]*\bclass="([^"]*)"[^>]*>/g)]
      .filter((m) => m[0].includes("#rc-") || m[1].includes("rc-icon"));
    const uses = [...src.matchAll(/<svg\b[^>]*>\s*<use href="#rc-/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const tag of uses.map((m) => m[0])) {
      expect(tag).toContain('class="rc-icon"');
      expect(tag).toMatch(/width="1em"/);
      expect(tag).toMatch(/height="1em"/);
    }
  });

  it("has no <use> pointing at a symbol base.html does not define", () => {
    // A typo'd href fails silently -- nothing throws, the icon is just blank.
    const refs = [...src.matchAll(/href="#(rc-[a-z-]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(spriteIds).toContain(ref);
  });
});

describe("the streaks page centers its icons", () => {
  const src = read("templates", "streaks.html");

  it("flex-centers .st-stat-icon now that its child is a block <svg>", () => {
    // The emoji was an inline glyph and centered via text-align. An <svg>
    // block does not, so without this the icons sit left of their number.
    const rule = src.slice(src.indexOf(".st-stat-icon {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/align-items:\s*center/);
    expect(body).toMatch(/justify-content:\s*center/);
  });
});
