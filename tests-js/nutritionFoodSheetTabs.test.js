// Coverage for the food-search bottom sheet's default (no-query) view after
// the segmented control changed from All / Favorites / Recent to
// Recent / Favorites / Custom, plus the re-log row that change made necessary
// (see templates/nutrition.html's renderModalDefaultSections / scopeSegHtml /
// createFoodRowHtml / relogRowEntry / foodRowHtml / showModal and the
// delegated modalResultsEl click handler).
//
// Why these paths and not others:
//   1. The landing tab. `let modalScope = "recent"` and showModal()'s reset
//      are two SEPARATE initializers of the same thing -- fixing one and
//      missing the other means the sheet opens on the right tab once and on
//      the wrong one every time after, which no other test would catch.
//   2. The three tab branches. renderModalDefaultSections is an early-return
//      ("custom") plus an if/else ("favorites" / everything else). "everything
//      else" is a fall-through, so a scope value that isn't one of the three
//      silently renders the Recent list -- worth pinning down which list each
//      tab actually produces.
//   3. Recent+top-picks dedup. The old "All" tab deduped
//      favorites+topPicks+recent; it now dedupes recent+topPicks. A broken
//      dedup shows the same food twice in the list a user sees first.
//   4. data-food vs data-relog-entry. Promoting Recent to the landing tab put
//      scan/barcode/quick-macro foods -- names with no FOOD_LIBRARY entry --
//      in front of every user on open, and those rows can't be logged through
//      openLogAmountModal(). relogRowEntry() is a three-way decision
//      (library hit / add-ingredient mode / re-log) whose failure mode is a
//      row that looks fine and does nothing when tapped.
//   5. The Custom tab's two states. It renders from `customFoods` (loaded
//      over the network from GET /api/custom-foods), so the empty list is the
//      state EVERY user hits on first open -- it must show the empty-state
//      copy and still offer the way in to creating a food.
//   6. The "Create a food" row's placement rules: custom tab only, and NOT in
//      add-ingredient mode (where creating a food would land as its own log
//      entry instead of an ingredient).
//   7. The query view. renderModalResults() must not render the segmented
//      control (typing hides it, iOS-style) and an emptied query must hand
//      back to whichever tab the user was on.
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadNutritionFoodSheet,
  libraryRows,
  rowNames,
  rowByName,
  rowMacroText,
  customRowNames,
  tabLabels,
  activeTab,
} from "./support/loadNutritionFoodSheet.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

// Local time, not UTC: getTopPicksForHour() buckets on Date#getHours().
function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

// Per-100g library foods. Which names are in here is the entire input to
// relogRowEntry()'s foodByName() check, so it's a fixture, not a stub.
const LIBRARY = [
  { name: "Rice", calories: 130, protein: 2.7, fat: 0.3, carbs: 28 },
  { name: "Chicken", calories: 165, protein: 31, fat: 3.6, carbs: 0 },
  { name: "Chicken Salad Wrap", calories: 190, protein: 14, fat: 7, carbs: 18 },
  { name: "Apple", calories: 52, protein: 0.3, fat: 0.2, carbs: 14 },
  { name: "Oatmeal", calories: 68, protein: 2.4, fat: 1.4, carbs: 12 },
  { name: "Yogurt", calories: 59, protein: 10, fat: 0.4, carbs: 3.6 },
  { name: "Banana", calories: 89, protein: 1.1, fat: 0.3, carbs: 23 },
  { name: "Eggs", calories: 155, protein: 13, fat: 11, carbs: 1.1 },
  { name: "Salad", calories: 20, protein: 1.4, fat: 0.2, carbs: 3.6 },
  { name: "Kale", calories: 49, protein: 4.3, fat: 0.9, carbs: 8.8 },
  { name: "Toast", calories: 265, protein: 9, fat: 3.2, carbs: 49 },
  { name: "Morning Coffee", calories: 2, protein: 0.3, fat: 0, carbs: 0 },
];

function entry(id, food, addedAt, macros = {}) {
  return {
    id,
    food,
    addedAt,
    grams: 100,
    baseCalories: 100,
    baseProtein: 5,
    baseFat: 2,
    baseCarbs: 10,
    ...macros,
  };
}

// "Protein Bar" is the one name with NO library entry -- a scanned product,
// whose macros live only on its own log entries. It's logged twice so
// latestEntryForFood()'s ordering is observable: the newer entry (pb-new,
// 60g of a 400kcal/100g bar => 240 kcal) is the one the row must use.
const PROTEIN_BAR_NEW = { grams: 60, baseCalories: 400, baseProtein: 30, baseFat: 12, baseCarbs: 40 };
const PROTEIN_BAR_OLD = { grams: 30, baseCalories: 400, baseProtein: 30, baseFat: 12, baseCarbs: 40 };

