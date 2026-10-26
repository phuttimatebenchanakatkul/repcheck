import { extractConst, extractFunction, lift, readRepoFile, runWebsiteScript } from '@/testing/website';

import {
  DEFAULT_GOALS,
  MACRO_BOUNDS,
  caloriesFromMacros,
  calorieRing,
  clampMacro,
  entryTotals,
  gramsToUnit,
  isFoodUnit,
  macroLine,
  normaliseGoals,
  num,
  percentOf,
  scaledMacros,
  sumMacrosForDay,
  unitToGrams,
} from '../macros';

// ---- the website's code, lifted -------------------------------------------------------------------------------------------------

const macrosWindow = runWebsiteScript('nutrition_macros.js', () => undefined);
const websiteSum: (entries: unknown) => { calories: number; protein: number; fat: number; carbs: number } = macrosWindow.RepCheckNutritionMacros.sumMacrosForDay;

const template = readRepoFile('templates', 'nutrition.html');
const lifted = lift<{
  entryTotals: (e: unknown) => any;
  scaledMacros: (e: unknown) => any;
  gramsToUnit: (g: number, u: string) => number;
  unitToGrams: (v: number, u: string) => number;
  caloriesFromMacros: (m: unknown) => number;
  loadGoals: () => any;
}>(
  template,
  [
    extractConst(template, 'UNIT_FACTORS'),
    extractFunction(template, 'gramsToUnit'),
    extractFunction(template, 'unitToGrams'),
    extractConst(template, 'MACRO_BOUNDS'),
    extractFunction(template, 'caloriesFromMacros'),
    extractFunction(template, 'clamp'),
    extractConst(template, 'DEFAULT_MACRO_GOALS'),
    extractConst(template, 'DEFAULT_GOALS'),
    extractFunction(template, 'loadGoals'),
    extractFunction(template, 'entryTotals'),
    extractFunction(template, 'scaledMacros'),
  ],
  ['entryTotals', 'scaledMacros', 'gramsToUnit', 'unitToGrams', 'caloriesFromMacros', 'loadGoals'],
  { GOALS_KEY: 'goals', localStorage: { getItem: (k: string) => (k === 'goals' ? goalsJson : null) } },
);
let goalsJson: string | null = null;

// A small deterministic generator, so a failure reproduces.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomEntry(r: () => number) {
  const frac = () => Math.round(r() * 1000) / 10; // 0.0 .. 100.0
  if (r() < 0.4) {
    return {
      id: 'x',
      food: 'dish',
      ingredients: Array.from({ length: 1 + Math.floor(r() * 5) }, () => ({ name: 'i', grams: Math.round(r() * 3000) / 10, baseCalories: frac() * 4, baseCarbs: frac(), baseFat: frac() / 3, baseProtein: frac() })),
    };
  }
  return { id: 'x', food: 'simple', grams: Math.round(r() * 5000) / 10, baseCalories: frac() * 4, baseCarbs: frac(), baseFat: frac() / 3, baseProtein: frac() };
}

describe('day totals: parity with static/nutrition_macros.js', () => {
  it('agree on 300 random days of simple foods and dishes (per-entry rounding, then summed)', () => {
    const r = rng(7);
    for (let day = 0; day < 300; day++) {
      const entries = Array.from({ length: Math.floor(r() * 9) }, () => randomEntry(r));
      expect(sumMacrosForDay(entries)).toEqual(websiteSum(entries));
    }
  });

  it('agree when fields are missing, text or garbage (one bad field must not poison the day)', () => {
    const entries = [
      { grams: 'abc', baseCalories: 50 },
      { grams: 100, baseCalories: null, baseProtein: undefined, baseFat: NaN, baseCarbs: '7' },
      { ingredients: [{ grams: 50 }, { grams: '40', baseCalories: '10' }] },
      { ingredients: [] , grams: 100, baseCalories: 100, baseProtein: 10, baseFat: 1, baseCarbs: 5 },
      {},
    ];
    expect(sumMacrosForDay(entries as never)).toEqual(websiteSum(entries));
  });

  it('agree on not-a-list', () => {
    for (const bad of [null, undefined, {}, 'x', 5]) expect(sumMacrosForDay(bad as never)).toEqual(websiteSum(bad));
  });

  it('rounding is per entry: three entries of 0.5 kcal sum to 3 (each rounds up), not to 2', () => {
    const entry = { grams: 100, baseCalories: 0.5, baseProtein: 0.5, baseFat: 0.5, baseCarbs: 0.5 };
    expect(sumMacrosForDay([entry, entry, entry]).calories).toBe(3);
    expect(websiteSum([entry, entry, entry]).calories).toBe(3);
  });
});

