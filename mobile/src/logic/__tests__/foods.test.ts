import { extractFunction, lift, readRepoFile, runWebsiteScript } from '@/testing/website';

import foodsJson from '../../data/foods.json';
import { iconForFood } from '../foodIcon';
import {
  FOOD_LIBRARY,
  MAX_FOOD_RESULTS,
  addIngredient,
  defaultGrams,
  entryForFood,
  foodByName,
  matchCustom,
  removeIngredient,
  scoreFoodMatch,
  searchFoodNames,
  setDishTotal,
  setEntryGrams,
  setIngredientGrams,
} from '../foods';
import { scaledMacros, sumMacrosForDay } from '../macros';
import { TOP_PICK_MIN_DAYS, recentExercises, recentFoods, topPicksForHour } from '../suggestions';
import type { FoodItem } from '../types';

const template = readRepoFile('templates', 'nutrition.html');
const website = lift<{ iconForFood: (n: string) => string; scoreFoodMatch: (n: string, q: string, c: number) => number }>(
  template,
  [extractFunction(template, 'iconForFood'), extractFunction(template, 'scoreFoodMatch')],
  ['iconForFood', 'scoreFoodMatch'],
  { favorites: { has: (name: string) => name === 'Banana' || name === 'Chicken Breast, cooked' } },
);
const FAVORITES = new Set(['Banana', 'Chicken Breast, cooked']);

describe('the library', () => {
  it('is the shipped JSON, with a dish carrying its recipe', () => {
    expect(FOOD_LIBRARY.length).toBe(foodsJson.length);
    const pizza = foodByName('Pizza, cheese') as FoodItem;
    expect(pizza.ingredients?.length).toBeGreaterThan(2);
    expect(foodByName('no such food')).toBeUndefined();
  });

  it('the first of two same-named foods wins (Macarons is in the library twice)', () => {
    const first = FOOD_LIBRARY.find((f) => f.name === 'Macarons');
    expect(foodByName('Macarons')).toBe(first);
  });
});

describe('food icons: parity with the website over every food', () => {
  it('agree on all of them', () => {
    for (const food of FOOD_LIBRARY) expect([food.name, iconForFood(food.name)]).toEqual([food.name, website.iconForFood(food.name)]);
  });

  it('agree on awkward inputs', () => {
    for (const name of ['', '   ', 'PIZZA', 'Hot Dog Sausage', 'Korean Corn Dog', 'Eggplant Parmesan', 'Curry Leaves', 'Beef Tartare', 'Olive Oil', 'Kalamata Olives', 'Stew Meat', 'Zebra Steak', 'ünïcödé', 'a'.repeat(300)]) {
      expect([name, iconForFood(name)]).toEqual([name, website.iconForFood(name)]);
    }
  });

  it('falls back to the plate for something unknown', () => {
    expect(iconForFood('Zzyzx')).toBe('\u{1F37D}️');
  });
});

