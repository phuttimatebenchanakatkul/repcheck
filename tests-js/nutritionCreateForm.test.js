// Coverage for the "Create Food" af-modal screen's two highest-risk changed
// paths (see templates/nutrition.html's renderAfCreateForm/submitCustomFood):
//
//   1. Serving-size unit conversion (unitToGrams()/UNIT_FACTORS) feeding
//      servingGrams in the POST /api/custom-foods body. The server trusts
//      this value as-is (app.py's api_create_custom_food just does
//      `float(payload.get("servingGrams") or 100)`, no re-derivation from a
//      unit) -- a wrong conversion here is silent data corruption: a "4 oz"
//      serving saved as 4g instead of ~113g understates every macro in that
//      food by ~28x, forever, with no error anywhere.
//   2. The in-app "+ Add another serving size" form (replacing the old
//      native prompt() dialogs) -- its validation must reject empty/
//      non-numeric/zero/negative input as a no-op, not push garbage into
//      afCreateExtraServings, which flows into the same POST body.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNutritionCreateForm } from "./support/loadNutritionCreateForm.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A resolved fetch that reports failure ({ok:false}) is enough to exercise
// submitCustomFood() through the full request-body construction (including
// the servingGrams conversion and barcode sanitization under test) without
// needing to also stub the success path's customFoodToResult()/renderAfResult()
// call chain, which submitCustomFood() only reaches when data.ok is true.
function stubFetchCapturingBody() {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { json: async () => ({ ok: false, error: "not tested past this point" }) };
    })
  );
  return calls;
}

describe("nutrition.html submitCustomFood -- servingGrams unit conversion", () => {
  it("converts an oz serving amount to grams via the real unitToGrams()/UNIT_FACTORS.oz before POSTing", async () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);
    document.getElementById("af-create-protein").value = "10";
    document.getElementById("af-create-serving-amount").value = "4";
    document.getElementById("af-create-serving-unit").value = "oz";

    const calls = stubFetchCapturingBody();
    await mod.submitCustomFood();

    expect(calls).toHaveLength(1);
    // 4 oz * 28.3495 g/oz == 113.398g -- if the conversion were dropped (raw
    // amount sent as grams) this would instead be 4, off by ~28x.
    expect(calls[0].body.servingGrams).toBeCloseTo(4 * 28.3495, 6);
    expect(calls[0].body.servingLabel).toBe("1 serving");
  });

  it("passes an mL serving amount through 1:1 (UNIT_FACTORS.ml == 1) rather than misapplying the oz factor", async () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);
    document.getElementById("af-create-protein").value = "10";
    document.getElementById("af-create-serving-amount").value = "250";
    document.getElementById("af-create-serving-unit").value = "ml";

    const calls = stubFetchCapturingBody();
    await mod.submitCustomFood();

    expect(calls[0].body.servingGrams).toBe(250);
  });
});

describe("nutrition.html submitCustomFood -- barcode field", () => {
  it("strips non-digit characters the user typed/left in the editable barcode field before POSTing", async () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, "011-222 333");
    document.getElementById("af-create-protein").value = "10";
    // Sanity: the field is pre-filled verbatim (including the noise) from
    // the "barcode not found" redirect -- only submit-time sanitizes it.
    expect(document.getElementById("af-create-barcode-input").value).toBe("011-222 333");

    const calls = stubFetchCapturingBody();
    await mod.submitCustomFood();

    expect(calls[0].body.barcode).toBe("011222333");
  });
});

describe("nutrition.html renderAfCreateForm -- in-app add-serving-size form", () => {
  it("a valid name + amount + unit converts via unitToGrams() and pushes {label, grams} into afCreateExtraServings, then re-renders the list", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);

    document.getElementById("af-add-serving-btn").click(); // reveals the form
    document.getElementById("af-new-serving-label").value = "1 box";
    document.getElementById("af-new-serving-amount").value = "2";
    document.getElementById("af-new-serving-unit").value = "oz";
    document.getElementById("af-new-serving-confirm-btn").click();

    expect(mod.afCreateExtraServings).toEqual([{ label: "1 box", grams: 2 * 28.3495 }]);
    // The list re-renders inline (not a full form re-render) -- confirms the
    // new row actually reached the DOM, not just the in-memory array.
    const list = document.getElementById("af-extra-servings-list");
    expect(list).not.toBeNull();
    expect(list.textContent).toContain("1 box");
    // The form clears and collapses back down after a successful add.
    expect(document.getElementById("af-add-serving-form").style.display).toBe("none");
    expect(document.getElementById("af-new-serving-label").value).toBe("");
  });

  it("an empty name, or a zero/negative/non-numeric amount, is a no-op -- none of the four push a row", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);

    const labelInput = document.getElementById("af-new-serving-label");
    const amountInput = document.getElementById("af-new-serving-amount");
    const confirmBtn = document.getElementById("af-new-serving-confirm-btn");
    document.getElementById("af-add-serving-btn").click();

    // Whitespace-only name (trims to "") paired with an otherwise-valid amount.
    labelInput.value = "   ";
    amountInput.value = "2";
    confirmBtn.click();

    // Valid name paired with each invalid amount in turn.
    for (const badAmount of ["0", "-5", "not-a-number"]) {
      labelInput.value = "1 box";
      amountInput.value = badAmount;
      confirmBtn.click();
    }

    expect(mod.afCreateExtraServings).toEqual([]);
    expect(document.getElementById("af-extra-servings-list")).toBeNull();
  });
});
