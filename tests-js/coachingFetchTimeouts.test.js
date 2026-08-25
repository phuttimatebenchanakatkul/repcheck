/**
 * Guards the weekly check-in against a submit that can never finish.
 *
 * Reported as "I already checked in on my phone, but it still pops up",
 * with a screenshot of the check-in sheet sitting on a disabled
 * "Loading..." button. That is not a due-date bug: submitCheckin() only
 * writes `lastAdjustmentDate` at the very END of a successful submit, so a
 * submit that never settles never advances the 7-day cadence -- the home
 * banner keeps advertising the check-in and ?quick=checkin keeps
 * re-opening the sheet, forever.
 *
 * The cause is that `fetch` has no default timeout. submitCheckin() awaits
 * four requests in sequence (/api/sync profile recovery,
 * /api/weight/log-entry, /api/checkin/photo, /api/coaching/weekly-adjustment)
 * and only the last one had an abort -- and even that one cleared its timer
 * before reading the response body, so a stalled body still hung forever.
 * On a flaky mobile connection any single one of them can stay pending
 * indefinitely, which pins `submitting` true.
 *
 * These tests pin both halves of the fix: the wrapper really does abort
 * (headers AND body), and every request in coaching.js actually goes
 * through it.
 *
 * Regression: check-in stuck on "Loading..." -> check-in re-prompts forever
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadFetchJson, readCoachingSource, extractSource } from "./support/loadCoachingFetchJson.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete globalThis.fetch;
});

describe("coaching.js fetchJson", () => {
  it("rejects a request that never settles instead of hanging forever", async () => {
    // The real failure mode: fetch() resolves neither way. Without an abort
    // the await below is simply never reached.
    globalThis.fetch = vi.fn((url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })
    );

    const fetchJson = loadFetchJson();
    const pending = fetchJson("/api/coaching/weekly-adjustment", { method: "POST" });
    const settled = vi.fn();
    pending.then(settled, settled);

    await vi.advanceTimersByTimeAsync(44_000);
    expect(settled).not.toHaveBeenCalled(); // a request the server may still be working on isn't cut off early

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).rejects.toThrow();
  });

  it("aborts a response whose BODY never arrives, not just its headers", async () => {
    // Headers arriving is not the same as the response being complete: a
    // proxy or a dying mobile connection can deliver a 200 and then stall
    // the body. The abort that this replaces had already been cleared by
    // the time response.json() ran, so this case hung.
    globalThis.fetch = vi.fn(async (url, options) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    }));

    const fetchJson = loadFetchJson();
    const pending = fetchJson("/api/weight/log-entry", { method: "POST" });
    pending.catch(() => {});

    await vi.advanceTimersByTimeAsync(46_000);
    await expect(pending).rejects.toThrow();
  });

  it("returns the parsed body and clears its timer on success", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, id: 7 }) }));

    const fetchJson = loadFetchJson();
    const { response, data } = await fetchJson("/api/checkin/photo", { method: "POST" });

    expect(data).toEqual({ ok: true, id: 7 });
    expect(response.ok).toBe(true);
    // A leaked timer would keep firing abort() at a controller nobody is
    // watching; more importantly it proves the finally-block ran.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the caller's options through untouched alongside the signal", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));

    const fetchJson = loadFetchJson();
    await fetchJson("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/sync");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(options.body).toBe("{}");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("coaching.js request call sites", () => {
  // Source-level assertion on purpose (see CLAUDE.md): the point is that no
  // FUTURE request in this file gets to be unbounded, which no behavioural
  // test of the existing four can express.
  it("routes every request through fetchJson -- exactly one bare fetch( remains", () => {
    // Comment lines mention fetch( when explaining this very rule, so count
    // code lines only.
    const code = readCoachingSource()
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    const bare = code.match(/(?<![\w.])fetch\(/g) || [];
    expect(bare).toHaveLength(1);
    // ...and that one is the call inside the wrapper itself.
    expect(extractSource()).toMatch(/(?<![\w.])fetch\(url,/);
  });

  it("covers each endpoint the check-in submit path touches", () => {
    const source = readCoachingSource();
    for (const endpoint of [
      "/api/sync",
      "/api/weight/log-entry",
      "/api/checkin/photo",
      "/api/coaching/weekly-adjustment",
    ]) {
      expect(source).toContain(`fetchJson("${endpoint}"`);
    }
  });
});
