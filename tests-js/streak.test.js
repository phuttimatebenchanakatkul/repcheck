// The streak rule: a day counts when the user USED RepCheck that day --
// any feature, not just the workout/nutrition logs the old copy-pasted
// per-page version knew about. These tests pin down both halves of that:
// the sources that are read out of existing logs, and the ones that have
// to announce themselves through mark().
//
// Exercises the real static/streak.js (see support/loadStreak.js).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadStreak, isoDaysFrom } from "./support/loadStreak.js";

// Local noon, so converting a timestamp back to a calendar date can't slip
// a day in either direction whatever timezone the test machine is in.
const NOW = new Date(2026, 7, 16, 12, 0, 0);
const today = (offset = 0) => isoDaysFrom(NOW, offset);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what counts as a streak day", () => {
  it("counts a logged workout (unchanged from the old rule)", () => {
    const streak = loadStreak({
      repcheck_workout_log_v2: { [today()]: [{ id: 1, name: "Squat" }] },
    });
    expect(streak.hasActivityOn(today())).toBe(true);
    expect(streak.current()).toBe(1);
  });

  it("counts logged food (unchanged from the old rule)", () => {
    const streak = loadStreak({
      repcheck_nutrition_log_v1: { [today()]: [{ id: 1, name: "Rice" }] },
    });
    expect(streak.current()).toBe(1);
  });

  it("counts a daily challenge attempt", () => {
    const streak = loadStreak({
      repcheck_activity_log_v1: { [today()]: ["challenge"] },
    });
    expect(streak.current()).toBe(1);
  });

  it("counts a weigh-in", () => {
    const streak = loadStreak({
      repcheck_weight_log_v1: { [today()]: { kg: 80, loggedAt: NOW.getTime() } },
    });
    expect(streak.current()).toBe(1);
  });

  it("counts a form analysis, filed under the day it was run", () => {
    const streak = loadStreak({
      repcheck_analyze_log_v1: [
        { exercise: "Bench Press", analyzedAt: new Date(2026, 7, 16, 9, 0, 0).getTime() },
      ],
    });
    expect(streak.hasActivityOn(today())).toBe(true);
  });

  it("counts a logged HYROX race", () => {
    const streak = loadStreak({
      repcheck_hyrox_history_v1: [
        { totalSeconds: 3600, date: new Date(2026, 7, 16, 10, 0, 0).toISOString() },
      ],
    });
    expect(streak.hasActivityOn(today())).toBe(true);
  });

  it("counts a workout AI chat thread", () => {
    const streak = loadStreak({
      repcheck_workout_chat_v1: { [today()]: [{ role: "user", text: "hi" }] },
    });
    expect(streak.current()).toBe(1);
  });

  it("does NOT count a day whose entries were all deleted", () => {
    const streak = loadStreak({
      repcheck_workout_log_v2: { [today()]: [] },
      repcheck_nutrition_log_v1: { [today()]: [] },
      repcheck_activity_log_v1: { [today()]: [] },
    });
    expect(streak.hasActivityOn(today())).toBe(false);
    expect(streak.current()).toBe(0);
  });

  it("does NOT count a manual day-status override, which can be applied to any past day", () => {
    const streak = loadStreak({
      repcheck_day_status_v1: { [today()]: "logged", [today(-1)]: "fasting" },
    });
    expect(streak.current()).toBe(0);
  });

  it("survives corrupt storage instead of throwing", () => {
    const streak = loadStreak({
      repcheck_workout_log_v2: "{not json",
      repcheck_analyze_log_v1: "[[[",
      repcheck_weight_log_v1: JSON.stringify(["unexpectedly an array"]),
      repcheck_activity_log_v1: { [today()]: ["challenge"] },
    });
    expect(streak.current()).toBe(1);
  });
});

describe("current()", () => {
  it("mixes sources across days -- a challenge, a workout and a weigh-in are one 3-day run", () => {
    const streak = loadStreak({
      repcheck_activity_log_v1: { [today()]: ["challenge"] },
      repcheck_workout_log_v2: { [today(-1)]: [{ id: 1 }] },
      repcheck_weight_log_v1: { [today(-2)]: { kg: 80 } },
    });
    expect(streak.current()).toBe(3);
  });

  it("keeps yesterday's streak alive when today hasn't been used yet", () => {
    const streak = loadStreak({
      repcheck_activity_log_v1: { [today(-1)]: ["challenge"], [today(-2)]: ["checkin"] },
    });
    expect(streak.current()).toBe(2);
  });

  it("breaks on a missed day", () => {
    const streak = loadStreak({
      repcheck_activity_log_v1: {
        [today()]: ["challenge"],
        // nothing on today(-1)
        [today(-2)]: ["challenge"],
      },
    });
    expect(streak.current()).toBe(1);
  });

  it("is 0 with no history at all", () => {
    expect(loadStreak({}).current()).toBe(0);
  });
});

