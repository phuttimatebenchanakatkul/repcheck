// The "Log food" confirm screen used to list a dish's ingredients as dead
// text: "Glass Noodles 180g". A second helping is rarely the same plate, so
// the only way to log 120g of noodles instead was to log the wrong amount
// first and go fix it in the timeline afterwards. The screen now carries the
// same editable ingredient cards the timeline's ingredients panel does.
//
// These run the REAL source out of templates/nutrition.html (see
// support/loadNutritionRelogConfirm.js) -- the point is that an edit reaches
// all three of the row's own macros, the dish's donut, and the entry that
// "Log again" actually writes, which only composition can show.

import { describe, it, expect } from "vitest";
import { loadNutritionRelogConfirm } from "./support/loadNutritionRelogConfirm.js";

// Per 100g, so a 100g ingredient contributes exactly these numbers.
const NOODLES = {
  name: "Glass Noodles", grams: 100, unit: "g",
  baseCalories: 350, baseProtein: 0, baseFat: 0, baseCarbs: 86,
};
const CHICKEN = {
  name: "Chicken Breast", grams: 100, unit: "g",
  baseCalories: 165, baseProtein: 31, baseFat: 4, baseCarbs: 0,
};

function dish(ingredients = [{ ...NOODLES }, { ...CHICKEN }]) {
  return { id: "entry-1", food: "Suki Haeng", source: "scan", addedAt: 1, ingredients };
}

function typeAmount(input, value) {
  input.value = String(value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

describe("log-food confirm screen: ingredient editor", () => {
  it("gives every ingredient an amount field, a unit picker and a remove button", () => {
    const ui = loadNutritionRelogConfirm(dish());

    expect(ui.names()).toEqual(["Glass Noodles", "Chicken Breast"]);
    expect(ui.amountInputs().map((i) => i.value)).toEqual(["100", "100"]);
    expect(ui.unitSelects().map((s) => s.value)).toEqual(["g", "g"]);
    expect(ui.removeButtons()).toHaveLength(2);
  });

  it("follows an edited amount through the row, the ring and the total", () => {
    const ui = loadNutritionRelogConfirm(dish());
    expect(ui.donutCalories()).toBe(515);
    expect(ui.totalHint()).toBe("200g total");

    typeAmount(ui.amountInputs()[0], 50);

    expect(ui.macrosText()[0]).toContain("175 kcal");
    expect(ui.donutCalories()).toBe(340); // 175 noodles + 165 chicken
    expect(ui.totalHint()).toBe("150g total");
  });

  it("logs the edited amounts, not the ones it opened with", () => {
    const ui = loadNutritionRelogConfirm(dish(), 13);

    typeAmount(ui.amountInputs()[0], 50);
    ui.logAgain();

    expect(ui.calls.relogEntry).toHaveLength(1);
    const { draft, hour } = ui.calls.relogEntry[0];
    expect(draft.ingredients.map((ing) => ing.grams)).toEqual([50, 100]);
    expect(draft.food).toBe("Suki Haeng");
    expect(draft.source).toBe("scan"); // still lands in "Recent scans"
    expect(hour).toBe(13);
  });

  it("never touches the entry it was opened from", () => {
    // The entry behind this screen is a real meal already logged on some past
    // day. Editing amounts here is about the NEW log; the old one must read
    // exactly as it did before the sheet was opened.
    const original = dish();
    const ui = loadNutritionRelogConfirm(original);

    typeAmount(ui.amountInputs()[0], 50);
    ui.removeButtons()[1].click();

    expect(original.ingredients.map((ing) => ing.grams)).toEqual([100, 100]);
    expect(original.ingredients).toHaveLength(2);
  });

  it("keeps grams canonical when the unit changes", () => {
    const ui = loadNutritionRelogConfirm(dish());
    const select = ui.unitSelects()[0];

    select.value = "oz";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));

    // 100g shown as 3.5oz -- the same amount, so nothing about the dish moved.
    expect(ui.amountInputs()[0].value).toBe("3.5");
    expect(ui.donutCalories()).toBe(515);

    typeAmount(ui.amountInputs()[0], 1); // 1oz = 28.3g of noodles = 99 kcal
    expect(ui.macrosText()[0]).toContain("99 kcal");
    ui.logAgain();
    expect(ui.calls.relogEntry[0].draft.ingredients[0].grams).toBeCloseTo(28.3495, 4);
  });

  it("drops a removed ingredient from the dish and from what gets logged", () => {
    const ui = loadNutritionRelogConfirm(dish());

    ui.removeButtons()[0].click();

    expect(ui.names()).toEqual(["Chicken Breast"]);
    expect(ui.donutCalories()).toBe(165);
    expect(ui.totalHint()).toBe("100g total");

    ui.logAgain();
    expect(ui.calls.relogEntry[0].draft.ingredients.map((ing) => ing.name))
      .toEqual(["Chicken Breast"]);
  });

  it("will not let the last ingredient be removed", () => {
    // An empty ingredients array is a shape entryTotals() has no branch for:
    // it falls through to the simple-food path and scales a `grams` a
    // composite entry never had, so the dish would log as NaN kcal.
    const ui = loadNutritionRelogConfirm(dish([{ ...NOODLES }]));
    expect(ui.removeButtons()).toHaveLength(0);

    const two = loadNutritionRelogConfirm(dish());
    two.removeButtons()[0].click();
    expect(two.removeButtons()).toHaveLength(0);
  });

  it("holds the last good amount while a field is mid-edit", () => {
    const ui = loadNutritionRelogConfirm(dish());

    typeAmount(ui.amountInputs()[0], ""); // the moment after select-all + delete

    expect(ui.donutCalories()).toBe(515);
    ui.logAgain();
    expect(ui.calls.relogEntry[0].draft.ingredients[0].grams).toBe(100);
  });

  it("escapes ingredient names, which the model wrote", () => {
    const ui = loadNutritionRelogConfirm(dish([
      { ...NOODLES, name: '<img src=x onerror="alert(1)">' },
      { ...CHICKEN },
    ]));

    expect(ui.afModalBody.querySelector("img[src='x']")).toBeNull();
    expect(ui.names()[0]).toBe('<img src=x onerror="alert(1)">');
  });

  it("cancels without logging anything", () => {
    const ui = loadNutritionRelogConfirm(dish());
    ui.cancel();
    expect(ui.calls.relogEntry).toHaveLength(0);
    expect(ui.calls.renderAfChoice).toBe(1);
  });
});
