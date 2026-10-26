import {
  candidateEntry,
  candidateGrams,
  candidateIsDish,
  findCandidate,
  searchCandidates,
  type Candidate,
  type CustomFoodLike,
} from '../candidates';
import { FOOD_LIBRARY, foodByName } from '../foods';
import { entryTotals, scaledMacros } from '../macros';
import type { NutritionEntry } from '../types';

const NOW = new Date(2026, 9, 26, 14, 30, 15);
const DAY = '2026-10-25';
const options = { id: 'new-id', day: DAY, now: NOW };

const shake: CustomFoodLike = { id: 1, name: 'House shake', emoji: '🥤', calories: 300, protein: 30, fat: 5, carbs: 30, servingLabel: '1 bottle', servingGrams: 400, servings: [{ label: 'half', grams: 200 }] };
const dish = FOOD_LIBRARY.find((f) => f.ingredients && f.ingredients.length > 1 && f.ingredients.every((i) => foodByName(i.name))) as NonNullable<(typeof FOOD_LIBRARY)[number]>;
const simple = FOOD_LIBRARY.find((f) => !f.ingredients && f.calories > 0 && f.name === 'Egg' ) ?? (FOOD_LIBRARY.find((f) => !f.ingredients && f.calories > 0) as (typeof FOOD_LIBRARY)[number]);

const logged = (id: string, food: string, addedAt: number, over: Partial<NutritionEntry> = {}): NutritionEntry => ({ id, food, addedAt, grams: 80, unit: 'g', baseCalories: 200, baseCarbs: 20, baseFat: 10, baseProtein: 5, ...over });

describe('findCandidate', () => {
  it('prefers the person’s own food, then the library, then something they logged', () => {
    expect(findCandidate(shake.name, { custom: [shake], logged: [logged('a', shake.name, 1)] })).toMatchObject({ kind: 'custom' });
    expect(findCandidate(simple.name, { custom: [], logged: [logged('a', simple.name, 1)] })).toMatchObject({ kind: 'library' });
    expect(findCandidate('Mystery scan', { custom: [], logged: [logged('a', 'Mystery scan', 1)] })).toMatchObject({ kind: 'entry' });
  });

  it('a custom food named like a library food wins', () => {
    const own = { ...shake, name: simple.name };
    expect(findCandidate(simple.name, { custom: [own], logged: [] })).toMatchObject({ kind: 'custom', food: own });
  });

  it('uses the NEWEST logged entry under that name', () => {
    const found = findCandidate('Mystery scan', { custom: [], logged: [logged('old', 'Mystery scan', 10), logged('new', 'Mystery scan', 99), logged('mid', 'Mystery scan', 50), logged('other', 'Different', 500)] });
    expect(found).toMatchObject({ kind: 'entry', entry: { id: 'new' } });
  });

  it('is null for a name that is none of these', () => {
    expect(findCandidate('Not a food at all xyz', { custom: [shake], logged: [logged('a', 'Something', 1)] })).toBeNull();
  });
});

describe('searchCandidates', () => {
  it('lists the person’s own matches first, then library matches', () => {
    const found = searchCandidates('shake', new Set(), [shake], 'all');
    expect(found[0]).toMatchObject({ kind: 'custom', name: 'House shake' });
    expect(found.slice(1).every((c) => c.kind === 'library')).toBe(true);
    expect(found.length).toBeGreaterThan(1);
  });

  it('the custom scope lists only their own', () => {
    const found = searchCandidates('shake', new Set(), [shake], 'custom');
    expect(found.map((c) => c.kind)).toEqual(['custom']);
  });

  it('an empty query finds nothing', () => {
    expect(searchCandidates('  ', new Set(), [shake], 'all')).toEqual([]);
    expect(searchCandidates('', new Set(), [shake], 'custom')).toEqual([]);
  });

  it('favourites float up among library matches', () => {
    const plain = searchCandidates('chicken', new Set(), [], 'all').map((c) => c.name);
    const last = plain[plain.length - 1];
    const boosted = searchCandidates('chicken', new Set([last]), [], 'all').map((c) => c.name);
    expect(boosted[0]).toBe(last);
  });

  it('is capped like the library search', () => {
    expect(searchCandidates('a', new Set(), [], 'all').length).toBeLessThanOrEqual(14);
  });
});

