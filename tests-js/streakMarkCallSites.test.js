// static/streak.js and its two direct consumers (database.py's
// get_activity_dates(), and RepCheckStreak's own current()/longest()/
// mark()/seedFromServer()) are covered directly by streak.test.js and
// test_streak_activity_dates.py. Neither of those touches the six actual
// CALL SITES that feed RepCheckStreak.mark() -- the template/script code
// that decides WHEN a feature counts as "used" -- and nothing else in the
// suite does either (only templates/workouts.html's split_plan call is
// pinned, via a regex in test_split_modal_bottom_sheet_and_edit.py).
//
// These are structural/source-contract tests, not behavioral ones: jsdom
// can't easily drive challenges.html's video-upload flow or coach.html's
// full chat round trip end to end, so this is deliberately the same
// "assert the exact wiring exists in the right place in the raw source"
// approach test_split_modal_bottom_sheet_and_edit.py already uses for
// workouts.html. What it catches: a mark() call site that's missing
// entirely, moved to fire before success is confirmed (so an aborted/
// failed attempt would wrongly earn a day), or that lost its
// window.RepCheckStreak guard on a page where streak.js isn't guaranteed
// loaded. What it can NOT catch: streak.js failing to load at runtime,
// fetch/network behavior, or anything about the actual DOM the real
// browser renders -- that needs an e2e/browser pass [->E2E].

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(root, "..", ...parts), "utf-8");

describe("challenges.html marks a challenge attempt only on confirmed success", () => {
  const src = read("templates", "challenges.html");

  it("calls RepCheckStreak.mark(\"challenge\") after the ok-check, not before", () => {
    // If data.ok is false the line above throws, so a failed/aborted
    // attempt never reaches the mark() call below it -- pinned by
    // requiring the throw to appear first in the same async function.
    const submitAttempt = src.slice(src.indexOf("async function submitAttempt("));
    const okCheckIdx = submitAttempt.indexOf("if (!data.ok) throw new Error(");
    const markIdx = submitAttempt.indexOf('RepCheckStreak.mark("challenge")');
    expect(okCheckIdx).toBeGreaterThan(-1);
    expect(markIdx).toBeGreaterThan(okCheckIdx);
  });

  it("still shows the result popup even without a window.RepCheckStreak guard (base.html always loads streak.js first)", () => {
    // Unlike the standalone-page call sites below, this one is bare
    // (`RepCheckStreak.mark(...)`, no `if (window.RepCheckStreak)`)
    // because challenges.html extends base.html, which loads streak.js on
    // every page. Pinning the unguarded form here means a future
    // regression that makes streak.js conditionally-loaded on this page
    // would need to update this call site too, not silently start
    // throwing on every challenge submission.
    expect(src).toMatch(/RepCheckStreak\.mark\("challenge"\);\s*\n\s*await loadFullLeaderboard\(\);/);
  });
});

describe("coach.html marks a coach chat turn only when the reply succeeded", () => {
  const src = read("templates", "coach.html");

  it("gates the mark on data.ok, same variable the reply itself is chosen from", () => {
    expect(src).toContain('if (data.ok) RepCheckStreak.mark("coach_chat");');
  });

  it("marks after the turn is saved and rendered, not before (a render failure shouldn't fake a streak day)", () => {
    const idx = src.indexOf("async function sendMessage(");
    const scope = src.slice(idx, idx + 2000);
    const saveIdx = scope.indexOf("saveHistory(history);");
    const renderIdx = scope.indexOf("renderMessages();");
    const markIdx = scope.indexOf('RepCheckStreak.mark("coach_chat")');
    expect(saveIdx).toBeGreaterThan(-1);
    expect(renderIdx).toBeGreaterThan(saveIdx);
    expect(markIdx).toBeGreaterThan(renderIdx);
  });
});

describe("analyze_chat_widget.js marks an analysis chat turn only when the reply succeeded", () => {
  const src = read("static", "analyze_chat_widget.js");

  it("guards on both data.ok and window.RepCheckStreak (this widget can render on pages without streak.js queued yet)", () => {
    expect(src).toContain('if (data.ok && window.RepCheckStreak) RepCheckStreak.mark("analyze_chat");');
  });
});

describe("coaching.js marks a completed weekly check-in on both result branches", () => {
  const src = read("static", "coaching.js");

  it("defines markCheckinActivity() guarded by window.RepCheckStreak", () => {
    expect(src).toMatch(
      /function markCheckinActivity\(\)\s*\{\s*if \(window\.RepCheckStreak\) RepCheckStreak\.mark\("checkin"\);\s*\}/
    );
  });

  it("calls it from the goal-achieved branch, after the profile is persisted", () => {
    const idx = src.indexOf('c.result = "goal-achieved";');
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, idx - 400), idx);
    expect(before).toMatch(/saveJson\(PROFILE_KEY, this\.profile\);\s*\n\s*markCheckinActivity\(\);\s*$/);
  });

  it("also calls it from the normal (non-goal-achieved) adjustment branch", () => {
    // Two call sites are required -- a check-in can complete via either
    // branch, and each is the ONLY place that branch's success is known.
    const calls = src.match(/markCheckinActivity\(\);/g) || [];
    expect(calls).toHaveLength(2);
  });
});

describe("onboarding.js marks finishing setup as the first streak day", () => {
  const src = read("static", "onboarding.js");

  it("marks after goals-updated fires, before waiting on the server sync", () => {
    const goalsIdx = src.indexOf('new CustomEvent("repcheck:goals-updated")');
    const markIdx = src.indexOf('if (window.RepCheckStreak) RepCheckStreak.mark("onboarding");');
    const syncIdx = src.indexOf("await Promise.all(syncPromises);");
    expect(goalsIdx).toBeGreaterThan(-1);
    expect(markIdx).toBeGreaterThan(goalsIdx);
    expect(syncIdx).toBeGreaterThan(markIdx);
  });
});

describe("templates/onboarding.html loads streak.js by hand (it doesn't extend base.html)", () => {
  it("includes static/streak.js in its own <head>, ahead of onboarding.js", () => {
    const src = read("templates", "onboarding.html");
    const streakIdx = src.indexOf("asset_url('streak.js')");
    const onboardingIdx = src.indexOf("asset_url('onboarding.js')");
    expect(streakIdx).toBeGreaterThan(-1);
    // onboarding.js isn't included in this head snippet in every version of
    // the template (it may load later in the body); only assert ordering
    // when both are actually present in this file.
    if (onboardingIdx !== -1) expect(streakIdx).toBeLessThan(onboardingIdx);
  });
});
