/* RepCheck day-level nutrition macro totals.
 *
 * Single source of truth for summing a day's logged food entries into
 * { calories, protein, fat, carbs }. Previously home.html, full_stats.html,
 * and coaching.js's week chart each carried their own copy-pasted
 * sumMacrosForDay(), which is how they drifted from templates/
 * nutrition.html's actual rendered totals (see entryTotals()/
 * scaledMacros() there) in two different ways: deriving calories from the
 * macro grams instead of summing each entry's own baseCalories, and
 * rounding once across the whole day instead of rounding each entry first.
 *
 * Rounds PER ENTRY before accumulating into the day total, matching
 * nutrition.html's entryTotals() + scaledMacros() + renderSummary()
 * split exactly: entryTotals() sums an entry's ingredients raw,
 * scaledMacros() rounds that entry's total, and renderSummary() sums
 * the already-rounded per-entry integers. Summing every entry's raw
 * values across the whole day and rounding once at the end produces a
 * different (and sometimes different-by-1) result whenever entries have
 * fractional totals, which is the common case -- food data is stored
 * with fractional per-100g macros (e.g. 0.3g fat), so the vast majority
 * of gram-scaled log entries land on a fractional total.
 */
(function (global) {
  "use strict";

  function sumMacrosForDay(entries) {
    const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    if (!Array.isArray(entries)) return totals;
    entries.forEach((entry) => {
      const items = (entry.ingredients && entry.ingredients.length) ? entry.ingredients : [entry];
      const raw = { calories: 0, protein: 0, fat: 0, carbs: 0 };
      items.forEach((item) => {
        const scale = item.grams / 100;
        raw.calories += item.baseCalories * scale;
        raw.protein += item.baseProtein * scale;
        raw.fat += item.baseFat * scale;
        raw.carbs += item.baseCarbs * scale;
      });
      totals.calories += Math.round(raw.calories);
      totals.protein += Math.round(raw.protein);
      totals.fat += Math.round(raw.fat);
      totals.carbs += Math.round(raw.carbs);
    });
    return totals;
  }

  global.RepCheckNutritionMacros = { sumMacrosForDay };
})(window);
