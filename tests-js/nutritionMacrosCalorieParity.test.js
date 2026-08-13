// Regression coverage for the homepage/Weekly-Stats vs Nutrition calorie
// mismatch. static/nutrition_macros.js (RepCheckNutritionMacros.sumMacrosForDay,
// shared by templates/home.html and templates/full_stats.html) must agree
// with templates/nutrition.html's actual rendered total for the same day's
// log. nutrition.html computes that total in two steps:
//   1. entryTotals(entry) sums one entry's ingredients raw (unrounded).
//   2. scaledMacros(entry) rounds that entry's total.
//   3. renderSummary() sums the already-rounded per-entry integers.
// Two distinct bugs are covered here:
//   - Deriving calories from macro grams (4*protein + 9*fat + 4*carbs)
//     instead of summing each entry's own baseCalories -- real foods'
//     listed calories don't always equal exactly 4P+9F+4C (fiber, alcohol,
//     rounding on the source label).
//   - Summing raw values across ALL of a day's entries and rounding once
//     at the end, instead of rounding each entry first and summing the
//     rounded integers (nutrition.html's actual approach) -- these differ
//     whenever entries have fractional totals, which is the common case
//     since food data has fractional per-100g macros (e.g. 0.3g fat).
import { describe, expect, it } from "vitest";
import { loadNutritionMacros } from "./support/loadNutritionMacros.js";
import { loadNutritionEntryTotals } from "./support/loadNutritionEntryTotals.js";

const { sumMacrosForDay } = loadNutritionMacros();
const { entryTotals, scaledMacros } = loadNutritionEntryTotals();

// Mirrors nutrition.html's renderSummary(): round EACH entry's totals
// first (scaledMacros), then sum the rounded integers -- not sum raw
// then round once.
function nutritionPageRealTotals(entries) {
  return entries.reduce(
    (acc, entry) => {
      const m = scaledMacros(entry);
      acc.calories += m.calories;
      acc.protein += m.protein;
      acc.fat += m.fat;
      acc.carbs += m.carbs;
      return acc;
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );
}

describe("RepCheckNutritionMacros.sumMacrosForDay() vs nutrition.html's real rendered totals", () => {
  it("sums each entry's real baseCalories, not a macro-derived formula", () => {
    const entries = [
      { grams: 150, baseCalories: 240, baseProtein: 20, baseFat: 8, baseCarbs: 15 },
    ];
    const eaten = sumMacrosForDay(entries);
    const macroDerivedKcal = eaten.protein * 4 + eaten.fat * 9 + eaten.carbs * 4;

    expect(eaten.calories).not.toBe(macroDerivedKcal);
    expect(eaten.calories).toBe(nutritionPageRealTotals(entries).calories);
  });

  it("matches nutrition.html's real per-entry-rounded total for a composite (ingredients) entry", () => {
    const entries = [
      {
        grams: 100,
        ingredients: [
          { grams: 200, baseCalories: 310, baseProtein: 25, baseFat: 12, baseCarbs: 20 },
          { grams: 50, baseCalories: 90, baseProtein: 2, baseFat: 1, baseCarbs: 18 },
        ],
      },
    ];

    expect(sumMacrosForDay(entries)).toEqual(nutritionPageRealTotals(entries));
  });

  it("rounds PER ENTRY before summing across entries -- the rounding-order regression", () => {
    // Each entry's raw calorie/macro totals land on X.5, chosen so that
    // "round once at the end" and "round per entry, then sum" disagree.
    // Per-entry: round(10.5) + round(10.5) = 11 + 11 = 22.
    // Sum-then-round (the bug): round(10.5 + 10.5) = round(21) = 21.
    const entries = [
      { grams: 100, baseCalories: 10.5, baseProtein: 1.5, baseFat: 1.5, baseCarbs: 1.5 },
      { grams: 100, baseCalories: 10.5, baseProtein: 1.5, baseFat: 1.5, baseCarbs: 1.5 },
    ];

    const eaten = sumMacrosForDay(entries);
    const real = nutritionPageRealTotals(entries);

    expect(eaten).toEqual(real);
    expect(eaten.calories).toBe(22);
    expect(eaten.protein).toBe(4); // round(1.5) + round(1.5) = 2 + 2 = 4
  });

  it("matches nutrition.html's real total across multiple mixed entries (the actual bug)", () => {
    const entries = [
      { grams: 150, baseCalories: 240, baseProtein: 20, baseFat: 8, baseCarbs: 15 },
      {
        grams: 100,
        ingredients: [
          { grams: 200, baseCalories: 310, baseProtein: 25, baseFat: 12, baseCarbs: 20 },
          { grams: 50, baseCalories: 90, baseProtein: 2, baseFat: 1, baseCarbs: 18 },
        ],
      },
      { grams: 137, baseCalories: 89, baseProtein: 3.1, baseFat: 0.9, baseCarbs: 19 },
    ];

    expect(sumMacrosForDay(entries)).toEqual(nutritionPageRealTotals(entries));
  });

  it("handles an empty day the same way both pages do (zero, not NaN)", () => {
    expect(sumMacrosForDay([]).calories).toBe(0);
    expect(sumMacrosForDay(undefined).calories).toBe(0);
  });

  it("a malformed entry contributes 0, not NaN, and doesn't poison the rest of the day", () => {
    // Regression: adversarial review flagged that consolidating three
    // independent implementations into this shared function widened the
    // blast radius of a bad entry -- before, only nutrition.html could be
    // corrupted by a NaN field; now home.html, full_stats.html, and
    // coaching.js all read this same total.
    const entries = [
      { grams: 150, baseCalories: 240, baseProtein: 20, baseFat: 8, baseCarbs: 15 },
      { grams: 100, baseCalories: undefined, baseProtein: "not-a-number", baseFat: null, baseCarbs: 5 },
    ];

    const eaten = sumMacrosForDay(entries);

    expect(Number.isFinite(eaten.calories)).toBe(true);
    expect(Number.isFinite(eaten.protein)).toBe(true);
    expect(Number.isFinite(eaten.fat)).toBe(true);
    expect(Number.isFinite(eaten.carbs)).toBe(true);
    // The good entry's contribution (240 cal @ 150g = 360) must survive
    // intact -- the bad entry contributes 0 for its malformed fields, not
    // NaN, so it doesn't zero out or NaN the whole day.
    expect(eaten.calories).toBe(360);
    expect(eaten.protein).toBe(30);
  });
});