describe('searching foods: parity with the add-food sheet', () => {
  const QUERIES = ['rice', 'chicken', 'pizza', 'egg', 'pad', 'milk', 'a', 'ch', 'oat', 'thai', 'banana', 'Chicken Breast', ' tuna ', 'xyzzy', 'cooked', 'curry'];

  it('scores agree for every food and query, with and without favourites', () => {
    for (const query of QUERIES) {
      const q = query.trim().toLowerCase();
      const count = q.split(/\s+/).filter(Boolean).length;
      for (const food of FOOD_LIBRARY) {
        expect(scoreFoodMatch(food.name, q, count, FAVORITES)).toBe(website.scoreFoodMatch(food.name, q, count));
      }
    }
  });

  it('results are the best 14, best first, shorter names winning a tie', () => {
    for (const query of QUERIES) {
      const results = searchFoodNames(query, FAVORITES);
      const q = query.trim().toLowerCase();
      const count = q.split(/\s+/).filter(Boolean).length;
      const expected = FOOD_LIBRARY.filter((f) => f.name.toLowerCase().includes(q))
        .map((f) => ({ name: f.name, score: website.scoreFoodMatch(f.name, q, count) }))
        .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
        .slice(0, 14)
        .map((m) => m.name);
      expect(results).toEqual(expected);
      expect(results.length).toBeLessThanOrEqual(MAX_FOOD_RESULTS);
    }
  });

  it('an exact name beats a prefix, which beats a word start, which beats the middle of a word', () => {
    const library: FoodItem[] = ['Rice', 'Rice Cake', 'Fried Rice', 'Licorice'].map((name) => ({ name, calories: 1, carbs: 1, fat: 1, protein: 1 }));
    expect(searchFoodNames('rice', new Set(), library)).toEqual(['Rice', 'Rice Cake', 'Fried Rice', 'Licorice']);
  });

  it('a favourite jumps ahead of an equally good match', () => {
    const library: FoodItem[] = ['Apple Pie', 'Apple Tart'].map((name) => ({ name, calories: 1, carbs: 1, fat: 1, protein: 1 }));
    expect(searchFoodNames('apple', new Set(['Apple Tart']), library)).toEqual(['Apple Tart', 'Apple Pie']);
  });

  it('a blank query lists nothing (the sheet shows its default sections instead)', () => {
    expect(searchFoodNames('   ')).toEqual([]);
    expect(searchFoodNames('')).toEqual([]);
  });

  it('the user’s own foods match by substring, in saved order', () => {
    const custom = [{ name: 'My Protein Bar' }, { name: 'Oat Mix' }, { name: 'Protein Shake' }];
    expect(matchCustom('protein', custom).map((f) => f.name)).toEqual(['My Protein Bar', 'Protein Shake']);
    expect(matchCustom('', custom)).toEqual([]);
  });
});

describe('logging a food', () => {
  const NOW = new Date(2026, 9, 26, 12, 30, 0);
  const options = { id: 'e1', day: '2026-10-20', now: NOW };

  it('a simple food: 100 g by default, its own per-100 g values copied onto the entry', () => {
    const rice = foodByName('White Rice, cooked') as FoodItem;
    const entry = entryForFood(rice, options);
    expect(entry).toMatchObject({ id: 'e1', food: 'White Rice, cooked', grams: 100, unit: 'g', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 });
    expect(entry.ingredients).toBeUndefined();
    expect(new Date(entry.addedAt).getDate()).toBe(20);
  });

  it('an amount the person chose is used, and a non-positive one is ignored', () => {
    const rice = foodByName('White Rice, cooked') as FoodItem;
    expect(entryForFood(rice, { ...options, grams: 250 }).grams).toBe(250);
    expect(entryForFood(rice, { ...options, grams: 0 }).grams).toBe(100);
    expect(entryForFood(rice, { ...options, grams: -5 }).grams).toBe(100);
  });

  it('a dish copies each ingredient’s own macros and its recipe amount', () => {
    const pizza = foodByName('Pizza, cheese') as FoodItem;
    const entry = entryForFood(pizza, options);
    expect(entry.grams).toBeUndefined();
    expect(entry.ingredients).toHaveLength(pizza.ingredients?.length as number);
    const bread = entry.ingredients?.[0];
    expect(bread).toMatchObject({ name: 'White Bread', grams: 120, unit: 'g' });
    expect(bread?.baseCalories).toBe(foodByName('White Bread')?.calories);
  });

  it('a dish at the recipe’s own total matches the library’s per-100 g figures', () => {
    const pizza = foodByName('Pizza, cheese') as FoodItem;
    const entry = entryForFood(pizza, options);
    const total = defaultGrams(pizza);
    const macros = scaledMacros(entry);
    expect(Math.abs(macros.calories - (pizza.calories * total) / 100)).toBeLessThanOrEqual(1);
  });

  it('a dish at another total scales every ingredient in proportion (ratios kept)', () => {
    const pizza = foodByName('Pizza, cheese') as FoodItem;
    const total = defaultGrams(pizza);
    const doubled = entryForFood(pizza, { ...options, grams: total * 2 });
    const normal = entryForFood(pizza, options);
    doubled.ingredients?.forEach((i, n) => expect(i.grams).toBeCloseTo((normal.ingredients?.[n].grams as number) * 2, 9));
    expect(scaledMacros(doubled).calories).toBeGreaterThan(scaledMacros(normal).calories * 1.9);
  });

  it('an ingredient the library lacks counts as zero rather than breaking the dish', () => {
    const odd: FoodItem = { name: 'Odd Dish', calories: 0, carbs: 0, fat: 0, protein: 0, ingredients: [{ name: 'No Such Thing', grams: 100 }] };
    expect(entryForFood(odd, options).ingredients?.[0]).toMatchObject({ baseCalories: 0, baseCarbs: 0, baseFat: 0, baseProtein: 0 });
  });

  it('the default amount of a dish is its recipe total; of anything else, 100 g', () => {
    expect(defaultGrams(foodByName('White Rice, cooked') as FoodItem)).toBe(100);
    const pizza = foodByName('Pizza, cheese') as FoodItem;
    expect(defaultGrams(pizza)).toBe((pizza.ingredients ?? []).reduce((s, i) => s + i.grams, 0));
  });

  it('an hour row stamps that hour on the chosen day', () => {
    const entry = entryForFood(foodByName('Banana') as FoodItem, { ...options, hour: 7 });
    expect([new Date(entry.addedAt).getDate(), new Date(entry.addedAt).getHours(), new Date(entry.addedAt).getMinutes()]).toEqual([20, 7, 0]);
  });
});

