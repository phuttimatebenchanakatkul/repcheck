import { describe, it, expect, beforeEach } from "vitest";
import { loadNutritionSwipeDelete, buildConfirmOverlayDom } from "./support/loadNutritionSwipeDelete.js";

// jsdom has no PointerEvent/setPointerCapture support at all, so a synthetic
// MouseEvent with a manually attached pointerId is the standard workaround --
// same helper as coachingRateSlider.test.js / rateSlider.test.js use for
// their own drag gestures.
function dispatchPointer(el, type, clientX, clientY = 0, pointerId = 1) {
  const evt = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  evt.pointerId = pointerId;
  evt.pointerType = "mouse";
  el.dispatchEvent(evt);
}

const SELECTED_DATE = "2026-08-15";
const OPEN_W = 98; // must match .nl-swipe-delete width in templates/nutrition.html's CSS

// jsdom's document persists across tests in the same file -- without
// clearing it, a stale #nl-confirm-overlay from an earlier test would still
// be the first match for document.getElementById, so a later test's fresh
// buildConfirmOverlayDom() would silently wire listeners onto a DOM node
// nobody is asserting against.
beforeEach(() => {
  document.body.innerHTML = "";
});

function buildSwipeRow(entryId) {
  const swipe = document.createElement("div");
  swipe.className = "nl-swipe";
  swipe.dataset.swipe = entryId;
  swipe.innerHTML = `
    <button type="button" class="nl-swipe-delete" data-swipe-delete="${entryId}"></button>
    <div class="nl-swipe-content">
      <div class="nl-entry-card" data-toggle-entry="${entryId}"></div>
    </div>
  `;
  return swipe;
}

describe("nutrition.html deleteEntry", () => {
  it("removes the entry from the selected day, clears it from EXPANDED, and notifies the server", () => {
    buildConfirmOverlayDom();
    const initialLog = { [SELECTED_DATE]: [{ id: "a", food: "Rice" }, { id: "b", food: "Egg" }] };
    const mod = loadNutritionSwipeDelete({ initialLog, selectedDate: SELECTED_DATE });
    mod.EXPANDED.add("a");

    mod.deleteEntry("a");

    expect(mod.log[SELECTED_DATE].map((e) => e.id)).toEqual(["b"]);
    expect(mod.EXPANDED.has("a")).toBe(false);
    expect(mod.calls.saveLog).toBe(1);
    expect(mod.calls.renderTimeline).toBe(1);
    expect(mod.calls.renderSummary).toBe(1);
    expect(mod.calls.persistRemoveLogEntry).toEqual([{ date: SELECTED_DATE, id: "a" }]);
  });

  it("leaves the day untouched when the id isn't found (no matching entry to remove)", () => {
    buildConfirmOverlayDom();
    const initialLog = { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] };
    const mod = loadNutritionSwipeDelete({ initialLog, selectedDate: SELECTED_DATE });

    mod.deleteEntry("missing");

    expect(mod.log[SELECTED_DATE].map((e) => e.id)).toEqual(["a"]);
    expect(mod.calls.persistRemoveLogEntry).toEqual([{ date: SELECTED_DATE, id: "missing" }]);
  });
});

describe("nutrition.html findEntry", () => {
  it("finds an entry in the selected day's log by id", () => {
    buildConfirmOverlayDom();
    const initialLog = { [SELECTED_DATE]: [{ id: "a", food: "Rice" }, { id: "b", food: "Egg" }] };
    const mod = loadNutritionSwipeDelete({ initialLog, selectedDate: SELECTED_DATE });

    expect(mod.findEntry("b").food).toBe("Egg");
    expect(mod.findEntry("nope")).toBeUndefined();
  });
});