// Nine distinct foods newer than the habitual 8am one, so getRecentFoods(8)'s
// limit actually bites and "Morning Coffee" can only reach the list as a top
// pick. "Oatmeal" is logged near 8am on two different days AND is recent,
// which is the dedup case.
const LOG = {
  "2026-08-16": [
    entry("a", "Rice", at(2026, 8, 16, 19, 0)),
    entry("b", "Chicken", at(2026, 8, 16, 13, 0)),
    entry("pb-new", "Protein Bar", at(2026, 8, 16, 11, 30), PROTEIN_BAR_NEW),
    entry("c", "Apple", at(2026, 8, 16, 10, 0)),
    entry("d", "Oatmeal", at(2026, 8, 16, 8, 10)),
  ],
  "2026-08-15": [
    entry("e", "Yogurt", at(2026, 8, 15, 21, 0)),
    entry("pb-old", "Protein Bar", at(2026, 8, 15, 16, 0), PROTEIN_BAR_OLD),
    entry("f", "Banana", at(2026, 8, 15, 15, 0)),
    entry("g", "Eggs", at(2026, 8, 15, 12, 0)),
    entry("h", "Salad", at(2026, 8, 15, 11, 0)),
    entry("i", "Oatmeal", at(2026, 8, 15, 8, 15)),
  ],
  "2026-08-14": [entry("j", "Toast", at(2026, 8, 14, 9, 0))],
  "2026-08-11": [entry("k", "Morning Coffee", at(2026, 8, 11, 8, 0))],
  "2026-08-10": [entry("l", "Morning Coffee", at(2026, 8, 10, 8, 0))],
};

// getRecentFoods(8), most recent distinct food first. "Salad" (08-15 11:00) is
// the 9th distinct food and falls off the end.
const RECENT_8 = ["Rice", "Chicken", "Protein Bar", "Apple", "Oatmeal", "Yogurt", "Banana", "Eggs"];

const CUSTOM_FOODS = [
  { name: "Gym Shake", emoji: "milk", calories: 320, protein: 40, fat: 6, carbs: 22, servingGrams: 400 },
  { name: 'My "house" bar', emoji: "bar", calories: 210, protein: 20, fat: 8, carbs: 14 },
];

function openSheet(overrides = {}) {
  return loadNutritionFoodSheet({
    initialLog: LOG,
    library: LIBRARY,
    favorites: ["Rice", "Kale"],
    modalMode: { type: "add-food" },
    pendingHour: 8,
    ...overrides,
  });
}

describe("food-search sheet -- segmented control and landing tab", () => {
  it("lands on Recent, and offers exactly Recent / Favorites / Custom (no 'All' tab)", () => {
    const sheet = openSheet();
    sheet.renderModalDefaultSections();

    expect(sheet.modalScope).toBe("recent");
    expect(activeTab(sheet.modalResultsEl)).toBe("recent");
    // Labels are the i18n KEYS here (the loader's t() is identity), so this
    // also pins down which keys the control reads.
    expect(tabLabels(sheet.modalResultsEl)).toEqual([
      "nutrition.recent",
      "nutrition.favorites",
      "nutrition.scope.custom",
    ]);
    expect(sheet.modalResultsEl.innerHTML).not.toContain("nutrition.scope.all");
  });

  it("resets to Recent when the sheet is reopened after the user switched to Custom", () => {
    const sheet = openSheet();
    // Switch tabs through the real delegated handler, as a tap would.
    sheet.renderModalDefaultSections();
    sheet.modalResultsEl.querySelector('[data-scope-tab="custom"]').click();
    expect(sheet.modalScope).toBe("custom");

    sheet.modalSearchInput.value = "chick"; // a query left over from last time
    sheet.showModal();

    expect(sheet.modalScope).toBe("recent");
    expect(sheet.modalSearchInput.value).toBe("");
    expect(activeTab(sheet.modalResultsEl)).toBe("recent");
    expect(rowNames(sheet.modalResultsEl)).toEqual([...RECENT_8, "Morning Coffee"]);
  });
});

