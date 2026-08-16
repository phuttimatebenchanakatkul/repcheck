// Coverage for the localStorage keys that were reaching SQLite for the
// first time: the per-analysis chat threads (one key per analyze_results
// row, so matched by prefix rather than allowlisted) and the exercise
// favourites list. The server half is tested in
// tests/test_all_user_data_synced.py; this file covers the client half --
// that the writes actually get pushed, and that hydration can't truncate a
// conversation or drop a favourite.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAccountSync } from "./support/loadAccountSync.js";

const CHAT_KEY = "repcheck_analyze_chat_v1_42";
const FAVORITES_KEY = "repcheck_exercise_favorites_v1";

let active = null;

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

// The hydration path is fetch -> .then(r => r.json()) -> .then(...), so it
// settles after a few microtask turns rather than immediately.
async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function start(opts) {
  active = loadAccountSync(opts);
  await flush();
  return active;
}

function pushesFor(fetchMock, key) {
  return fetchMock.mock.calls.filter((call) => call[0] === `/api/sync/${key}`);
}

function thread(...texts) {
  return { createdAtMs: 1700000000000, history: texts.map((text) => ({ role: "user", text })) };
}

afterEach(() => {
  if (active) active.restore();
  active = null;
  vi.unstubAllGlobals();
});

describe("writes reach the server", () => {
  it("pushes a per-analysis chat thread, which is matched by prefix", async () => {
    const fetchMock = mockSync();
    const { storage } = await start();

    storage.setItem(CHAT_KEY, JSON.stringify(thread("why is my depth flagged?")));

    const pushes = pushesFor(fetchMock, CHAT_KEY);
    expect(pushes).toHaveLength(1);
    expect(pushes[0][1].method).toBe("PUT");
    expect(JSON.parse(pushes[0][1].body).value.history).toHaveLength(1);
  });

  it("pushes exercise favourites", async () => {
    const fetchMock = mockSync();
    const { storage } = await start();
    const before = pushesFor(fetchMock, FAVORITES_KEY).length;

    storage.setItem(FAVORITES_KEY, JSON.stringify(["Bench Press"]));

    const pushes = pushesFor(fetchMock, FAVORITES_KEY);
    expect(pushes).toHaveLength(before + 1);
    expect(JSON.parse(pushes[pushes.length - 1][1].body).value).toEqual(["Bench Press"]);
  });

  it("deletes the server copy when a stale chat thread is pruned locally", async () => {
    const fetchMock = mockSync();
    const { storage } = await start();

    storage.removeItem(CHAT_KEY);

    const pushes = pushesFor(fetchMock, CHAT_KEY);
    expect(pushes).toHaveLength(1);
    expect(pushes[0][1].method).toBe("DELETE");
  });

  it("still ignores keys that are deliberately per-device", async () => {
    const fetchMock = mockSync();
    const { storage } = await start();

    storage.setItem("repcheck_tour_step", "2");
    storage.setItem("repcheck_analyze_chat_v1_not-a-row-id", "{}");

    expect(pushesFor(fetchMock, "repcheck_tour_step")).toHaveLength(0);
    expect(pushesFor(fetchMock, "repcheck_analyze_chat_v1_not-a-row-id")).toHaveLength(0);
  });
});

describe("hydration", () => {
  it("brings down a chat thread this browser has never seen", async () => {
    mockSync({ [CHAT_KEY]: thread("asked from my phone") });
    const { storage } = await start();

    expect(JSON.parse(storage.getItem(CHAT_KEY)).history).toHaveLength(1);
  });

  it("never truncates a conversation when the server copy is behind", async () => {
    const local = thread("first", "second", "third");
    const fetchMock = mockSync({ [CHAT_KEY]: thread("first") });
    const { storage } = await start({ initialLocal: { [CHAT_KEY]: JSON.stringify(local) } });

    expect(JSON.parse(storage.getItem(CHAT_KEY)).history).toHaveLength(3);
    // ...and the server is brought up to the longer transcript.
    const pushes = pushesFor(fetchMock, CHAT_KEY);
    expect(pushes).toHaveLength(1);
    expect(JSON.parse(pushes[0][1].body).value.history).toHaveLength(3);
  });

  it("unions exercise favourites instead of letting either side win", async () => {
    mockSync({ [FAVORITES_KEY]: ["Deadlift"] });
    const { storage } = await start({
      initialLocal: { [FAVORITES_KEY]: JSON.stringify(["Bench Press"]) },
    });

    expect(new Set(JSON.parse(storage.getItem(FAVORITES_KEY)))).toEqual(
      new Set(["Bench Press", "Deadlift"])
    );
  });

  it("adopts the account's HYROX leaderboard gender and facility lane", async () => {
    mockSync({
      repcheck_hyrox_leaderboard_gender_v1: "women",
      repcheck_hyrox_facility_lane_v1: 15,
    });
    const { storage } = await start();

    expect(storage.getItem("repcheck_hyrox_leaderboard_gender_v1")).toBe("women");
    expect(storage.getItem("repcheck_hyrox_facility_lane_v1")).toBe("15");
  });

  it("clears another account's chat threads instead of adopting them", async () => {
    // Same browser, different user id than the one this device last synced
    // under -- the owner-mismatch wipe has to reach the prefix keys too.
    mockSync();
    const { storage } = await start({
      initialLocal: {
        __repcheck_sync_owner_id: "7",
        [CHAT_KEY]: JSON.stringify(thread("the previous user's question")),
      },
    });

    expect(storage.getItem(CHAT_KEY)).toBeNull();
  });
});
