/** A person's own foods and exercises, never shared: the port of api/foods.py (the website's rules, with its deliberate differences:
 *  the ceiling is enforced under a per-person lock; every number is bounded above; control characters are dropped from every text;
 *  a barcode that races past the duplicate check is caught by the database's unique index and answered as the same 409). */
import type { Tx } from "./db.ts";
import { lock, overLimitMessage } from "./rows.ts";
import { cleanText, isoSql, isoUtc } from "./rows.ts";
import { pyFloat, pyRound, pyTruthy } from "./pyNumbers.ts";
import { pyStr } from "./pyText.ts";

export const FOOD_LIMIT = 500; // database.py PER_USER_LIMITS["custom_foods"]
export const EXERCISE_LIMIT = 500; // ... ["custom_exercises"]
export const MAX_NAME = 60;
export const MAX_EMOJI = 8;
export const MAX_LABEL = 40;
export const MAX_BARCODE = 20;
export const MAX_EXTRA_SERVINGS = 20;
export const MAX_MACRO_GRAMS = 5000; // per serving
export const MAX_SERVING_GRAMS = 100_000;
export const DEFAULT_FOOD_NAME = "Custom food";
export const DEFAULT_FOOD_EMOJI = "\u{1F37D}️"; // the plate-and-cutlery emoji the website defaults to
export const EXERCISE_MODES = ["both", "each", "either"] as const;

/** The message is safe to show the person; `status` is the HTTP status to answer with. */
export class Rejected extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface Serving {
  label: string;
  grams: number;
}
export interface Food {
  id: number;
  name: string;
  emoji: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  barcode: string | null;
  servingLabel: string;
  servingGrams: number;
  servings: Serving[];
}
export interface Exercise {
  id: number;
  name: string;
  emoji: string | null;
  mode: string;
  created_at?: string;
}

/** Barcode digits: ASCII 0-9 only (Python's str.isdigit would also accept other scripts' digits). Not clipped; callers cut to MAX_BARCODE. */
export const digitsOnly = (value: unknown): string => pyStr(pyTruthy(value) ? value : "").replace(/[^0-9]/g, "");

/** Python's float(): a number, a boolean, or number text. NaN when Python would raise or return something not finite. */
function floatOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return Number(value);
  return pyFloat(value);
}

/** A non-negative, finite, bounded number of grams; anything else is 0, as on the website. */
export function macro(value: unknown): number {
  const n = floatOf(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(0, n), MAX_MACRO_GRAMS);
}

