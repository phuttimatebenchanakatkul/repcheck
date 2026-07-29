/**
 * Apple-Intelligence-style "ask" bar scoped to one specific Analyze result.
 * Shared between templates/index.html's AJAX result view and
 * templates/result.html's server-rendered fallback -- both build the same
 * DOM (#ac-dock, #ac-toggle, #ac-messages, #ac-suggestions, #ac-form,
 * #ac-input, #ac-send-btn, #ac-header-sub) and call
 * AnalyzeChatWidget.init(context) once, each building `context` from the
 * data it already has (live JS state after the fetch, or Jinja-inlined
 * values on the fallback path).
 *
 * The dock is a small frosted glass circle centered in normal flow at the
 * TOP of the results. It's strictly binary -- open or closed, never in
 * between. Tapping the circle (or pulling down at the very top edge) opens
 * it: the pill widens and a panel expands below, pushing the results down to
 * make room; closing (tap again, or scroll the page down) returns everything.
 *
 * No localStorage persistence -- context and history live only in this
 * module's own JS state for the current page view, matching the rest of the
 * Analyze results page (see analyze_chat.py's header comment for why).
 */
(function () {
  "use strict";

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatBubble(text) {
    const lines = escapeHtml(text).split("\n");
    let html = "";
    let inList = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const isBullet = /^[-*]\s+/.test(line);
      if (isBullet) {
        if (!inList) { html += "<ul class=\"ag-bullet-list\">"; inList = true; }
        html += `<li>${line.replace(/^[-*]\s+/, "")}</li>`;
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        if (line) html += `<p>${line}</p>`;
      }
    }
    if (inList) html += "</ul>";
    return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function init(context) {
    const t = RepCheckI18n.t;
    const dockEl = document.getElementById("ac-dock");
    const threadEl = document.getElementById("ac-messages");
    const suggestEl = document.getElementById("ac-suggestions");
    const formEl = document.getElementById("ac-form");
    const inputEl = document.getElementById("ac-input");
    const sendBtn = document.getElementById("ac-send-btn");
    const subEl = document.getElementById("ac-header-sub");
    if (!dockEl || !formEl || !threadEl) return; // widget markup not on this page

    let history = [];
    let isSending = false;

    // ---- Binary open / close (no in-between) ----
    // The dock is a small glass circle centered in normal flow at the top of
    // the results. open()/close() toggle .is-open; the CSS widens the pill
    // and expands the panel, and because the dock is in flow the results
    // below are pushed down (and returned) smoothly. Strictly binary. Any
    // previous run's listeners are torn down first (AJAX re-inits per run).
    if (window.__agCleanup) { window.__agCleanup(); window.__agCleanup = null; }

    const toggleEl = document.getElementById("ac-toggle");
    let openedAt = 0;
    const barEl = inputEl.closest(".ag-bar");
    const rowEl = inputEl.closest(".ag-inputrow");
    function focusInput() {
      try { inputEl.focus({ preventScroll: true }); } catch (e) { inputEl.focus(); }
    }
    function isOpen() { return dockEl.classList.contains("is-open"); }
    function open(focusNow) {
      const wasOpen = isOpen();
      if (!wasOpen) { dockEl.classList.add("is-open"); openedAt = Date.now(); }
      if (!focusNow) return;
      // iOS only raises the keyboard for focus() called SYNCHRONOUSLY in a
      // user gesture AND on a visible, non-zero-size field. Ours is clipped
      // to ~0 width until the widen animation runs, so: force the OPEN width
      // (transition off, layout only, never painted), focus to raise the
      // keyboard, then snap back to the collapsed width and restore the
      // transition -- the widen now animates from the circle with the field
      // already focused (the keyboard stays up).
      if (barEl && rowEl && !wasOpen) {
        barEl.style.transition = "none";
        rowEl.style.transition = "none";
        rowEl.style.opacity = "1";
        barEl.style.width = "min(480px, 100%)";
        void barEl.offsetWidth;
        focusInput();
        barEl.style.width = "44px";
        void barEl.offsetWidth;
        barEl.style.transition = "";
        rowEl.style.transition = "";
        barEl.style.width = "";
        rowEl.style.opacity = "";
      } else {
        focusInput();
      }
    }
    function close() {
      if (!isOpen()) return;
      dockEl.classList.remove("is-open");
      if (document.activeElement === inputEl) inputEl.blur();
    }

    // 1) Tap the circle to open (+ focus, so the keyboard pops) or close.
    function onToggleClick() { isOpen() ? close() : open(true); }
    if (toggleEl) toggleEl.addEventListener("click", onToggleClick);

    // 2) Pull down at the very top edge (the pull-to-refresh zone). While
    //    dragging it only PREVIEWS -- a small dip that follows the finger --
    //    and commits to opening only on RELEASE, past PULL_OPEN. Tiny jitter
    //    (<=14px) is ignored so it never swallows a normal tap's click.
    const PULL_OPEN = 64;
    let pullStartY = 0, pulling = false, pullDy = 0;
    function clearPullPreview() {
      dockEl.style.transform = "";
      dockEl.classList.remove("is-pulling");
    }
    function onTouchStart(e) {
      pulling = window.scrollY <= 0 && !isOpen();
      pullStartY = e.touches[0].clientY;
      pullDy = 0;
    }
    function onTouchMove(e) {
      if (!pulling) return;
      if (window.scrollY > 0) { pulling = false; clearPullPreview(); return; }
      const dy = e.touches[0].clientY - pullStartY;
      pullDy = dy;
      if (dy <= 14) { clearPullPreview(); return; }
      e.preventDefault();
      dockEl.classList.add("is-pulling");
      dockEl.style.transform = `translateY(${Math.min((dy - 14) * 0.35, 28)}px)`;
    }
    function onTouchEnd() {
      if (!pulling) return;
      pulling = false;
      const passed = pullDy >= PULL_OPEN;
      clearPullPreview();
      if (passed) open(true); // release past threshold -> open + focus in-gesture
    }

    // 3) A deliberate downward scroll closes it again. Must NOT fire right
    //    after opening or while the field is focused: the keyboard sliding up
    //    resizes the viewport and emits scroll events that would otherwise
    //    slam it shut the instant it opened.
    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      const goingDown = y - lastY;
      lastY = y;
      if (isOpen() && goingDown > 4 && y > 8 &&
          document.activeElement !== inputEl &&
          Date.now() - openedAt > 500) {
        close();
      }
    }

    const rootStyle = document.documentElement.style;
    const prevOverscroll = rootStyle.overscrollBehaviorY;
    rootStyle.overscrollBehaviorY = "contain";
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    window.__agCleanup = function () {
      if (toggleEl) toggleEl.removeEventListener("click", onToggleClick);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("scroll", onScroll);
      rootStyle.overscrollBehaviorY = prevOverscroll;
    };

    function scrollToBottom() {
      threadEl.scrollTop = threadEl.scrollHeight;
    }

    function renderMessages() {
      if (!history.length) {
        // Empty state: a couple of tappable starter questions above the bar,
        // iOS-Spotlight-suggestion style. The thread panel stays hidden.
        threadEl.innerHTML = "";
        const keys = ["analyzeChat.suggestion1", "analyzeChat.suggestion2"];
        suggestEl.innerHTML = keys.map((key) => {
          const q = t(key);
          return `<button type="button" class="ag-chip" data-suggestion="${escapeHtml(q)}">${q}</button>`;
        }).join("");
        suggestEl.querySelectorAll("[data-suggestion]").forEach((btn) => {
          btn.addEventListener("click", () => {
            inputEl.value = btn.dataset.suggestion;
            sendMessage();
          });
        });
        return;
      }
      suggestEl.innerHTML = "";
      threadEl.innerHTML = history.map((turn) => `
        <div class="ag-row ${turn.role === "user" ? "ag-row-user" : "ag-row-assistant"}">
          <div class="ag-bubble">${formatBubble(turn.text)}</div>
        </div>
      `).join("");
      scrollToBottom();
    }

    function showTyping() {
      const row = document.createElement("div");
      row.className = "ag-typing";
      row.id = "ac-typing-row";
      row.innerHTML = "<span></span><span></span><span></span>";
      threadEl.appendChild(row);
      scrollToBottom();
    }

    function hideTyping() {
      const row = document.getElementById("ac-typing-row");
      if (row) row.remove();
    }

    let lockoutInterval = null;
    let lockoutTimeout = null;

    function formatCountdown(seconds) {
      seconds = Math.max(seconds, 0);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return hours ? `${hours}h ${minutes}m` : `${Math.max(minutes, 1)}m`;
    }

    function applyLimitLockout(retryAfterSeconds) {
      let remaining = retryAfterSeconds;
      inputEl.disabled = true;
      sendBtn.disabled = true;
      inputEl.placeholder = t("analyzeChat.limitReachedPlaceholder");

      const updateSub = () => { if (subEl) subEl.textContent = t("analyzeChat.limitReached", { time: formatCountdown(remaining) }); };
      updateSub();

      clearInterval(lockoutInterval);
      clearTimeout(lockoutTimeout);
      lockoutInterval = setInterval(() => {
        remaining = Math.max(remaining - 30, 0);
        updateSub();
      }, 30000);
      lockoutTimeout = setTimeout(() => {
        clearInterval(lockoutInterval);
        inputEl.disabled = false;
        sendBtn.disabled = false;
        inputEl.placeholder = t("analyzeChat.inputPlaceholder");
        if (subEl) subEl.textContent = "";
        inputEl.focus();
      }, retryAfterSeconds * 1000);
    }

    async function sendMessage() {
      const message = inputEl.value.trim();
      if (!message || isSending) return;

      isSending = true;
      sendBtn.disabled = true;
      inputEl.value = "";

      history.push({ role: "user", text: message });
      renderMessages();
      showTyping();

      try {
        const response = await fetch("/api/analyze-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history, context }),
        });
        const data = await response.json();
        hideTyping();
        const reply = data.ok ? data.reply : (data.error || t("analyzeChat.errorReaching"));
        history.push({ role: "assistant", text: reply });
        renderMessages();
        if (data.ok && data.limited) {
          applyLimitLockout(data.retry_after_seconds);
        }
      } catch (err) {
        hideTyping();
        history.push({ role: "assistant", text: t("analyzeChat.errorReaching") });
        renderMessages();
      } finally {
        isSending = false;
        if (!inputEl.disabled) {
          sendBtn.disabled = false;
          inputEl.focus();
        }
      }
    }

    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage();
    });

    renderMessages();
    document.addEventListener("repcheck:language-changed", renderMessages);
  }

  window.AnalyzeChatWidget = { init };
})();
