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

  // Each analyzed workout gets its own permanent chat thread, keyed by its
  // server-side analyze_results row id (context.id) -- so asking a
  // question on one analysis never shows up on (or is affected by)
  // another's chat, and reopening the SAME analysis later still has the
  // conversation right where it was left. Anonymous/local-only use (no
  // context.id -- /api/analyze-chat itself requires login anyway) just
  // falls back to the old page-view-only behavior, nothing persisted.
  const STORAGE_PREFIX = "repcheck_analyze_chat_v1_";
  const LOCK_AFTER_MS = 24 * 60 * 60 * 1000;
  // How long a thread's storage key is kept around after its 24h
  // prompting window closes -- history stays readable for a while after
  // a revisit, but without this a chat key would otherwise live in
  // localStorage forever, once per analysis, for as long as the account
  // exists (analyze_results rows themselves get pruned server-side; nothing
  // ever pruned the matching localStorage key to match).
  const RETAIN_AFTER_LOCK_MS = 30 * 24 * 60 * 60 * 1000;

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) { return fallback; }
  }

  // Opportunistic sweep of old threads well past their retention window --
  // runs once per widget init, cheap (a handful of keys at most), and is
  // the only place anything ever removes a repcheck_analyze_chat_v1_* key.
  function pruneStaleChatThreads() {
    const now = Date.now();
    Object.keys(localStorage).forEach((key) => {
      if (!key.startsWith(STORAGE_PREFIX)) return;
      const stored = loadJson(key, null);
      const createdAtMs = stored && stored.createdAtMs;
      if (typeof createdAtMs === "number" && now - createdAtMs > LOCK_AFTER_MS + RETAIN_AFTER_LOCK_MS) {
        localStorage.removeItem(key);
      }
    });
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

    let lockoutInterval = null;
    let lockoutTimeout = null;

    pruneStaleChatThreads();

    // This markup (and inputEl/sendBtn) is reused across multiple init()
    // calls on the AJAX result view (index.html re-renders into the same
    // #ac-dock for every fresh analysis or history entry viewed) -- a
    // PREVIOUS call locking the input (rate limit, or a >24h-old chat)
    // never got explicitly undone, so a later, perfectly fresh chat could
    // silently inherit "can't type anything" from whatever was viewed
    // before it. Always start clean; applyClosedState() below re-locks
    // it only if *this* context actually warrants it.
    clearInterval(lockoutInterval);
    clearTimeout(lockoutTimeout);
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.placeholder = t("analyzeChat.inputPlaceholder");
    if (subEl) subEl.textContent = "";

    const storageKey = context.id != null ? `${STORAGE_PREFIX}${context.id}` : null;
    const stored = storageKey ? loadJson(storageKey, null) : null;
    let history = (stored && stored.history) || [];

    function persistHistory() {
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify({
        createdAtMs: context.created_at_ms || Date.now(),
        history,
      }));
    }

    const isLocked = typeof context.created_at_ms === "number" && (Date.now() - context.created_at_ms > LOCK_AFTER_MS);
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
    // The results screen docks this to the BOTTOM of the viewport as a
    // full-width field that is always visible (see the html.an-result
    // block in style.css). Several behaviours below only make sense for
    // the original top-of-page collapsed circle: growing the bar out of a
    // 44px circle before focusing, pull-down-to-open, and close-on-scroll
    // (scrolling the report must not shut a chat the user opened).
    const bottomMode = document.documentElement.classList.contains("an-result");
    // Plain focus(), no { preventScroll: true } -- that option has a
    // known class of iOS Safari bugs where it silently fails to actually
    // focus the element (or raise the keyboard) instead of throwing, so a
    // try/catch around it never falls back to anything. A harmless auto-
    // scroll into view is a fine trade for the keyboard reliably showing.
    function focusInput() { inputEl.focus(); }
    function isOpen() { return dockEl.classList.contains("is-open"); }
    function open(focusNow) {
      const wasOpen = isOpen();
      if (!wasOpen) { dockEl.classList.add("is-open"); openedAt = Date.now(); }
      if (!focusNow) return;
      // iOS only reliably raises the keyboard for a focus() call that is
      // (a) synchronous within the user gesture and (b) lands on a field
      // that's ALREADY laid out at a real, non-zero size -- ours starts
      // clipped to ~0 width inside the collapsed circle. Neither a bare
      // classList.add() (doesn't force a synchronous layout recalc, so
      // the field can still measure as 0-size when focus() runs) nor
      // deferring focus() via requestAnimationFrame (which can land
      // outside iOS's user-activation window entirely, silently
      // preventing the keyboard from ever appearing -- the strongest
      // suspect for this surviving an earlier fix attempt) reliably
      // satisfies both. So: force the full width directly, force a
      // synchronous reflow by reading a layout property, THEN focus --
      // all still inside the same synchronous click handler, nothing
      // deferred before the focus() call itself. The transition/inline
      // overrides are cleared a frame LATER (not immediately, unlike an
      // earlier version of this code), so the field stays at its real,
      // focused size for at least one full frame instead of being
      // snapped back down out from under the keyboard mid-raise.
      if (bottomMode) {
        // Already full width and laid out, so the reflow dance below is
        // unnecessary -- and forcing an inline width here would fight the
        // docked bar's own sizing.
        focusInput();
      } else if (barEl && rowEl && !wasOpen) {
        barEl.style.transition = "none";
        rowEl.style.transition = "none";
        rowEl.style.opacity = "1";
        barEl.style.width = "min(480px, 100%)";
        void barEl.offsetWidth;
        focusInput();
        requestAnimationFrame(() => {
          barEl.style.transition = "";
          rowEl.style.transition = "";
          barEl.style.width = "";
          rowEl.style.opacity = "";
        });
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
    //    In bottom mode the spark is just the field's leading icon (CSS
    //    makes it pointer-events:none), so the field itself carries this.
    function onToggleClick() { isOpen() ? close() : open(true); }
    if (toggleEl) toggleEl.addEventListener("click", onToggleClick);

    // Bottom mode: focusing the always-visible field is the open gesture,
    // and an explicit close button dismisses the panel (there is no
    // collapsed circle left to tap a second time).
    function onInputFocus() { if (!isOpen()) open(false); }
    const closeEl = document.getElementById("ac-close");
    function onCloseClick() { close(); }
    // The keyboard shrinks the visual viewport without moving a
    // position:fixed element, so the bar would sit behind it. Offsetting
    // by the hidden amount keeps the field above the keyboard.
    const vv = window.visualViewport;
    function onViewportResize() {
      if (!vv) return;
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      dockEl.style.transform = hidden > 0 ? `translateY(-${hidden}px)` : "";
    }
    if (bottomMode) {
      inputEl.addEventListener("focus", onInputFocus);
      if (closeEl) closeEl.addEventListener("click", onCloseClick);
      if (vv) {
        vv.addEventListener("resize", onViewportResize);
        vv.addEventListener("scroll", onViewportResize);
      }
    }

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
    // Pull-to-open and close-on-scroll are top-dock behaviours only.
    if (!bottomMode) {
      document.addEventListener("touchstart", onTouchStart, { passive: true });
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd, { passive: true });
      document.addEventListener("touchcancel", onTouchEnd, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    window.__agCleanup = function () {
      if (toggleEl) toggleEl.removeEventListener("click", onToggleClick);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("scroll", onScroll);
      inputEl.removeEventListener("focus", onInputFocus);
      if (closeEl) closeEl.removeEventListener("click", onCloseClick);
      if (vv) {
        vv.removeEventListener("resize", onViewportResize);
        vv.removeEventListener("scroll", onViewportResize);
      }
      dockEl.style.transform = "";
      rootStyle.overscrollBehaviorY = prevOverscroll;
    };

    function scrollToBottom() {
      threadEl.scrollTop = threadEl.scrollHeight;
    }

    function renderMessages() {
      if (!history.length) {
        // Empty state: a couple of tappable starter questions above the bar,
        // iOS-Spotlight-suggestion style. The thread panel stays hidden.
        // Skipped once locked -- there's nothing useful to suggest asking
        // in a chat that can no longer accept prompts.
        threadEl.innerHTML = "";
        if (isLocked) { suggestEl.innerHTML = ""; return; }
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
      // isLocked is permanent (no countdown to wait out, unlike the rate
      // limit below) -- guarded here too, not just via the disabled input,
      // since a suggestion chip click bypasses the input entirely.
      if (!message || isSending || isLocked) return;

      isSending = true;
      sendBtn.disabled = true;
      inputEl.value = "";

      history.push({ role: "user", text: message });
      persistHistory();
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
        persistHistory();
        renderMessages();
        // Counts toward the streak like any other use of the app. Needs an
        // explicit mark because these threads are keyed by analysis id,
        // not by date, so nothing in them says WHEN a question was asked.
        if (data.ok && window.RepCheckStreak) RepCheckStreak.mark("analyze_chat");
        if (data.ok && data.limited) {
          applyLimitLockout(data.retry_after_seconds);
        }
      } catch (err) {
        hideTyping();
        history.push({ role: "assistant", text: t("analyzeChat.errorReaching") });
        persistHistory();
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

    // Permanent, unlike applyLimitLockout() above -- there's no countdown
    // to wait out, so the input/button just stay disabled and the history
    // (if any) stays exactly as readable as it was before locking.
    function applyClosedState() {
      inputEl.disabled = true;
      sendBtn.disabled = true;
      inputEl.placeholder = t("analyzeChat.closedPlaceholder");
      if (subEl) subEl.textContent = t("analyzeChat.closed");
    }

    if (isLocked) applyClosedState();
    renderMessages();
    document.addEventListener("repcheck:language-changed", () => {
      renderMessages();
      if (isLocked) applyClosedState();
    });
  }

  window.AnalyzeChatWidget = { init };
})();