describe('editing a logged food', () => {
  const NOW = new Date(2026, 9, 26, 12, 0, 0);
  const rice = entryForFood(foodByName('White Rice, cooked') as FoodItem, { id: 'r', day: '2026-10-26', now: NOW, grams: 150 });
  const pizza = entryForFood(foodByName('Pizza, cheese') as FoodItem, { id: 'p', day: '2026-10-26', now: NOW });

  it('adding an ingredient to a simple food makes it a dish whose first ingredient is itself, and drops the simple fields', () => {
    const dish = addIngredient(rice, 'Banana') as ReturnType<typeof addIngredient> & object;
    expect(dish.grams).toBeUndefined();
    expect(dish.unit).toBeUndefined();
    expect(dish.baseCalories).toBeUndefined();
    expect(dish.ingredients).toHaveLength(2);
    expect(dish.ingredients?.[0]).toMatchObject({ name: 'White Rice, cooked', grams: 150, baseCalories: 130 });
    expect(dish.ingredients?.[1]).toMatchObject({ name: 'Banana', grams: 50, unit: 'g' });
    expect(dish.id).toBe('r');
    expect(dish.food).toBe('White Rice, cooked');
  });

  it('the total of that dish is the old amount plus 50 g of the new ingredient', () => {
    const dish = addIngredient(rice, 'Banana') as NonNullable<ReturnType<typeof addIngredient>>;
    const banana = foodByName('Banana') as FoodItem;
    const expected = scaledMacros(rice).calories + Math.round((banana.calories * 50) / 100);
    expect(Math.abs(scaledMacros(dish).calories - expected)).toBeLessThanOrEqual(1);
  });

  it('adding to a dish appends and never mutates the original', () => {
    const before = JSON.stringify(pizza);
    const more = addIngredient(pizza, 'Banana') as NonNullable<ReturnType<typeof addIngredient>>;
    expect(more.ingredients).toHaveLength((pizza.ingredients?.length as number) + 1);
    expect(JSON.stringify(pizza)).toBe(before);
  });

  it('an unknown food cannot be added', () => {
    expect(addIngredient(rice, 'No Such Food')).toBeNull();
  });

  it('changing an ingredient’s amount, with a floor of zero, and an out-of-range index changes nothing', () => {
    expect(setIngredientGrams(pizza, 0, 200).ingredients?.[0].grams).toBe(200);
    expect(setIngredientGrams(pizza, 0, -4).ingredients?.[0].grams).toBe(0);
    expect(setIngredientGrams(pizza, 99, 5)).toBe(pizza);
    expect(setIngredientGrams(rice, 0, 5)).toBe(rice);
  });

  it('removing an ingredient, but never the last one', () => {
    const fewer = removeIngredient(pizza, 0);
    expect(fewer.ingredients).toHaveLength((pizza.ingredients?.length as number) - 1);
    const one = { ...pizza, ingredients: [(pizza.ingredients ?? [])[0]] };
    expect(removeIngredient(one, 0)).toBe(one);
    expect(removeIngredient(pizza, -1)).toBe(pizza);
    expect(removeIngredient(rice, 0)).toBe(rice);
  });

  it('a simple food’s amount changes with its unit; a dish’s does not (its ingredients do)', () => {
    expect(setEntryGrams(rice, 3.5, 'oz')).toMatchObject({ grams: 3.5, unit: 'oz' });
    expect(setEntryGrams(rice, -1).grams).toBe(0);
    expect(setEntryGrams(pizza, 5)).toBe(pizza);
    expect(sumMacrosForDay([setEntryGrams(rice, 0)]).calories).toBe(0);
  });
});

