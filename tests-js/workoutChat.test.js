// DOM-level coverage for the workout chat widget added to
// templates/workouts.html. The pytest tests (tests/test_workout_chat.py)
// only cover the Python backend (prompt building + /api/workout-chat route);
// this file covers the client-side JS: building the two-section summary
// sent to the model (a lean 7-day overview + a per-exercise history capped
// at the last 4 sessions regardless of calendar window), formatting/
// escaping bot replies, day labeling, today-only interactivity gating, and
// the send/lockout/error UI flows.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkoutChat } from "./support/loadWorkoutChat.js";

beforeEach(() => {
  localStorage.clear();
});

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("buildRecentWorkoutSummary", () => {
  it("reports no workouts in either section when the log is empty", () => {
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log: {} });
    const summary = buildRecentWorkoutSummary();
    expect(summary).toContain("(No workouts logged in the last 7 days.)");
    expect(summary).toContain("(No exercises logged yet.)");
  });

  it("describes a normal weighted exercise's sets", () => {
    const today = isoDaysAgo(0);
    const log = {
      [today]: [
        {
          exercise: "Bench Press",
          unilateral: false,
          addedAt: 1,
          sets: [{ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 6 }],
        },
      ],
    };
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log });
    const summary = buildRecentWorkoutSummary();
    expect(summary).toContain("Bench Press:");
    expect(summary).toContain("60kg x 8 reps; 60kg x 6 reps");
  });

  it("describes a bodyweight exercise without a weight figure", () => {
    const today = isoDaysAgo(0);
    const log = {
      [today]: [
        { exercise: "Pull-Up", unilateral: false, addedAt: 1, sets: [{ reps: 10 }] },
      ],
    };
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log });
    expect(buildRecentWorkoutSummary()).toContain("10 reps (bodyweight)");
  });

  it("describes a unilateral exercise per-side", () => {
    const today = isoDaysAgo(0);
    const log = {
      [today]: [
        {
          exercise: "Dumbbell Curl",
          unilateral: true,
          addedAt: 1,
          sets: [{ leftKg: 12, leftReps: 10, rightKg: 14, rightReps: 8 }],
        },
      ],
    };
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log });
    expect(buildRecentWorkoutSummary()).toContain(
      "L 12kg x 10 reps, R 14kg x 8 reps"
    );
  });

});

describe("buildRecentWorkoutSummary: exercise-history section", () => {
  it("lists an exercise's occurrences most-recent-first, capped at the last 4", () => {
    // 6 sessions of the same exercise, oldest to newest, each on a
    // distinct day well outside any 7-day window -- must still all be
    // findable, and only the 4 most recent kept.
    const log = {};
    for (let i = 0; i < 6; i++) {
      const dateIso = isoDaysAgo(60 - i * 10); // 60, 50, 40, 30, 20, 10 days ago
      log[dateIso] = [{
        exercise: "Tricep Pushdown",
        unilateral: false,
        addedAt: i,
        sets: [{ weightKg: 20 + i, reps: 8 }],
      }];
    }
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log });
    const summary = buildRecentWorkoutSummary();
    const section = summary.split("Exercise history")[1];

    // Most recent 4 (weights 25, 24, 23, 22 kg, for i=5,4,3,2) present...
    expect(section).toContain("25kg x 8 reps");
    expect(section).toContain("24kg x 8 reps");
    expect(section).toContain("23kg x 8 reps");
    expect(section).toContain("22kg x 8 reps");
    // ...but the two oldest (i=0,1 -> 20kg, 21kg) are dropped.
    expect(section).not.toContain("20kg x 8 reps");
    expect(section).not.toContain("21kg x 8 reps");

    // Most-recent-first ordering: the 25kg line must appear before 22kg.
    expect(section.indexOf("25kg x 8 reps")).toBeLessThan(section.indexOf("22kg x 8 reps"));
  });

  it("finds an exercise's history even when its only sessions fall outside the last 7 days", () => {
    // This is the headline behavior the feature exists for: an exercise
    // trained only on a split day that recurs every 1-2 weeks must still
    // surface its history, not just whatever's inside a flat 7-day window.
    const log = {
      [isoDaysAgo(14)]: [{
        exercise: "Overhead Tricep Extension",
        unilateral: false,
        addedAt: 1,
        sets: [{ weightKg: 15, reps: 10 }],
      }],
    };
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log });
    const summary = buildRecentWorkoutSummary();
    expect(summary).toContain("Overhead Tricep Extension:");
    expect(summary).toContain("15kg x 10 reps");
  });

  it("orders exercises by their own most-recent occurrence, not alphabetically", () => {
    const log = {
      [isoDaysAgo(5)]: [{ exercise: "Squat", unilateral: false, addedAt: 1, sets: [{ weightKg: 80, reps: 5 }] }],
      [isoDaysAgo(1)]: [{ exercise: "Bicep Curl", unilateral: false, addedAt: 1, sets: [{ weightKg: 10, reps: 12 }] }],
    };
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log });
    const section = buildRecentWorkoutSummary().split("Exercise history")[1];
    expect(section.indexOf("Bicep Curl")).toBeLessThan(section.indexOf("Squat"));
  });
});

