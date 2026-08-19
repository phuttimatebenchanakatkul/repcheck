// Coverage for the day-scoped workout-log sync added to fix cross-device
// staleness/resurrection (see database.py's set_workout_log_day() and
// POST /api/workout/log-day in app.py for the server-side half). Flagged
// by ship's coverage audit as untested -- this inline <script> logic had
// no test harness before this file existed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkoutSync } from "./support/loadWorkoutSync.js";

// loadWorkoutSync() registers a real window.addEventListener("pagehide", ...)
// as a side effect of running the extracted source, and jsdom's `window`
// persists across every test in this file -- without tracking and
// removing each one, listeners pile up and a later pagehide dispatch
// would re-trigger every earlier test's (usually-drained, but not
// guaranteed) state too. createSync() is what every test in this file
// calls instead of the raw import, so afterEach can always clean up.
let activeSyncs = [];
function createSync(opts) {
  const sync = loadWorkoutSync(opts);
  activeSyncs.push(sync);
  return sync;
}

// jsdom's Blob doesn't implement .text(), and neither wrapping it in a
// Response nor reading it via FileReader works reliably here (Response
// just stringifies it to "[object Blob]", and FileReader's onload never
// fires while fake timers are active -- it appears to be scheduled
// through a timer jsdom doesn't drive under vi.useFakeTimers()). Instead,
// wrap the global Blob constructor to record its parts at construction
// time, so reading a blob back is a synchronous WeakMap lookup instead of
// depending on any of jsdom's incomplete async Blob-reading paths.
let blobParts;
let NativeBlob;

beforeEach(() => {
  vi.useFakeTimers();
  blobParts = new WeakMap();
  NativeBlob = global.Blob;
  global.Blob = class extends NativeBlob {
    constructor(parts, options) {
      super(parts, options);
      blobParts.set(this, parts);
    }
  };
});

afterEach(() => {
  activeSyncs.forEach((sync) => sync.cleanup());
  activeSyncs = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  global.Blob = NativeBlob;
  // Object.defineProperty mutations on navigator aren't undone by
  // unstubAllGlobals() -- remove the mock explicitly so it doesn't leak
  // into tests that don't expect sendBeacon to exist.
  delete navigator.sendBeacon;
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

function mockFetchResolvingNotOk(status = 401) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock, callIndex = 0) {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body);
}

function beaconBodyOf(sendBeaconMock, callIndex = 0) {
  const blob = sendBeaconMock.mock.calls[callIndex][1];
  return JSON.parse(blobParts.get(blob).join(""));
}

function mockSendBeacon(returns = true) {
  const sendBeaconMock = vi.fn().mockReturnValue(returns);
  Object.defineProperty(navigator, "sendBeacon", { value: sendBeaconMock, configurable: true, writable: true });
  return sendBeaconMock;
}

