// Loads the REAL RepCheckNutritionMacros.sumMacrosForDay() out of
// static/nutrition_macros.js -- the single shared implementation used by
// both templates/home.html and templates/full_stats.html (previously each
// had its own copy-pasted, independently-drifting version). Evaluates the
// script's own IIFE against a plain stand-in object for `window`, so this
// exercises the exact file that ships, not a re-implementation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "..", "..", "static", "nutrition_macros.js");

export function loadNutritionMacros() {
  const source = readFileSync(SCRIPT_PATH, "utf-8");
  const windowStub = {};
  const factory = new Function("window", `${source}\nreturn window.RepCheckNutritionMacros;`);
  const macros = factory(windowStub);
  if (!macros || typeof macros.sumMacrosForDay !== "function") {
    throw new Error("loadNutritionMacros: RepCheckNutritionMacros.sumMacrosForDay not found after evaluating static/nutrition_macros.js");
  }
  return macros;
}
