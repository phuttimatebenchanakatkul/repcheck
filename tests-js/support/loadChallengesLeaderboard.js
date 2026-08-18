// Loads the REAL lbRow/lbGap/renderLeaderboard() out of templates/challenges.html
// and runs it in jsdom, rather than maintaining a hand-copied duplicate that can
// silently drift from what actually ships. Same extraction-by-source-markers
// tradeoff as loadReviewStep.js -- the function is inline in a server-rendered
// Jinja template with no module boundary.
//
// If the markers below stop matching, extraction throws immediately and
// loudly rather than silently testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "challenges.html");

const START_MARKER = "function escapeHtml(text) {";
const END_MARKER = "// Default to Global -- everyone, not just friends";

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadChallengesLeaderboard: could not find escapeHtml()..renderLeaderboard() in " +
        "templates/challenges.html -- the extraction markers moved or the code was renamed. " +
        "Update START/END markers."
    );
  }
  return html.slice(start, end);
}

/**
 * Evaluates the real leaderboard-render source against a fresh set of mocks
 * and returns the callable pieces a test needs.
 */
export function loadChallengesLeaderboard() {
  const I18N = {
    "challenges.reps": "reps",
    "challenges.tied": "tied",
    "challenges.youLabel": "You",
    "challenges.of": "of {n}",
    "challenges.emptyTitle": "No attempts yet",
    "challenges.emptySub": "Be the first to set a score.",
  };
  function t(key, vars) {
    let s = I18N[key] || key;
    if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
    return s;
  }
  const mascotCalls = [];
  const RepCheckMascot = {
    emptyState(opts) {
      mascotCalls.push(opts);
      return `<div class="mascot-empty" data-pose="${opts.pose}">${opts.title}: ${opts.sub}</div>`;
    },
  };

  const source = extractSource();
  const factory = new Function(
    "t",
    "RepCheckMascot",
    `${source}\nreturn { lbRow, lbGap, renderLeaderboard, escapeHtml };`
  );
  const { lbRow, lbGap, renderLeaderboard, escapeHtml } = factory(t, RepCheckMascot);

  return { lbRow, lbGap, renderLeaderboard, escapeHtml, mascotCalls };
}