describe('suggestions: parity with static/suggestions.js', () => {
  const at = (days: number, hour: number, minute = 0) => new Date(2026, 9, 26 - days, hour, minute).getTime();
  const log = [
    { food: 'Oats', addedAt: at(1, 8, 10) },
    { food: 'Oats', addedAt: at(2, 7, 55) },
    { food: 'Oats', addedAt: at(3, 9, 5) },
    { food: 'Coffee', addedAt: at(1, 8, 0) },
    { food: 'Coffee', addedAt: at(1, 8, 30) }, // twice, but the same day: a one-off
    { food: 'Late Snack', addedAt: at(1, 23, 40) },
    { food: 'Late Snack', addedAt: at(2, 0, 20) },
    { food: 'Eggs', addedAt: at(0, 12, 0) },
    { food: 'Eggs', addedAt: at(4, 12, 30) },
    { food: '', addedAt: at(1, 8) },
    { food: 'No Time', addedAt: 0 },
    { food: 'Banana' },
  ];

  it('the habits around an hour: recurring on 2+ different days within +/- 1 hour, wrapping midnight', () => {
    expect(topPicksForHour(log, 8, 5)).toEqual(['Oats']);
    expect(topPicksForHour(log, 0, 5)).toEqual(['Late Snack']);
    expect(topPicksForHour(log, 23, 5)).toEqual(['Late Snack']);
    expect(topPicksForHour(log, 12, 5)).toEqual(['Eggs']);
    expect(topPicksForHour(log, 18, 5)).toEqual([]);
    expect(TOP_PICK_MIN_DAYS).toBe(2);
  });

  it('recent foods and exercises are distinct and newest first; entries without a time sort last', () => {
    expect(recentFoods(log, 10)).toEqual(['Eggs', 'Late Snack', 'Coffee', 'Oats', 'No Time', 'Banana']);
    expect(recentFoods(log, 2)).toHaveLength(2);
    expect(recentExercises([{ exercise: 'Squat', addedAt: 5 }, { exercise: 'Bench', addedAt: 9 }, { exercise: 'Squat', addedAt: 1 }], 5)).toEqual(['Bench', 'Squat']);
  });

  it('matches the website’s answers on the same log', () => {
    const window = runWebsiteScript('suggestions.js', () => undefined);
    const site = window.RepCheckSuggestions;
    const siteLog = { '2026-10-25': log.slice(0, 4), '2026-10-24': log.slice(4) };
    for (const hour of [0, 7, 8, 9, 12, 18, 23]) expect(topPicksForHour(log, hour, 5)).toEqual(site.topPicksForHour(hour, 5, siteLog));
    expect(recentFoods(log, 10)).toEqual(site.recentFoods(10, siteLog));
    const workouts = [{ exercise: 'Squat', addedAt: 5 }, { exercise: 'Bench', addedAt: 9 }, { exercise: 'Squat', addedAt: 1 }, { exercise: 'Row' }];
    expect(recentExercises(workouts, 5)).toEqual(site.recentExercises(5, { '2026-10-01': workouts }));
  });

  it('someone with no history gets nothing invented', () => {
    expect(topPicksForHour([], 8, 5)).toEqual([]);
    expect(recentFoods([], 5)).toEqual([]);
    expect(recentExercises([], 5)).toEqual([]);
  });
});