describe("describeSet", () => {
  it("returns null for a unilateral set with both sides blank (so it's filtered, not shown as empty)", () => {
    const { describeSet } = loadWorkoutChat({});
    const entry = { unilateral: true, exercise: "Curl" };
    expect(describeSet(entry, { leftReps: "", rightReps: null })).toBeNull();
  });

  it("renders a unilateral set with only one side logged using '-' for the blank side", () => {
    const { describeSet } = loadWorkoutChat({});
    const entry = { unilateral: true, exercise: "Curl" };
    const desc = describeSet(entry, { leftKg: 10, leftReps: 8, rightKg: "", rightReps: "" });
    expect(desc).toBe("L 10kg x 8 reps, R x - reps");
  });
});

describe("dayLabelFor", () => {
  it("labels today as Today", () => {
    const { dayLabelFor } = loadWorkoutChat({});
    expect(dayLabelFor(isoDaysAgo(0))).toBe("Today");
  });

  it("labels yesterday as Yesterday", () => {
    const { dayLabelFor } = loadWorkoutChat({});
    expect(dayLabelFor(isoDaysAgo(1))).toBe("Yesterday");
  });

  it("labels any other day with a localized weekday/date string", () => {
    const { dayLabelFor } = loadWorkoutChat({});
    const label = dayLabelFor(isoDaysAgo(3));
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label.length).toBeGreaterThan(0);
  });
});

