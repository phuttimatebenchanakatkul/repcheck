// Loads the REAL static/mascot.js into the jsdom global and hands back the
// window.RepCheckMascot it installs -- the same file the app ships, not a
// hand-copied duplicate that could drift from it.
//
// Like streak.js this is a standalone static file rather than a script
// embedded in a template, so there's no marker-extraction to do: it just
// gets evaluated. It IS re-evaluated per test, though, because the module
// keeps a module-level `uid` counter behind nextId() -- a shared instance
// would make "these two drawings got different clipPath ids" depend on how
// many drawings every earlier test happened to make.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASCOT_PATH = path.join(__dirname, "..", "..", "static", "mascot.js");
const I18N_PATH = path.join(__dirname, "..", "..", "static", "i18n.js");

const mascotSource = readFileSync(MASCOT_PATH, "utf-8");
const i18nSource = readFileSync(I18N_PATH, "utf-8");

/** Evaluates the real mascot.js and returns the API it installs on window. */
export function loadMascot() {
  delete window.RepCheckMascot;
  // eslint-disable-next-line no-eval
  (0, eval)(mascotSource);
  return window.RepCheckMascot;
}

/**
 * Evaluates the real i18n.js and returns its API. The dictionaries live in
 * a closure, so key parity is checked the only way a caller can see it:
 * through t() with the language switched via the storage key the module
 * itself reads (setLang() would also fire applyI18n + a document event,
 * which these tests have no use for).
 */
export function loadI18n() {
  localStorage.clear();
  delete window.RepCheckI18n;
  // eslint-disable-next-line no-eval
  (0, eval)(i18nSource);
  const api = window.RepCheckI18n;
  return {
    api,
    /** t(key) as rendered in `lang`. */
    tIn(lang, key) {
      localStorage.setItem("repcheck_language", lang);
      return api.t(key);
    },
  };
}

/** Parses an emptyState()/art() HTML string into a detached container. */
export function parse(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  return wrap;
}
