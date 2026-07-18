/**
 * Small chatbot widget scoped to one specific Analyze result. Shared
 * between templates/index.html's AJAX result view and templates/result.html's
 * server-rendered fallback -- both build the same DOM markup (#ac-messages,
 * #ac-suggestions, #ac-form, #ac-input, #ac-send-btn, #ac-header-sub) and
 * just call AnalyzeChatWidget.init(context) once it exists, each building
 * `context` from whatever data it already has on hand (live JS state after
 * the fetch on the AJAX path, Jinja-inlined values on the fallback path).
 *
 * No localStorage persistence -- context and history live only in this
 * module's own JS state for the current page view, matching the rest of
 * the Analyze results page (nothing else about a past analysis is kept
 * around either; see analyze_chat.py's header comment for why).
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
        if (!inList) { html += "<ul class=\"ac-bullet-list\">"; inList = true; }
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
    const messagesEl = document.getElementById("ac-messages");
    const suggestionsEl = document.getElementById("ac-suggestions");
    const formEl = document.getElementById("ac-form");
    const inputEl = document.getElementById("ac-input");
    const sendBtn = document.getElementById("ac-send-btn");
    const headerSubEl = document.getElementById("ac-header-sub");
    if (!messagesEl || !formEl) return; // widget markup not on this page

    let history = [];
    let isSending = false;

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    var SPARKLE_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M11.4 3.5a.6.6 0 0 1 1.2 0l1.1 3.2a3 3 0 0 0 1.9 1.9l3.2 1.1a.6.6 0 0 1 0 1.1l-3.2 1.1a3 3 0 0 0-1.9 1.9l-1.1 3.2a.6.6 0 0 1-1.2 0l-1.1-3.2a3 3 0 0 0-1.9-1.9L5.2 11.9a.6.6 0 0 1 0-1.1l3.2-1.1a3 3 0 0 0 1.9-1.9z"/><path d="M18.5 15.5a.4.4 0 0 1 .8 0l.5 1.4a1.5 1.5 0 0 0 1 1l1.4.5a.4.4 0 0 1 0 .8l-1.4.5a1.5 1.5 0 0 0-1 1l-.5 1.4a.4.4 0 0 1-.8 0l-.5-1.4a1.5 1.5 0 0 0-1-1l-1.4-.5a.4.4 0 0 1 0-.8l1.4-.5a1.5 1.5 0 0 0 1-1z"/></svg>';
    var SPARKLE_SVG_SM = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M11.4 3.5a.6.6 0 0 1 1.2 0l1.1 3.2a3 3 0 0 0 1.9 1.9l3.2 1.1a.6.6 0 0 1 0 1.1l-3.2 1.1a3 3 0 0 0-1.9 1.9l-1.1 3.2a.6.6 0 0 1-1.2 0l-1.1-3.2a3 3 0 0 0-1.9-1.9L5.2 11.9a.6.6 0 0 1 0-1.1l3.2-1.1a3 3 0 0 0 1.9-1.9z"/><path d="M18.5 15.5a.4.4 0 0 1 .8 0l.5 1.4a1.5 1.5 0 0 0 1 1l1.4.5a.4.4 0 0 1 0 .8l-1.4.5a1.5 1.5 0 0 0-1 1l-.5 1.4a.4.4 0 0 1-.8 0l-.5-1.4a1.5 1.5 0 0 0-1-1l-1.4-.5a.4.4 0 0 1 0-.8l1.4-.5a1.5 1.5 0 0 0 1-1z"/></svg>';
    var ARROW_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

    function renderMessages() {
      if (!history.length) {
        // Empty state: warm intro + tappable starter questions, all in one
        // cohesive block (the separate suggestions bar stays empty).
        suggestionsEl.innerHTML = "";
        const prompts = ["analyzeChat.suggestion1", "analyzeChat.suggestion2", "analyzeChat.suggestion3"].map((key) => t(key));
        messagesEl.innerHTML = `
          <div class="ac-empty">
            <div class="ac-empty-avatar">${SPARKLE_SVG}</div>
            <div class="ac-empty-title">${t("analyzeChat.welcomeTitle")}</div>
            <div class="ac-empty-body">${t("analyzeChat.welcomeBody")}</div>
            <div class="ac-prompts">
              ${prompts.map((q) => `<button type="button" class="ac-prompt" data-suggestion="${escapeHtml(q)}"><span class="ac-prompt-text">${q}</span><span class="ac-prompt-arrow">${ARROW_SVG}</span></button>`).join("")}
            </div>
          </div>
        `;
        messagesEl.querySelectorAll("[data-suggestion]").forEach((btn) => {
          btn.addEventListener("click", () => {
            inputEl.value = btn.dataset.suggestion;
            sendMessage();
          });
        });
        return;
      }
      suggestionsEl.innerHTML = "";
      messagesEl.innerHTML = history.map((turn) => `
        <div class="ac-row ${turn.role === "user" ? "ac-row-user" : "ac-row-assistant"}">
          <div class="ac-avatar">${turn.role === "user" ? "🙂" : SPARKLE_SVG_SM}</div>
          <div class="ac-bubble">${formatBubble(turn.text)}</div>
        </div>
      `).join("");
      scrollToBottom();
    }

    function showTyping() {
      const row = document.createElement("div");
      row.className = "ac-row ac-row-assistant ac-typing-row";
      row.id = "ac-typing-row";
      row.innerHTML = `<div class="ac-avatar">${SPARKLE_SVG_SM}</div><div class="ac-typing-dots"><span></span><span></span><span></span></div>`;
      messagesEl.appendChild(row);
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

      const updateSub = () => { headerSubEl.textContent = t("analyzeChat.limitReached", { time: formatCountdown(remaining) }); };
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
        headerSubEl.textContent = t("analyzeChat.headerSub");
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