describe('setDishTotal', () => {
  const rice = { name: 'Rice', grams: 100, unit: 'g' as const, baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 };
  const egg = { name: 'Egg', grams: 50, unit: 'g' as const, baseCalories: 143, baseCarbs: 0.7, baseFat: 9.5, baseProtein: 12.6 };
  const bowl = { id: 'b', food: 'Bowl', addedAt: 1, ingredients: [rice, egg] };

  it('scales every ingredient by the same factor, so the recipe keeps its proportions', () => {
    const scaled = setDishTotal(bowl, 300);
    expect(scaled.ingredients?.map((i) => i.grams)).toEqual([200, 100]);
    expect(scaled.ingredients?.[0]).toMatchObject({ name: 'Rice', baseCalories: 130 }); // only the amount changes
  });

  it('can scale down', () => {
    expect(setDishTotal(bowl, 75).ingredients?.map((i) => i.grams)).toEqual([50, 25]);
  });

  it.each([[0], [-10], [Number.NaN]])('does nothing for a total of %p', (total) => {
    expect(setDishTotal(bowl, total)).toBe(bowl);
  });

  it('does nothing when the dish currently weighs nothing (there is no ratio to keep)', () => {
    const empty = { ...bowl, ingredients: [{ ...rice, grams: 0 }, { ...egg, grams: 0 }] };
    expect(setDishTotal(empty, 100)).toBe(empty);
  });

  it('does nothing for a simple food or an empty dish', () => {
    const simple = { id: 's', food: 'Egg', addedAt: 1, grams: 50 };
    expect(setDishTotal(simple, 100)).toBe(simple);
    const none = { id: 'n', food: 'x', addedAt: 1, ingredients: [] };
    expect(setDishTotal(none, 100)).toBe(none);
  });

  it('does not change the entry it was given', () => {
    setDishTotal(bowl, 300);
    expect(bowl.ingredients.map((i) => i.grams)).toEqual([100, 50]);
  });
});

