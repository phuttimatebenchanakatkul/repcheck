/**
 * Reporting and blocking for user-generated content (RepCheckSafety).
 *
 * The only content one RepCheck account writes that another sees is a display
 * name, on the global leaderboards. App Store Guideline 1.2 asks for three
 * things wherever that is true: filter it (name_filter.py, server-side, when
 * the name is set), let people report it, and let people block the account.
 * This file is the last two.
 *
 * One sheet, shared. The leaderboards on templates/challenges.html and in
 * static/hyrox.js both open it, and Settings uses the same endpoints for its
 * blocked-accounts list -- the alternative was the same sheet written three
 * times, drifting apart.
 *
 * Lives in base.html's shell (outside <main>), so it is not a page-owned
 * sheet: static/pagenav.js swaps <main> and leaves this alone, which is what
 * lets a swap mid-sheet not strand it. See openBottomSheet's data-pc-page-sheet
 * comment in base.html for the distinction.
 *
 * A CLASSIC script, like every other file here -- pagenav re-runs inline page
 * scripts through new Function and skips module scripts entirely.
 */
(function (window, document) {
  "use strict";

  // Every file here defines its own; there is deliberately no shared helper
  // (see the escaping note in CLAUDE.md). The name this renders came from
  // ANOTHER account, so it is the one string on this screen that must never
  // reach innerHTML raw.
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function t(key, vars) {
    return window.RepCheckI18n ? window.RepCheckI18n.t(key, vars) : key;
  }

  const REASONS = [
    { id: "offensive_name", key: "safety.reason.offensive" },
    { id: "impersonation", key: "safety.reason.impersonation" },
    { id: "spam", key: "safety.reason.spam" },
    { id: "other", key: "safety.reason.other" },
  ];

  let target = null; // { userId, name }

  function overlay() {
    return document.getElementById("sf-sheet-overlay");
  }
  function body() {
    return document.getElementById("sf-sheet-body");
  }

  function close() {
    const el = overlay();
    if (!el) return;
    if (window.closeBottomSheet) window.closeBottomSheet(el, ".log-sheet");
    else el.classList.remove("is-open");
    target = null;
  }

  async function post(path, payload, method) {
    const res = await window.fetch(path, {
      method: method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      /* a non-JSON error page still counts as a failure below */
    }
    if (!res.ok || !data.ok) throw new Error(data.error || t("safety.genericError"));
    return data;
  }

  /** Anything that changed who is visible -- leaderboards re-render on it. */
  function announceChange() {
    document.dispatchEvent(new CustomEvent("repcheck:safety-changed"));
  }

  function renderActions() {
    const name = escapeHtml(target ? target.name : "");
    body().innerHTML = `
      <div class="sf-target">${name}</div>
      <button type="button" class="sf-row" data-sf-action="report">
        <span class="sf-row-icon">⚑</span>
        <span class="sf-row-text">
          <span class="sf-row-label">${t("safety.reportName")}</span>
          <span class="sf-row-sub">${t("safety.reportSub")}</span>
        </span>
      </button>
      <button type="button" class="sf-row" data-sf-action="block">
        <span class="sf-row-icon">🚫</span>
        <span class="sf-row-text">
          <span class="sf-row-label">${t("safety.blockAccount")}</span>
          <span class="sf-row-sub">${t("safety.blockSub")}</span>
        </span>
      </button>
      <button type="button" class="sf-cancel" data-sf-action="cancel">${t("common.cancel")}</button>
    `;
  }

  function renderReasons() {
    const rows = REASONS.map(
      (r) => `
        <button type="button" class="sf-row" data-sf-reason="${r.id}">
          <span class="sf-row-text"><span class="sf-row-label">${t(r.key)}</span></span>
        </button>`
    ).join("");
    body().innerHTML = `
      <div class="sf-target">${t("safety.reasonTitle")}</div>
      ${rows}
      <button type="button" class="sf-cancel" data-sf-action="back">${t("common.back")}</button>
    `;
  }

  function renderDone(message) {
    body().innerHTML = `
      <div class="sf-done">
        <div class="sf-done-icon">✓</div>
        <div class="sf-done-text">${message}</div>
      </div>
      <button type="button" class="sf-cancel" data-sf-action="cancel">${t("common.done")}</button>
    `;
  }

  function renderError(message) {
    body().insertAdjacentHTML(
      "afterbegin",
      `<div class="sf-error">${escapeHtml(message)}</div>`
    );
  }

  async function doBlock() {
    try {
      await post("/api/safety/block", { user_id: target.userId });
      announceChange();
      renderDone(t("safety.blockedDone"));
    } catch (err) {
      renderError(err.message);
    }
  }

  async function doReport(reason) {
    try {
      // Reporting blocks too -- see api_safety_report. Being asked to take a
      // second action to stop seeing what you just objected to is the wrong
      // shape for this.
      await post("/api/safety/report", { user_id: target.userId, reason });
      announceChange();
      renderDone(t("safety.reportedDone"));
    } catch (err) {
      renderError(err.message);
    }
  }

  /** Open the sheet for one account. Never offered for your own row. */
  function open(opts) {
    const el = overlay();
    if (!el || !opts || !opts.userId) return;
    target = { userId: opts.userId, name: opts.name || "" };
    renderActions();
    if (window.openBottomSheet) window.openBottomSheet(el, ".log-sheet");
    else el.classList.add("is-open");
  }

  function onBodyClick(event) {
    const reasonBtn = event.target.closest("[data-sf-reason]");
    if (reasonBtn) {
      doReport(reasonBtn.getAttribute("data-sf-reason"));
      return;
    }
    const actionBtn = event.target.closest("[data-sf-action]");
    if (!actionBtn) return;
    const action = actionBtn.getAttribute("data-sf-action");
    if (action === "cancel") close();
    else if (action === "back") renderActions();
    else if (action === "report") renderReasons();
    else if (action === "block") doBlock();
  }

  function init() {
    const el = overlay();
    if (!el) return;
    body().addEventListener("click", onBodyClick);
    const closeBtn = document.getElementById("sf-sheet-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    el.addEventListener("click", (event) => {
      if (event.target === el) close();
    });
    if (window.bindSheetDrag) {
      // Bind before any open, per base.html: openBottomSheet arms the drag and
      // can only arm what has already been bound.
      window.bindSheetDrag(el, ".log-sheet", ".log-sheet-handle", close);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.RepCheckSafety = { open: open, close: close };
})(window, document);
