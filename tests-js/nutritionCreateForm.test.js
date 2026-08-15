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

  it("removing a serving row splices it out of afCreateExtraServings and re-renders the list down to nothing when it was the last one", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);

    document.getElementById("af-add-serving-btn").click();
    document.getElementById("af-new-serving-label").value = "1 box";
    document.getElementById("af-new-serving-amount").value = "2";
    document.getElementById("af-new-serving-unit").value = "g";
    document.getElementById("af-new-serving-confirm-btn").click();

    expect(mod.afCreateExtraServings).toHaveLength(1);
    expect(document.getElementById("af-extra-servings-list")).not.toBeNull();

    document.querySelector("[data-remove-serving]").click();

    expect(mod.afCreateExtraServings).toEqual([]);
    // The list container itself (afExtraServingsListHtml() returns "" for an
    // empty array) must disappear from the DOM, not just render empty.
    expect(document.getElementById("af-extra-servings-list")).toBeNull();
  });

  it("afExtraServingsListHtml() rounds a converted gram amount to one decimal for display, not the raw float", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);

    document.getElementById("af-add-serving-btn").click();
    document.getElementById("af-new-serving-label").value = "1 cup";
    document.getElementById("af-new-serving-amount").value = "2";
    document.getElementById("af-new-serving-unit").value = "oz";
    document.getElementById("af-new-serving-confirm-btn").click();

    // 2 oz * 28.3495 g/oz == 56.699g raw -- the stored value stays the raw
    // float (submitCustomFood needs full precision), but the displayed
    // text must be rounded via Math.round(s.grams * 10) / 10 -- "56.7g",
    // not "56.699g" or "56.699999999999999g".
    expect(mod.afCreateExtraServings[0].grams).toBeCloseTo(56.699, 3);
    expect(document.querySelector(".af-serving-row-grams").textContent).toBe("56.7g");
  });
});

describe("nutrition.html renderAfCreateForm -- emoji picker", () => {
  it("tapping Change toggles the emoji grid open/closed, and picking an emoji sets state, updates the icon, marks it active, and collapses the grid", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);

    const grid = document.getElementById("af-emoji-grid");
    expect(grid.style.display).toBe("none");
    document.getElementById("af-icon-edit-btn").click();
    expect(grid.style.display).toBe("grid");
    document.getElementById("af-icon-edit-btn").click(); // toggles back closed
    expect(grid.style.display).toBe("none");

    document.getElementById("af-icon-edit-btn").click(); // reopen to pick one
    const emojiButtons = grid.querySelectorAll(".af-emoji-btn");
    const target = emojiButtons[3];
    expect(emojiButtons[0].classList.contains("is-active")).toBe(true); // default selection

    target.click();

    expect(mod.afCreateEmoji).toBe(target.dataset.emoji);
    expect(document.getElementById("af-icon-emoji").textContent).toBe(target.dataset.emoji);
    expect(target.classList.contains("is-active")).toBe(true);
    expect(emojiButtons[0].classList.contains("is-active")).toBe(false);
    // Picking an emoji collapses the grid back down, same as tapping Change again.
    expect(grid.style.display).toBe("none");
  });
});

describe("nutrition.html renderAfCreateForm -- serving editor", () => {
  it("tapping Edit toggles the serving editor open/closed, and changing the amount or unit updates the live summary text", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);

    const editor = document.getElementById("af-serving-editor");
    expect(editor.style.display).toBe("none");
    document.getElementById("af-serving-edit-btn").click();
    expect(editor.style.display).toBe("block");
    document.getElementById("af-serving-edit-btn").click(); // toggles back closed
    expect(editor.style.display).toBe("none");
    document.getElementById("af-serving-edit-btn").click(); // reopen

    const amountInput = document.getElementById("af-create-serving-amount");
    const unitSelect = document.getElementById("af-create-serving-unit");
    const summarySub = document.getElementById("af-serving-summary-sub");
    expect(summarySub.textContent).toBe("= 100 g");

    amountInput.value = "4";
    amountInput.dispatchEvent(new Event("input"));
    expect(summarySub.textContent).toBe("= 4 g");

    unitSelect.value = "oz";
    unitSelect.dispatchEvent(new Event("change"));
    expect(summarySub.textContent).toBe("= 4 oz");
  });
});

