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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadAccountSync, submitLogoutForm } from "./support/loadAccountSync.js";

const SEEDED_FLAG = "repcheck_activity_seeded";
const OWNER_KEY = "__repcheck_sync_owner_id";

function syncResponse(userId, values = {}) {
  return Promise.resolve({ json: () => Promise.resolve({ ok: true, user_id: userId, values }) });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.REPCHECK_LOGGED_IN;
});

describe("logout clears the streak seed flag", () => {
  it("clears repcheck_activity_seeded when a /logout form is submitted", async () => {
    vi.stubGlobal("fetch", vi.fn(() => syncResponse(1)));
    const { cleanup } = await loadAccountSync();
    sessionStorage.setItem(SEEDED_FLAG, "1");

    submitLogoutForm();

    expect(sessionStorage.getItem(SEEDED_FLAG)).toBe(null);
    cleanup();
  });

  it("leaves the flag alone for a form submit that isn't a logout", async () => {
    vi.stubGlobal("fetch", vi.fn(() => syncResponse(1)));
    const { cleanup } = await loadAccountSync();
    sessionStorage.setItem(SEEDED_FLAG, "1");

    submitLogoutForm("https://example.test/api/some-other-form");

    expect(sessionStorage.getItem(SEEDED_FLAG)).toBe("1");
    cleanup();
  });

  it("also clears the synced account keys, not just the streak flag (logout does both)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => syncResponse(1)));
    const { cleanup } = await loadAccountSync();
    localStorage.setItem("repcheck_activity_log_v1", JSON.stringify({ "2026-08-16": ["challenge"] }));
    sessionStorage.setItem(SEEDED_FLAG, "1");

    submitLogoutForm();

    expect(localStorage.getItem("repcheck_activity_log_v1")).toBe(null);
    expect(sessionStorage.getItem(SEEDED_FLAG)).toBe(null);
    cleanup();
  });
});

describe("an account-owner mismatch on hydration clears the streak seed flag", () => {
  it("clears the flag when the account that just loaded differs from the one this browser last synced as", async () => {
    // This browser last hydrated as user 1 (owner key on disk from a
    // previous page load); /api/sync now reports user 2 is logged in --
    // e.g. the session cookie was cleared and a different account signed
    // in without ever hitting /logout.
    localStorage.setItem(OWNER_KEY, "1");
    sessionStorage.setItem(SEEDED_FLAG, "1");
    vi.stubGlobal("fetch", vi.fn(() => syncResponse(2)));

    const { cleanup } = await loadAccountSync();

    expect(sessionStorage.getItem(SEEDED_FLAG)).toBe(null);
    cleanup();
  });

  it("does NOT clear the flag when hydration confirms the same account is still logged in", async () => {
    localStorage.setItem(OWNER_KEY, "1");
    sessionStorage.setItem(SEEDED_FLAG, "1");
    vi.stubGlobal("fetch", vi.fn(() => syncResponse(1)));

    const { cleanup } = await loadAccountSync();

    expect(sessionStorage.getItem(SEEDED_FLAG)).toBe("1");
    cleanup();
  });

  it("does NOT clear the flag on this browser's very first hydration (no owner on record yet)", async () => {
    // No __repcheck_sync_owner_id yet -- a brand-new browser/anonymous ->
    // signup adoption case, not an account switch, so nothing should be
    // wiped.
    sessionStorage.setItem(SEEDED_FLAG, "1");
    vi.stubGlobal("fetch", vi.fn(() => syncResponse(1)));

    const { cleanup } = await loadAccountSync();

    expect(sessionStorage.getItem(SEEDED_FLAG)).toBe("1");
    cleanup();
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
    vi.stubGlobal("fetch", vi.fn(() => syncResponse(1)));
    const seen = vi.fn();
    document.addEventListener("repcheck:sync-hydrated", seen);

    const { cleanup } = await loadAccountSync();

    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("repcheck:sync-hydrated", seen);
    cleanup();
  });

  it("still fires even when the hydration pull fails outright", async () => {
    // account_sync.js's own .catch(() => {}) swallows the error -- the
    // signal must still land, or streak.js would be stuck waiting on a
    // dead session-flaky connection with no back-fill until its timeout.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const seen = vi.fn();
    document.addEventListener("repcheck:sync-hydrated", seen);

    const { cleanup } = await loadAccountSync();

    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("repcheck:sync-hydrated", seen);
    cleanup();
  });

  it("fires AFTER the account-switch wipe has already cleared the stale local data", async () => {
    // The whole point of gating streak.js on this event: by the time it
    // fires, any account-switch cleanup this pass is going to do has
    // already happened -- so a listener reading localStorage inside the
    // event handler must see the POST-wipe state (the old account's day
    // gone -- normalized back to an empty log, not left absent), never a
    // stale pre-wipe snapshot still carrying user 1's day.
    localStorage.setItem(OWNER_KEY, "1");
    localStorage.setItem(
      "repcheck_activity_log_v1",
      JSON.stringify({ "2026-08-10": ["challenge"] }) // stale, belongs to user 1
    );
    vi.stubGlobal("fetch", vi.fn(() => syncResponse(2))); // now logged in as user 2

    let sawDuringEvent = "not fired";
    document.addEventListener("repcheck:sync-hydrated", () => {
      sawDuringEvent = localStorage.getItem("repcheck_activity_log_v1");
    });

    const { cleanup } = await loadAccountSync();

    expect(sawDuringEvent).not.toBe("not fired"); // the event did fire
    expect(JSON.parse(sawDuringEvent)).not.toHaveProperty("2026-08-10"); // and user 1's day is gone by then
    cleanup();
  });

  it("does not fire at all for a logged-out visitor (account_sync.js never touches /api/sync)", async () => {
    const fetchMock = vi.fn(() => syncResponse(1));
    vi.stubGlobal("fetch", fetchMock);
    const seen = vi.fn();
    document.addEventListener("repcheck:sync-hydrated", seen);

    const { cleanup } = await loadAccountSync({ loggedIn: false });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("repcheck:sync-hydrated", seen);
    cleanup();
  });
});
