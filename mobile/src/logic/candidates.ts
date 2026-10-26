/**
 * "Something the person can log": a library food, one of their own foods, or a copy of something they logged before (a scan, a quick
 * add, a dish edited since). The add-food sheet lists these, and turns the chosen one into a log entry at the chosen amount.
 */
import { stampOnDay } from './dates';
import { defaultGrams, entryForFood, foodByName, matchCustom, searchFoodNames, setDishTotal, setEntryGrams } from './foods';
import { entryTotals, num } from './macros';
import type { FoodItem, NutritionEntry } from './types';

/** The part of a saved custom food (src/api/endpoints.ts CustomFood) the log needs. */
export interface CustomFoodLike {
  id: number;
  name: string;
  emoji: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  servingLabel: string;
  servingGrams: number;
  servings: { label: string; grams: number }[];
}

export type Candidate =
  | { kind: 'library'; name: string; food: FoodItem }
  | { kind: 'custom'; name: string; food: CustomFoodLike }
  | { kind: 'entry'; name: string; entry: NutritionEntry };

export interface CandidateSources {
  custom: readonly CustomFoodLike[];
  /** What the person has logged before, in any order. */
  logged: readonly NutritionEntry[];
}

/**
 * The thing a name refers to: the person's own food first, then the library, then the newest entry they logged under that name
 * (which is how a scan or a quick add is re-logged). null if it is none of those.
 */
export function findCandidate(name: string, sources: CandidateSources): Candidate | null {
  const custom = sources.custom.find((f) => f.name === name);
  if (custom) return { kind: 'custom', name, food: custom };
  const food = foodByName(name);
  if (food) return { kind: 'library', name, food };
  let newest: NutritionEntry | null = null;
  for (const entry of sources.logged) if (entry.food === name && (!newest || entry.addedAt > newest.addedAt)) newest = entry;
  return newest ? { kind: 'entry', name, entry: newest } : null;
}

/** What typing `query` finds: library foods (best first) and the person's own foods, each as candidates. */
export function searchCandidates(query: string, favorites: ReadonlySet<string>, custom: readonly CustomFoodLike[], scope: 'all' | 'custom'): Candidate[] {
  const own = matchCustom(query, custom).map((food): Candidate => ({ kind: 'custom', name: food.name, food }));
  if (scope === 'custom') return own;
  const library = searchFoodNames(query, favorites).flatMap((name): Candidate[] => {
    const food = foodByName(name);
    return food ? [{ kind: 'library', name, food }] : [];
  });
  return [...own, ...library];
}

/** The amount (grams) a candidate starts at: a recipe's own total, a custom food's serving, the amount last logged, else 100 g. */
export function candidateGrams(candidate: Candidate): number {
  if (candidate.kind === 'library') return defaultGrams(candidate.food);
  if (candidate.kind === 'custom') return candidate.food.servingGrams > 0 ? candidate.food.servingGrams : 100;
  const grams = entryTotals(candidate.entry).grams;
  return grams > 0 ? grams : 100;
}

/** Whether the amount is one number of g/oz/mL (a simple food) rather than a dish's total. */
export function candidateIsDish(candidate: Candidate): boolean {
  if (candidate.kind === 'library') return !!candidate.food.ingredients?.length;
  if (candidate.kind === 'custom') return false;
  return !!candidate.entry.ingredients?.length;
}

export interface CandidateEntryOptions {
  id: string;
  day: string;
  now: Date;
  hour?: number;
  grams?: number;
  unit?: NutritionEntry['unit'];
}

/** The log entry for a candidate at an amount. Macros are copied per 100 g at this moment, so a later change to a library never rewrites history. */
export function candidateEntry(candidate: Candidate, options: CandidateEntryOptions): NutritionEntry {
  const addedAt = stampOnDay(options.day, options.now, options.hour);
  if (candidate.kind === 'library') {
    const entry = entryForFood(candidate.food, options);
    return options.unit && !entry.ingredients ? { ...entry, unit: options.unit } : entry;
  }
  if (candidate.kind === 'custom') {
    const food = candidate.food;
    const serving = food.servingGrams > 0 ? food.servingGrams : 100;
    const per100 = (perServing: number) => (num(perServing) * 100) / serving;
    return {
      id: options.id,
      food: food.name,
      addedAt,
      grams: options.grams !== undefined && options.grams > 0 ? options.grams : serving,
      unit: options.unit ?? 'g',
      baseCalories: per100(food.calories),
      baseCarbs: per100(food.carbs),
      baseFat: per100(food.fat),
      baseProtein: per100(food.protein),
    };
  }
  // A copy of an earlier entry: its own macros, a new id and time; "extra" and where it came from stay with the original.
  const { extra: _extra, ...template } = candidate.entry;
  const copy: NutritionEntry = { ...template, id: options.id, addedAt };
  if (options.grams !== undefined && options.grams > 0) {
    return copy.ingredients?.length ? setDishTotal(copy, options.grams) : setEntryGrams(copy, options.grams, options.unit);
  }
  return options.unit && !copy.ingredients ? { ...copy, unit: options.unit } : copy;
}
