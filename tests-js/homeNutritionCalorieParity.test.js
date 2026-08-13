// Regression coverage for the homepage/Nutrition calorie mismatch: the
// homepage's "Calories & macros" card (templates/home.html) and the Food
// Today tile used to derive kcal from the day's summed macro grams
// (4*protein + 9*fat + 4*carbs), while templates/nutrition.html's own
// Today's Totals ring always summed each logged entry's actual
// baseCalories field. Real foods' listed calories don't always equal
// exactly 4P+9F+4C (fiber, alcohol, rounding), so for the same day's log
// the two pages could show different kcal totals.
//
// Fix: home.html now sums baseCalories the same way nutrition.html does,
// so both pages compute the same eaten-calories number from the same log.
import { describe, expect, it } from "vitest";
import { loadHomeMacros } from "./support/loadHomeMacros.js";
import { loadNutritionEntryTotals } from "./support/loadNutritionEntryTotals.js";

const { sumMacrosForDay } = loadHomeMacros();
const { entryTotals } = loadNutritionEntryTotals();

// A day's log with entries whose baseCalories intentionally do NOT equal
// 4*baseProtein + 9*baseFat + 4*baseCarbs -- this is what real food data
// looks like (fiber, sugar alcohols, rounding on the source label).
const DAY_ENTRIES = [
  { grams: 150, baseCalories: 240, baseProtein: 20, baseFat: 8, baseCarbs: 15 },
  {
    grams: 100,
    ingredients: [
      { grams: 200, baseCalories: 310, baseProtein: 25, baseFat: 12, baseCarbs: 20 },
      { grams: 50, baseCalories: 90, baseProtein: 2, baseFat: 1, baseCarbs: 18 },
    ],
  },
];

function nutritionPageTotalCalories(entries) {
  return Math.round(entries.reduce((sum, entry) => sum + entryTotals(entry).calories, 0));
}

describe("home.html sumMacrosForDay() calories vs nutrition.html entryTotals() calories", () => {
  it("sums each entry's real baseCalories, not a macro-derived formula", () => {
    const homeEaten = sumMacrosForDay(DAY_ENTRIES);

    // What the old buggy code produced: 4P + 9F + 4C from the summed macros.
    const macroDerivedKcal = homeEaten.protein * 4 + homeEaten.fat * 9 + homeEaten.carbs * 4;

    expect(Math.round(homeEaten.calories)).not.toBe(Math.round(macroDerivedKcal));
  });

  it("matches nutrition.html's own total for the same day's log (the actual bug)", () => {
    const homeEatenKcal = Math.round(sumMacrosForDay(DAY_ENTRIES).calories);
    const nutritionPageKcal = nutritionPageTotalCalories(DAY_ENTRIES);

    expect(homeEatenKcal).toBe(nutritionPageKcal);
  });

  it("handles an empty day the same way both pages do (zero, not NaN)", () => {
    expect(sumMacrosForDay([]).calories).toBe(0);
    expect(sumMacrosForDay(undefined).calories).toBe(0);
  });
});
