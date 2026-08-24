// Loads the REAL marketing-site IIFE out of marketing/app.js and runs it in
// jsdom against the same markup marketing/index.html ships. Same
// extraction-from-source approach as the loaders for the Flask app's inline
// widgets -- the difference is that app.js is already a standalone file, so
// there are no start/end markers to drift, only the injected return.
//
// The marketing site is a separate Render Static Site with no build step and
// no module boundary (see CLAUDE.md), so its waitlist form -- the one thing
// on the page that can actually fail a user -- would otherwise ship with no
// test at all.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PATH = path.join(__dirname, "..", "..", "marketing", "app.js");

const IIFE_TAIL = "})();";

// The real IIFE returns nothing (it wires listeners and exits), so tests get
// at `validEmail` and `ENDPOINT` through a return spliced into the extracted
// copy only, immediately before its closing `})();`.
const RETURN_STMT = `
  return { validEmail: validEmail, ENDPOINT: ENDPOINT, wireForm: wireForm };
`;

export function extractSource() {
  const src = readFileSync(APP_PATH, "utf-8").replace(/\r\n/g, "\n");
  const closeIdx = src.lastIndexOf(IIFE_TAIL);
  if (closeIdx === -1) {
    throw new Error(
      "loadMarketingApp: could not find the closing `})();` in " +
        "marketing/app.js -- the file stopped being a single IIFE. Update " +
        "loadMarketingApp.js."
    );
  }
  return `${src.slice(0, closeIdx)}${RETURN_STMT}${IIFE_TAIL}`;
}

// Mirrors the two waitlist forms in marketing/index.html (hero + closing CTA)
// closely enough that wireForm() finds every node it queries: the email
// input, the submit button, and the [data-note] line it writes status into.
const HERO_NOTE = "No spam, no drip sequence. One email when we open the doors.";
const CTA_NOTE = "No spam. Unsubscribe in one click, from the first email onward.";

function markup() {
  return `
    <header class="nav" id="nav"></header>
    <button class="theme-toggle" id="theme-toggle" type="button"></button>
    <form class="waitlist-form" id="waitlist-form-hero" novalidate>
      <input type="email" id="email-hero" name="email" required>
      <button class="btn btn-primary" type="submit">Join the waitlist</button>
      <p class="form-note" data-note>${HERO_NOTE}</p>
    </form>
    <form class="waitlist-form waitlist-form--lg" id="waitlist-form-cta" novalidate>
      <input type="email" id="email-cta" name="email" required>
      <button class="btn btn-primary" type="submit">Join the waitlist</button>
      <p class="form-note" data-note>${CTA_NOTE}</p>
    </form>
    <span id="year">2026</span>
  `;
}

/**
 * Evaluates the real marketing IIFE against a fresh DOM, a fresh fetch mock,
 * and a fresh localStorage. Every call gets its own nodes so tests can't
 * bleed state into each other.
 *
 * @param {(url: string, init: object) => Promise<any>} [fetchImpl] - stands in
 *   for the network. Defaults to a resolved `{ ok: true }`, i.e. the happy
 *   path, and records every call on the returned `calls` array.
 */
export function loadMarketingApp({ fetchImpl = null, prefersDark = false } = {}) {
  document.documentElement.removeAttribute("data-theme");
  document.body.innerHTML = markup();
  try {
    localStorage.clear();
  } catch (e) {
    /* jsdom always has it; the real page guards anyway */
  }

  const calls = [];
  const fetchMock = fetchImpl || (() => Promise.resolve({ ok: true }));
  global.fetch = (url, init) => {
    calls.push({ url, init });
    return fetchMock(url, init);
  };

  // jsdom has no matchMedia, and currentTheme() calls it whenever the root
  // carries no explicit data-theme -- exactly the first-click case.
  window.matchMedia = (query) => ({
    matches: prefersDark && String(query).includes("dark"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });

  const api = new Function(
    "window",
    "document",
    "localStorage",
    `return ${extractSource()}`
  )(window, document, localStorage);

  const form = (which) => document.getElementById(`waitlist-form-${which}`);
  return {
    ...api,
    calls,
    dom: {
      heroForm: form("hero"),
      ctaForm: form("cta"),
      heroInput: document.getElementById("email-hero"),
      ctaInput: document.getElementById("email-cta"),
      heroButton: form("hero").querySelector("button"),
      heroNote: form("hero").querySelector("[data-note]"),
      ctaNote: form("cta").querySelector("[data-note]"),
      nav: document.getElementById("nav"),
      toggle: document.getElementById("theme-toggle"),
      yearEl: document.getElementById("year"),
    },
    notes: { HERO_NOTE, CTA_NOTE },
  };
}
