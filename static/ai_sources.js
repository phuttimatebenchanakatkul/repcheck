// The "Sources" list under an AI chat reply (RepCheckSources).
//
// App Review rejected 0.12.10 (35) under Guideline 1.4.1: the AI coach gave
// health advice without citations. The server now attaches the sources
// behind every reply (health_sources.py -- picked from a fixed, checked
// catalog, never written by the model), and the three chats -- the coach
// page, the workout chat and the Analyze chat -- each render them under the
// reply bubble through html() below, so all three look and behave the same.
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

  /** The sources block for one reply, or "" when there is nothing to cite. */
  function html(sources) {
    if (!Array.isArray(sources)) return "";
    var items = [];
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
    if (!items.length) return "";
    return (
      '<div class="ai-sources">' +
        '<div class="ai-sources-label">' + escapeHtml(t("aiSources.label", "Sources")) + "</div>" +
        "<ol>" + items.join("") + "</ol>" +
        '<a class="ai-sources-all" href="/sources">' + escapeHtml(t("aiSources.all", "All sources & health info")) + "</a>" +
      "</div>"
    );
  }

  // One delegated listener for every citation link in the app (chat lists
  // and the /sources page alike). In the iOS shell it opens the study in the
  // in-app browser instead of letting Capacitor throw the user out to
  // Safari; everywhere else it does nothing and the link opens normally.
  // Bound once on the document, which pagenav's swaps never replace.
  if (!window.RepCheckSources) {
    document.addEventListener("click", function (event) {
      var link = event.target && event.target.closest ? event.target.closest("a[data-source-link]") : null;
      if (!link) return;
      var native = window.RepCheckNative;
      if (native && typeof native.openExternal === "function" && native.openExternal(link.href)) {
        event.preventDefault();
      }
    });
  }

  window.RepCheckSources = { html: html };
})(window, document);