describe("food-search sheet -- the three tab branches", () => {
  it("Recent appends this hour's top picks after the recent list, deduped", () => {
    const sheet = openSheet();
    sheet.renderModalDefaultSections();

    const names = rowNames(sheet.modalResultsEl);
    // "Morning Coffee" is older than all 8 recent foods, so it can ONLY be
    // here via getTopPicksForHour(8) -- and it lands after them, not before.
    expect(names).toEqual([...RECENT_8, "Morning Coffee"]);
    // "Oatmeal" is both recent and a top pick for 8am: once, not twice.
    expect(names.filter((n) => n === "Oatmeal")).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it("Recent drops the top picks entirely when the sheet carries no hour", () => {
    // The quick-add bar opens with topPicksHour, but it can be null; only the
    // hour-row "+" always pins one. With no hour there is nothing to append,
    // so the list is the recent foods and nothing else.
    const sheet = openSheet({ modalMode: { type: "quickadd", topPicksHour: null }, pendingHour: null });
    sheet.renderModalDefaultSections();

    const names = rowNames(sheet.modalResultsEl);
    expect(names).toEqual(RECENT_8);
    expect(names).not.toContain("Morning Coffee"); // top-pick-only, so it can't appear
    expect(sheet.getTopPicksForHour(8, 8)).toContain("Morning Coffee"); // ...but it IS a top pick
  });

  it("Favorites lists exactly the favorited foods, and an empty favorites list falls back to the empty state", () => {
    const sheet = openSheet();
    sheet.modalScope = "favorites";
    sheet.renderModalDefaultSections();

    expect(rowNames(sheet.modalResultsEl)).toEqual(["Rice", "Kale"]);
    expect(activeTab(sheet.modalResultsEl)).toBe("favorites");

    const bare = openSheet({ favorites: [] });
    bare.modalScope = "favorites";
    bare.renderModalDefaultSections();
    expect(rowNames(bare.modalResultsEl)).toEqual([]);
    expect(bare.modalResultsEl.querySelector(".nl-search-empty").textContent.trim())
      .toBe("nutrition.searchToAdd");
    // The tab bar survives the empty state -- otherwise there's no way back.
    expect(tabLabels(bare.modalResultsEl)).toHaveLength(3);
  });

  it("Custom renders one row per custom food (not library rows) with its data-custom-index intact", () => {
    const sheet = openSheet({ customFoods: CUSTOM_FOODS });
    sheet.modalScope = "custom";
    sheet.renderModalDefaultSections();

    const rows = [...sheet.modalResultsEl.querySelectorAll("[data-custom-index]")];
    expect(rows.map((r) => r.dataset.customIndex)).toEqual(["0", "1"]);
    expect(customRowNames(sheet.modalResultsEl)).toEqual(["Gym Shake", 'My "house" bar']);
    // Nothing from the Recent/Favorites branches bleeds in: no library rows,
    // no hearts (a custom food isn't favoritable).
    expect(rowNames(sheet.modalResultsEl)).toEqual([]);
    expect(sheet.modalResultsEl.querySelector("[data-fav-toggle]")).toBeNull();
    expect(activeTab(sheet.modalResultsEl)).toBe("custom");
  });

  it("Custom with no custom foods yet shows the empty-state copy and still offers 'Create a food'", () => {
    const sheet = openSheet({ customFoods: [] });
    sheet.modalScope = "custom";
    sheet.renderModalDefaultSections();

    expect(sheet.modalResultsEl.querySelector(".nl-search-empty").textContent.trim())
      .toBe("nutrition.custom.empty");
    expect(sheet.modalResultsEl.querySelector(".nl-food-list")).toBeNull();
    expect(sheet.modalResultsEl.querySelector("[data-create-food]")).not.toBeNull();
    expect(tabLabels(sheet.modalResultsEl)).toHaveLength(3);
  });
});

describe("food-search sheet -- re-log rows for names the library doesn't have", () => {
  it("renders an unresolvable name from its LATEST log entry: data-relog-entry plus that entry's macros", () => {
    const sheet = openSheet();
    sheet.renderModalDefaultSections();

    const row = rowByName(sheet.modalResultsEl, "Protein Bar");
    // Tapping it must go to the re-log confirm screen, not openLogAmountModal,
    // which has no per-100g macros to work from for this name.
    expect(row.dataset.relogEntry).toBe("pb-new"); // the newer of the two entries
    expect(row.hasAttribute("data-food")).toBe(false);
    // 60g of a 400 kcal/100g bar = 240 kcal, 18P / 7F / 24C -- the entry's own
    // stored macros, NOT the blank line a library miss used to produce. The
    // line leads with the portion's grams because these numbers are a whole
    // logged portion, while a library row's are per-100g; without it the two
    // kinds of row are indistinguishable in identical type.
    expect(rowMacroText(row)).toEqual({ cal: "240 kcal", macros: "60g / 18P / 7F / 24C" });
    expect(sheet.scaledMacros(sheet.latestEntryForFood("Protein Bar")).calories).toBe(240);
  });

  it("leaves a name the library DOES have on the data-food path with its per-100g macro line", () => {
    const sheet = openSheet();
    sheet.renderModalDefaultSections();

    const row = rowByName(sheet.modalResultsEl, "Rice");
    expect(row.dataset.food).toBe("Rice");
    expect(row.hasAttribute("data-relog-entry")).toBe(false);
    expect(rowMacroText(row)).toEqual({ cal: "130 kcal", macros: "3P / 0F / 28C" }); // library per-100g
    expect(sheet.relogRowEntry("Rice")).toBeNull();
    // Exactly one row in the whole list is a re-log row.
    expect(libraryRows(sheet.modalResultsEl).filter((r) => r.hasAttribute("data-relog-entry")))
      .toHaveLength(1);
  });

  it("falls back to data-food for that same unresolvable name in add-ingredient mode", () => {
    // An ingredient is scaled from per-100g library macros, so the re-log
    // path (which logs a whole standalone entry) must not take over here.
    const sheet = openSheet({ modalMode: { type: "add-ingredient", entryId: "a" } });
    sheet.renderModalDefaultSections();

    const row = rowByName(sheet.modalResultsEl, "Protein Bar");
    expect(row.dataset.food).toBe("Protein Bar");
    expect(row.hasAttribute("data-relog-entry")).toBe(false);
    expect(sheet.relogRowEntry("Protein Bar")).toBeNull();
    // No row anywhere in the list took the re-log path in this mode.
    expect(sheet.modalResultsEl.querySelector("[data-relog-entry]")).toBeNull();
  });

  it("tapping a re-log row closes the sheet and opens the confirm screen for that exact entry", () => {
    const sheet = openSheet();
    sheet.renderModalDefaultSections();

    // Tap the name span, not the button: the handler matches via closest().
    rowByName(sheet.modalResultsEl, "Protein Bar").querySelector(".nl-food-row-name").click();

    expect(sheet.calls.closeModal).toBe(1);
    expect(sheet.calls.openRelogConfirmModal).toHaveLength(1);
    expect(sheet.calls.openRelogConfirmModal[0].id).toBe("pb-new");
    expect(sheet.calls.openRelogConfirmModal[0].food).toBe("Protein Bar");
    // It must not also fall through into the data-food logging branch.
    expect(sheet.calls.openLogAmountModal).toEqual([]);
  });

  it("re-renders instead of swallowing the tap when the entry vanished under the open sheet", () => {
    // Deleted in this tab while the sheet sat open, or deleted on another
    // device and merged in by account_sync: the row's id no longer resolves.
    // An empty else there would have been the same silent dead tap this whole
    // path exists to remove.
    const sheet = openSheet();
    sheet.renderModalDefaultSections();
    const row = rowByName(sheet.modalResultsEl, "Protein Bar");
    expect(row.dataset.relogEntry).toBe("pb-new");

    // Drop both entries for that name, then tap the now-stale row.
    sheet.log["2026-08-16"] = sheet.log["2026-08-16"].filter((e) => e.food !== "Protein Bar");
    sheet.log["2026-08-15"] = sheet.log["2026-08-15"].filter((e) => e.food !== "Protein Bar");
    row.click();

    expect(sheet.calls.openRelogConfirmModal).toEqual([]);
    expect(sheet.calls.closeModal).toBe(0); // sheet stays open
    // The re-render dropped the stale row, and the cache did not serve the
    // deleted entry back.
    expect(rowByName(sheet.modalResultsEl, "Protein Bar")).toBeNull();
    expect(sheet.relogRowEntry("Protein Bar")).toBeNull();
    expect(tabLabels(sheet.modalResultsEl)).toHaveLength(3);
  });

  it("falls back to data-food -- and does NOT blank the sheet -- when the entry's macros can't be computed", () => {
    // entryTotals() reduces over `ingredients` with no guards, so a null
    // element throws. The throw would happen while building the innerHTML
    // string, so the assignment never runs and the sheet comes up with no
    // segmented control, no rows and no search results at all.
    const sheet = openSheet({
      initialLog: {
        ...LOG,
        "2026-08-16": [
          { id: "broken", food: "Mystery Meal", addedAt: at(2026, 8, 16, 20, 0), ingredients: [null] },
          ...LOG["2026-08-16"],
        ],
      },
    });
    sheet.renderModalDefaultSections();

    const row = rowByName(sheet.modalResultsEl, "Mystery Meal");
    expect(row.dataset.food).toBe("Mystery Meal"); // inert, but harmless
    expect(row.hasAttribute("data-relog-entry")).toBe(false);
    expect(sheet.relogRowEntry("Mystery Meal")).toBeNull();
    // The rest of the sheet rendered normally -- this is the assertion that
    // fails if the guard is removed.
    expect(tabLabels(sheet.modalResultsEl)).toHaveLength(3);
    expect(rowNames(sheet.modalResultsEl)).toContain("Rice");
    expect(rowByName(sheet.modalResultsEl, "Protein Bar").dataset.relogEntry).toBe("pb-new");
  });

  it("falls back to data-food when the entry's macros come out NaN", () => {
    // No ingredients and no grams: `entry.grams / 100` is NaN, so the row used
    // to read "NaN kcal" and re-logging copied NaN into today's log, where
    // renderSummary() spreads it across the day's ring and every macro bar and
    // persistLogEntry() pushes it to the server.
    const sheet = openSheet({
      initialLog: {
        ...LOG,
        "2026-08-16": [
          { id: "nan", food: "Half Written", addedAt: at(2026, 8, 16, 21, 0), baseCalories: 200 },
          ...LOG["2026-08-16"],
        ],
      },
    });
    sheet.renderModalDefaultSections();

    const row = rowByName(sheet.modalResultsEl, "Half Written");
    expect(row.dataset.food).toBe("Half Written");
    expect(row.hasAttribute("data-relog-entry")).toBe(false);
    expect(sheet.relogRowEntry("Half Written")).toBeNull();
    // Whatever it renders, it must not put NaN in front of the user.
    expect(row.textContent).not.toContain("NaN");
  });

  it("shows the portion's grams on a re-log row, since those macros are a whole portion and a library row's are per-100g", () => {
    const sheet = openSheet();
    sheet.renderModalDefaultSections();

    // 60g portion of the bar vs Rice's per-100g line, in the same list.
    expect(rowMacroText(rowByName(sheet.modalResultsEl, "Protein Bar")).macros).toMatch(/^60g \//);
    expect(rowMacroText(rowByName(sheet.modalResultsEl, "Rice")).macros).not.toMatch(/g \//);
  });
});

describe("food-search sheet -- the 'Create a food' row", () => {
  it("appears on the Custom tab only, above the list, and nowhere on Recent or Favorites", () => {
    const sheet = openSheet({ customFoods: CUSTOM_FOODS });

    for (const scope of ["recent", "favorites"]) {
      sheet.modalScope = scope;
      sheet.renderModalDefaultSections();
      expect(sheet.modalResultsEl.querySelector("[data-create-food]")).toBeNull();
    }

    sheet.modalScope = "custom";
    sheet.renderModalDefaultSections();
    const createRow = sheet.modalResultsEl.querySelector("[data-create-food]");
    expect(createRow).not.toBeNull();
    expect(createRow.classList.contains("nl-create-food-row")).toBe(true);
    // Two-line row: the action's name plus the subtitle that distinguishes it
    // from the "Quick add" dock below.
    expect(createRow.querySelector(".nl-create-food-body .nl-create-food-label").textContent)
      .toBe("nutrition.custom.create");
    expect(createRow.querySelector(".nl-create-food-body .nl-create-food-sub").textContent)
      .toBe("nutrition.custom.createSub");
    // Ordering: segmented control, then the create row, then the food list.
    const order = [...sheet.modalResultsEl.querySelectorAll(".nl-scope-seg, [data-create-food], .nl-food-list")];
    expect(order.map((el) => (el.classList.contains("nl-scope-seg") ? "seg" : el.dataset.createFood ? "create" : "list")))
      .toEqual(["seg", "create", "list"]);
  });

  it("is suppressed on the Custom tab in add-ingredient mode, where a new food couldn't become an ingredient", () => {
    const sheet = openSheet({
      customFoods: CUSTOM_FOODS,
      modalMode: { type: "add-ingredient", entryId: "a" },
    });
    sheet.modalScope = "custom";
    sheet.renderModalDefaultSections();

    expect(sheet.modalResultsEl.querySelector("[data-create-food]")).toBeNull();
    // The rest of the tab is untouched -- the existing custom foods are still
    // pickable, and the tab bar is still there.
    expect(customRowNames(sheet.modalResultsEl)).toEqual(["Gym Shake", 'My "house" bar']);
    expect(tabLabels(sheet.modalResultsEl)).toHaveLength(3);

    // Same suppression with an empty list: empty state, and still no create row.
    const bare = openSheet({ customFoods: [], modalMode: { type: "add-ingredient", entryId: "a" } });
    bare.modalScope = "custom";
    bare.renderModalDefaultSections();
    expect(bare.modalResultsEl.querySelector("[data-create-food]")).toBeNull();
    expect(bare.modalResultsEl.querySelector(".nl-search-empty").textContent.trim())
      .toBe("nutrition.custom.empty");
  });

  it("tapping it closes the search sheet and opens the full create-food form", () => {
    const sheet = openSheet({ customFoods: CUSTOM_FOODS });
    sheet.modalScope = "custom";
    sheet.renderModalDefaultSections();

    // Click the inner label, not the button: the handler matches via
    // closest(), so a tap landing on the icon/text must still register.
    sheet.modalResultsEl.querySelector(".nl-create-food-label").click();

    expect(sheet.calls.openCreateFoodModal).toBe(1);
    expect(sheet.calls.closeModal).toBe(1);
    // Not the "Quick add" dock's flow, which is a different form.
    expect(sheet.calls.openQuickMacroModal).toBe(0);
    // And it doesn't fall through into logging a food.
    expect(sheet.calls.openLogAmountModal).toEqual([]);
  });
});

describe("food-search sheet -- tapping a custom-food row", () => {
  it("opens the shared review screen built from that custom food, and closes the sheet", () => {
    const sheet = openSheet({ customFoods: CUSTOM_FOODS });
    sheet.modalScope = "custom";
    sheet.renderModalDefaultSections();

    const row = [...sheet.modalResultsEl.querySelectorAll("[data-custom-index]")][1];
    row.querySelector(".nl-food-row-name").click(); // inner span -> closest()

    expect(sheet.calls.closeModal).toBe(1);
    expect(sheet.calls.openScannedResultModal).toHaveLength(1);
    const result = sheet.calls.openScannedResultModal[0];
    expect(result.food_name).toBe('My "house" bar');
    expect(result.calories).toBe(210);
    // Reshaped through the real customFoodToResult(), so the review screen
    // gets the same shape a scan produces.
    expect(result).toEqual(sheet.customFoodToResult(CUSTOM_FOODS[1]));
    expect(sheet.calls.openLogAmountModal).toEqual([]);
    expect(sheet.calls.openRelogConfirmModal).toEqual([]);
  });
});

describe("food-search sheet -- typing and clearing the query", () => {
  it("hides the segmented control and the create row while a query is active", () => {
    const sheet = openSheet({ customFoods: CUSTOM_FOODS });
    sheet.modalScope = "custom";
    sheet.renderModalDefaultSections();
    expect(sheet.modalResultsEl.querySelectorAll("[data-scope-tab]")).toHaveLength(3);

    sheet.renderModalResults("chick");

    // iOS hides segmented controls once you start typing; a scope filter makes
    // no sense over a query that already spans every source.
    expect(sheet.modalResultsEl.querySelector("[data-scope-tab]")).toBeNull();
    expect(sheet.modalResultsEl.querySelector("[data-create-food]")).toBeNull();
    expect(rowNames(sheet.modalResultsEl)).toEqual(["Chicken", "Chicken Salad Wrap"]);
  });

  it("re-renders the remembered scope when the query is cleared, not the default tab", () => {
    const sheet = openSheet({ customFoods: CUSTOM_FOODS });
    sheet.renderModalDefaultSections();
    sheet.modalResultsEl.querySelector('[data-scope-tab="custom"]').click();

    sheet.renderModalResults("shake");
    expect(sheet.modalResultsEl.querySelector("[data-scope-tab]")).toBeNull();

    sheet.renderModalResults(""); // user cleared the field

    // Back to Custom -- the tab the user was on -- not back to Recent. Only
    // reopening the sheet (showModal) resets that.
    expect(sheet.modalScope).toBe("custom");
    expect(activeTab(sheet.modalResultsEl)).toBe("custom");
    expect(customRowNames(sheet.modalResultsEl)).toEqual(["Gym Shake", 'My "house" bar']);
    expect(sheet.modalResultsEl.querySelector("[data-create-food]")).not.toBeNull();
  });
});
