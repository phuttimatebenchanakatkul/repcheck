import { entryTotals, scaledMacros } from '../macros';
import { parseScanResult, scanAmountIn, scanBaseGrams, scanEntry, scanGrams, scanTotals, type ScanResult } from '../scan';

const NOW = new Date(2026, 9, 26, 14, 30, 15);
const options = { id: 'scan-1', day: '2026-10-25', now: NOW, name: 'Pad kra pao', grams: 300 };

const plate: ScanResult = {
  food_name: 'Pad kra pao',
  confidence: 'medium',
  note: 'An estimate.',
  ingredients: [
    { name: 'Rice', grams: 150, calories: 130, protein: 2.7, fat: 0.3, carbs: 28 },
    { name: 'Pork', grams: 100, calories: 250, protein: 20, fat: 18, carbs: 1 },
    { name: 'Egg', grams: 50, calories: 143, protein: 12.6, fat: 9.5, carbs: 0.7 },
  ],
  // totals for 300 g: 195 + 250 + 71.5 = 516.5 kcal
  calories: 517,
  protein: 4.05 + 20 + 6.3,
  fat: 0.45 + 18 + 4.75,
  carbs: 42 + 1 + 0.35,
};

describe('parseScanResult', () => {
  it('accepts a well-formed answer', () => {
    expect(parseScanResult(plate)).toEqual(plate);
  });

  it.each([[null], [undefined], ['text'], [42], [{}], [{ ingredients: 'no' }], [{ ingredients: [] }]])('is null for %p', (raw) => {
    expect(parseScanResult(raw)).toBeNull();
  });

  it('drops ingredients that have no name or no weight, and is null if none are left', () => {
    const parsed = parseScanResult({ ...plate, ingredients: [{ name: '', grams: 5 }, { name: 'Air', grams: 0 }, null, 'x', { name: 'Rice', grams: 100, calories: 130 }] });
    expect(parsed?.ingredients).toEqual([{ name: 'Rice', grams: 100, calories: 130, protein: 0, fat: 0, carbs: 0 }]);
    expect(parseScanResult({ ...plate, ingredients: [{ name: '', grams: 5 }, { name: 'Air', grams: 0 }] })).toBeNull();
  });

  it('turns unreadable numbers into zero rather than NaN', () => {
    const parsed = parseScanResult({ ...plate, calories: 'lots', protein: null, ingredients: [{ name: 'Rice', grams: '120', calories: 'x' }] });
    expect(parsed).toMatchObject({ calories: 0, protein: 0, ingredients: [{ grams: 120, calories: 0 }] });
  });

  it('an unknown confidence is medium; "custom" (the person’s own food) is kept', () => {
    expect(parseScanResult({ ...plate, confidence: 'certain' })?.confidence).toBe('medium');
    expect(parseScanResult({ ...plate, confidence: 'custom' })?.confidence).toBe('custom');
    expect(parseScanResult({ ...plate, confidence: 'high' })?.confidence).toBe('high');
    expect(parseScanResult({ ...plate, confidence: 'low' })?.confidence).toBe('low');
  });

  it('keeps the data source, the custom food id and valid servings; drops the rest', () => {
    const parsed = parseScanResult({ ...plate, data_source: 'Open Food Facts', custom_food_id: 7, servings: [{ label: '1 bar', grams: 45 }, { label: '', grams: 3 }, { label: 'bad', grams: 0 }, null] });
    expect(parsed).toMatchObject({ data_source: 'Open Food Facts', custom_food_id: 7, servings: [{ label: '1 bar', grams: 45 }] });
    const bare = parseScanResult(plate) as ScanResult;
    expect('data_source' in bare).toBe(false);
    expect('servings' in bare).toBe(false);
    expect('custom_food_id' in bare).toBe(false);
  });

  it('a blank name becomes a placeholder, not an empty title', () => {
    expect(parseScanResult({ ...plate, food_name: '   ' })?.food_name).toBe('Unknown food');
    expect(parseScanResult({ ...plate, food_name: '  Soup ' })?.food_name).toBe('Soup');
  });
});

describe('amounts', () => {
  it('the scan’s own grams are the ingredients added up (100 if that is nothing)', () => {
    expect(scanBaseGrams(plate)).toBe(300);
    expect(scanBaseGrams({ ingredients: [] })).toBe(100);
  });

  it('turns an amount in a unit into grams; a serving is whatever the food says one is', () => {
    expect(scanGrams(2, 'g', 45)).toBe(2);
    expect(scanGrams(2, 'oz', 45)).toBeCloseTo(56.699, 3);
    expect(scanGrams(2, 'serving', 45)).toBe(90);
    expect(scanGrams(0.5, 'serving', 270)).toBe(135);
  });

  it('never negative', () => {
    expect(scanGrams(-3, 'g', 45)).toBe(0);
    expect(scanGrams(-3, 'serving', 45)).toBe(0);
  });

  it('writes grams back in another unit to two decimals, so switching unit does not change the amount', () => {
    expect(scanAmountIn(90, 'serving', 45)).toBe(2);
    expect(scanAmountIn(100, 'oz', 45)).toBe(3.53);
    expect(scanAmountIn(100, 'g', 45)).toBe(100);
    const grams = scanGrams(3.53, 'oz', 45);
    expect(scanAmountIn(grams, 'g', 45)).toBeCloseTo(100.07, 1);
  });
});