describe("nutrition.html delete confirmation dialog", () => {
  let overlay;

  beforeEach(() => {
    overlay = buildConfirmOverlayDom();
  });

  it("opening sets the food name and shows the dialog; confirming deletes exactly that entry", () => {
    const initialLog = { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] };
    const mod = loadNutritionSwipeDelete({ initialLog, selectedDate: SELECTED_DATE });

    mod.openDeleteConfirm({ id: "a", food: "Rice" });
    expect(overlay.classList.contains("is-open")).toBe(true);
    expect(document.getElementById("nl-confirm-sub").textContent).toBe("Rice");

    document.getElementById("nl-confirm-delete").click();

    expect(mod.log[SELECTED_DATE]).toEqual([]);
    expect(overlay.classList.contains("is-open")).toBe(false);
  });

  it("cancel closes the dialog without deleting anything", () => {
    const initialLog = { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] };
    const mod = loadNutritionSwipeDelete({ initialLog, selectedDate: SELECTED_DATE });

    mod.openDeleteConfirm({ id: "a", food: "Rice" });
    document.getElementById("nl-confirm-cancel").click();

    expect(overlay.classList.contains("is-open")).toBe(false);
    expect(mod.log[SELECTED_DATE].map((e) => e.id)).toEqual(["a"]);
    expect(mod.calls.persistRemoveLogEntry).toEqual([]);
  });

  it("clicking the backdrop (not the dialog itself) closes without deleting", () => {
    const initialLog = { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] };
    const mod = loadNutritionSwipeDelete({ initialLog, selectedDate: SELECTED_DATE });

    mod.openDeleteConfirm({ id: "a", food: "Rice" });
    overlay.click(); // click target === overlay itself, i.e. the backdrop

    expect(overlay.classList.contains("is-open")).toBe(false);
    expect(mod.calls.persistRemoveLogEntry).toEqual([]);
  });

  it("Escape closes the dialog and clears the pending id so a second Escape can't re-trigger a delete", () => {
    const initialLog = { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] };
    const mod = loadNutritionSwipeDelete({ initialLog, selectedDate: SELECTED_DATE });

    mod.openDeleteConfirm({ id: "a", food: "Rice" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlay.classList.contains("is-open")).toBe(false);

    // A stray second Escape (or a stale confirm-delete click) must not delete
    // anything now that nlPendingDeleteId has been cleared.
    document.getElementById("nl-confirm-delete").click();
    expect(mod.log[SELECTED_DATE].map((e) => e.id)).toEqual(["a"]);
    expect(mod.calls.persistRemoveLogEntry).toEqual([]);
  });
});

