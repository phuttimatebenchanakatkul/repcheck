// Loads the REAL saveLog()/scheduleWorkoutDaySync()/pushWorkoutDay() out of
// templates/workouts.html and runs them in jsdom, rather than maintaining a
// hand-copied duplicate that can silently drift from what actually ships.
// Same source-marker extraction tradeoff as loadReviewStep.js (the function
// is inline in a server-rendered Jinja template with no module boundary).
//
// If the markers below stop matching, extraction throws immediately and
// loudly rather than silently testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "workouts.html");

const START_MARKER = "  function loadLog() {";
const END_MARKER = "  let log = loadLog();";

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadWorkoutSync: could not find loadLog()..saveLog() in templates/workouts.html -- " +
        "the extraction markers moved or the functions were renamed/reordered. Update START/END markers."
    );
  }
  // Inclusive of END_MARKER itself: saveLog()/pushWorkoutDay() close over
  // `log`, which that line declares -- excluding it would leave `log`
  // undefined in the extracted scope.
  return html.slice(start, end + END_MARKER.length);
}

/**
 * Evaluates the real sync functions against a fresh set of mocks. Every
 * call gets its own log/localStorage state so tests can run in any order
 * without bleeding into each other. `fetch` must be mocked by the caller
 * (vi.stubGlobal) before calling saveLog()/pushWorkoutDay() -- this harness
 * doesn't provide a default so tests are explicit about what the network
 * layer does.
 */
export function loadWorkoutSync({ initialLog = {}, selectedDate = "2026-08-13" } = {}) {
  const STORAGE_KEY = "repcheck_workout_log_v2";
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initialLog));

  const source = extractSource();
  // new Function's parameter list becomes the top-level scope of the
  // generated function body, so saveLog/etc. (declared inside `source`)
  // close over these exact mocks by name -- the same free variables they
  // reference as ambient globals in the real <script> block. `log` is
  // exposed via get/set accessors on the returned object since it's a
  // `let` inside the factory's closure, not something callers can import
  // a live reference to directly.
  const factory = new Function(
    "STORAGE_KEY",
    "selectedDate",
    `${source}
    return {
      saveLog, scheduleWorkoutDaySync, pushWorkoutDay, workoutDaySyncTimers, loadLog,
      get log() { return log; },
      set log(v) { log = v; },
    };`
  );

  // The extracted source registers a real `window.addEventListener("pagehide", ...)`
  // as a side effect of running (not just defining functions), and jsdom's
  // `window` persists across tests in the same file -- without capturing
  // and removing it, every call here leaks one more listener onto a
  // shared object, and a LATER test's pagehide dispatch would also
  // (harmlessly, since their own state is stale/drained, but not always
  // predictably) re-trigger every earlier call's listener too. Temporarily
  // wrap addEventListener just for this call to capture the "pagehide"
  // listener it registers, and expose a cleanup() the caller's
  // afterEach/cleanup can use to remove it.
  const nativeAddEventListener = window.addEventListener.bind(window);
  let capturedListener = null;
  window.addEventListener = (type, listener, options) => {
    if (type === "pagehide") capturedListener = listener;
    return nativeAddEventListener(type, listener, options);
  };
  let result;
  try {
    result = factory(STORAGE_KEY, selectedDate);
  } finally {
    window.addEventListener = nativeAddEventListener;
  }

  result.cleanup = () => {
    if (capturedListener) window.removeEventListener("pagehide", capturedListener);
  };
  return result;
}
