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

const START_MARKER = "// ---------- AI chat grounded in the user's logged workouts ----------\n  // Chat is scoped to whichever date is selected in the date strip above:";
const IIFE_OPEN = "(function () {";
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
      loadAllThreads,
      isSelectedDateToday,
      applyDateLockState,
      refreshForSelectedDate,
      getChatHistory: () => chatHistory,
      setChatHistory: (h) => { chatHistory = h; },
    };
  `;

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8").replace(/\r\n/g, "\n");
  const commentStart = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (commentStart === -1 || end === -1 || end <= commentStart) {
    throw new Error(
      "loadWorkoutChat: could not find the workout-chat IIFE in " +
        "templates/workouts.html -- the extraction markers moved or the " +
        "widget was renamed. Update START/END markers in loadWorkoutChat.js."
    );
  }
  const iifeStart = html.indexOf(IIFE_OPEN, commentStart);
  if (iifeStart === -1 || iifeStart > end) {
    throw new Error(
      "loadWorkoutChat: found the comment marker but not the IIFE opening " +
        "right after it -- update IIFE_OPEN in loadWorkoutChat.js."
    );
  }
  // Slice from `(function () {` through the closing `})();` (inclusive),
  // then splice the return statement in just before that final `})();`.
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
function defaultToIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * @param {string} [selectedDate] - the date-strip's currently-selected day
 *   (ISO). Defaults to today. The real widget reads this via closure over
 *   the outer script's `let selectedDate` (see templates/workouts.html) --
 *   pass a past/future date here to test the read-only-when-not-today gate,
 *   and use the returned `setSelectedDate` to simulate date navigation.
 */
export function loadWorkoutChat({ log = {}, locale = "en", fetchImpl = null, selectedDate = null } = {}) {
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
    "workoutChat.subtitle": "Ask about progressive overload on anything you've logged",
    "workoutChat.inputPlaceholder": "Ask about your recent workouts...",
    "workoutChat.empty": "Ask about progressive overload, form, or rep maxes for anything you've logged.",
    "workoutChat.suggestion1": "How should I progressive overload my most recent exercise?",
    "workoutChat.suggestion2": "Am I training each muscle enough this week?",
    "workoutChat.limitReached": "Limit reached — resets in {time}",
    "workoutChat.limitReachedPlaceholder": "Message limit reached",
    "workoutChat.errorReaching": "Something went wrong reaching the workout chat. Please try again.",
    "workoutChat.readOnlyDayStatus": "You can only chat on today's log — this conversation is read-only.",
    "workoutChat.readOnlyDayPlaceholder": "Chat only works on today's log",
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
    return defaultToIsoDate(date);
  }
  function isBlank(v) { return v === "" || v === null || v === undefined; }
  const BODYWEIGHT_EXERCISES = new Set(["Pull-Up", "Push-Up", "Sit-Up", "Plank"]);
  function isBodyweight(name) { return BODYWEIGHT_EXERCISES.has(name); }

  if (fetchImpl) {
    global.fetch = fetchImpl;
  }

  const source = extractSource();
  // The real template's chat IIFE reads `selectedDate` via closure over
  // the outer script's `let selectedDate` -- since this extracted copy has
  // no such outer scope, `selectedDate` is instead a parameter of this
  // factory (a real local binding the inlined IIFE closes over the same
  // way), and setSelectedDate lets tests reassign it exactly the way a
  // real date-strip click would, before calling refreshForSelectedDate().
  const factory = new Function(
    "document",
    "localStorage",
    "log",
    "toIsoDate",
    "isBlank",
    "isBodyweight",
    "RepCheckUnits",
    "RepCheckI18n",
    "selectedDate",
    `
    function setSelectedDate(d) { selectedDate = d; }
    const api = ${source};
    return { ...api, setSelectedDate };
    `
  );

  const api = factory(
    document,
    localStorage,
    log,
    toIsoDate,
    isBlank,
    isBodyweight,
    RepCheckUnits,
    RepCheckI18n,
    selectedDate || defaultToIsoDate(new Date())
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
