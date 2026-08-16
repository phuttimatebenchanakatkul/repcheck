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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNutritionCreateForm } from "./support/loadNutritionCreateForm.js";

const TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "templates", "nutrition.html"
);

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

  // The picker is meant to be exactly the app's own food-icon vocabulary --
  // whatever iconForFood() can hand back for a library food. Adding a case
  // to iconForFood (a new cuisine, a new staple) without adding its emoji
  // here would leave a food the app draws but nobody can pick, so the two
  // lists are pinned to each other by parsing both out of the template.
  it("offers exactly the emojis iconForFood() can return, with the plate fallback first", () => {
    const html = readFileSync(TEMPLATE_PATH, "utf-8");

    // Fail loudly on marker drift: a missing marker makes indexOf return -1,
    // and slice(start, -1) would quietly hand back most of the file instead
    // of the region we meant to read.
    const region = (startMarker, endMarker) => {
      const s = html.indexOf(startMarker);
      const e = html.indexOf(endMarker);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(e).toBeGreaterThan(s);
      return html.slice(s, e);
    };

    const iconFn = region(
      "  function iconForFood(name) {",
      "  function foodIconHtml(name, photoClass) {"
    );
    const listSrc = region(
      "  const CUSTOM_FOOD_EMOJIS = [",
      "  let customFoods = [];"
    );

    const codepoints = (src) => (src.match(/\\u\{[0-9A-F]+\}/g) || []);
    const iconEmojis = codepoints(iconFn);
    const pickerEmojis = codepoints(listSrc);

    expect(new Set(pickerEmojis)).toEqual(new Set(iconEmojis));
    expect(pickerEmojis).toHaveLength(new Set(iconEmojis).size); // no duplicate buttons
    // iconForFood()'s own fallback, and app.py's default for a food created
    // without one -- renderAfCreateForm preselects CUSTOM_FOOD_EMOJIS[0], so
    // the two defaults only agree while the plate stays first.
    expect(pickerEmojis[0]).toBe("\\u{1F37D}");
  });
});

describe("nutrition.html iconForFood -- category assignment regression", () => {
  // Running the real iconForFood() against actual FOOD_LIBRARY dish/ingredient
  // names (via a Node script, not eyeballing) turned up several substring
  // collisions where a short generic keyword swallowed an unrelated food:
  // "eggplant" contains "egg", "graham cracker" contains "ham", "rice cake"/
  // "fish cake" contain "cake", "beef tartare" contains "tart", "beef, stew
  // meat" contains "stew". Each of these pins one such fix so it can't
  // silently regress the next time a keyword list grows.
  function loadIconForFood() {
    const html = readFileSync(TEMPLATE_PATH, "utf-8");
    const s = html.indexOf("  function iconForFood(name) {");
    const e = html.indexOf("  function foodIconHtml(name, photoClass) {");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(e).toBeGreaterThan(s);
    const src = html.slice(s, e);
    return new Function(`${src}; return iconForFood;`)();
  }

  it("routes real foods to their own category instead of an unrelated keyword's icon", () => {
    const iconForFood = loadIconForFood();

    // Bug: "eggplant" was caught by the generic "egg" check.
    expect(iconForFood("Eggplant")).toBe("\u{1F346}"); // eggplant, not egg
    // Bug: "Rice Cake"/"Fish Cake" were caught by the dessert "cake" check.
    expect(iconForFood("Rice Cake (Tteok)")).toBe("\u{1F365}"); // fish cake w/ swirl, not cupcake
    expect(iconForFood("Korean Fish Cake")).toBe("\u{1F365}");
    // Bug: "Graham Cracker" was caught by the meat "ham" check (graHAM).
    expect(iconForFood("Graham Cracker")).toBe("\u{1F36A}"); // cookie, not steak
    // Bug: "Butter Chicken" was caught by the "butter" check before "chicken".
    expect(iconForFood("Butter Chicken")).toBe("\u{1F35A}"); // rice, not cheese
    // Bug: "Beef Tartare" was caught by a "tart" check meant for Tarte Tatin.
    expect(iconForFood("Beef Tartare")).toBe("\u{1F969}"); // meat, not pie
    // Bug: "Beef, stew meat, cooked" (a raw cut) was caught by the "stew" check.
    expect(iconForFood("Beef, stew meat, cooked")).toBe("\u{1F969}"); // meat, not soup
    // Sanity: an actual stew dish still gets the soup/stew icon.
    expect(iconForFood("Sundubu Jjigae, Soft Tofu Stew")).toBe("\u{1F372}");
  });

  it("covers categories food_library.py defines that the old keyword list never checked", () => {
    const iconForFood = loadIconForFood();
    const DEFAULT = "\u{1F37D}️";

    // Whole raw-ingredient categories that had zero keyword coverage before:
    // lamb, chickpeas, herbs/aromatics, dry spices, sauces/pastes, olives,
    // wine, coffee, curry dishes, soups/stews, dumplings, and flatbread/
    // French-pastry split out of the old one-size grain bucket.
    expect(iconForFood("Lamb, cooked")).not.toBe(DEFAULT);
    expect(iconForFood("Chickpeas, cooked")).not.toBe(DEFAULT);
    expect(iconForFood("Curry Leaves")).not.toBe(DEFAULT);
    expect(iconForFood("Turmeric")).not.toBe(DEFAULT);
    expect(iconForFood("Soy Sauce")).not.toBe(DEFAULT);
    expect(iconForFood("Kalamata Olives")).not.toBe(DEFAULT);
    expect(iconForFood("Red Wine")).not.toBe(DEFAULT);
    expect(iconForFood("Espresso")).not.toBe(DEFAULT);
    expect(iconForFood("Chicken Tikka Masala")).not.toBe(DEFAULT);
    expect(iconForFood("Clam Chowder")).not.toBe(DEFAULT);
    expect(iconForFood("Gyoza, Pork Dumplings")).not.toBe(DEFAULT);
    expect(iconForFood("Pita Bread")).not.toBe(DEFAULT);
    expect(iconForFood("Croissant")).not.toBe(DEFAULT);
  });

  // Three pairs were visually near-duplicates at picker-thumbnail size --
  // for each, the icon covering fewer real FOOD_LIBRARY foods (measured,
  // not eyeballed) was retired in favor of the one covering more, so the
  // picker doesn't force a choice between two icons that read the same:
  //   pot of food (24 foods) vs. shallow pan of food (1 food)      -> pot wins
  //   cooked rice (46 foods) vs. curry rice (28 foods)             -> rice wins
  //   seedling (16 foods)    vs. herb (14 foods)                   -> seedling wins
  it("merges each near-duplicate icon pair onto whichever one already covers more foods", () => {
    const iconForFood = loadIconForFood();

    expect(iconForFood("Beef Stir Fry")).toBe("\u{1F372}"); // pot of food, not shallow pan
    expect(iconForFood("Chicken Tikka Masala")).toBe("\u{1F35A}"); // cooked rice, not curry rice
    expect(iconForFood("Thai Basil")).toBe("\u{1F331}"); // seedling, not herb

    // Both retired codepoints must be unreachable now -- iconForFood() has
    // no line left that can return them.
    const html = readFileSync(TEMPLATE_PATH, "utf-8");
    const s = html.indexOf("  function iconForFood(name) {");
    const e = html.indexOf("  function foodIconHtml(name, photoClass) {");
    const src = html.slice(s, e);
    expect(src).not.toContain("\\u{1F958}"); // shallow pan of food
    expect(src).not.toContain("\\u{1F35B}"); // curry rice
    expect(src).not.toContain("\\u{1F33F}"); // herb
  });
});

