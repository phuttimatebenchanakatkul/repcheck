/**
 * Food macros, goals and units: the website's rules (static/nutrition_macros.js and templates/nutrition.html), tested against them.
 * Everything is per 100 g (or 100 mL) in the library; an entry scales it by its amount.
 */
import type { FoodUnit, Goals, Ingredient, MacroGoals, Macros, NutritionEntry } from './types';

/** Coerces to a finite number, 0 otherwise: one malformed field must not turn a whole day's total into NaN. */
export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// -- units (g, oz, mL) -----------------------------------------------------------------------------------------------------------

/** mL is treated as 1:1 with grams (the library's water-density approximation for liquids); oz uses the real factor. */
export const UNIT_FACTORS: Record<FoodUnit, number> = { g: 1, oz: 28.3495, ml: 1 };
export const UNIT_LABELS: Record<FoodUnit, string> = { g: 'g', oz: 'oz', ml: 'mL' };
export const FOOD_UNITS: readonly FoodUnit[] = ['g', 'oz', 'ml'];

export function gramsToUnit(grams: number, unit: FoodUnit): number {
  return Math.round((grams / UNIT_FACTORS[unit]) * 10) / 10;
}

export function unitToGrams(value: number, unit: FoodUnit): number {
  return value * UNIT_FACTORS[unit];
}

export function isFoodUnit(value: unknown): value is FoodUnit {
  return value === 'g' || value === 'oz' || value === 'ml';
}

// -- goals -----------------------------------------------------------------------------------------------------------------------

/** Sane per-day bounds so a goal cannot be set to something physically unrealistic. */
export const MACRO_BOUNDS = {
  protein: { min: 20, max: 400 },
  fat: { min: 15, max: 300 },
  carbs: { min: 20, max: 800 },
} as const;

export const DEFAULT_MACRO_GOALS: MacroGoals = { protein: 150, fat: 65, carbs: 200 };

/** Calories are always derived (4 kcal/g protein and carbs, 9 kcal/g fat), so the calorie goal can never disagree with the macros. */
export function caloriesFromMacros({ protein, fat, carbs }: MacroGoals): number {
  return Math.round(protein * 4 + fat * 9 + carbs * 4);
}

export const DEFAULT_GOALS: Goals = { ...DEFAULT_MACRO_GOALS, calories: caloriesFromMacros(DEFAULT_MACRO_GOALS) };

/** parseFloat, clamped to [min, max]; anything unreadable is the fallback (the website's rule: `12abc` reads as 12). */
export function clampMacro(value: unknown, bounds: { min: number; max: number }, fallback: number): number {
  const n = Number.parseFloat(String(value));
  if (Number.isNaN(n)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, n));
}

/** Goals as stored (possibly partial, stale or out of range) -> valid goals, with calories re-derived. */
export function normaliseGoals(stored?: Partial<Record<keyof MacroGoals, unknown>> | null): Goals {
  const merged = { ...DEFAULT_MACRO_GOALS, ...(stored ?? {}) } as Record<keyof MacroGoals, unknown>;
  const protein = clampMacro(merged.protein, MACRO_BOUNDS.protein, DEFAULT_MACRO_GOALS.protein);
  const fat = clampMacro(merged.fat, MACRO_BOUNDS.fat, DEFAULT_MACRO_GOALS.fat);
  const carbs = clampMacro(merged.carbs, MACRO_BOUNDS.carbs, DEFAULT_MACRO_GOALS.carbs);
  return { protein, fat, carbs, calories: caloriesFromMacros({ protein, fat, carbs }) };
}

// -- entries and totals ----------------------------------------------------------------------------------------------------------

type Item = Pick<Ingredient, 'grams'> & Partial<Pick<Ingredient, 'baseCalories' | 'baseCarbs' | 'baseFat' | 'baseProtein'>>;

/** Unrounded totals of one entry: a dish is the sum of its ingredients, a simple food is one amount of its own per-100 g values. */
export function entryTotals(entry: Pick<NutritionEntry, 'ingredients' | 'grams' | 'baseCalories' | 'baseCarbs' | 'baseFat' | 'baseProtein'>): Macros & { grams: number } {
  const items: Item[] = entry.ingredients && entry.ingredients.length ? entry.ingredients : [{ ...entry, grams: entry.grams as number }];
  const total = { calories: 0, protein: 0, fat: 0, carbs: 0, grams: 0 };
  for (const item of items) {
    const grams = num(item.grams);
    const scale = grams / 100;
    total.calories += num(item.baseCalories) * scale;
    total.protein += num(item.baseProtein) * scale;
    total.fat += num(item.baseFat) * scale;
    total.carbs += num(item.baseCarbs) * scale;
    total.grams += grams;
  }
  return total;
}

/** One entry's macros rounded to whole numbers. Rounded PER ENTRY, then summed (see sumMacrosForDay). */
export function scaledMacros(entry: Parameters<typeof entryTotals>[0]): Macros {
  const t = entryTotals(entry);
  return { calories: Math.round(t.calories), protein: Math.round(t.protein), fat: Math.round(t.fat), carbs: Math.round(t.carbs) };
}

/**
 * A day's totals. Each entry is rounded first and the whole numbers are summed, which is exactly what the website's page shows;
 * summing the raw values and rounding once differs by 1 whenever entries have fractional totals (the usual case).
 */
export function sumMacrosForDay(entries: readonly Parameters<typeof entryTotals>[0][] | null | undefined): Macros {
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  if (!Array.isArray(entries)) return totals;
  for (const entry of entries) {
    const m = scaledMacros(entry);
    totals.calories += m.calories;
    totals.protein += m.protein;
    totals.fat += m.fat;
    totals.carbs += m.carbs;
  }
  return totals;
}

/** Fill percentage for a macro bar: 0..100, 0 when the goal is zero or the numbers are not usable. */
export function percentOf(value: number, goal: number): number {
  return Math.max(0, Math.min(100, (value / goal) * 100 || 0));
}

export interface CalorieRing {
  consumed: number;
  goal: number;
  /** goal - consumed; negative when over. */
  remaining: number;
  over: boolean;
  /** 0..1, how much of the ring is filled (it stops at full when over). */
  fill: number;
}

export function calorieRing(consumedCalories: number, goalCalories: number): CalorieRing {
  const consumed = Math.round(consumedCalories);
  const remaining = goalCalories - consumed;
  return { consumed, goal: goalCalories, remaining, over: remaining < 0, fill: goalCalories > 0 ? Math.max(0, Math.min(1, consumed / goalCalories)) : 0 };
}

/** The website's macro line under a food: `31P / 4F / 0C` (whole numbers; anything missing is 0). */
export function macroLine(m: Partial<Pick<Macros, 'protein' | 'fat' | 'carbs'>>): string {
  return `${Math.round(m.protein || 0)}P / ${Math.round(m.fat || 0)}F / ${Math.round(m.carbs || 0)}C`;
}