describe('survivors: scoring, amounts and indexes', () => {
  it.each([['7up', 'up'], ['2% Milk', 'milk'], ['Vitamin B12 pill', '12'], ['5-Spice Powder', 'spice'], ['Pack 9 Rolls', 'rolls']])(
    'scores %p for %p the way the website does (a digit before the match is part of the word)',
    (name, q) => {
      const count = q.split(/\s+/).filter(Boolean).length;
      expect(scoreFoodMatch(name, q, count, FAVORITES)).toBe(website.scoreFoodMatch(name, q, count));
    },
  );

  it('a digit right before the match makes it a mid-word match, not a word start', () => {
    expect(scoreFoodMatch('7up', 'up', 1, new Set())).toBeLessThan(scoreFoodMatch('a up', 'up', 1, new Set()));
  });

  const egg = FOOD_LIBRARY.find((f) => !f.ingredients && f.calories > 0) as FoodItem;
  const stew: FoodItem = { name: 'Test stew', calories: 100, carbs: 10, fat: 5, protein: 8, ingredients: [{ name: 'Rice', grams: 0.25 }, { name: 'Egg', grams: 0.25 }] };
  const empty: FoodItem = { name: 'Nothing stew', calories: 0, carbs: 0, fat: 0, protein: 0, ingredients: [{ name: 'Rice', grams: 0 }, { name: 'Egg', grams: 0 }] };
  const opts = { id: 'x', day: '2026-10-25', now: new Date(2026, 9, 25, 12) };

  it('a small positive amount (half a gram) is used as typed', () => {
    expect(entryForFood(egg, { ...opts, grams: 0.5 }).grams).toBe(0.5);
  });

  it('a dish whose recipe weighs less than a gram still scales to the chosen total', () => {
    const entry = entryForFood(stew, { ...opts, grams: 100 });
    expect(entry.ingredients?.reduce((s, i) => s + i.grams, 0)).toBeCloseTo(100, 9);
  });

  it('a dish whose recipe weighs nothing stays at nothing rather than turning into NaN', () => {
    const entry = entryForFood(empty, { ...opts, grams: 100 });
    expect(entry.ingredients?.map((i) => i.grams)).toEqual([0, 0]);
  });

  it('an index one past the end is ignored (the same entry comes back)', () => {
    const entry = { id: 'e', food: 'Bowl', addedAt: 1, ingredients: [
      { name: 'Rice', grams: 100, baseCalories: 1, baseCarbs: 1, baseFat: 1, baseProtein: 1 },
      { name: 'Egg', grams: 50, baseCalories: 1, baseCarbs: 1, baseFat: 1, baseProtein: 1 },
    ] };
    expect(setIngredientGrams(entry, 2, 10)).toBe(entry);
    expect(removeIngredient(entry, 2)).toBe(entry);
    expect(setIngredientGrams(entry, -1, 10)).toBe(entry);
    expect(removeIngredient(entry, -1)).toBe(entry);
  });

  it('suggestions: entries that are missing, nameless or untimed are skipped, not fatal', () => {
    const log = [null, { food: 'Egg' }, { addedAt: 5 }, { food: 'Rice', addedAt: 10 }, undefined, { food: 'Oats', addedAt: 20 }] as never[];
    expect(recentFoods(log, 10)).toEqual(['Oats', 'Rice', 'Egg']);
    const at = (day: number) => new Date(2026, 9, day, 8).getTime();
    expect(topPicksForHour([null, { food: 'Egg' }, { addedAt: at(1) }, { food: 'Rice', addedAt: at(1) }, { food: 'Rice', addedAt: at(2) }] as never[], 8, 5)).toEqual(['Rice']);
  });

  it('suggestions: habits are ordered by how many different days they recur on', () => {
    const at = (day: number) => new Date(2026, 9, day, 8).getTime();
    const log = [
      { food: 'Twice', addedAt: at(1) }, { food: 'Twice', addedAt: at(2) },
      { food: 'Thrice', addedAt: at(1) }, { food: 'Thrice', addedAt: at(2) }, { food: 'Thrice', addedAt: at(3) },
      { food: 'Once', addedAt: at(1) },
    ];
    expect(topPicksForHour(log, 8, 5)).toEqual(['Thrice', 'Twice']);
  });
});

describe('survivors 2: untimed and nameless entries in the suggestions', () => {
  it('an entry with no time sorts after any entry with one, however the log is ordered', () => {
    const log = [{ food: 'NoTime' }, { food: 'Old', addedAt: 1 }, { food: 'New', addedAt: 9 }, { food: 'AlsoNoTime' }];
    expect(recentFoods(log, 10)).toEqual(['New', 'Old', 'NoTime', 'AlsoNoTime']);
    expect(recentFoods([{ food: 'Missing' }, { food: 'A', addedAt: 1 }], 10)).toEqual(['A', 'Missing']);
  });

  it('nameless entries are never a habit, however often they recur', () => {
    const at = (day: number) => new Date(2026, 9, day, 8).getTime();
    const log = [{ addedAt: at(1) }, { addedAt: at(2) }, { addedAt: at(3) }, { food: '', addedAt: at(4) }, { food: 'Rice', addedAt: at(1) }, { food: 'Rice', addedAt: at(2) }] as never[];
    expect(topPicksForHour(log, 8, 5)).toEqual(['Rice']);
  });
});
