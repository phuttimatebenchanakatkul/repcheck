// Regression coverage for full_stats.html's OWN sumMacrosForDay() -- it is a
// separately copy-pasted implementation from home.html's (not shared code),
// so a test that only extracts and exercises home.html's version (see
// homeNutritionCalorieParity.test.js) does not actually prove full_stats.html
// was fixed too. This exercises the real full_stats.html function directly.
import { describe, expect, it } from "vitest";
import { loadFullStatsMacros } from "./support/loadFullStatsMacros.js";
import { loadHomeMacros } from "./support/loadHomeMacros.js";
import { loadNutritionEntryTotals } from "./support/loadNutritionEntryTotals.js";

const { sumMacrosForDay: fullStatsSumMacrosForDay } = loadFullStatsMacros();
const { sumMacrosForDay: homeSumMacrosForDay } = loadHomeMacros();
const { entryTotals } = loadNutritionEntryTotals();

// Same divergent-baseCalories fixture as homeNutritionCalorieParity.test.js.
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

describe("full_stats.html sumMacrosForDay() calories vs nutrition.html entryTotals() calories", () => {
  it("sums each entry's real baseCalories, not a macro-derived formula", () => {
    const weekEaten = fullStatsSumMacrosForDay(DAY_ENTRIES);
    const macroDerivedKcal = weekEaten.protein * 4 + weekEaten.fat * 9 + weekEaten.carbs * 4;

    expect(Math.round(weekEaten.calories)).not.toBe(Math.round(macroDerivedKcal));
  });

  it("matches nutrition.html's own total for the same day's log (the actual bug)", () => {
    const weekEatenKcal = Math.round(fullStatsSumMacrosForDay(DAY_ENTRIES).calories);
    const nutritionPageKcal = nutritionPageTotalCalories(DAY_ENTRIES);

    expect(weekEatenKcal).toBe(nutritionPageKcal);
  });

  it("agrees with home.html's own sumMacrosForDay() -- the two copy-pasted implementations can't silently diverge", () => {
    const fullStatsEaten = fullStatsSumMacrosForDay(DAY_ENTRIES);
    const homeEaten = homeSumMacrosForDay(DAY_ENTRIES);

    expect(fullStatsEaten).toEqual(homeEaten);
  });

  it("handles an empty day the same way both pages do (zero, not NaN)", () => {
    expect(fullStatsSumMacrosForDay([]).calories).toBe(0);
    expect(fullStatsSumMacrosForDay(undefined).calories).toBe(0);
  });
});