describe("longest()", () => {
  it("finds the longest past run, not just the current one", () => {
    const streak = loadStreak({
      repcheck_activity_log_v1: {
        [today(-10)]: ["challenge"],
        [today(-9)]: ["challenge"],
        [today(-8)]: ["coach_chat"],
        [today(-7)]: ["challenge"],
        // gap
        [today()]: ["challenge"],
      },
    });
    expect(streak.longest()).toBe(4);
    expect(streak.current()).toBe(1);
  });

  it("does not double-count a day reported by two different sources", () => {
    const streak = loadStreak({
      repcheck_activity_log_v1: { [today()]: ["challenge"] },
      repcheck_workout_log_v2: { [today()]: [{ id: 1 }] },
      repcheck_nutrition_log_v1: { [today()]: [{ id: 2 }] },
    });
    expect(streak.longest()).toBe(1);
  });
});

describe("mark()", () => {
  it("makes today count and extends the streak", () => {
    const streak = loadStreak({
      repcheck_activity_log_v1: { [today(-1)]: ["challenge"] },
    });
    expect(streak.current()).toBe(1); // yesterday's, still alive

    streak.mark("challenge");

    expect(streak.current()).toBe(2);
    expect(JSON.parse(localStorage.getItem("repcheck_activity_log_v1"))[today()]).toEqual([
      "challenge",
    ]);
  });

  it("keeps every distinct action for a day, and records each only once", () => {
    const streak = loadStreak({});
    streak.mark("challenge");
    streak.mark("coach_chat");
    streak.mark("challenge");

    expect(JSON.parse(localStorage.getItem("repcheck_activity_log_v1"))[today()]).toEqual([
      "challenge",
      "coach_chat",
    ]);
  });

  it("announces the change so streak displays can redraw", () => {
    const streak = loadStreak({});
    const seen = vi.fn();
    document.addEventListener(streak.UPDATED_EVENT, seen);

    streak.mark("challenge");
    expect(seen).toHaveBeenCalledTimes(1);

    streak.mark("challenge"); // already recorded -- nothing to redraw for
    expect(seen).toHaveBeenCalledTimes(1);

    document.removeEventListener(streak.UPDATED_EVENT, seen);
  });

  it("ignores an empty action rather than writing a junk entry", () => {
    const streak = loadStreak({});
    streak.mark("");
    streak.mark(undefined);
    expect(localStorage.getItem("repcheck_activity_log_v1")).toBe(null);
  });

  it("does not throw when the write fails (quota exceeded / private browsing)", () => {
    // "A failed write ... must not take the action itself down with it" --
    // every call site (challenges.html, coach.html, coaching.js, ...) calls
    // mark() synchronously in the middle of handling a successful response,
    // so an uncaught exception here would also abort whatever the caller
    // does AFTER the mark() line (e.g. challenges.html's
    // openResultPopup(data, blob), which comes right after its mark call).
    const streak = loadStreak({});
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    expect(() => streak.mark("challenge")).not.toThrow();

    setItemSpy.mockRestore();
  });

  it("still fires the update event when the write fails, even though the day wasn't actually recorded", () => {
    const streak = loadStreak({});
    const seen = vi.fn();
    document.addEventListener(streak.UPDATED_EVENT, seen);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    streak.mark("challenge");

    expect(seen).toHaveBeenCalledTimes(1);
    // The write never actually landed, so the day must not silently count.
    expect(streak.hasActivityOn(today())).toBe(false);

    setItemSpy.mockRestore();
    document.removeEventListener(streak.UPDATED_EVENT, seen);
  });
});

