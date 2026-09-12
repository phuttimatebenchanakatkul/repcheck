// Loads the REAL marketing/app.js against the REAL .what section lifted out of
// marketing/index.html, so the feature switcher runs over the markup it ships
// with rather than a hand-written copy of it.
//
// marketing/ has no test harness of its own -- it is a separate static deploy
// with no build step, and nothing in tests-js touched it before this file. The
// script is one big IIFE that wires up several unrelated blocks at load
// (hero canvas, magnetic buttons, switcher, scripted workout-log screen, HYROX
// race simulator, waitlist form), each guarded by whether its element is
// present. So the fixture below is the index.html markup for the switcher and
// nothing else: everything outside .what is simply absent, and the guards skip
// those blocks.
//
// Two surgical edits to the extracted section, both because jsdom cannot run
// the thing, not because the test wants different behaviour:
//
//   <video> is removed. jsdom has no HTMLMediaElement implementation, so
//   play()/pause() raise "Not implemented" on the virtual console. showFeature
//   skips the media branch entirely when a screen holds no <video>
//   (`if (!video) return;`), which leaves the class and aria-pressed writes --
//   what this suite is about -- untouched.
//
//   data-wl is renamed. That attribute is how app.js finds the scripted
//   workout-log screen, which loops itself with setTimeout forever while it is
//   the screen on show. Renaming it makes wlScreen null so the animation never
//   arms, while the <div class="screen"> itself stays in the list -- feature
//   indices, which showFeature depends on, are unchanged.
//
// The HYROX race block IS kept: it registers showFeature's onFeatureChange
// hook, so leaving it out would skip a code path every click goes through. Its
// clock only starts on an in-handset action, and its IntersectionObserver is
// behind a `if (window.IntersectionObserver)` guard that jsdom fails.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const SCRIPT_PATH = path.join(ROOT, "marketing", "app.js");
const PAGE_PATH = path.join(ROOT, "marketing", "index.html");

export function readSource() {
  return readFileSync(SCRIPT_PATH, "utf-8");
}

/** The shipped .what section, as an HTML string. */
export function readWhatSection() {
  const html = readFileSync(PAGE_PATH, "utf-8");
  const match = /<section[^>]*class="[^"]*\bwhat\b[^"]*"[\s\S]*?<\/section>/.exec(html);
  if (!match) {
    throw new Error(
      "loadMarketingFeatureSwitcher: could not find the .what section in " +
        "marketing/index.html -- the switcher markup moved. Update the extractor."
    );
  }
  return match[0]
    .replace(/<video\b[\s\S]*?<\/video>/g, "")
    .replace(/data-wl=/g, "data-wl-disabled-for-test=");
}

/**
 * Mounts the switcher and runs the real script over it.
 *
 * @returns a handle with the six feature buttons, the screens they swap, and
 *   readers for the state a screen reader and a sighted user each see.
 */
export function loadMarketingFeatureSwitcher() {
  document.body.innerHTML = readWhatSection();

  // eslint-disable-next-line no-new-func
  new Function(readSource())();

  const section = document.querySelector(".what");
  const buttons = Array.from(section.querySelectorAll(".feature"));
  const screens = Array.from(section.querySelectorAll(".screen"));

  return {
    section,
    buttons,
    screens,
    /** What each button reports to assistive tech, in order. */
    pressed: () => buttons.map((b) => b.getAttribute("aria-pressed")),
    /** What each button looks like, in order. */
    active: () => buttons.map((b) => b.classList.contains("is-active")),
    /** Which screen is in the handset, by index. */
    shownScreen: () => screens.findIndex((s) => s.classList.contains("is-active")),
    click: (i) => buttons[i].dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
    hover: (i) => buttons[i].dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true })),
  };
}
