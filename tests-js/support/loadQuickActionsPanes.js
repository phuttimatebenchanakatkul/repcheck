// Loads the REAL quick-actions pane IIFE out of templates/base.html.
//
// The block is self-executing and binds its elements at parse time, so the
// caller must build the fixture DOM FIRST and then call run(). That mirrors
// how the browser loads it: the <script> sits after the sheet markup.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "base.html");

const START_MARKER = '// ---------- Quick-actions: sliding "More" pane ----------';
const END_MARKER = '// Closes the "+" quick-actions sheet AND resets the FAB\'s aria-expanded';

export function loadQuickActionsPanes() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadQuickActionsPanes: could not find the sliding-pane block in " +
        "templates/base.html -- the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);
  return function run() {
    new Function(source)();
  };
}

// The markup the block drives. Mirrors templates/base.html closely enough to
// exercise every branch; the Jinja-conditional rows are collapsed to plain
// anchors since the block never inspects them.
export function quickActionsFixture() {
  return `
    <button id="mt-fab-btn" aria-expanded="false"></button>
    <div class="mt-sheet-overlay" id="mt-fab-overlay">
      <div class="mt-sheet qa-sheet" id="mt-fab-sheet">
        <div class="qa-panes" id="qa-panes">
          <section class="qa-pane" id="qa-pane-actions">
            <div class="qa-grid">
              <a class="qa-tile qa-green"></a>
              <a class="qa-tile qa-blue"></a>
              <button class="qa-tile qa-red" id="mt-fab-log-weight"></button>
              <button class="qa-tile qa-purple" id="mt-fab-scan-barcode"></button>
              <a class="qa-tile qa-pink"></a>
            </div>
            <button type="button" class="qa-more-link" id="qa-more-open"
                    aria-controls="qa-pane-more" aria-expanded="false">More options</button>
          </section>
          <section class="qa-pane" id="qa-pane-more" hidden>
            <div class="qa-pane-head">
              <button type="button" class="qa-back" id="qa-more-back"></button>
            </div>
            <div class="qa-links">
              <a class="mt-sheet-action">Coach</a>
              <a class="mt-sheet-action">Friends</a>
              <a class="mt-sheet-action">Settings</a>
            </div>
          </section>
        </div>
        <button type="button" class="qa-cancel" id="mt-fab-cancel"></button>
      </div>
    </div>
  `;
}