describe("formatBubble", () => {
  it("escapes raw HTML/script content instead of rendering it (XSS safety)", () => {
    const { formatBubble } = loadWorkoutChat({});
    const html = formatBubble("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("converts '- ' lines into a bullet list", () => {
    const { formatBubble } = loadWorkoutChat({});
    const html = formatBubble("- first point\n- second point");
    expect(html).toContain('<ul class="wlc-bullet-list">');
    expect(html).toContain("<li>first point</li>");
    expect(html).toContain("<li>second point</li>");
  });

  it("bolds **text** after escaping", () => {
    const { formatBubble } = loadWorkoutChat({});
    const html = formatBubble("Try **32 kg** next time.");
    expect(html).toContain("<strong>32 kg</strong>");
  });
});

describe("loadHistory / saveHistory", () => {
  it("returns an empty history when localStorage contains malformed JSON", () => {
    localStorage.setItem("repcheck_workout_chat_v1", "{not valid json");
    const { loadHistory } = loadWorkoutChat({});
    expect(loadHistory(isoDaysAgo(0))).toEqual([]);
  });

  it("returns an empty history when localStorage holds the old flat-array shape", () => {
    // Pre-restructure shape (a single rolling array, not date-keyed) --
    // must degrade to empty rather than throwing or misreading it as one
    // day's thread.
    localStorage.setItem(
      "repcheck_workout_chat_v1",
      JSON.stringify([{ role: "user", text: "hi", date: "2000-01-01" }])
    );
    const { loadHistory } = loadWorkoutChat({});
    expect(loadHistory("2000-01-01")).toEqual([]);
  });

  it("keeps a past day's thread readable after storing it, unaffected by other days", () => {
    const { loadHistory, saveHistory } = loadWorkoutChat({});
    const yesterday = isoDaysAgo(1);
    const today = isoDaysAgo(0);
    saveHistory(yesterday, [{ id: "a", role: "user", text: "yesterday's question", date: yesterday }]);
    saveHistory(today, [{ id: "b", role: "user", text: "today's question", date: today }]);

    expect(loadHistory(yesterday)).toEqual([
      { id: "a", role: "user", text: "yesterday's question", date: yesterday },
    ]);
    expect(loadHistory(today)).toEqual([
      { id: "b", role: "user", text: "today's question", date: today },
    ]);
  });
});

describe("today-only interactivity", () => {
  it("leaves the input/send button enabled when the selected date is today", () => {
    const { applyDateLockState, dom } = loadWorkoutChat({ selectedDate: isoDaysAgo(0) });
    applyDateLockState();
    expect(dom.inputEl.disabled).toBe(false);
    expect(dom.sendBtn.disabled).toBe(false);
    expect(dom.clearBtn.hidden).toBe(false);
    expect(dom.statusEl.hidden).toBe(true);
  });

  it("disables the input/send button and shows a read-only status for a past day", () => {
    const { applyDateLockState, dom } = loadWorkoutChat({ selectedDate: isoDaysAgo(3) });
    applyDateLockState();
    expect(dom.inputEl.disabled).toBe(true);
    expect(dom.sendBtn.disabled).toBe(true);
    expect(dom.clearBtn.hidden).toBe(true);
    expect(dom.statusEl.hidden).toBe(false);
    expect(dom.statusEl.textContent).toContain("read-only");
  });

  it("disables the input/send button for a future day too, not just past ones", () => {
    // isoDaysAgo, not toISOString(): the widget reads "today" from the LOCAL
    // date, so a UTC-derived tomorrow is the same string as local today for
    // every timezone ahead of UTC during its small hours -- this assertion
    // failed nightly between 00:00 and 07:00 in UTC+7 and passed all day.
    const tomorrow = isoDaysAgo(-1);
    const { applyDateLockState, dom } = loadWorkoutChat({ selectedDate: tomorrow });
    applyDateLockState();
    expect(dom.inputEl.disabled).toBe(true);
    expect(dom.sendBtn.disabled).toBe(true);
  });

  it("refreshForSelectedDate loads the newly-selected day's own thread and re-applies the lock state", () => {
    const yesterday = isoDaysAgo(1);
    const today = isoDaysAgo(0);
    const { refreshForSelectedDate, setSelectedDate, saveHistory, getChatHistory, dom } =
      loadWorkoutChat({ selectedDate: today });
    saveHistory(yesterday, [{ id: "a", role: "assistant", text: "yesterday's reply", date: yesterday }]);

    setSelectedDate(yesterday);
    refreshForSelectedDate();

    expect(getChatHistory()).toEqual([
      { id: "a", role: "assistant", text: "yesterday's reply", date: yesterday },
    ]);
    expect(dom.inputEl.disabled).toBe(true);
    expect(dom.messagesEl.textContent).toContain("yesterday's reply");

    setSelectedDate(today);
    refreshForSelectedDate();
    expect(getChatHistory()).toEqual([]);
    expect(dom.inputEl.disabled).toBe(false);
  });

  it("sendMessage is a no-op when the selected date isn't today, even if called directly", async () => {
    // Belt-and-suspenders coverage: the button/input being disabled is the
    // primary guard, but sendMessage() itself must also refuse, in case
    // it's ever invoked programmatically while viewing a past/future day.
    const fetchImpl = vi.fn();
    const { sendMessage, dom, getChatHistory } = loadWorkoutChat({ selectedDate: isoDaysAgo(2), fetchImpl });
    dom.inputEl.value = "should not send";

    await sendMessage();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getChatHistory()).toEqual([]);
  });
});

