// Loads the REAL workout-chat widget IIFE out of templates/workouts.html and
// runs it in jsdom, rather than maintaining a hand-copied duplicate that can
// silently drift from what actually ships. Same extraction-by-source-marker
// approach as loadReviewStep.js / loadSetsRepsBuckets.js -- the function is
// inline in a server-rendered Jinja template with no module boundary.
//
// If the markers below stop matching, extraction throws immediately and
// loudly rather than silently testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "workouts.html");

const START_MARKER = "// ---------- AI chat scoped to the last 7 days of logged workouts ----------\n  (function () {";
const END_MARKER = "  })();\n</script>";

// Internals exposed to tests via an injected return statement -- the real
// IIFE returns nothing (it's fire-and-forget, wiring event listeners), so
// this return is added only inside the extracted copy, immediately before
// its closing `})();`.
const RETURN_STMT = `
    return {
      buildRecentWorkoutSummary,
      describeSet,
      dayLabelFor,
      formatBubble,
      escapeHtml,
      sendMessage,
      applyLimitLockout,
      formatCountdown,
      renderMessages,
      renderSuggestions,
      loadHistory,
      saveHistory,
      getChatHistory: () => chatHistory,
      setChatHistory: (h) => { chatHistory = h; },
    };
  `;

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8").replace(/\r\n/g, "\n");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadWorkoutChat: could not find the workout-chat IIFE in " +
        "templates/workouts.html -- the extraction markers moved or the " +
        "widget was renamed. Update START/END markers in loadWorkoutChat.js."
    );
  }
  // Slice from `(function () {` through the closing `})();` (inclusive),
  // then splice the return statement in just before that final `})();`.
  const iifeStart = start + START_MARKER.indexOf("(function () {");
  const closeIdx = html.lastIndexOf("})();", end + END_MARKER.length);
  const body = html.slice(iifeStart, closeIdx);
  return `${body}${RETURN_STMT}})();`;
}

/**
 * Evaluates the real widget source against a fresh set of mocks/DOM and
 * returns the callable internals a test needs. Every call gets its own DOM
 * nodes, its own `log` object, and its own fetch mock so tests don't bleed
 * state into each other.
 */
export function loadWorkoutChat({ log = {}, locale = "en", fetchImpl = null } = {}) {
  document.body.innerHTML = `
    <div class="wlc-chat" id="wlc-chat">
      <div class="wlc-header">
        <button type="button" class="wlc-clear-btn" id="wlc-clear-btn"></button>
      </div>
      <div class="wlc-messages" id="wlc-messages"></div>
      <div class="wlc-suggestions" id="wlc-suggestions"></div>
      <div class="wlc-status" id="wlc-status" hidden></div>
      <form class="wlc-input-pill" id="wlc-form">
        <input type="text" id="wlc-input" maxlength="600">
        <button type="submit" class="wlc-send-btn" id="wlc-send-btn"></button>
      </form>
    </div>
  `;
  const I18N = {
    "workoutChat.title": "Workout AI Chat",
    "workoutChat.subtitle": "Ask about your last 7 days of training",
    "workoutChat.inputPlaceholder": "Ask about your recent workouts...",
    "workoutChat.empty": "Ask about progressive overload, form, or rep maxes for anything you've logged in the last 7 days.",
    "workoutChat.suggestion1": "How should I progressive overload my most recent exercise?",
    "workoutChat.suggestion2": "Am I training each muscle enough this week?",
    "workoutChat.limitReached": "Limit reached — resets in {time}",
    "workoutChat.limitReachedPlaceholder": "Message limit reached",
    "workoutChat.errorReaching": "Something went wrong reaching the workout chat. Please try again.",
    "workouts.plan.today": "Today",
    "workouts.day.yesterday": "Yesterday",
  };
  const RepCheckI18n = {
    t(key, vars) {
      let s = I18N[key] || key;
      if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
      return s;
    },
    locale() { return locale; },
  };
  const RepCheckUnits = {
    weightUnitLabel() { return "kg"; },
    kgToDisplay(kg) { return kg; },
  };

  function toIsoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function isBlank(v) { return v === "" || v === null || v === undefined; }
  const BODYWEIGHT_EXERCISES = new Set(["Pull-Up", "Push-Up", "Sit-Up", "Plank"]);
  function isBodyweight(name) { return BODYWEIGHT_EXERCISES.has(name); }

  if (fetchImpl) {
    global.fetch = fetchImpl;
  }

  const source = extractSource();
  const factory = new Function(
    "document",
    "localStorage",
    "log",
    "toIsoDate",
    "isBlank",
    "isBodyweight",
    "RepCheckUnits",
    "RepCheckI18n",
    `return ${source}`
  );

  const api = factory(
    document,
    localStorage,
    log,
    toIsoDate,
    isBlank,
    isBodyweight,
    RepCheckUnits,
    RepCheckI18n
  );

  return {
    ...api,
    dom: {
      chatEl: document.getElementById("wlc-chat"),
      messagesEl: document.getElementById("wlc-messages"),
      suggestionsEl: document.getElementById("wlc-suggestions"),
      formEl: document.getElementById("wlc-form"),
      inputEl: document.getElementById("wlc-input"),
      sendBtn: document.getElementById("wlc-send-btn"),
      clearBtn: document.getElementById("wlc-clear-btn"),
      statusEl: document.getElementById("wlc-status"),
    },
  };
}
