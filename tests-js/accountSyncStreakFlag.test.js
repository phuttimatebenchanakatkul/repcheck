// The streak's server back-fill (static/streak.js's seedFromServer()) only
// runs once per browser session, gated by a sessionStorage flag. Two spots
// in account_sync.js are supposed to clear that flag -- the explicit
// /logout submit, and the "hydration notices a different account is now
// logged in" belt-and-suspenders check -- because a session survives a
// switch to a different account and a stale flag would leave that account
// permanently showing a zero streak until the browser closes.
//
// tests-js/streak.test.js already pins the STRING contract (that both call
// sites exist, verbatim, in account_sync.js's source) -- see its
// "is re-armed by account_sync.js" test. This file goes one level deeper
// and actually exercises the real account_sync.js to prove the flag gets
// cleared, not just that the right function name appears somewhere in the
// file.
//
// Uses the shared loadAccountSync() harness (support/loadAccountSync.js) --
// injected fake storage objects, not jsdom's real localStorage/
// sessionStorage, because jsdom's Storage silently swallows the
// `localStorage.setItem = fn` override account_sync.js relies on (see that
// file's own header comment for the full explanation).

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAccountSync } from "./support/loadAccountSync.js";

const SEEDED_FLAG = "repcheck_activity_seeded";
const OWNER_KEY = "__repcheck_sync_owner_id";
const ACTIVITY_LOG_KEY = "repcheck_activity_log_v1";

function mockSync(userId, values = {}) {
  const fetchMock = vi.fn((url) => {
    if (url === "/api/sync") {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, user_id: userId, values }) });
    }
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// The hydration path is fetch -> .then(r => r.json()) -> .then(...) ->
// .catch() -> .then(dispatch), so it settles after a few microtask turns
// rather than immediately -- same helper as accountSyncStrandedKeys.test.js.
async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

let active = null;

async function start(opts) {
  active = loadAccountSync(opts);
  await flush();
  return active;
}

function submitLogoutForm(action = "https://example.test/logout") {
  const form = document.createElement("form");
  form.action = action;
  document.body.appendChild(form);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  document.body.removeChild(form);
}

afterEach(() => {
  if (active) active.restore();
  active = null;
  vi.unstubAllGlobals();
});

describe("logout clears the streak seed flag", () => {
  it("clears repcheck_activity_seeded when a /logout form is submitted", async () => {
    mockSync(1);
    const { session } = await start();
    session.setItem(SEEDED_FLAG, "1");

    submitLogoutForm();

    expect(session.getItem(SEEDED_FLAG)).toBe(null);
  });

  it("leaves the flag alone for a form submit that isn't a logout", async () => {
    mockSync(1);
    const { session } = await start();
    session.setItem(SEEDED_FLAG, "1");

    submitLogoutForm("https://example.test/api/some-other-form");

    expect(session.getItem(SEEDED_FLAG)).toBe("1");
  });

  it("also clears the synced account keys, not just the streak flag (logout does both)", async () => {
    mockSync(1);
    const { storage, session } = await start({
      initialLocal: { [ACTIVITY_LOG_KEY]: JSON.stringify({ "2026-08-16": ["challenge"] }) },
    });
    session.setItem(SEEDED_FLAG, "1");

    submitLogoutForm();

    expect(storage.getItem(ACTIVITY_LOG_KEY)).toBe(null);
    expect(session.getItem(SEEDED_FLAG)).toBe(null);
  });
});

// loadAccountSync() fires its /api/sync fetch synchronously but the
// resulting .then() chain resolves on the microtask queue -- so a flag can
// still be seeded into `session` right after the call returns, before
// hydration's owner check has actually run, then observed once flush()
// drains that chain.
async function startWithSeededFlag(opts) {
  active = loadAccountSync(opts);
  active.session.setItem(SEEDED_FLAG, "1");
  await flush();
  return active;
}

describe("an account-owner mismatch on hydration clears the streak seed flag", () => {
  it("clears the flag when the account that just loaded differs from the one this browser last synced as", async () => {
    // This browser last hydrated as user 1 (owner key on disk from a
    // previous page load); /api/sync now reports user 2 is logged in --
    // e.g. the session cookie was cleared and a different account signed
    // in without ever hitting /logout.
    mockSync(2);
    const { session } = await startWithSeededFlag({ initialLocal: { [OWNER_KEY]: "1" } });

    expect(session.getItem(SEEDED_FLAG)).toBe(null);
  });

  it("does NOT clear the flag when hydration confirms the same account is still logged in", async () => {
    mockSync(1);
    const { session } = await startWithSeededFlag({ initialLocal: { [OWNER_KEY]: "1" } });

    expect(session.getItem(SEEDED_FLAG)).toBe("1");
  });

  it("does NOT clear the flag on this browser's very first hydration (no owner on record yet)", async () => {
    // No __repcheck_sync_owner_id yet -- a brand-new browser/anonymous ->
    // signup adoption case, not an account switch, so nothing should be
    // wiped.
    mockSync(1);
    const { session } = await startWithSeededFlag({});

    expect(session.getItem(SEEDED_FLAG)).toBe("1");
  });
});

describe("repcheck:sync-hydrated signal", () => {
  // static/streak.js waits for this event before running its own
  // once-per-session server pull -- see the big comment above streak.js's
  // seedFromServer() call site. If account_sync.js ever stopped firing it
  // (success or failure), streak.js would hang waiting until its 5s
  // defensive timeout, and in the meantime could read this device's local
  // data before an account-switch wipe has landed -- the exact race the
  // signal exists to close. These tests pin that it fires in both cases.

  it("fires once the hydration pull resolves successfully", async () => {
    mockSync(1);
    const seen = vi.fn();
    document.addEventListener("repcheck:sync-hydrated", seen);

    await start();

    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("repcheck:sync-hydrated", seen);
  });

  it("still fires even when the hydration pull fails outright", async () => {
    // account_sync.js's own .catch(() => {}) swallows the error -- the
    // signal must still land, or streak.js would be stuck waiting on a
    // dead/flaky connection with no back-fill until its timeout.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const seen = vi.fn();
    document.addEventListener("repcheck:sync-hydrated", seen);

    await start();

    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("repcheck:sync-hydrated", seen);
  });

  it("fires AFTER the account-switch wipe has already cleared the stale local data", async () => {
    // The whole point of gating streak.js on this event: by the time it
    // fires, any account-switch cleanup this pass is going to do has
    // already happened -- so a listener reading storage inside the event
    // handler must see the POST-wipe state (the old account's day gone --
    // normalized to an empty log, not left absent), never a stale pre-wipe
    // snapshot still carrying user 1's day.
    mockSync(2); // now logged in as user 2
    let sawDuringEvent = "not fired";
    const handler = () => {
      sawDuringEvent = active.storage.getItem(ACTIVITY_LOG_KEY);
    };
    document.addEventListener("repcheck:sync-hydrated", handler);

    active = loadAccountSync({
      initialLocal: {
        [OWNER_KEY]: "1", // last synced as user 1
        [ACTIVITY_LOG_KEY]: JSON.stringify({ "2020-01-01": ["challenge"] }), // stale, belongs to user 1
      },
    });
    await flush();

    expect(sawDuringEvent).not.toBe("not fired"); // the event did fire
    expect(JSON.parse(sawDuringEvent)).not.toHaveProperty("2020-01-01"); // user 1's day is gone by then
    document.removeEventListener("repcheck:sync-hydrated", handler);
  });
});