describe("sendMessage", () => {
  it("posts the message + built summary and appends the bot reply on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, reply: "Try **32 kg**.", limited: false, retry_after_seconds: 0 }),
    });
    const { sendMessage, dom, getChatHistory } = loadWorkoutChat({ fetchImpl });
    dom.inputEl.value = "How's my bench?";

    await sendMessage();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, options] = fetchImpl.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.message).toBe("How's my bench?");
    expect(body.context).toHaveProperty("workout_summary");
    // Regression: chatHistory has the new turn pushed onto it (for optimistic
    // rendering) BEFORE the fetch -- the wire payload's `history` must exclude
    // that just-added turn, or the server ends up sending Gemini the same
    // user message twice (once as `message`, once as the last history item).
    expect(body.history).toEqual([]);

    const hist = getChatHistory();
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ role: "user", text: "How's my bench?" });
    expect(hist[1]).toMatchObject({ role: "assistant", text: "Try **32 kg**." });
    expect(dom.messagesEl.innerHTML).toContain("<strong>32 kg</strong>");
  });

  it("sends only PRIOR turns as history, excluding the message just being sent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, reply: "ok", limited: false, retry_after_seconds: 0 }),
    });
    const { sendMessage, dom, setChatHistory } = loadWorkoutChat({ fetchImpl });
    setChatHistory([
      { role: "user", text: "earlier question", date: "2026-08-13" },
      { role: "assistant", text: "earlier answer", date: "2026-08-13" },
    ]);
    dom.inputEl.value = "follow up";

    await sendMessage();

    const [, options] = fetchImpl.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.message).toBe("follow up");
    expect(body.history).toEqual([
      { role: "user", text: "earlier question", date: "2026-08-13" },
      { role: "assistant", text: "earlier answer", date: "2026-08-13" },
    ]);
  });

  it("shows a friendly error bubble when the request throws (network failure)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const { sendMessage, dom, getChatHistory } = loadWorkoutChat({ fetchImpl });
    dom.inputEl.value = "hello";

    await sendMessage();

    const hist = getChatHistory();
    expect(hist[1].text).toBe("Something went wrong reaching the workout chat. Please try again.");
    expect(dom.sendBtn.disabled).toBe(false);
  });

  it("locks the input and shows a countdown status when the reply is rate-limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, reply: "Limit hit", limited: true, retry_after_seconds: 3600 }),
    });
    const { sendMessage, dom } = loadWorkoutChat({ fetchImpl });
    dom.inputEl.value = "hello";

    await sendMessage();

    expect(dom.inputEl.disabled).toBe(true);
    expect(dom.sendBtn.disabled).toBe(true);
    expect(dom.statusEl.hidden).toBe(false);
    expect(dom.statusEl.textContent).toContain("Limit reached");
    expect(dom.inputEl.placeholder).toBe("Message limit reached");
  });
});

describe("renderSuggestions", () => {
  it("sends the suggestion text as a message when a suggestion chip is clicked", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, reply: "ok", limited: false, retry_after_seconds: 0 }),
    });
    const { renderSuggestions, dom } = loadWorkoutChat({ fetchImpl });

    renderSuggestions();
    const chip = dom.suggestionsEl.querySelector("[data-suggestion]");
    expect(chip).not.toBeNull();
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, options] = fetchImpl.mock.calls[0];
    expect(JSON.parse(options.body).message).toBe(chip.dataset.suggestion);
  });
});

