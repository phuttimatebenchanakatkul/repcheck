/**
 * Turning what a food scan (an AI photo, a barcode) found into a log entry: the amount sheet's arithmetic in templates/nutrition.html
 * (renderAfResult / refreshAfDonut / addAfResultToLog), rule for rule.
 *
 * A result lists INGREDIENTS with their per-100 g macros and the grams the scan saw; its calories and macros are the totals for
 * exactly those grams. Choosing another amount scales every ingredient by the same factor, so a dish keeps its proportions.
 */
import { stampOnDay } from './dates';
import { UNIT_FACTORS, num } from './macros';
import type { Macros, NutritionEntry } from './types';

export interface ScanIngredient {
  name: string;
  grams: number;
  /** Per 100 g. */
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface ScanResult {
  food_name: string;
  confidence: 'low' | 'medium' | 'high' | 'custom';
  note: string;
  ingredients: ScanIngredient[];
  /** The totals for the ingredients' grams as listed. */
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Which database a barcode's figures came from, for the credit its terms require. */
  data_source?: string;
  /** Named serving sizes, when the food has more than one. */
  servings?: { label: string; grams: number }[];
  custom_food_id?: number;
}

/** What the person is choosing the amount in: a serving of this food, or grams / ounces. */
export type ScanUnit = 'serving' | 'g' | 'oz';
export const SCAN_UNITS: readonly ScanUnit[] = ['serving', 'g', 'oz'];

/** The server's answer, checked: anything unusable (no ingredients, nothing to scale) is null. */
export function parseScanResult(raw: unknown): ScanResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.ingredients)) return null;
  const ingredients: ScanIngredient[] = [];
  for (const item of body.ingredients) {
    if (!item || typeof item !== 'object') continue;
    const ing = item as Record<string, unknown>;
    if (typeof ing.name !== 'string' || !ing.name.trim()) continue;
    const grams = num(ing.grams);
    if (grams <= 0) continue;
    ingredients.push({ name: ing.name, grams, calories: num(ing.calories), protein: num(ing.protein), fat: num(ing.fat), carbs: num(ing.carbs) });
  }
  if (ingredients.length === 0) return null;
  const confidence = body.confidence === 'low' || body.confidence === 'high' || body.confidence === 'custom' ? body.confidence : 'medium';
  const servings = Array.isArray(body.servings)
    ? body.servings.flatMap((s): { label: string; grams: number }[] => {
        const serving = s as { label?: unknown; grams?: unknown } | null;
        return serving && typeof serving.label === 'string' && serving.label.trim() && num(serving.grams) > 0 ? [{ label: serving.label, grams: num(serving.grams) }] : [];
      })
    : undefined;
  return {
    food_name: typeof body.food_name === 'string' && body.food_name.trim() ? body.food_name.trim() : 'Unknown food',
    confidence,
    note: typeof body.note === 'string' ? body.note : '',
    ingredients,
    calories: num(body.calories),
    protein: num(body.protein),
    fat: num(body.fat),
    carbs: num(body.carbs),
    ...(typeof body.data_source === 'string' && body.data_source ? { data_source: body.data_source } : {}),
    ...(servings && servings.length ? { servings } : {}),
    ...(typeof body.custom_food_id === 'number' ? { custom_food_id: body.custom_food_id } : {}),
  };
}

/** The grams the result's own totals are for: the ingredients added up (100 if that is nothing). */
export function scanBaseGrams(result: Pick<ScanResult, 'ingredients'>): number {
  return result.ingredients.reduce((sum, ing) => sum + ing.grams, 0) || 100;
}

/** An amount in a unit as grams. One "serving" is `servingGrams` (by default the whole scan). Never negative. */
export function scanGrams(amount: number, unit: ScanUnit, servingGrams: number): number {
  const perUnit = unit === 'g' ? 1 : unit === 'oz' ? UNIT_FACTORS.oz : servingGrams;
  return Math.max(0, amount * perUnit);
}

/** The same grams written in another unit, to two decimals (so switching unit never changes how much is logged). */
export function scanAmountIn(grams: number, unit: ScanUnit, servingGrams: number): number {
  const perUnit = unit === 'g' ? 1 : unit === 'oz' ? UNIT_FACTORS.oz : servingGrams;
  return Math.round((grams / perUnit) * 100) / 100;
}

/** The result's totals at `grams`: they scale linearly from the grams the scan saw. */
export function scanTotals(result: ScanResult, grams: number): Macros {
  const base = scanBaseGrams(result);
  const scale = base > 0 ? grams / base : 0;
  return { calories: result.calories * scale, protein: result.protein * scale, fat: result.fat * scale, carbs: result.carbs * scale };
}

export interface ScanEntryOptions {
  id: string;
  day: string;
  now: Date;
  /** The name as the person left it; the scan's own name if blank. */
  name: string;
  grams: number;
  hour?: number;
}

/**
 * The log entry: a dish of the scan's ingredients, each scaled to the chosen amount (to two decimals), marked `source: "scan"` so it
 * shows under recent scans.
 */
export function scanEntry(result: ScanResult, options: ScanEntryOptions): NutritionEntry {
  const base = scanBaseGrams(result);
  const scale = base > 0 ? options.grams / base : 1; // as the website: an amount of zero logs zero grams (the sheet does not let that be added)
  return {
    id: options.id,
    food: options.name.trim() || result.food_name,
    addedAt: stampOnDay(options.day, options.now, options.hour),
    source: 'scan',
    ingredients: result.ingredients.map((ing) => ({
      name: ing.name,
      grams: Math.round(ing.grams * scale * 100) / 100,
      unit: 'g',
      baseCalories: ing.calories,
      baseCarbs: ing.carbs,
      baseFat: ing.fat,
      baseProtein: ing.protein,
    })),
  };
}