describe("nutrition.html renderAfCreateForm -- af-modal header title", () => {
  // The af-modal's sticky header is shared by every screen in the flow, so
  // renderAfCreateForm has to rename it -- otherwise the create-food form
  // sits under "Analyze a food photo", which is a different feature. The
  // nav row under it must NOT repeat the name.
  it("names the modal header 'Create food' and leaves no second title under the back chevron", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, null);

    expect(mod.calls.afModalTitle).toBe("Create food");
    expect(document.querySelector(".af-create-nav-title")).toBeNull();
    // The chevron is the only thing left in the nav row, and it still has to
    // be there -- it is the way back to the choice screen.
    expect(document.getElementById("af-create-back-btn")).not.toBeNull();
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

describe("nutrition.html renderAfCreateForm -- barcode attribute escaping", () => {
  // The barcode is NOT trusted input. /api/lookup-barcode echoes the
  // submitted `barcode` field back verbatim in its not_found response
  // (app.py), and that echoed value is what renderAfCreateForm receives as
  // notFoundBarcode -- so whatever a caller POSTs lands in this attribute.
  //
  // It must be escaped with escapeAttr(), not escapeHtml(). escapeHtml
  // round-trips through textContent, which escapes < > and & but leaves
  // quotes intact -- fine for a text node, exploitable in a quoted
  // attribute, where one " closes value="..." and everything after it
  // parses as markup (an event handler that runs on render).
  it("a barcode containing a quote cannot break out of the value attribute", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, '" onfocus="alert(1)" autofocus x="');

    const input = document.getElementById("af-create-barcode-input");
    // The whole payload survives as the field's literal value...
    expect(input.value).toBe('" onfocus="alert(1)" autofocus x="');
    // ...and none of it became real markup: no injected attributes, and
    // no extra elements smuggled in alongside the input.
    expect(input.getAttribute("onfocus")).toBeNull();
    expect(input.hasAttribute("autofocus")).toBe(false);
    expect(input.getAttribute("x")).toBeNull();
  });

  it("escapes a quote-bearing barcode rather than dropping it -- the digits survive a round-trip through the field", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm(false, '885"0999320007');

    const input = document.getElementById("af-create-barcode-input");
    expect(input.value).toBe('885"0999320007');
    // submitCustomFood strips to digits, so the quote never reaches the
    // server even though the field faithfully shows what was scanned.
    expect(input.value.replace(/\D/g, "")).toBe("8850999320007");
  });
});

describe("nutrition.html renderAfCreateForm -- quickMode", () => {
  it("in quickMode, the name field, icon row, and serving section are all absent, the modal header reads 'Log macros', and the submit button reads 'Log now'", () => {
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

    // The screen's name lives in the af-modal's sticky header now, not in
    // a second title under the back chevron.
    expect(mod.calls.afModalTitle).toBe("Log macros");
    expect(document.querySelector(".af-create-nav-title")).toBeNull();
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

// The blank-on-focus behavior these fields rely on now lives in the shared
// static/numeric_fields.js (opted into with data-clear-on-focus, delegated
// off document) instead of a per-element helper local to this template --
// see numericFields.test.js. What stays this suite's job is that the
// create-food form actually opts its number fields in.
describe("nutrition.html create-food form -- number fields opt into clear-on-focus", () => {
  it("marks every macro, serving-size and amount field with data-clear-on-focus", () => {
    const mod = loadNutritionCreateForm();
    mod.renderAfCreateForm();

    ["af-create-protein", "af-create-fat", "af-create-carbs", "af-create-serving-amount"].forEach((id) => {
      const input = mod.afModalBody.querySelector(`#${id}`);
      expect(input, id).not.toBeNull();
      expect(input.hasAttribute("data-clear-on-focus"), id).toBe(true);
    });
  });
});
