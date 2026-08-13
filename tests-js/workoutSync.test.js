// Coverage for the day-scoped workout-log sync added to fix cross-device
// staleness/resurrection (see database.py's set_workout_log_day() and
// POST /api/workout/log-day in app.py for the server-side half). Flagged
// by ship's coverage audit as untested -- this inline <script> logic had
// no test harness before this file existed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkoutSync } from "./support/loadWorkoutSync.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockFetchResolvingOk() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFetchRejectingOnce() {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFetchAlwaysRejecting() {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock, callIndex = 0) {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body);
}

describe("saveLog() date targeting", () => {
  it("with no argument, syncs the currently selected date", async () => {
    const fetchMock = mockFetchResolvingOk();
    const sync = loadWorkoutSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock)).toEqual({ date: "2026-08-13", entries: sync.log["2026-08-13"] });
  });

  it("with an explicit date, syncs that date instead of the selected one -- the quickLogExerciseNow() case", async () => {
    const fetchMock = mockFetchResolvingOk();
    // selectedDate is "2026-08-10" but the caller (mirroring
    // quickLogExerciseNow, which always logs to *today*) explicitly wants
    // a different date synced.
    const sync = loadWorkoutSync({ selectedDate: "2026-08-10" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Deadlift", addedAt: 1, sets: [] }];

    sync.saveLog("2026-08-13");
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock)).toEqual({ date: "2026-08-13", entries: sync.log["2026-08-13"] });
  });

  it("always writes localStorage synchronously, even before the debounced network call fires", () => {
    mockFetchResolvingOk();
    const sync = loadWorkoutSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();

    // No timer advance yet -- the network call hasn't fired, but the local
    // write must already be durable (this is what makes the same device's
    // own reload always see the latest state, independent of sync timing).
    expect(JSON.parse(localStorage.getItem("repcheck_workout_log_v2"))).toEqual(sync.log);
  });
});

describe("scheduleWorkoutDaySync() debounce", () => {
  it("collapses repeated edits to the SAME date within the debounce window into one network call carrying the latest state", async () => {
    const fetchMock = mockFetchResolvingOk();
    const sync = loadWorkoutSync({ selectedDate: "2026-08-13" });

    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [{ reps: "" }] }];
    sync.saveLog();
    await vi.advanceTimersByTimeAsync(100); // well under the 400ms debounce

    // A second edit to the same date before the first sync fired.
    sync.log["2026-08-13"][0].sets[0].reps = 12;
    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock).entries[0].sets[0].reps).toBe(12);
  });

  it("edits to TWO DIFFERENT dates within the debounce window do not cancel each other -- both eventually sync", async () => {
    const fetchMock = mockFetchResolvingOk();
    const sync = loadWorkoutSync({ selectedDate: "2026-08-13" });

    sync.log["2026-08-13"] = [{ id: "mon", exercise: "Push", addedAt: 1, sets: [] }];
    sync.log["2026-08-14"] = [{ id: "tue", exercise: "Pull", addedAt: 2, sets: [] }];

    sync.saveLog("2026-08-13");
    await vi.advanceTimersByTimeAsync(100);
    sync.saveLog("2026-08-14"); // different date -- must not clear the 8-13 timer
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const dates = fetchMock.mock.calls.map((_, i) => bodyOf(fetchMock, i).date).sort();
    expect(dates).toEqual(["2026-08-13", "2026-08-14"]);
  });
});

describe("pushWorkoutDay() retry", () => {
  it("retries exactly once, 2s later, after the first attempt fails", async () => {
    const fetchMock = mockFetchRejectingOnce();
    const sync = loadWorkoutSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400); // first attempt fires and fails
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000); // the retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1)).toEqual({ date: "2026-08-13", entries: sync.log["2026-08-13"] });
  });

  it("does not schedule a retry when the request succeeds", async () => {
    const fetchMock = mockFetchResolvingOk();
    const sync = loadWorkoutSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000); // well past where a retry would fire if scheduled
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up silently after the retry also fails -- no unbounded retry loop", async () => {
    const fetchMock = mockFetchAlwaysRejecting();
    const sync = loadWorkoutSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400); // attempt 0: fails
    await vi.advanceTimersByTimeAsync(2000); // attempt 1 (the retry): also fails
    await vi.advanceTimersByTimeAsync(10000); // plenty of time for a 3rd attempt, if one were (wrongly) scheduled

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends the day's entries as they are at the moment the request actually fires, not when it was scheduled", async () => {
    // Regression-shaped: pushWorkoutDay reads log[dateIso] fresh each call,
    // so a retry after further local edits must carry the NEWEST state, not
    // a stale snapshot from the original failed attempt.
    const fetchMock = mockFetchRejectingOnce();
    const sync = loadWorkoutSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [{ reps: 8 }] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400); // fails
    sync.log["2026-08-13"][0].sets[0].reps = 15; // edited again before the retry fires
    await vi.advanceTimersByTimeAsync(2000); // the retry

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).entries[0].sets[0].reps).toBe(15);
  });
});