describe("seedFromServer()", () => {
  it("back-fills server-recorded days and reports the change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              ok: true,
              dates: { [today(-1)]: ["challenge"], [today(-2)]: ["challenge", "analysis"] },
            }),
        })
      )
    );

    // Loaded logged-out so the on-load back-fill doesn't fire, then flipped
    // on -- this drives seedFromServer() by hand to assert what it does.
    const streak = loadStreak({ repcheck_activity_log_v1: { [today()]: ["coach_chat"] } });
    expect(streak.current()).toBe(1);
    window.REPCHECK_LOGGED_IN = true;

    await expect(streak.seedFromServer()).resolves.toBe(true);

    expect(streak.current()).toBe(3);
    // Locally-known days are kept, not replaced by the server's view.
    const log = JSON.parse(localStorage.getItem("repcheck_activity_log_v1"));
    expect(log[today()]).toEqual(["coach_chat"]);
    expect(log[today(-2)]).toEqual(["challenge", "analysis"]);
  });

  it("sends the browser's UTC offset so days are bucketed in local time", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ ok: true, dates: {} }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    const streak = loadStreak({});
    window.REPCHECK_LOGGED_IN = true;
    await streak.seedFromServer();

    const expected = -new Date().getTimezoneOffset();
    expect(fetchMock).toHaveBeenCalledWith(`/api/activity/dates?tz_offset_minutes=${expected}`);
  });

  it("leaves the locally-known streak intact when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));

    const streak = loadStreak({ repcheck_activity_log_v1: { [today()]: ["challenge"] } });
    window.REPCHECK_LOGGED_IN = true;
    await expect(streak.seedFromServer()).resolves.toBe(false);
    expect(streak.current()).toBe(1);
  });

  it("treats a non-ok API response (e.g. session expired) as a no-op, not a throw", async () => {
    // app.py's /api/activity/dates returns {"ok": false, "error": "..."}
    // (401) when the session has expired since page load -- same shape as
    // every other route in this app. Must not be confused with a network
    // failure or crash the caller.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({ ok: false, error: "Not logged in." }) })
      )
    );

    const streak = loadStreak({ repcheck_activity_log_v1: { [today()]: ["challenge"] } });
    window.REPCHECK_LOGGED_IN = true;

    await expect(streak.seedFromServer()).resolves.toBe(false);
    expect(streak.current()).toBe(1);
  });

  it("does nothing for a logged-out visitor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const streak = loadStreak({});
    window.REPCHECK_LOGGED_IN = false;
    await expect(streak.seedFromServer()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is re-armed by account_sync.js whenever an account's local data is wiped", async () => {
    // The flag name is shared across two files by string. If either side
    // renames it, a user who logs into a different account mid-session
    // never gets that account's activity back-filled and is shown a zero
    // streak until they close the browser -- so pin the contract here.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static");

    const streakSrc = readFileSync(path.join(staticDir, "streak.js"), "utf-8");
    const syncSrc = readFileSync(path.join(staticDir, "account_sync.js"), "utf-8");

    expect(streakSrc).toContain('var SEEDED_FLAG = "repcheck_activity_seeded"');
    expect(syncSrc).toContain('sessionStorage.removeItem("repcheck_activity_seeded")');
    // Both wipe paths -- the explicit logout, and the "logged in as someone
    // else without logging out" hydration check -- must call it.
    expect(syncSrc.match(/clearStreakSeedFlag\(\);/g)).toHaveLength(2);
  });

  it("runs itself once per browser session on load, not once per page", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ ok: true, dates: {} }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadStreak({}, { loggedIn: true }); // first page of the session
    // account_sync.js's own hydration pull is what gates the seed now (see
    // the "waits for..." tests below) -- simulate it settling.
    document.dispatchEvent(new CustomEvent("repcheck:sync-hydrated"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second page load in the same session: sessionStorage still carries
    // the flag, so loading the module again must not re-request, even
    // once that page's own hydration signal fires too.
    window.REPCHECK_LOGGED_IN = true;
    delete window.RepCheckStreak;
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const streakPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "static",
      "streak.js"
    );
    (0, eval)(readFileSync(streakPath, "utf-8"));
    document.dispatchEvent(new CustomEvent("repcheck:sync-hydrated"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for account_sync.js's repcheck:sync-hydrated signal before seeding", () => {
    // Closes the cross-account race an adversarial review found: seeding
    // immediately on load could read this device's stale localStorage
    // (left over from a previous account on a shared device) before
    // account_sync.js's own hydration pass has had a chance to wipe it on
    // an account-owner mismatch. See the big comment above this wait in
    // static/streak.js for the full failure mode.
    const fetchMock = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ ok: true, dates: {} }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadStreak({}, { loggedIn: true });
    expect(fetchMock).not.toHaveBeenCalled(); // not yet -- still waiting on the signal

    document.dispatchEvent(new CustomEvent("repcheck:sync-hydrated"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to seeding on its own after a grace period if the signal never arrives", () => {
    // Defensive timeout: a future change to account_sync.js that drops the
    // dispatch, or a browser without fetch, must not leave the streak
    // permanently un-seeded.
    const fetchMock = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ ok: true, dates: {} }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadStreak({}, { loggedIn: true });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only seeds once even if the signal arrives right as the fallback timeout also fires", () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ ok: true, dates: {} }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    loadStreak({}, { loggedIn: true });
    document.dispatchEvent(new CustomEvent("repcheck:sync-hydrated"));
    vi.advanceTimersByTime(5000); // the fallback firing after the signal already did must be a no-op

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not wait for the signal at all when logged out (account_sync.js never dispatches it)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    loadStreak({}, { loggedIn: false });
    vi.advanceTimersByTime(10000);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