/** A serving size: finite, above 0 and at most 100,000 g, else `fallback`. */
export function grams(value: unknown, fallback: number): number {
  const n = floatOf(pyTruthy(value) ? value : fallback);
  return Number.isFinite(n) && n > 0 && n <= MAX_SERVING_GRAMS ? n : fallback;
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505";

interface FoodRow {
  id: number;
  name: string;
  emoji: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  barcode: string | null;
  serving_label: string;
  serving_grams: number;
}

const foodJson = (r: FoodRow, servings: Serving[]): Food => ({
  id: r.id, name: r.name, emoji: r.emoji, calories: r.calories, protein: r.protein, fat: r.fat, carbs: r.carbs,
  barcode: r.barcode, servingLabel: r.serving_label, servingGrams: r.serving_grams, servings,
});

async function attachServings(tx: Tx, rows: FoodRow[]): Promise<Food[]> {
  const byFood = new Map<number, Serving[]>(rows.map((r) => [r.id, []]));
  if (rows.length) {
    const marks = rows.map((_, i) => `$${i + 1}`).join(", ");
    const found = await tx.all<{ custom_food_id: number; label: string; grams: number }>(
      `select custom_food_id, label, grams from public.custom_food_servings where custom_food_id in (${marks}) order by id`,
      rows.map((r) => r.id),
    );
    for (const s of found) byFood.get(Number(s.custom_food_id))?.push({ label: s.label, grams: s.grams });
  }
  return rows.map((r) => foodJson(r, byFood.get(r.id)!));
}

export async function listFoods(tx: Tx, userId: string): Promise<Food[]> {
  return await attachServings(tx, await tx.all<FoodRow>("select * from public.custom_foods where user_id = $1 order by created_at desc, id desc", [userId]));
}

export async function foodByBarcode(tx: Tx, userId: string, barcode: string): Promise<Food | null> {
  const row = await tx.one<FoodRow>("select * from public.custom_foods where user_id = $1 and barcode = $2", [userId, barcode]);
  return row ? (await attachServings(tx, [row]))[0] : null;
}

const duplicateBarcode = () => new Rejected("You already have a custom food saved for this barcode.", 409);

/** Create the food and return it as the website's JSON. Rejected: 429 at the ceiling, 409 for a barcode already saved. */
export async function createFood(tx: Tx, userId: string, payload: Record<string, unknown>): Promise<Food> {
  await lock(tx, "custom_foods", userId);
  const count = await tx.one<{ n: number }>("select count(*) as n from public.custom_foods where user_id = $1", [userId]);
  if (Number(count!.n) >= FOOD_LIMIT) throw new Rejected(overLimitMessage(FOOD_LIMIT), 429);
  const protein = macro(payload.protein);
  const fat = macro(payload.fat);
  const carbs = macro(payload.carbs);
  const name = cleanText(payload.name, MAX_NAME) || DEFAULT_FOOD_NAME;
  const emoji = cleanText(payload.emoji, MAX_EMOJI) || DEFAULT_FOOD_EMOJI;
  const barcode = [...digitsOnly(payload.barcode)].slice(0, MAX_BARCODE).join("") || null;
  if (barcode && await tx.one("select 1 from public.custom_foods where user_id = $1 and barcode = $2", [userId, barcode])) throw duplicateBarcode();
  const servingLabel = cleanText(payload.servingLabel, MAX_LABEL) || "1 serving";
  const servingGrams = grams(payload.servingGrams, 100);
  const extra: Serving[] = [];
  const raw = Array.isArray(payload.servings) ? payload.servings.slice(0, MAX_EXTRA_SERVINGS) : [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const label = cleanText((item as Record<string, unknown>).label, MAX_LABEL);
    const g = grams((item as Record<string, unknown>).grams, 0);
    if (label && g > 0) extra.push({ label, grams: g });
  }
  const calories = pyRound(protein * 4 + carbs * 4 + fat * 9); // always derived, never trusted from the client
  let id: number;
  try {
    id = await tx.savepoint(async (sp) => {
      const row = await sp.one<{ id: number }>(
        `insert into public.custom_foods (user_id, name, emoji, calories, protein, fat, carbs, barcode, serving_label, serving_grams)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [userId, name, emoji, calories, protein, fat, carbs, barcode, servingLabel, servingGrams],
      );
      for (const serving of extra) {
        await sp.exec("insert into public.custom_food_servings (custom_food_id, label, grams) values ($1, $2, $3)", [row!.id, serving.label, serving.grams]);
      }
      return Number(row!.id);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicateBarcode(); // a barcode that raced past the check above
    throw e;
  }
  return { id, name, emoji, calories, protein, fat, carbs, barcode, servingLabel, servingGrams, servings: extra };
}

export async function deleteFood(tx: Tx, userId: string, foodId: number): Promise<void> {
  await tx.exec("delete from public.custom_foods where user_id = $1 and id = $2", [userId, foodId]);
}

/** A saved food in the shape a fresh barcode lookup answers with, so a scan that matches the person's own food renders through the
 *  same result screen. ingredients[0].grams is the food's own serving size; `servings` lists every option. */
export function foodAsScanResult(food: Food) {
  return {
    food_name: food.name, confidence: "custom", note: "Your own saved food entry.", custom_food_id: food.id,
    ingredients: [{ name: food.name, grams: food.servingGrams, calories: food.calories, protein: food.protein, fat: food.fat, carbs: food.carbs }],
    calories: food.calories, protein: food.protein, fat: food.fat, carbs: food.carbs,
    servings: [{ label: food.servingLabel, grams: food.servingGrams }, ...food.servings],
  };
}

// -- custom exercises --------------------------------------------------------------------------------------------------------

export async function listExercises(tx: Tx, userId: string): Promise<Exercise[]> {
  const rows = await tx.all<{ id: number; name: string; emoji: string | null; mode: string; created_text: string }>(
    `select id, name, emoji, mode, ${isoSql("created_at")} as created_text
     from public.custom_exercises where user_id = $1 order by created_at desc, id desc`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, mode: r.mode, created_at: isoUtc(r.created_text) }));
}

export async function createExercise(tx: Tx, userId: string, payload: Record<string, unknown>): Promise<Exercise> {
  await lock(tx, "custom_exercises", userId);
  const count = await tx.one<{ n: number }>("select count(*) as n from public.custom_exercises where user_id = $1", [userId]);
  if (Number(count!.n) >= EXERCISE_LIMIT) throw new Rejected(overLimitMessage(EXERCISE_LIMIT), 429);
  const name = cleanText(payload.name, MAX_NAME);
  if (!name) throw new Rejected("Enter a name for the exercise.", 400);
  const emoji = cleanText(payload.emoji, MAX_EMOJI) || null;
  let mode = cleanText(pyTruthy(payload.mode) ? payload.mode : "both", 20);
  if (!(EXERCISE_MODES as readonly string[]).includes(mode)) mode = "both";
  const row = await tx.one<Exercise>(
    "insert into public.custom_exercises (user_id, name, emoji, mode) values ($1, $2, $3, $4) returning id, name, emoji, mode",
    [userId, name, emoji, mode],
  );
  return { id: row!.id, name: row!.name, emoji: row!.emoji, mode: row!.mode };
}

export async function deleteExercise(tx: Tx, userId: string, exerciseId: number): Promise<void> {
  await tx.exec("delete from public.custom_exercises where user_id = $1 and id = $2", [userId, exerciseId]);
}