describe('one entry: parity with the nutrition page', () => {
  it('entryTotals and scaledMacros agree on 200 random well-formed entries', () => {
    const r = rng(11);
    for (let i = 0; i < 200; i++) {
      const entry = randomEntry(r);
      expect(entryTotals(entry)).toEqual(lifted.entryTotals(entry));
      expect(scaledMacros(entry)).toEqual(lifted.scaledMacros(entry));
    }
  });

  it('a dish ignores its own top-level amount; a simple food scales its per-100 g values', () => {
    expect(scaledMacros({ grams: 250, baseCalories: 200, baseProtein: 10, baseFat: 4, baseCarbs: 30 })).toEqual({ calories: 500, protein: 25, fat: 10, carbs: 75 });
    expect(entryTotals({ ingredients: [{ name: 'a', grams: 100, baseCalories: 100, baseCarbs: 0, baseFat: 0, baseProtein: 0 }, { name: 'b', grams: 50, baseCalories: 200, baseCarbs: 0, baseFat: 0, baseProtein: 0 }] }).grams).toBe(150);
  });
});

describe('units', () => {
  it.each(['g', 'oz', 'ml'] as const)('%s conversions agree with the website for many values', (unit) => {
    const r = rng(3);
    for (let i = 0; i < 100; i++) {
      const v = Math.round(r() * 100000) / 100;
      expect(gramsToUnit(v, unit)).toBe(lifted.gramsToUnit(v, unit));
      expect(unitToGrams(v, unit)).toBe(lifted.unitToGrams(v, unit));
    }
  });

  it('an ounce is 28.3495 g, a mL is a gram, and the conversion round-trips', () => {
    expect(unitToGrams(1, 'oz')).toBe(28.3495);
    expect(unitToGrams(250, 'ml')).toBe(250);
    expect(gramsToUnit(unitToGrams(8, 'oz'), 'oz')).toBe(8);
  });

  it('isFoodUnit accepts exactly the three', () => {
    expect(['g', 'oz', 'ml'].every(isFoodUnit)).toBe(true);
    expect(['lb', 'mL', '', null, undefined, 5].some(isFoodUnit)).toBe(false);
  });
});

describe('goals', () => {
  it('calories are 4P + 9F + 4C, rounded, and the defaults are 150/65/200 = 1985', () => {
    expect(caloriesFromMacros({ protein: 150, fat: 65, carbs: 200 })).toBe(1985);
    expect(DEFAULT_GOALS).toEqual({ protein: 150, fat: 65, carbs: 200, calories: 1985 });
    expect(caloriesFromMacros({ protein: 100.4, fat: 50.5, carbs: 10 })).toBe(Math.round(100.4 * 4 + 50.5 * 9 + 40));
  });

  it('normaliseGoals agrees with the website’s loadGoals for stored values of every kind', () => {
    const cases: unknown[] = [
      null,
      {},
      { protein: 180, fat: 70, carbs: 250 },
      { protein: 5, fat: 5000, carbs: -3 },
      { protein: '170', fat: '60.5', carbs: '12abc' },
      { protein: 'abc', fat: null, carbs: undefined },
      { protein: 400, fat: 300, carbs: 800 },
      { protein: 401, fat: 14.99, carbs: 19.99 },
      { protein: 200, calories: 99999 },
    ];
    for (const stored of cases) {
      goalsJson = stored === null ? null : JSON.stringify(stored);
      expect(normaliseGoals(stored as never)).toEqual(lifted.loadGoals());
    }
  });

  it('clampMacro reads a leading number, falls back on junk, and clamps to the bounds', () => {
    expect(clampMacro('12abc', MACRO_BOUNDS.protein, 150)).toBe(20);
    expect(clampMacro('abc', MACRO_BOUNDS.protein, 150)).toBe(150);
    expect(clampMacro(9999, MACRO_BOUNDS.protein, 150)).toBe(400);
    expect(clampMacro(-5, MACRO_BOUNDS.carbs, 200)).toBe(20);
    expect(clampMacro(null, MACRO_BOUNDS.fat, 65)).toBe(65);
  });

  it('calories are re-derived even when a stale value was stored', () => {
    expect(normaliseGoals({ protein: 100, fat: 50, carbs: 100, calories: 1 } as never).calories).toBe(1250);
  });
});

