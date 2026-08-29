// account_sync.js used to finish its load-time hydration by calling
// location.reload(). It was the one thing in the app that visibly refreshed
// the page on its own, and the guard against it repeating ("once per
// session", via sessionStorage) does not survive the iOS app being killed
// and relaunched -- so a Capacitor user could meet it on every cold start.
//
// It now asks the page to redraw instead, via a cancelable
// "repcheck:data-hydrated" event. preventDefault() is the whole protocol: a
// page that re-read its state and re-rendered claims the event, and only an
// unclaimed one falls back to the reload.
//
// These tests pin both halves. The reload must still happen when nothing
// handles the event -- dropping it entirely would leave a page rendering
// data the user can see is wrong -- and it must NOT happen when something
// does.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAccountSync } from "./support/loadAccountSync.js";

const NUTRITION_LOG = "repcheck_nutrition_log_v1";
const WORKOUT_LOG = "repcheck_workout_log_v2";
const FAVORITES = "repcheck_nutrition_favorites_v1";
const RELOAD_GUARD = "repcheck_hydrated_reload";

let active = null;
let listeners = [];

function mockSync(values = {}) {
  const fetchMock = vi.fn((url) => {
    if (url === "/api/sync") {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, user_id: 1, values }) });
    }
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function start(opts) {
  active = loadAccountSync(opts);
  await flush();
  return active;
}

// Registered through here so afterEach can always take them off the shared
// jsdom document -- a leaked handler would silently claim the event for the
// next test and make a reload assertion pass for the wrong reason.
function onHydrated(handler) {
  document.addEventListener("repcheck:data-hydrated", handler);
  listeners.push(handler);
}

afterEach(() => {
  listeners.forEach((h) => document.removeEventListener("repcheck:data-hydrated", h));
  listeners = [];
  if (active) active.restore();
  active = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("account_sync.js -- re-render instead of reload", () => {
  it("asks the page to redraw, naming the keys that changed", async () => {
    const seen = [];
    onHydrated((event) => seen.push(event.detail.keys));
    mockSync({ [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] } });

    await start();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([NUTRITION_LOG]);
  });

  it("does not reload when a page claims the event", async () => {
    onHydrated((event) => event.preventDefault());
    mockSync({ [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] } });

    const { reload, session } = await start();

    expect(reload.called).toBe(false);
    // The guard is cleared too, so a genuinely unhandled hydration later in
    // the same session can still fall back.
    expect(session.getItem(RELOAD_GUARD)).toBeNull();
  });

  it("still reloads when nothing claims it, so no page is left showing stale data", async () => {
    mockSync({ [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] } });

    const { reload, session } = await start();

    expect(reload.called).toBe(true);
    expect(session.getItem(RELOAD_GUARD)).toBe("1");
  });

  it("a listener that merely looks at the event does not count as handling it", async () => {
    onHydrated(() => { /* reads detail, redraws nothing */ });
    mockSync({ [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] } });

    const { reload } = await start();

    expect(reload.called).toBe(true);
  });

  it("one page claiming it is enough, even alongside a listener that doesn't", async () => {
    // coaching.js deliberately re-renders without claiming, because
    // nutrition.html's own handler is what owns the page.
    onHydrated(() => {});
    onHydrated((event) => event.preventDefault());
    mockSync({ [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] } });

    const { reload } = await start();

    expect(reload.called).toBe(false);
  });

  it("reports every changed key, so a page can redraw only what moved", async () => {
    const seen = [];
    onHydrated((event) => { seen.push(...event.detail.keys); event.preventDefault(); });
    mockSync({
      [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] },
      [WORKOUT_LOG]: { "2026-08-29": [{ id: "b", exercise: "Deadlift" }] },
      [FAVORITES]: ["Rice"],
    });

    await start();

    expect(seen.sort()).toEqual([FAVORITES, NUTRITION_LOG, WORKOUT_LOG].sort());
  });

  it("says nothing at all when hydration changed nothing visible", async () => {
    const seen = vi.fn();
    onHydrated(seen);
    // An empty log on the server normalizing against an empty local one is
    // not a change worth redrawing for -- this is what used to make a
    // brand-new account's very first page load flash-reload for no reason.
    mockSync({ [NUTRITION_LOG]: {} });

    const { reload } = await start();

    expect(seen).not.toHaveBeenCalled();
    expect(reload.called).toBe(false);
  });

  it("leaves the screen alone while a modal is open, and does not reload either", async () => {
    // Redrawing under an open sheet yanks the page out from under whatever
    // the user is mid-way through -- a food they picked but haven't added yet.
    document.body.innerHTML = '<div class="log-sheet-overlay" style="display:flex"></div>';
    const seen = vi.fn();
    onHydrated(seen);
    mockSync({ [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] } });

    const { reload, session } = await start();

    expect(seen).not.toHaveBeenCalled();
    expect(reload.called).toBe(false);
    expect(session.getItem(RELOAD_GUARD)).toBeNull();
  });

  it("never reloads twice in one session", async () => {
    mockSync({ [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] } });
    const first = await start();
    expect(first.reload.called).toBe(true);

    // Same session (the guard lives in sessionStorage), second page load.
    active.restore();
    mockSync({ [WORKOUT_LOG]: { "2026-08-29": [{ id: "b", exercise: "Squat" }] } });
    active = loadAccountSync({ initialLocal: { [RELOAD_GUARD]: "1" } });
    // The guard is sessionStorage, which the harness makes fresh per load --
    // so seed it the way a real second page load would find it.
    active.session.setItem(RELOAD_GUARD, "1");
    await flush();

    expect(active.reload.called).toBe(false);
  });

  it("still signals repcheck:sync-hydrated, which streak.js waits on", async () => {
    // The re-render path returns early out of the hydration .then(); that
    // must not skip the signal chained after it, or streak.js's own
    // once-per-session server pull never runs.
    const settled = vi.fn();
    document.addEventListener("repcheck:sync-hydrated", settled, { once: true });
    onHydrated((event) => event.preventDefault());
    mockSync({ [NUTRITION_LOG]: { "2026-08-29": [{ id: "a", food: "Rice" }] } });

    await start();

    expect(settled).toHaveBeenCalled();
  });
});
