// Loads the REAL static/analyze_chat_widget.js and mounts the widget the way
// templates/index.html's AJAX result view does (the top-dock mode, i.e.
// documentElement WITHOUT .an-result -- that is the mode with the
// pull-to-open gesture these tests are about).
//
// new Function(src)(), not an import: the file is a classic-script IIFE that
// hangs window.AnalyzeChatWidget off the global, with no module boundary to
// import through. See tests-js/support/loadPageNav.js for the same pattern.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_PATH = path.join(__dirname, "..", "..", "static", "analyze_chat_widget.js");

export function widgetFixture() {
  return `
    <div id="ac-dock">
      <button id="ac-toggle" type="button"></button>
      <div id="ac-header-sub"></div>
      <div id="ac-messages"></div>
      <div id="ac-suggestions"></div>
      <form id="ac-form">
        <input id="ac-input" />
        <button id="ac-send-btn" type="submit"></button>
      </form>
    </div>
  `;
}

export function mountWidget(context) {
  document.documentElement.className = ""; // top-dock mode, not .an-result
  document.body.innerHTML = widgetFixture();
  // The widget reads t() for every placeholder and bubble; the strings
  // themselves are not what these tests are about.
  window.RepCheckI18n = { t: (key) => key };
  new Function(readFileSync(WIDGET_PATH, "utf-8"))();
  window.AnalyzeChatWidget.init(context || { id: 1 });
}

// Records the touch listeners the widget puts on `document`, including
// whether a touchmove went on as scroll-blocking (non-passive).
export function trackDocumentTouchListeners() {
  const log = [];
  const origAdd = document.addEventListener.bind(document);
  const origRemove = document.removeEventListener.bind(document);
  document.addEventListener = (type, handler, opts) => {
    if (String(type).startsWith("touch")) {
      log.push(`+${type}${opts && opts.passive === false ? ":blocking" : ""}`);
    }
    return origAdd(type, handler, opts);
  };
  document.removeEventListener = (type, handler, opts) => {
    if (String(type).startsWith("touch")) log.push(`-${type}`);
    return origRemove(type, handler, opts);
  };
  return log;
}