describe("nutrition.html renderAfCreateForm -- barcode clear button", () => {
  it("clears and focuses the barcode input when clicked, and is entirely absent when no barcode was passed in", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, "01234567");

    const input = document.getElementById("af-create-barcode-input");
    expect(input.value).toBe("01234567");
    document.getElementById("af-barcode-del-btn").click();
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);

    // This form only shows the barcode field/button at all when a barcode
    // was passed in (notFoundBarcode truthy) -- verify both are absent
    // when it wasn't.
    mod.renderAfCreateForm(false, null);
    expect(document.getElementById("af-barcode-del-btn")).toBeNull();
    expect(document.getElementById("af-create-barcode-input")).toBeNull();
  });
});

describe("nutrition.html renderAfCreateForm -- quickMode", () => {
  it("in quickMode, the name field, icon row, and serving section are all absent, nav title reads 'Log Macros', and the submit button reads 'Log now'", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(true, null);

    expect(document.getElementById("af-create-name")).toBeNull();
    expect(document.getElementById("af-icon-edit-btn")).toBeNull();
    expect(document.getElementById("af-emoji-grid")).toBeNull();
    expect(document.getElementById("af-serving-edit-btn")).toBeNull();
    expect(document.getElementById("af-serving-editor")).toBeNull();
    expect(document.getElementById("af-add-serving-btn")).toBeNull();
    // Both the emoji row and the serving-summary row share the ".af-icon-row"
    // class -- neither is rendered in quickMode.
    expect(document.querySelectorAll(".af-icon-row")).toHaveLength(0);

    expect(document.querySelector(".af-create-nav-title").textContent).toBe("Log Macros");
    expect(document.getElementById("af-create-submit-btn").textContent).toBe("Log now");
    // Sanity: quickMode still renders the macro fields it actually needs.
    expect(document.getElementById("af-create-protein")).not.toBeNull();
  });
});

describe("nutrition.html lookupScannedBarcode -- client-side live-scan digit stripping", () => {
  it("strips non-digit characters from the scanned rawValue before POSTing to the lookup API", async () => {
    const mod = loadNutritionCreateForm();
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return { json: async () => ({ ok: false, error: "not tested past this point" }) };
      })
    );

    await mod.lookupScannedBarcode("011-222 333");

    expect(calls).toHaveLength(1);
    expect(calls[0].body.barcode).toBe("011222333");
  });
});

describe("nutrition.html wireNumericClearOnFocus -- isolated behavior", () => {
  it("clears a non-empty value on focus (dispatching input), restores the wire-time original on blur-while-empty (dispatching input again), and no-ops focusing an already-empty input", () => {
    const mod = loadNutritionCreateForm();
    const input = document.createElement("input");
    input.value = "0";
    document.body.appendChild(input);

    let inputEvents = 0;
    input.addEventListener("input", () => { inputEvents++; });

    mod.wireNumericClearOnFocus(input);

    input.dispatchEvent(new Event("focus"));
    expect(input.value).toBe("");
    expect(inputEvents).toBe(1);

    input.dispatchEvent(new Event("blur"));
    expect(input.value).toBe("0"); // restored to the value captured at wire-time
    expect(inputEvents).toBe(2);

    // Focusing again while non-empty (freshly-restored "0") clears again...
    input.dispatchEvent(new Event("focus"));
    expect(input.value).toBe("");
    expect(inputEvents).toBe(3);
    // ...but focusing again while ALREADY empty is a no-op: no re-clear, no re-dispatch.
    input.dispatchEvent(new Event("focus"));
    expect(input.value).toBe("");
    expect(inputEvents).toBe(3);
  });
});