describe('scanTotals', () => {
  it('at the scan’s own grams it is the result’s totals', () => {
    expect(scanTotals(plate, 300)).toEqual({ calories: plate.calories, protein: plate.protein, fat: plate.fat, carbs: plate.carbs });
  });

  it('scales linearly with the amount', () => {
    const half = scanTotals(plate, 150);
    expect(half.calories).toBeCloseTo(plate.calories / 2, 9);
    expect(half.protein).toBeCloseTo(plate.protein / 2, 9);
    const double = scanTotals(plate, 600);
    expect(double.carbs).toBeCloseTo(plate.carbs * 2, 9);
  });

  it('an amount of zero is zero of everything', () => {
    expect(scanTotals(plate, 0)).toEqual({ calories: 0, protein: 0, fat: 0, carbs: 0 });
  });
});

describe('scanEntry', () => {
  it('is a dish of the scan’s ingredients marked as a scan, filed on the day at the time of day it is now', () => {
    const entry = scanEntry(plate, options);
    expect(entry).toMatchObject({ id: 'scan-1', food: 'Pad kra pao', source: 'scan' });
    expect(entry.ingredients?.map((i) => i.name)).toEqual(['Rice', 'Pork', 'Egg']);
    expect(entry.grams).toBeUndefined();
    expect(new Date(entry.addedAt).getDate()).toBe(25);
    expect(new Date(entry.addedAt).getHours()).toBe(14);
  });

  it('keeps each ingredient’s per-100 g macros and logs its grams in g', () => {
    const [rice] = scanEntry(plate, options).ingredients ?? [];
    expect(rice).toEqual({ name: 'Rice', grams: 150, unit: 'g', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 });
  });

  it('at the scan’s own amount the logged macros are the scan’s totals', () => {
    const entry = scanEntry(plate, options);
    expect(entryTotals(entry).calories).toBeCloseTo(516.5, 6);
    expect(scaledMacros(entry).calories).toBe(517);
  });

  it('another amount scales every ingredient together and rounds each to two decimals', () => {
    const entry = scanEntry(plate, { ...options, grams: 100 });
    expect(entry.ingredients?.map((i) => i.grams)).toEqual([50, 33.33, 16.67]);
    expect(entryTotals(entry).grams).toBeCloseTo(100, 1);
  });

  it('the name the person typed wins; blank falls back to the scan’s', () => {
    expect(scanEntry(plate, { ...options, name: '  My lunch ' }).food).toBe('My lunch');
    expect(scanEntry(plate, { ...options, name: '   ' }).food).toBe('Pad kra pao');
  });

  it('files an hour row’s entry on the hour', () => {
    const entry = scanEntry(plate, { ...options, hour: 9 });
    expect(new Date(entry.addedAt).getHours()).toBe(9);
    expect(new Date(entry.addedAt).getMinutes()).toBe(0);
  });

  it('an amount of zero logs zero grams, as the website does (the sheet does not offer to add it)', () => {
    expect(scanEntry(plate, { ...options, grams: 0 }).ingredients?.map((i) => i.grams)).toEqual([0, 0, 0]);
  });

  it('does not change the result it was given', () => {
    const before = JSON.stringify(plate);
    scanEntry(plate, { ...options, grams: 123 });
    expect(JSON.stringify(plate)).toBe(before);
  });
});

describe('survivors: tiny amounts, odd fields', () => {
  it('an ingredient of one gram or less than one is kept', () => {
    const parsed = parseScanResult({ ...plate, ingredients: [{ name: 'Salt', grams: 1 }, { name: 'Pepper', grams: 0.5 }, { name: 'Nothing', grams: 0 }] });
    expect(parsed?.ingredients.map((i) => i.name)).toEqual(['Salt', 'Pepper']);
  });

  it('a serving of one gram is a serving', () => {
    expect(parseScanResult({ ...plate, servings: [{ label: 'pinch', grams: 1 }, { label: 'none', grams: 0 }] })?.servings).toEqual([{ label: 'pinch', grams: 1 }]);
  });

  it('a data source that is blank or not text is not kept', () => {
    expect('data_source' in (parseScanResult({ ...plate, data_source: '' }) as ScanResult)).toBe(false);
    expect('data_source' in (parseScanResult({ ...plate, data_source: 42 }) as ScanResult)).toBe(false);
  });

  it('a result whose ingredients somehow weigh less than nothing scales to nothing and logs as seen', () => {
    const odd = { ...plate, ingredients: [{ name: 'Odd', grams: -50, calories: 1, protein: 1, fat: 1, carbs: 1 }] };
    expect(scanBaseGrams(odd)).toBe(-50);
    expect(scanTotals(odd, 100)).toEqual({ calories: 0, protein: 0, fat: 0, carbs: 0 });
    expect(scanEntry(odd, { ...options, grams: 100 }).ingredients?.[0].grams).toBe(-50);
  });
});
