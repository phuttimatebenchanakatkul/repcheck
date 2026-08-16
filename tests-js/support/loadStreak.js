// Loads the REAL static/streak.js into the jsdom global and hands back
// the window.RepCheckStreak it installs -- the same file the app ships,
// not a hand-copied duplicate that could drift from it.
//
// Unlike the other loaders in this folder, streak.js is a standalone
// static file rather than a script embedded in a template, so there's no
// marker-extraction to do: it just gets evaluated. It IS re-evaluated per
// test, though, because the module snapshots localStorage into its active
// -dates Set at load time -- so each test seeds storage first, then loads.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STREAK_PATH = path.join(__dirname, "..", "..", "static", "streak.js");

const source = readFileSync(STREAK_PATH, "utf-8");

/**
 * Seeds localStorage with `storage` ({ key: value-to-be-JSON-stringified },
 * or a raw string to simulate a corrupt entry), then evaluates streak.js.
 *
 * By default the module is loaded logged-out so its one-shot
 * /api/activity/dates back-fill is a no-op; pass { loggedIn: true } (with
 * global.fetch stubbed) to exercise that path.
 */
export function loadStreak(storage = {}, { loggedIn = false } = {}) {
  localStorage.clear();
  sessionStorage.clear();
  Object.entries(storage).forEach(([key, value]) => {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  });
  window.REPCHECK_LOGGED_IN = loggedIn;
  delete window.RepCheckStreak;
  // eslint-disable-next-line no-eval
  (0, eval)(source);
  return window.RepCheckStreak;
}

/** ISO date string for a day `offset` days from `from`, in LOCAL time -- the
 *  same calendar the module itself counts in. */
export function isoDaysFrom(from, offset) {
  const d = new Date(from);
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