describe('bars and the ring', () => {
  it('percentOf is 0..100 and never NaN', () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(500, 200)).toBe(100);
    expect(percentOf(-5, 200)).toBe(0);
    expect(percentOf(5, 0)).toBe(100); // Infinity clamps: a zero goal is full, as on the website
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(NaN, 100)).toBe(0);
  });

  it('the ring shows what is left, flips to "over" past the goal and stops filling at full', () => {
    expect(calorieRing(1200.4, 2000)).toEqual({ consumed: 1200, goal: 2000, remaining: 800, over: false, fill: 0.6 });
    expect(calorieRing(2500, 2000)).toEqual({ consumed: 2500, goal: 2000, remaining: -500, over: true, fill: 1 });
    expect(calorieRing(0, 2000).fill).toBe(0);
    expect(calorieRing(100, 0).fill).toBe(0);
  });

  it('exactly the goal is not over', () => {
    expect(calorieRing(2000, 2000).over).toBe(false);
  });
});

describe('small helpers', () => {
  it('num coerces to a finite number', () => {
    expect([num('3.5'), num(null), num(undefined), num('x'), num(NaN), num(Infinity), num(7)]).toEqual([3.5, 0, 0, 0, 0, 0, 7]);
  });

  it('macroLine is the website’s "31P / 4F / 0C"', () => {
    expect(macroLine({ protein: 30.6, fat: 3.5, carbs: 0 })).toBe('31P / 4F / 0C');
    expect(macroLine({})).toBe('0P / 0F / 0C');
  });
});

describe('survivors: goal bounds and the ring', () => {
  it.each([
    ['protein', 400, 401, 20, 19],
    ['fat', 300, 301, 15, 14],
    ['carbs', 800, 801, 20, 19],
  ] as const)('%s is held to exactly its bounds', (key, max, aboveMax, min, belowMin) => {
    expect(normaliseGoals({ [key]: max })[key]).toBe(max);
    expect(normaliseGoals({ [key]: aboveMax })[key]).toBe(max);
    expect(normaliseGoals({ [key]: min })[key]).toBe(min);
    expect(normaliseGoals({ [key]: belowMin })[key]).toBe(min);
  });

  it('the ring rounds calories to the nearest whole, halves up', () => {
    expect(calorieRing(100.5, 2000).consumed).toBe(101);
    expect(calorieRing(100.4, 2000).consumed).toBe(100);
    expect(calorieRing(1999.5, 2000).remaining).toBe(0);
  });

  it('a goal of zero (or less) has an empty ring, however much was eaten', () => {
    expect(calorieRing(500, 0).fill).toBe(0);
    expect(calorieRing(500, -1).fill).toBe(0);
  });

  it('the ring never goes past full or below empty', () => {
    expect(calorieRing(5000, 2000).fill).toBe(1);
    expect(calorieRing(-50, 2000).fill).toBe(0);
    expect(calorieRing(1000, 2000).fill).toBe(0.5);
  });
});

describe('survivors 2: the smallest goal', () => {
  it('a goal of one calorie still fills the ring in proportion', () => {
    expect(calorieRing(1, 1).fill).toBe(1);
    expect(calorieRing(0, 1).fill).toBe(0);
  });
});
