// Loads the REAL static/account_sync.js into the jsdom global -- same
// "evaluate the actual shipped file" tradeoff as support/loadStreak.js,
// since account_sync.js is also a standalone static file with no module
// boundary to import normally.
//
// Unlike loadStreak.js this module has real side effects the moment it's
// evaluated: it registers a document-level "submit" listener AND fires an
// unawaited fetch("/api/sync") whose .then() chain can itself call
// clearStreakSeedFlag() (on an account-owner mismatch) or push data back
// out over fetch/sendBeacon. Callers MUST stub `fetch` (vi.stubGlobal)
// before calling loadAccountSync() -- there's no default here, same
// convention as loadWorkoutSync.js.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_PATH = path.join(__dirname, "..", "..", "static", "account_sync.js");

const source = readFileSync(STATIC_PATH, "utf-8");

/**
 * Evaluates the real account_sync.js. Does NOT touch localStorage or
 * sessionStorage -- seed those yourself beforehand (the module reads
 * window.REPCHECK_LOGGED_IN, __repcheck_sync_owner_id, and the sync keys on
 * load, so pre-seeding matters for what its hydration pass does).
 *
 * Resolves once the module's own fetch("/api/sync").then().then() chain has
 * had a real macrotask turn to run (a couple of `await Promise.resolve()`
 * hops isn't reliably enough turns for a two-deep .then() chain plus
 * whatever the caller's fetch mock itself awaits) -- so it's safe to make
 * assertions about hydration side effects (like clearStreakSeedFlag())
 * right after awaiting this.
 *
 * Captures and returns a cleanup() that removes the "submit" listener this
 * eval registers, so tests don't leak listeners onto the shared jsdom
 * `document` across cases in the same file.
 */
export async function loadAccountSync({ loggedIn = true } = {}) {
  window.REPCHECK_LOGGED_IN = loggedIn;

  const nativeAddEventListener = document.addEventListener.bind(document);
  let capturedListener = null;
  document.addEventListener = (type, listener, options) => {
    if (type === "submit" && capturedListener === null) capturedListener = listener;
    return nativeAddEventListener(type, listener, options);
  };
  try {
    // eslint-disable-next-line no-eval
    (0, eval)(source);
  } finally {
    document.addEventListener = nativeAddEventListener;
  }

  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    cleanup() {
      if (capturedListener) document.removeEventListener("submit", capturedListener);
    },
  };
}

/**
 * Dispatches a submit event as if a <form action="/logout"> was submitted.
 * Appends the form under document.body and dispatches ON it (rather than
 * faking event.target) so it bubbles up to the document-level listener
 * exactly like a real form submission does.
 */
export function submitLogoutForm(action = "https://example.test/logout") {
  const form = document.createElement("form");
  form.action = action;
  document.body.appendChild(form);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  document.body.removeChild(form);
}
