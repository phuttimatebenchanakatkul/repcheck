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

  it("keeps the local chat thread when the server copy is malformed", async () => {
    // Mirrors database.py's test_merge_chat_thread_ignores_a_malformed_incoming_value
    // -- mergeChatThread is the JS side of the same merge rule, fed straight
    // from the hydration GET's response, which is server-controlled but not
    // guaranteed to be the {createdAtMs, history} shape (an older/buggy
    // build, or a row that predates this key family).
    const local = thread("keep me");
    mockSync({ [CHAT_KEY]: "not-a-thread" });
    const { storage } = await start({ initialLocal: { [CHAT_KEY]: JSON.stringify(local) } });

    expect(JSON.parse(storage.getItem(CHAT_KEY))).toEqual(local);
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

  it("trusts a just-written local chat thread over the server copy instead of merging", async () => {
    // Mirrors the MERGE_UNION_KEYS / MERGE_LOG_KEYS "recently written
    // locally" trust window (RECENT_WRITE_MS): a chat turn written moments
    // ago on this device must win outright and be re-pushed, not merged
    // against whatever the hydration GET raced back with -- even when the
    // server copy looks longer (e.g. it's a stale draft from another tab
    // that the local write has since superseded).
    const local = thread("just typed this");
    const server = thread("stale from another device", "and another");
    const fetchMock = mockSync({ [CHAT_KEY]: server });
    const { storage } = await start({
      initialLocal: {
        [CHAT_KEY]: JSON.stringify(local),
        __repcheck_sync_write_times: JSON.stringify({ [CHAT_KEY]: Date.now() }),
      },
    });

    // Untouched by the merge: still exactly the local (shorter) thread.
    expect(JSON.parse(storage.getItem(CHAT_KEY))).toEqual(local);

    const pushes = pushesFor(fetchMock, CHAT_KEY);
    expect(pushes).toHaveLength(1);
    expect(JSON.parse(pushes[0][1].body).value).toEqual(local);
  });
});

describe("logout clears account-owned keys (clearAccountOwnedKeys)", () => {
  // clearAccountOwnedKeys() used to be duplicated inline at both the logout
  // submit handler and the owner-mismatch hydration check; this diff
  // extracted it into one shared function and added the chat-key sweep to
  // it. Neither call site had any test before this file existed, so a
  // mistake in the extraction (e.g. dropping the PER_DEVICE_KEYS exclusion,
  // or only wiring the chat sweep into one of the two call sites) would
  // have shipped silently. This exercises the actual logout <form> submit
  // path, not just the owner-mismatch path covered above.
  function submitLogoutForm() {
    const form = document.createElement("form");
    form.action = "/logout";
    document.body.appendChild(form);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    document.body.removeChild(form);
  }

  it("removes regular synced keys and this device's chat threads, but keeps per-device keys", async () => {
    mockSync();
    const { storage } = await start({
      initialLocal: {
        repcheck_workout_log_v2: JSON.stringify({ "2026-01-01": [] }),
        [FAVORITES_KEY]: JSON.stringify(["Bench Press"]),
        repcheck_theme: "dark",
        repcheck_language: "en",
        [CHAT_KEY]: JSON.stringify(thread("the logged-out user's question")),
      },
    });

    submitLogoutForm();

    expect(storage.getItem("repcheck_workout_log_v2")).toBeNull();
    expect(storage.getItem(FAVORITES_KEY)).toBeNull();
    expect(storage.getItem(CHAT_KEY)).toBeNull();
    // PER_DEVICE_KEYS (theme/language) are not account data -- logging out
    // must not reset the device's own display preferences.
    expect(storage.getItem("repcheck_theme")).toBe("dark");
    expect(storage.getItem("repcheck_language")).toBe("en");
  });
});
