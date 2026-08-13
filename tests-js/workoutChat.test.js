// DOM-level coverage for the last-7-days workout chat widget added to
// templates/workouts.html. The 15 existing pytest tests (tests/test_workout_chat.py)
// only cover the Python backend (prompt building + /api/workout-chat route);
// this file covers the client-side JS that had zero test coverage: building
// the 7-day summary sent to the model, formatting/escaping bot replies, day
// labeling, and the send/lockout/error UI flows.
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
  it("reports every one of the last 7 days as unlogged when the log is empty", () => {
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log: {} });
    const summary = buildRecentWorkoutSummary();
    const lines = summary.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines.every((l) => l.includes("no workout logged."))).toBe(true);
    // Today must be the last line (days are emitted oldest -> newest).
    expect(lines[6]).toContain(isoDaysAgo(0));
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
    expect(summary).toContain("Bench Press: 60kg x 8 reps; 60kg x 6 reps");
  });

  it("describes a bodyweight exercise without a weight figure", () => {
    const today = isoDaysAgo(0);
    const log = {
      [today]: [
        { exercise: "Pull-Up", unilateral: false, addedAt: 1, sets: [{ reps: 10 }] },
      ],
    };
    const { buildRecentWorkoutSummary } = loadWorkoutChat({ log });
    expect(buildRecentWorkoutSummary()).toContain("Pull-Up: 10 reps (bodyweight)");
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
      "Dumbbell Curl: L 12kg x 10 reps, R 14kg x 8 reps"
    );
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
    expect(loadHistory()).toEqual([]);
  });

  it("discards a stored history from a previous day", () => {
    localStorage.setItem(
      "repcheck_workout_chat_v1",
      JSON.stringify([{ role: "user", text: "hi", date: "2000-01-01" }])
    );
    const { loadHistory } = loadWorkoutChat({});
    expect(loadHistory()).toEqual([]);
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

    const hist = getChatHistory();
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ role: "user", text: "How's my bench?" });
    expect(hist[1]).toMatchObject({ role: "assistant", text: "Try **32 kg**." });
    expect(dom.messagesEl.innerHTML).toContain("<strong>32 kg</strong>");
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
