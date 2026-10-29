/** The AI food-photo estimate: the port of analyze_food_gemini.py. One photo of a meal in, its ingredients (per 100 g, with an estimated portion
 *  each) and their totals out. */
import { FOOD_SYSTEM_PROMPT, MAX_INGREDIENTS } from "./foodData.ts";
import { shortenName } from "./foodLookup.ts";
import type { Gemini } from "./gemini.ts";
import { pyStrip } from "./nameFilter.ts";
import { pyFloat, pyRound, pyRoundDigits, pyTruthy } from "./pyNumbers.ts";
import { pyStr } from "./pyText.ts";

/** The photo could not be turned into a usable estimate (no key, the model failed, or its answer could not be read). */
export class FoodAnalysisError extends Error {}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
/** `parsed.get(key, fallback)` as text: a present null is "None", as str(None) is. */
const field = (o: Obj, key: string, fallback: string): string => pyStr(Object.hasOwn(o, key) ? o[key] : fallback);

/** The model's answer as JSON: the whole text, or what is inside the first ``` fence. */
export function extractJson(textIn: string): unknown {
  let text = pyStrip(textIn);
  const fenced = /```(?:json)?\s*(.*?)```/s.exec(text);
  if (fenced) text = pyStrip(fenced[1]);
  return JSON.parse(text);
}

/** max(0.0, float(source.get(key, 0) or 0)); anything that is not a number is 0. */
function num(source: Obj, key: string): number {
  const raw = Object.hasOwn(source, key) ? source[key] : 0;
  const value = pyTruthy(raw) ? raw : 0;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "boolean") n = Number(value);
  else if (typeof value === "string" && /^\+?(inf|infinity)$/i.test(pyStrip(value))) n = Infinity;
  else n = pyFloat(value);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

const roundInt = (x: number): number => {
  if (!Number.isFinite(x)) throw new RangeError("cannot round");
  return pyRound(x);
};

export interface FoodEstimate {
  food_name: string;
  confidence: string;
  note: string;
  ingredients: { name: string; grams: number; calories: number; protein: number; fat: number; carbs: number }[];
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** The model's answer cleaned into the result the app shows: names shortened, numbers bounded, totals summed from the rounded ingredients. */
export function validate(parsed: unknown): FoodEstimate {
  if (!isObject(parsed)) throw new TypeError("not an object");
  const foodName = shortenName(pyStrip(field(parsed, "food_name", "")) || "Unknown food");
  let confidence = pyStrip(field(parsed, "confidence", "medium")).toLowerCase();
  if (!["low", "medium", "high"].includes(confidence)) confidence = "medium";

  const raw = Object.hasOwn(parsed, "ingredients") ? parsed.ingredients : undefined;
  const ingredients: FoodEstimate["ingredients"] = [];
  if (Array.isArray(raw)) {
    for (const item of raw.slice(0, MAX_INGREDIENTS)) {
      if (!isObject(item)) continue;
      const name = shortenName(pyStrip(field(item, "name", "")), 30);
      const grams = num(item, "grams");
      if (!name || grams <= 0) continue;
      ingredients.push({
        name,
        grams: roundInt(grams),
        calories: roundInt(num(item, "calories")),
        protein: pyRoundDigits(num(item, "protein"), 1),
        fat: pyRoundDigits(num(item, "fat"), 1),
        carbs: pyRoundDigits(num(item, "carbs"), 1),
      });
    }
  }
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  for (const ing of ingredients) {
    const scale = ing.grams / 100;
    totals.calories += ing.calories * scale;
    totals.protein += ing.protein * scale;
    totals.fat += ing.fat * scale;
    totals.carbs += ing.carbs * scale;
  }
  return {
    food_name: foodName,
    confidence,
    note: pyStrip(field(parsed, "note", "")),
    ingredients,
    calories: roundInt(totals.calories),
    protein: pyRoundDigits(totals.protein, 1),
    fat: pyRoundDigits(totals.fat, 1),
    carbs: pyRoundDigits(totals.carbs, 1),
  };
}

/** What the person's note is told to the model as: more reliable than its own look at the photo. */
export const noteInstruction = (note: string): string =>
  "The user who took this photo added the following note about it -- " +
  "treat it as more reliable than your own visual read and use it to " +
  "correct or refine your estimate (e.g. an actual amount in grams, an " +
  "ingredient that's missing/extra/swapped, how it was cooked): " +
  `"${note}"`;

/** Estimate one photo. Throws FoodAnalysisError for anything that goes wrong, so the caller can answer one friendly message. */
export async function analyzeFoodPhoto(gemini: Gemini, image: Uint8Array, mimeType: string, noteIn: string | null): Promise<FoodEstimate> {
  if (!gemini.configured) throw new FoodAnalysisError("GEMINI_API_KEY environment variable is not set.");
  try {
    const note = pyStrip(noteIn ?? "");
    const reply = await gemini.generate({
      contents: [{ role: "user", text: FOOD_SYSTEM_PROMPT, images: [{ data: image, mimeType }], after: note ? noteInstruction(note) : undefined }],
    });
    if (reply === null) throw new TypeError("the model gave no text");
    return validate(extractJson(reply));
  } catch (e) {
    if (e instanceof FoodAnalysisError) throw e;
    throw new FoodAnalysisError(`Couldn't analyze that photo: ${e instanceof Error ? e.message : "failed"}`);
  }
}
