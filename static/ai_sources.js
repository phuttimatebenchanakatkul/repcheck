// The "Sources" list under an AI chat reply (RepCheckSources).
//
// App Review rejected 0.12.10 (35) under Guideline 1.4.1: the AI coach gave
// health advice without citations. The server now attaches the sources
// behind every reply (health_sources.py -- picked from a fixed, checked
// catalog, never written by the model), and the three chats -- the coach
// page, the workout chat and the Analyze chat -- each render them under the
// reply bubble through html() below, so all three look and behave the same.
//
// The same footer carries a Report control (Guideline 4.7.1: a hosted
// chatbot needs a way to report its output, like user content). It posts the
// reply's text to /api/ai-report, which lands on /admin/reports for review.
//
// Turns are kept in localStorage and synced between devices, so what comes
// back through html() is not trusted: every field is escaped, and a URL that
// is not plain https is dropped rather than linked.

(function (window, document) {
  "use strict";

  var MAX_SOURCES = 3;

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function t(key, fallback) {
    var i18n = window.RepCheckI18n;
    var value = i18n && typeof i18n.t === "function" ? i18n.t(key) : null;
    return value && value !== key ? value : fallback;
  }

  function safeUrl(url) {
    return typeof url === "string" && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null;
  }

  var REPORT_REASONS = ["harmful", "inaccurate", "offensive", "other"];
  var BUBBLE_SELECTOR = ".cc-bubble, .wlc-bubble, .ag-bubble";

  // Guideline 1.4.1: every AI answer says what it is, wherever it appears --
  // not only on the coach page's welcome screen.
  function disclaimerHtml() {
    return '<div class="ai-disclaimer">' +
      escapeHtml(t("aiSources.disclaimer", "AI-generated · general fitness info, not medical advice")) + "</div>";
  }

  function reportHtml(feature) {
    return (
      '<div class="ai-report" data-ai-report="' + escapeHtml(feature) + '">' +
        '<button type="button" class="ai-report-btn" data-ai-report-open>' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/></svg>' +
          escapeHtml(t("aiReport.button", "Report this reply")) +
        "</button>" +
      "</div>"
    );
  }

  /**
   * The footer under one AI reply: its sources (when there are any) and,
   * when `feature` is given, the Report control. "" when there is nothing.
   */
  function html(sources, feature) {
    var report = feature ? disclaimerHtml() + reportHtml(feature) : "";
    var items = [];
    if (!Array.isArray(sources)) sources = [];
    for (var i = 0; i < sources.length && items.length < MAX_SOURCES; i++) {
      var source = sources[i] || {};
      var url = safeUrl(source.url);
      if (!url || !source.title) continue;
      items.push(
        '<li><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" data-source-link>' +
          escapeHtml(source.title) + "</a>" +
          (source.publisher ? ' <span class="ai-sources-pub">' + escapeHtml(source.publisher) + "</span>" : "") +
        "</li>"
      );
    }
    if (!items.length) return report;
    return (
      '<div class="ai-sources">' +
        '<div class="ai-sources-label">' + escapeHtml(t("aiSources.label", "Sources")) + "</div>" +
        "<ol>" + items.join("") + "</ol>" +
        '<a class="ai-sources-all" href="/sources">' + escapeHtml(t("aiSources.all", "All sources & health info")) + "</a>" +
      "</div>" + report
    );
  }

  /** The reply's own text: its bubble, minus this footer. */
  function replyTextFor(node) {
    var bubble = node.closest(BUBBLE_SELECTOR);
    if (!bubble) return "";
    var copy = bubble.cloneNode(true);
    var extras = copy.querySelectorAll(".ai-sources, .ai-report, .ai-disclaimer");
    for (var i = 0; i < extras.length; i++) extras[i].remove();
    return (copy.textContent || "").replace(/[ \t]+\n/g, "\n").trim();
  }

  function showReasons(box) {
    var buttons = REPORT_REASONS.map(function (reason) {
      return '<button type="button" class="ai-report-reason" data-ai-report-reason="' + reason + '">' +
        escapeHtml(t("aiReport.reason." + reason, reason)) + "</button>";
    }).join("");
    box.innerHTML =
      '<div class="ai-report-prompt">' + escapeHtml(t("aiReport.prompt", "What's wrong with this reply?")) + "</div>" +
      '<div class="ai-report-reasons">' + buttons +
        '<button type="button" class="ai-report-cancel" data-ai-report-cancel>' + escapeHtml(t("aiReport.cancel", "Cancel")) + "</button>" +
      "</div>";
  }

  function sendReport(box, reason) {
    var text = replyTextFor(box);
    box.innerHTML = '<div class="ai-report-done">' + escapeHtml(t("aiReport.sending", "Sending…")) + "</div>";
    var done = function (ok) {
      box.innerHTML = '<div class="ai-report-done">' +
        escapeHtml(ok ? t("aiReport.thanks", "Thanks — reported. We review every report within 24 hours.")
                      : t("aiReport.failed", "Couldn't send that report. Please try again.")) +
        "</div>";
    };
    try {
      fetch("/api/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: box.getAttribute("data-ai-report"), reason: reason, reply: text }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) { done(Boolean(data && data.ok)); })
        .catch(function () { done(false); });
    } catch (error) {
      done(false);
    }
  }

  // One delegated listener for every citation link in the app (chat lists
  // and the /sources page alike). In the iOS shell it opens the study in the
  // in-app browser instead of letting Capacitor throw the user out to
  // Safari; everywhere else it does nothing and the link opens normally.
  // Bound once on the document, which pagenav's swaps never replace.
  if (!window.RepCheckSources) {
    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      var box = target ? target.closest(".ai-report") : null;
      if (box) {
        if (target.closest("[data-ai-report-open]")) {
          showReasons(box);
          // The reasons open below the reply, often past the bottom of the
          // chat's scroll area -- bring them into view.
          if (typeof box.scrollIntoView === "function") box.scrollIntoView({ block: "nearest" });
          return;
        }
        if (target.closest("[data-ai-report-cancel]")) {
          box.outerHTML = reportHtml(box.getAttribute("data-ai-report"));
          return;
        }
        var reasonBtn = target.closest("[data-ai-report-reason]");
        if (reasonBtn) { sendReport(box, reasonBtn.getAttribute("data-ai-report-reason")); return; }
      }
      var link = event.target && event.target.closest ? event.target.closest("a[data-source-link]") : null;
      if (!link) return;
      var native = window.RepCheckNative;
      if (native && typeof native.openExternal === "function" && native.openExternal(link.href)) {
        event.preventDefault();
      }
    });
  }

  window.RepCheckSources = { html: html, _replyTextFor: replyTextFor };
})(window, document);
