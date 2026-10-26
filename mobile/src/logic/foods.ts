/** The shared food library (generated into src/data/foods.json), search, and turning a food into a log entry. */
import foodsJson from '../data/foods.json';

import { stampOnDay } from './dates';
import type { FoodItem, Ingredient, NutritionEntry } from './types';

export const FOOD_LIBRARY: readonly FoodItem[] = foodsJson as FoodItem[];

/** Maximum results the add-food sheet lists: a short, ranked list reads better than a wall of near-duplicates. */
export const MAX_FOOD_RESULTS = 14;

const BY_NAME = new Map<string, FoodItem>();
for (const food of FOOD_LIBRARY) if (!BY_NAME.has(food.name)) BY_NAME.set(food.name, food); // the first of two same-named foods wins, as on the website

export function foodByName(name: string): FoodItem | undefined {
  return BY_NAME.get(name);
}

/**
 * How well `name` matches the (lower-cased) query `q`: -Infinity for no match; an exact name beats a prefix, which beats a
 * word start, which beats the middle of a word; extra words and extra length cost a little; a favourite gets a large boost.
 */
export function scoreFoodMatch(name: string, q: string, qWordCount: number, favorites: ReadonlySet<string>): number {
  const lower = name.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return -Infinity;
  let score: number;
  if (lower === q) score = 1000;
  else if (idx === 0) score = 620;
  else if (!/[a-z0-9]/.test(lower[idx - 1])) score = 380; // the query begins a word
  else score = 130;
  const nameWordCount = lower.split(/\s+/).filter(Boolean).length;
  score -= Math.max(0, nameWordCount - qWordCount) * 24;
  score -= Math.max(0, lower.length - q.length) * 0.7;
  if (favorites.has(name)) score += 450;
  return score;
}

/** Library foods matching a typed query, best first, at most MAX_FOOD_RESULTS (names). */
export function searchFoodNames(query: string, favorites: ReadonlySet<string> = new Set(), library: readonly FoodItem[] = FOOD_LIBRARY): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qWordCount = q.split(/\s+/).filter(Boolean).length;
  return library
    .filter((f) => f.name.toLowerCase().includes(q))
    .map((f) => ({ name: f.name, score: scoreFoodMatch(f.name, q, qWordCount, favorites) }))
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, MAX_FOOD_RESULTS)
    .map((m) => m.name);
}

/** The user's own foods that match a typed query, in the order they are saved. */
export function matchCustom<T extends { name: string }>(query: string, custom: readonly T[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return custom.filter((food) => food.name.toLowerCase().includes(q));
}

function ingredientOf(name: string, grams: number): Ingredient {
  const base = foodByName(name) ?? { calories: 0, carbs: 0, fat: 0, protein: 0 };
  return { name, grams, unit: 'g', baseCalories: base.calories, baseCarbs: base.carbs, baseFat: base.fat, baseProtein: base.protein };
}

export interface NewEntryOptions {
  id: string;
  /** The day the entry is filed under. */
  day: string;
  now: Date;
  /** Logged via a specific hour row's "+": stamped on that hour. */
  hour?: number;
  /** The total amount the person chose, in grams; the food's default (100 g, or the recipe's own total) if absent. */
  grams?: number;
}

/** A library food as a log entry: a simple food is one amount; a dish copies each ingredient's macros and scales the recipe to the chosen total. */
export function entryForFood(food: FoodItem, options: NewEntryOptions): NutritionEntry {
  const entry: NutritionEntry = { id: options.id, food: food.name, addedAt: stampOnDay(options.day, options.now, options.hour) };
  const amount = options.grams !== undefined && options.grams > 0 ? options.grams : undefined;
  if (food.ingredients && food.ingredients.length) {
    entry.ingredients = food.ingredients.map((i) => ingredientOf(i.name, i.grams));
    if (amount !== undefined) {
      const defaultTotal = entry.ingredients.reduce((sum, i) => sum + i.grams, 0);
      if (defaultTotal > 0) {
        const scale = amount / defaultTotal;
        entry.ingredients = entry.ingredients.map((i) => ({ ...i, grams: i.grams * scale }));
      }
    }
  } else {
    entry.grams = amount ?? 100;
    entry.unit = 'g';
    entry.baseCalories = food.calories;
    entry.baseCarbs = food.carbs;
    entry.baseFat = food.fat;
    entry.baseProtein = food.protein;
  }
  return entry;
}

/** The default amount a food starts with when the person opens it: a dish's recipe total, otherwise 100 g. */
export function defaultGrams(food: FoodItem): number {
  if (food.ingredients && food.ingredients.length) return food.ingredients.reduce((sum, i) => sum + i.grams, 0);
  return 100;
}

/** Adds a library food as another ingredient (50 g), turning a simple entry into a dish whose first ingredient is itself. */
export function addIngredient(entry: NutritionEntry, foodName: string): NutritionEntry | null {
  const base = foodByName(foodName);
  if (!base) return null;
  let ingredients: Ingredient[];
  if (entry.ingredients) {
    ingredients = entry.ingredients.slice();
  } else {
    ingredients = [{
      name: entry.food,
      grams: entry.grams as number,
      unit: entry.unit ?? 'g',
      baseCalories: entry.baseCalories as number,
      baseCarbs: entry.baseCarbs as number,
      baseFat: entry.baseFat as number,
      baseProtein: entry.baseProtein as number,
    }];
  }
  ingredients.push(ingredientOf(base.name, 50));
  const { grams, unit, baseCalories, baseCarbs, baseFat, baseProtein, ...rest } = entry;
  void grams; void unit; void baseCalories; void baseCarbs; void baseFat; void baseProtein;
  return { ...rest, ingredients };
}

/** A copy of an entry with one ingredient's amount changed (never below zero). */
export function setIngredientGrams(entry: NutritionEntry, index: number, grams: number): NutritionEntry {
  if (!entry.ingredients || index < 0 || index >= entry.ingredients.length) return entry;
  const ingredients = entry.ingredients.map((i, n) => (n === index ? { ...i, grams: Math.max(0, grams) } : i));
  return { ...entry, ingredients };
}

/** A copy without one ingredient; the last one cannot be removed (delete the entry instead). */
export function removeIngredient(entry: NutritionEntry, index: number): NutritionEntry {
  if (!entry.ingredients || entry.ingredients.length <= 1 || index < 0 || index >= entry.ingredients.length) return entry;
  return { ...entry, ingredients: entry.ingredients.filter((_, n) => n !== index) };
}

/**
 * A dish with a new TOTAL amount: every ingredient scales by the same factor, so the recipe's proportions (and macro ratios) hold.
 * Unchanged unless both the new and the current totals are above zero (the website's rule).
 */
export function setDishTotal(entry: NutritionEntry, total: number): NutritionEntry {
  if (!entry.ingredients || !entry.ingredients.length || !(total > 0)) return entry;
  const current = entry.ingredients.reduce((sum, i) => sum + i.grams, 0);
  if (!(current > 0)) return entry;
  const scale = total / current;
  return { ...entry, ingredients: entry.ingredients.map((i) => ({ ...i, grams: i.grams * scale })) };
}

/** A simple entry with a new amount. */
export function setEntryGrams(entry: NutritionEntry, grams: number, unit?: NutritionEntry['unit']): NutritionEntry {
  if (entry.ingredients && entry.ingredients.length) return entry;
  return { ...entry, grams: Math.max(0, grams), unit: unit ?? entry.unit };
}