describe("clear chat button", () => {
  it("wipes the conversation from state and localStorage on click", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, reply: "hi", limited: false, retry_after_seconds: 0 }),
    });
    const { sendMessage, dom, getChatHistory } = loadWorkoutChat({ fetchImpl });
    dom.inputEl.value = "hello";
    await sendMessage();
    expect(getChatHistory().length).toBeGreaterThan(0);

    dom.clearBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getChatHistory()).toEqual([]);
    expect(JSON.parse(localStorage.getItem("repcheck_workout_chat_v1"))).toEqual({
      [isoDaysAgo(0)]: [],
    });
  });

  it("is hidden (and a no-op) when the selected date isn't today", () => {
    const { applyDateLockState, dom } = loadWorkoutChat({ selectedDate: isoDaysAgo(1) });
    applyDateLockState();
    expect(dom.clearBtn.hidden).toBe(true);
  });
});

describe("sendMessage double-submit guard", () => {
  it("ignores a second send while the first request is still in flight", async () => {
    let resolveFetch;
    const fetchImpl = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const { sendMessage, dom } = loadWorkoutChat({ fetchImpl });

    dom.inputEl.value = "first";
    const p1 = sendMessage();
    dom.inputEl.value = "second";
    const p2 = sendMessage(); // isSending is already true -- should be a no-op

    resolveFetch({ json: async () => ({ ok: true, reply: "ok", limited: false, retry_after_seconds: 0 }) });
    await Promise.all([p1, p2]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("applyLimitLockout / formatCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("re-enables the input once the lockout timer elapses", () => {
    const { applyLimitLockout, dom } = loadWorkoutChat({});
    applyLimitLockout(60);

    expect(dom.inputEl.disabled).toBe(true);
    vi.advanceTimersByTime(60 * 1000);

    expect(dom.inputEl.disabled).toBe(false);
    expect(dom.sendBtn.disabled).toBe(false);
    expect(dom.statusEl.hidden).toBe(true);
    vi.useRealTimers();
  });
});

describe("empty-log visibility", () => {
  it("stays hidden when nothing has ever been logged", () => {
    const { dom } = loadWorkoutChat({ log: {} });
    expect(dom.chatEl.hidden).toBe(true);
  });

  it("stays hidden when a day exists in the log but holds no exercises", () => {
    const { dom } = loadWorkoutChat({ log: { [isoDaysAgo(0)]: [] } });
    expect(dom.chatEl.hidden).toBe(true);
  });

  it("shows once at least one exercise is logged on any day", () => {
    const log = {
      [isoDaysAgo(3)]: [
        { name: "Bench Press", addedAt: 1, sets: [{ reps: 8, weightKg: 60 }] },
      ],
    };
    const { dom } = loadWorkoutChat({ log });
    expect(dom.chatEl.hidden).toBe(false);
  });

  it("appears after the first exercise lands and the timeline re-renders", () => {
    const today = isoDaysAgo(0);
    const log = {};
    const { dom, refreshForSelectedDate } = loadWorkoutChat({ log, selectedDate: today });
    expect(dom.chatEl.hidden).toBe(true);

    log[today] = [{ name: "Squat", addedAt: 1, sets: [{ reps: 5, weightKg: 80 }] }];
    refreshForSelectedDate(); // what repcheck:workout-date-changed triggers

    expect(dom.chatEl.hidden).toBe(false);
  });

  it("keeps showing on an empty past day when other days have workouts", () => {
    const log = {
      [isoDaysAgo(2)]: [
        { name: "Deadlift", addedAt: 1, sets: [{ reps: 5, weightKg: 100 }] },
      ],
    };
    const { dom, setSelectedDate, refreshForSelectedDate } = loadWorkoutChat({ log });
    setSelectedDate(isoDaysAgo(5));
    refreshForSelectedDate();

    expect(dom.chatEl.hidden).toBe(false);
  });
});