describe('candidateGrams / candidateIsDish', () => {
  it('a simple library food starts at 100 g, a dish at its recipe total', () => {
    expect(candidateGrams({ kind: 'library', name: simple.name, food: simple })).toBe(100);
    const total = (dish.ingredients ?? []).reduce((s, i) => s + i.grams, 0);
    expect(candidateGrams({ kind: 'library', name: dish.name, food: dish })).toBe(total);
  });

  it('a custom food starts at its serving; a zero serving falls back to 100 g', () => {
    expect(candidateGrams({ kind: 'custom', name: shake.name, food: shake })).toBe(400);
    expect(candidateGrams({ kind: 'custom', name: shake.name, food: { ...shake, servingGrams: 0 } })).toBe(100);
  });

  it('a logged entry starts at the amount it was logged at; nothing usable falls back to 100 g', () => {
    expect(candidateGrams({ kind: 'entry', name: 'x', entry: logged('a', 'x', 1, { grams: 250 }) })).toBe(250);
    expect(candidateGrams({ kind: 'entry', name: 'x', entry: logged('a', 'x', 1, { grams: 0 }) })).toBe(100);
  });

  it('knows a dish when it sees one', () => {
    expect(candidateIsDish({ kind: 'library', name: dish.name, food: dish })).toBe(true);
    expect(candidateIsDish({ kind: 'library', name: simple.name, food: simple })).toBe(false);
    expect(candidateIsDish({ kind: 'custom', name: shake.name, food: shake })).toBe(false);
    expect(candidateIsDish({ kind: 'entry', name: 'x', entry: logged('a', 'x', 1, { ingredients: [{ name: 'Rice', grams: 100, baseCalories: 1, baseCarbs: 1, baseFat: 1, baseProtein: 1 }] }) })).toBe(true);
    expect(candidateIsDish({ kind: 'entry', name: 'x', entry: logged('a', 'x', 1) })).toBe(false);
  });
});

describe('candidateEntry', () => {
  it('a library food becomes the same entry the library builds', () => {
    const entry = candidateEntry({ kind: 'library', name: simple.name, food: simple }, { ...options, grams: 150 });
    expect(entry).toMatchObject({ id: 'new-id', food: simple.name, grams: 150, unit: 'g', baseCalories: simple.calories });
    expect(new Date(entry.addedAt).getHours()).toBe(14);
    expect(new Date(entry.addedAt).getDate()).toBe(25); // filed under the chosen day, at the time of day it is now
  });

  it('a library food keeps the unit the person chose', () => {
    expect(candidateEntry({ kind: 'library', name: simple.name, food: simple }, { ...options, grams: 28.3495, unit: 'oz' }).unit).toBe('oz');
  });

  it('a library dish scales its recipe to the chosen total', () => {
    const entry = candidateEntry({ kind: 'library', name: dish.name, food: dish }, { ...options, grams: 1000 });
    expect(entry.ingredients?.length).toBe(dish.ingredients?.length);
    expect(entryTotals(entry).grams).toBeCloseTo(1000, 6);
    expect(entry.grams).toBeUndefined();
  });

  it('a custom food is stored per 100 g so its macros at the serving come out as saved', () => {
    const entry = candidateEntry({ kind: 'custom', name: shake.name, food: shake }, options);
    expect(entry).toMatchObject({ food: 'House shake', grams: 400, unit: 'g' });
    expect(scaledMacros(entry)).toEqual({ calories: 300, protein: 30, fat: 5, carbs: 30 });
  });

  it('a custom food at another amount scales', () => {
    const entry = candidateEntry({ kind: 'custom', name: shake.name, food: shake }, { ...options, grams: 200 });
    expect(scaledMacros(entry)).toEqual({ calories: 150, protein: 15, fat: 3, carbs: 15 });
  });

  it('a custom food with a zero serving does not divide by zero', () => {
    const entry = candidateEntry({ kind: 'custom', name: shake.name, food: { ...shake, servingGrams: 0 } }, options);
    expect(entry.grams).toBe(100);
    expect(Number.isFinite(entry.baseCalories)).toBe(true);
  });

  it('a logged entry is copied with a new id and time, keeping its macros and where it came from', () => {
    const original = logged('old', 'Mystery scan', 5, { source: 'scan', extra: { secret: 1 }, grams: 120 });
    const entry = candidateEntry({ kind: 'entry', name: 'Mystery scan', entry: original }, options);
    expect(entry).toMatchObject({ id: 'new-id', food: 'Mystery scan', source: 'scan', grams: 120, baseCalories: 200 });
    expect(entry.extra).toBeUndefined();
    expect(entry.addedAt).not.toBe(original.addedAt);
    expect(original.id).toBe('old'); // the original is untouched
  });

  it('a copied simple entry takes the chosen amount and unit', () => {
    const entry = candidateEntry({ kind: 'entry', name: 'x', entry: logged('old', 'x', 5) }, { ...options, grams: 56.699, unit: 'oz' });
    expect(entry).toMatchObject({ grams: 56.699, unit: 'oz' });
  });

  it('a copied dish scales to the chosen total', () => {
    const original = logged('old', 'Bowl', 5, { grams: undefined, unit: undefined, baseCalories: undefined, baseCarbs: undefined, baseFat: undefined, baseProtein: undefined, ingredients: [
      { name: 'Rice', grams: 100, unit: 'g', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 },
      { name: 'Egg', grams: 50, unit: 'g', baseCalories: 143, baseCarbs: 0.7, baseFat: 9.5, baseProtein: 12.6 },
    ] });
    const entry = candidateEntry({ kind: 'entry', name: 'Bowl', entry: original } as Candidate, { ...options, grams: 300 });
    expect(entryTotals(entry).grams).toBeCloseTo(300, 6);
    expect(entry.ingredients?.map((i) => Math.round(i.grams))).toEqual([200, 100]);
  });

  it('ignores a non-positive amount (the default is used)', () => {
    expect(candidateEntry({ kind: 'library', name: simple.name, food: simple }, { ...options, grams: 0 }).grams).toBe(100);
    expect(candidateEntry({ kind: 'custom', name: shake.name, food: shake }, { ...options, grams: -5 }).grams).toBe(400);
    expect(candidateEntry({ kind: 'entry', name: 'x', entry: logged('o', 'x', 1) }, { ...options, grams: 0 }).grams).toBe(80);
  });

  it('files an hour row’s entry on the hour', () => {
    const entry = candidateEntry({ kind: 'library', name: simple.name, food: simple }, { ...options, hour: 9 });
    expect(new Date(entry.addedAt).getHours()).toBe(9);
    expect(new Date(entry.addedAt).getMinutes()).toBe(0);
  });
});

