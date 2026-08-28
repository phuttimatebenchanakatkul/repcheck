// static/streak.js's seedFromServer() back-fills server-recorded activity
// (challenge attempts, form analyses, ...) asynchronously, well after each
// page's own first render. Home, Challenges, and the Streaks page all have
// to redraw once that lands, or a user whose only activity today was a
// challenge attempt would see a stale zero streak until their next
// navigation. Each page wires this by listening for
// RepCheckStreak.UPDATED_EVENT and re-running its own render function.
//
// (home.html used to be in this list. Its hero showed the streak flame and
// a week strip; that whole card was replaced by the Analyze one, so there
// is no streak display left on Home to keep fresh.)
//
// This is a source-contract test (regex against the shipped template),
// same approach as tests-js/streakMarkCallSites.test.js -- it can't drive
// the actual async back-fill without a browser, but it pins the wiring so
// a typo'd event name or an accidentally-dropped listener fails loudly
// instead of silently leaving the UI stale.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(root, "..", ...parts), "utf-8");

describe("pages redraw when the streak's server back-fill lands", () => {
  // home.html is deliberately absent: its hero is the Analyze card now
  // and shows no streak at all, so it has nothing to redraw. Challenges
  // and the Streaks page are the remaining displays.

  it("challenges.html listens for RepCheckStreak.UPDATED_EVENT and calls renderHeroTop", () => {
    expect(read("templates", "challenges.html")).toMatch(
      /document\.addEventListener\(RepCheckStreak\.UPDATED_EVENT,\s*renderHeroTop\)/
    );
  });

  it("streaks.html listens for RepCheckStreak.UPDATED_EVENT and calls render", () => {
    expect(read("templates", "streaks.html")).toMatch(
      /document\.addEventListener\(RepCheckStreak\.UPDATED_EVENT,\s*render\)/
    );
  });
});
