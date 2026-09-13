// Loads the REAL pose interpolation core out of templates/index.html (the
// analyze page's inline script), same extraction-by-source-marker approach as
// loadExerciseSearch.js and loadSetsRepsBuckets.js.
//
// These two functions are where the skeleton's position in time is decided,
// so they are the part worth testing directly: everything around them needs a
// camera, a WASM model and a playing <video>, none of which exist in jsdom.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "index.html");

const START_MARKER = "// ---- pose interpolation core (extracted by tests-js/support/loadPoseInterp.js) ----";
const END_MARKER = "// ---- end pose interpolation core ----";

export function loadPoseInterp() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadPoseInterp: could not find the pose interpolation core in " +
        "templates/index.html -- the extraction markers moved. Update START/END markers."
    );
  }
  const source = html.slice(start, end);
  const factory = new Function(`${source}\nreturn { poseAt, nextPoseSamples };`);
  return factory();
}

// The constants live outside the extracted block (they are shared with the
// render loop), so read them off the template rather than restating them --
// a test that hardcodes 1 or 0.5 keeps passing when the page changes.
export function poseInterpConstant(name) {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const match = new RegExp("const " + name + " = ([0-9.]+);").exec(html);
  if (!match) {
    throw new Error("loadPoseInterp: " + name + " is not defined in templates/index.html");
  }
  return Number(match[1]);
}