describe('survivors: edges of the amounts', () => {
  const dishEntry = logged('d', 'Bowl', 5, {
    grams: undefined, unit: undefined, baseCalories: undefined, baseCarbs: undefined, baseFat: undefined, baseProtein: undefined,
    ingredients: [{ name: 'Rice', grams: 100, unit: 'g', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 }],
  });

  it('a logged amount of one gram, or less, is still its own amount', () => {
    expect(candidateGrams({ kind: 'entry', name: 'x', entry: logged('a', 'x', 1, { grams: 1 }) })).toBe(1);
    expect(candidateGrams({ kind: 'entry', name: 'x', entry: logged('a', 'x', 1, { grams: 0.5 }) })).toBe(0.5);
  });

  it('a custom serving of one gram is a serving of one gram', () => {
    expect(candidateGrams({ kind: 'custom', name: shake.name, food: { ...shake, servingGrams: 1 } })).toBe(1);
    expect(candidateEntry({ kind: 'custom', name: shake.name, food: { ...shake, servingGrams: 1 } }, options).grams).toBe(1);
  });

  it('an amount of exactly zero means "no amount given" for every kind of candidate', () => {
    expect(candidateEntry({ kind: 'custom', name: shake.name, food: shake }, { ...options, grams: 0 }).grams).toBe(400);
    expect(candidateEntry({ kind: 'library', name: simple.name, food: simple }, { ...options, grams: 0 }).grams).toBe(100);
    expect(candidateEntry({ kind: 'entry', name: 'x', entry: logged('o', 'x', 1) }, { ...options, grams: 0 }).grams).toBe(80);
  });

  it('an amount of exactly one gram is used', () => {
    expect(candidateEntry({ kind: 'custom', name: shake.name, food: shake }, { ...options, grams: 1 }).grams).toBe(1);
    expect(candidateEntry({ kind: 'entry', name: 'x', entry: logged('o', 'x', 1) }, { ...options, grams: 1 }).grams).toBe(1);
  });

  it('a unit chosen without an amount is applied to a simple copy, and never invented on a dish', () => {
    expect(candidateEntry({ kind: 'entry', name: 'x', entry: logged('o', 'x', 1) }, { ...options, unit: 'ml' }).unit).toBe('ml');
    expect(candidateEntry({ kind: 'entry', name: 'x', entry: logged('o', 'x', 1) }, options).unit).toBe('g');
    expect(candidateEntry({ kind: 'entry', name: 'Bowl', entry: dishEntry }, { ...options, unit: 'oz' }).unit).toBeUndefined();
  });

  it('two entries logged at the same instant: the first one found is used', () => {
    const found = findCandidate('Twin', { custom: [], logged: [logged('first', 'Twin', 50), logged('second', 'Twin', 50)] });
    expect(found).toMatchObject({ kind: 'entry', entry: { id: 'first' } });
  });
});