describe("saveLog() date targeting", () => {
  it("with no argument, syncs the currently selected date", async () => {
    const fetchMock = mockFetchResolvingOk();
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock)).toEqual({ date: "2026-08-13", entries: sync.log["2026-08-13"] });
    // The harness extracts the template's raw source without Jinja
    // rendering it, so the URL argument here is the literal
    // `{{ url_for(...) }}` expression, not a real path -- this suite
    // can't verify the URL is actually correct in production. That's
    // covered instead by the Flask route test in
    // tests/test_workout_log_day_sync.py, which exercises the rendered
    // endpoint directly.
    expect(fetchMock.mock.calls[0][0]).toBe("{{ url_for('api_workout_log_day') }}");
  });

  it("with an explicit date, syncs that date instead of the selected one -- the quickLogExerciseNow() case", async () => {
    const fetchMock = mockFetchResolvingOk();
    // selectedDate is "2026-08-10" but the caller (mirroring
    // quickLogExerciseNow, which always logs to *today*) explicitly wants
    // a different date synced.
    const sync = createSync({ selectedDate: "2026-08-10" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Deadlift", addedAt: 1, sets: [] }];

    sync.saveLog("2026-08-13");
    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock)).toEqual({ date: "2026-08-13", entries: sync.log["2026-08-13"] });
  });

  it("always writes localStorage synchronously, even before the debounced network call fires", () => {
    mockFetchResolvingOk();
    const sync = createSync({ selectedDate: "2026-08-13" });
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
    const sync = createSync({ selectedDate: "2026-08-13" });

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
    const sync = createSync({ selectedDate: "2026-08-13" });

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
    const sync = createSync({ selectedDate: "2026-08-13" });
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
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000); // well past where a retry would fire if scheduled
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up silently after the retry also fails -- no unbounded retry loop", async () => {
    const fetchMock = mockFetchAlwaysRejecting();
    const sync = createSync({ selectedDate: "2026-08-13" });
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
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [{ reps: 8 }] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400); // fails
    sync.log["2026-08-13"][0].sets[0].reps = 15; // edited again before the retry fires
    await vi.advanceTimersByTimeAsync(2000); // the retry

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).entries[0].sets[0].reps).toBe(15);
  });

  it("retries when the request resolves but the server rejected it (e.g. 401 session expired) -- not just on a network-level failure", async () => {
    // Flagged in pre-landing review: fetch() only REJECTS on a network
    // error -- an HTTP error response still RESOLVES, so response.ok must
    // be checked or a mid-session auth expiry "succeeds" here with the
    // write never landing and no retry ever firing.
    const fetchMock = mockFetchResolvingNotOk(401);
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400); // first attempt: resolves with ok:false
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000); // the retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a second time when the retry itself also comes back not-ok", async () => {
    const fetchMock = mockFetchResolvingNotOk(500);
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(2000); // the retry, also not-ok
    await vi.advanceTimersByTimeAsync(10000); // plenty of time for a wrongly-scheduled 3rd attempt

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("pagehide flush", () => {
  it("flushes a still-pending debounced sync via sendBeacon instead of letting the page unload cancel it", async () => {
    const sendBeaconMock = mockSendBeacon();
    const fetchMock = mockFetchResolvingOk();
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    // No timer advance -- the 400ms debounce hasn't fired yet when the
    // page starts unloading.
    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
    expect(await beaconBodyOf(sendBeaconMock)).toEqual({ date: "2026-08-13", entries: sync.log["2026-08-13"] });

    // The original debounced call must not ALSO fire later -- the pending
    // timer was cleared when the beacon flushed it.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flushes every pending date, not just one", async () => {
    const sendBeaconMock = mockSendBeacon();
    mockFetchResolvingOk();
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "mon", exercise: "Push", addedAt: 1, sets: [] }];
    sync.log["2026-08-14"] = [{ id: "tue", exercise: "Pull", addedAt: 2, sets: [] }];

    sync.saveLog("2026-08-13");
    sync.saveLog("2026-08-14");
    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeaconMock).toHaveBeenCalledTimes(2);
    const dates = [(await beaconBodyOf(sendBeaconMock, 0)).date, (await beaconBodyOf(sendBeaconMock, 1)).date].sort();
    expect(dates).toEqual(["2026-08-13", "2026-08-14"]);
  });

  it("falls back to a keepalive fetch when sendBeacon is unavailable", async () => {
    // No mockSendBeacon() call -- jsdom doesn't implement sendBeacon by
    // default, matching this branch's "!navigator.sendBeacon" check.
    const fetchMock = mockFetchResolvingOk();
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    window.dispatchEvent(new Event("pagehide"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
    expect(bodyOf(fetchMock)).toEqual({ date: "2026-08-13", entries: sync.log["2026-08-13"] });
  });

  it("falls back to fetch when sendBeacon returns false (its queue is full)", async () => {
    mockSendBeacon(false);
    const fetchMock = mockFetchResolvingOk();
    const sync = createSync({ selectedDate: "2026-08-13" });
    sync.log["2026-08-13"] = [{ id: "e1", exercise: "Squat", addedAt: 1, sets: [] }];

    sync.saveLog();
    window.dispatchEvent(new Event("pagehide"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is nothing pending", () => {
    const sendBeaconMock = mockSendBeacon();
    const fetchMock = mockFetchResolvingOk();
    createSync({ selectedDate: "2026-08-13" });

    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