describe("nutrition.html wireSwipeToDelete", () => {
  let timelineEl;

  beforeEach(() => {
    buildConfirmOverlayDom();
    timelineEl = document.createElement("div");
    document.body.appendChild(timelineEl);
  });

  it("dragging past the halfway threshold snaps the row open at -OPEN_W and reveals the delete panel", () => {
    const swipe = buildSwipeRow("a");
    timelineEl.appendChild(swipe);
    const content = swipe.querySelector(".nl-swipe-content");

    const mod = loadNutritionSwipeDelete({
      initialLog: { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] },
      selectedDate: SELECTED_DATE,
      timelineEl,
    });
    mod.wireSwipeToDelete();

    dispatchPointer(content, "pointerdown", 200);
    dispatchPointer(content, "pointermove", 200 - OPEN_W); // past the halfway mark
    dispatchPointer(content, "pointerup", 200 - OPEN_W);

    expect(swipe.classList.contains("is-open")).toBe(true);
    expect(content.style.transform).toBe(`translateX(-${OPEN_W}px)`);
  });

  it("dragging less than halfway snaps the row back closed", () => {
    const swipe = buildSwipeRow("a");
    timelineEl.appendChild(swipe);
    const content = swipe.querySelector(".nl-swipe-content");

    const mod = loadNutritionSwipeDelete({
      initialLog: { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] },
      selectedDate: SELECTED_DATE,
      timelineEl,
    });
    mod.wireSwipeToDelete();

    dispatchPointer(content, "pointerdown", 200);
    dispatchPointer(content, "pointermove", 200 - OPEN_W / 4); // well short of halfway
    dispatchPointer(content, "pointerup", 200 - OPEN_W / 4);

    expect(swipe.classList.contains("is-open")).toBe(false);
    expect(content.style.transform).toBe("");
  });

  it("a predominantly-vertical drag is treated as a scroll, not a swipe -- the row never opens", () => {
    const swipe = buildSwipeRow("a");
    timelineEl.appendChild(swipe);
    const content = swipe.querySelector(".nl-swipe-content");

    const mod = loadNutritionSwipeDelete({
      initialLog: { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] },
      selectedDate: SELECTED_DATE,
      timelineEl,
    });
    mod.wireSwipeToDelete();

    dispatchPointer(content, "pointerdown", 200, 200);
    dispatchPointer(content, "pointermove", 205, 260); // dy (60) far exceeds dx (5)
    dispatchPointer(content, "pointerup", 205, 260);

    expect(swipe.classList.contains("is-dragging")).toBe(false);
    expect(swipe.classList.contains("is-open")).toBe(false);
    expect(content.style.transform).toBe("");
  });

  it("opening a second swipe row closes the first -- only one row stays open at a time", () => {
    const swipeA = buildSwipeRow("a");
    const swipeB = buildSwipeRow("b");
    timelineEl.appendChild(swipeA);
    timelineEl.appendChild(swipeB);
    const contentA = swipeA.querySelector(".nl-swipe-content");
    const contentB = swipeB.querySelector(".nl-swipe-content");

    const mod = loadNutritionSwipeDelete({
      initialLog: { [SELECTED_DATE]: [{ id: "a", food: "Rice" }, { id: "b", food: "Egg" }] },
      selectedDate: SELECTED_DATE,
      timelineEl,
    });
    mod.wireSwipeToDelete();

    dispatchPointer(contentA, "pointerdown", 200);
    dispatchPointer(contentA, "pointermove", 200 - OPEN_W);
    dispatchPointer(contentA, "pointerup", 200 - OPEN_W);
    expect(swipeA.classList.contains("is-open")).toBe(true);

    dispatchPointer(contentB, "pointerdown", 200);
    dispatchPointer(contentB, "pointermove", 200 - OPEN_W);
    dispatchPointer(contentB, "pointerup", 200 - OPEN_W);

    expect(swipeB.classList.contains("is-open")).toBe(true);
    expect(swipeA.classList.contains("is-open")).toBe(false);
    expect(contentA.style.transform).toBe("");
  });

  it("tapping the revealed Delete button opens the confirm dialog for that row's entry", () => {
    const overlay = document.getElementById("nl-confirm-overlay");
    const swipe = buildSwipeRow("a");
    timelineEl.appendChild(swipe);
    const content = swipe.querySelector(".nl-swipe-content");
    const delBtn = swipe.querySelector("[data-swipe-delete]");

    const mod = loadNutritionSwipeDelete({
      initialLog: { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] },
      selectedDate: SELECTED_DATE,
      timelineEl,
    });
    mod.wireSwipeToDelete();

    dispatchPointer(content, "pointerdown", 200);
    dispatchPointer(content, "pointermove", 200 - OPEN_W);
    dispatchPointer(content, "pointerup", 200 - OPEN_W);
    delBtn.click();

    expect(overlay.classList.contains("is-open")).toBe(true);
    expect(document.getElementById("nl-confirm-sub").textContent).toBe("Rice");
  });

  it("a plain tap (no movement) is not swallowed -- it still reaches the card's own toggle-expand listener", () => {
    const swipe = buildSwipeRow("a");
    timelineEl.appendChild(swipe);
    const content = swipe.querySelector(".nl-swipe-content");
    let toggled = 0;
    content.querySelector("[data-toggle-entry]").addEventListener("click", () => { toggled++; });

    const mod = loadNutritionSwipeDelete({
      initialLog: { [SELECTED_DATE]: [{ id: "a", food: "Rice" }] },
      selectedDate: SELECTED_DATE,
      timelineEl,
    });
    mod.wireSwipeToDelete();

    dispatchPointer(content, "pointerdown", 200);
    dispatchPointer(content, "pointerup", 200);
    content.querySelector("[data-toggle-entry]").click();

    expect(toggled).toBe(1);
  });
});
