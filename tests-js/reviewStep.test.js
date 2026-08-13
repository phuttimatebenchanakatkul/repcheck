// DOM-level coverage for renderSplitStepReview()'s interactive state
// machine -- the carousel's prev/next/dot navigation, the day-type picker
// menu, and the exercise row -> editor wiring. These were the pieces
// ship's coverage audit flagged as needing an actual JS runtime rather
// than source-text assertions (see tests/test_split_review_step.py for
// the escaping/saved-plan-contract half of the coverage).
import { beforeEach, describe, expect, it } from "vitest";
import { loadReviewStep } from "./support/loadReviewStep.js";

const PPL_DAYS = [
  { label: "Push", exercises: ["Bench Press", "Overhead Press"] },
  { label: "Pull", exercises: ["Deadlift", "Barbell Row"] },
  { label: "Legs", exercises: ["Squat"] },
];
const PPL_SCHEDULE = {
  monday: "Push",
  tuesday: "Pull",
  wednesday: "Rest",
  thursday: "Legs",
  friday: "Push",
  saturday: "Rest",
  sunday: "Rest",
};

function dots(body) {
  return [...body.querySelectorAll("[data-weekday-cell]")];
}
function pill(body) {
  return body.querySelector("[data-pill-toggle]");
}
function pillMenu(body) {
  return body.querySelector(".split-carousel-pill-menu");
}
function pillMenuOption(body, value) {
  return body.querySelector(`[data-select-day="${value}"]`);
}
function exRows(body) {
  return [...body.querySelectorAll(".split-ex-row")];
}

describe("renderSplitStepReview — carousel", () => {
  it("renders one dot per weekday and the current day's name + pill", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });
    renderSplitStepReview();

    expect(dots(splitModalBody)).toHaveLength(7);
    expect(splitModalBody.querySelector(".split-carousel-day").textContent).toBe("Monday");
    expect(pill(splitModalBody).textContent.trim()).toContain("Push");
  });

  it("opens on the first weekday that actually trains, not Monday-if-rest", () => {
    // wednesday is the first training day in this schedule.
    const schedule = { ...PPL_SCHEDULE, monday: "Rest", tuesday: "Rest", wednesday: "Legs" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    expect(splitModalBody.querySelector(".split-carousel-day").textContent).toBe("Wednesday");
    expect(dots(splitModalBody)[2].classList.contains("is-active")).toBe(true);
  });

  it("falls back to the first day when the whole week is Rest", () => {
    const allRest = Object.fromEntries(Object.keys(PPL_SCHEDULE).map((k) => [k, "Rest"]));
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: allRest,
    });
    renderSplitStepReview();

    expect(splitModalBody.querySelector(".split-carousel-day").textContent).toBe("Monday");
    expect(dots(splitModalBody)[0].classList.contains("is-active")).toBe(true);
  });

  it("shows the recovery note on a rest day, not an exercise list", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE, // opens on Monday = Push
    });
    renderSplitStepReview();
    dots(splitModalBody)[2].click(); // Wednesday = Rest

    expect(splitModalBody.querySelector(".split-day-rest-note")).not.toBeNull();
    expect(splitModalBody.querySelector(".split-ex-row")).toBeNull();
  });

  it("shows every exercise for a training day with an icon, name, and sets×reps meta", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE, // Monday = Push
    });
    renderSplitStepReview();

    const rows = exRows(splitModalBody);
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".split-ex-name").textContent).toBe("Bench Press");
    expect(rows[0].querySelector(".split-ex-emoji")).not.toBeNull();
    expect(rows[0].querySelector(".split-ex-meta").textContent).toMatch(/^\d+×\d+$/);
  });

  it("wraps the pill's day label in a truncating span, so a long custom label ellipsizes instead of overflowing the card", () => {
    // Regression: /qa caught a custom day label running clean off the
    // right edge of the modal with no ellipsis -- .split-carousel-pill had
    // no max-width and the label had no truncating wrapper of its own.
    const longLabel = "A Very Long Custom Day Name That Might Overflow The Pill";
    const days = [{ label: longLabel, exercises: ["Bench Press"] }];
    const schedule = { monday: longLabel, tuesday: "Rest", wednesday: "Rest", thursday: "Rest", friday: "Rest", saturday: "Rest", sunday: "Rest" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: days,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    const textEl = pill(splitModalBody).querySelector(".split-carousel-pill-text");
    expect(textEl).not.toBeNull();
    expect(textEl.textContent).toBe(longLabel);
  });

  it("renders the rationale callout when the wizard has one, omits it when it doesn't", () => {
    const withRationale = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
      rationale: "Push/pull/legs twice a week balances volume with recovery.",
    });
    withRationale.renderSplitStepReview();
    expect(withRationale.splitModalBody.querySelector(".split-rationale").textContent).toContain(
      "balances volume"
    );

    const withoutRationale = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
      rationale: null,
    });
    withoutRationale.renderSplitStepReview();
    expect(withoutRationale.splitModalBody.querySelector(".split-rationale")).toBeNull();
  });
});

describe("renderSplitStepReview — navigation", () => {
  let ctx;
  beforeEach(() => {
    ctx = loadReviewStep({ generatedDays: PPL_DAYS, generatedSchedule: { ...PPL_SCHEDULE } });
    ctx.renderSplitStepReview();
  });

  it("next/prev arrows step through the week and wrap at the ends", () => {
    const { splitModalBody } = ctx;
    const dayName = () => splitModalBody.querySelector(".split-carousel-day").textContent;
    expect(dayName()).toBe("Monday");

    splitModalBody.querySelector('[data-carousel-dir="1"]').click();
    expect(dayName()).toBe("Tuesday");

    splitModalBody.querySelector('[data-carousel-dir="-1"]').click();
    splitModalBody.querySelector('[data-carousel-dir="-1"]').click();
    expect(dayName()).toBe("Sunday"); // wrapped backward past Monday
  });

  it("clicking a dot jumps straight to that weekday", () => {
    const { splitModalBody } = ctx;
    dots(splitModalBody)[3].click(); // Thursday
    expect(splitModalBody.querySelector(".split-carousel-day").textContent).toBe("Thursday");
    expect(dots(splitModalBody)[3].classList.contains("is-active")).toBe(true);
  });

  it("tapping the pill opens a menu listing every unique label plus Rest", () => {
    const { splitModalBody } = ctx;
    expect(pillMenu(splitModalBody)).toBeNull();
    pill(splitModalBody).click();

    const menu = pillMenu(splitModalBody);
    expect(menu).not.toBeNull();
    expect(pill(splitModalBody).getAttribute("aria-expanded")).toBe("true");
    const values = [...menu.querySelectorAll("[data-select-day]")].map((el) => el.dataset.selectDay);
    expect(values).toEqual(["Push", "Pull", "Legs", "Rest"]);
    // Monday is Push -- that option (and only that one) should read selected.
    expect(pillMenuOption(splitModalBody, "Push").classList.contains("is-selected")).toBe(true);
    expect(pillMenuOption(splitModalBody, "Pull").classList.contains("is-selected")).toBe(false);
  });

  it("a single-label split (e.g. a whole-week Full Body plan) offers exactly that label plus Rest, no duplicates", () => {
    const days = [{ label: "Full Body", exercises: ["Squat"] }];
    const schedule = { monday: "Full Body", tuesday: "Full Body", wednesday: "Rest", thursday: "Full Body", friday: "Full Body", saturday: "Rest", sunday: "Rest" };
    const solo = loadReviewStep({ generatedDays: days, generatedSchedule: schedule });
    solo.renderSplitStepReview();

    pill(solo.splitModalBody).click();
    const values = [...pillMenu(solo.splitModalBody).querySelectorAll("[data-select-day]")].map((el) => el.dataset.selectDay);
    expect(values).toEqual(["Full Body", "Rest"]);
  });

  it("selecting an option reassigns the CURRENTLY SHOWN day directly, not some other day, and closes the menu", () => {
    const { splitModalBody } = ctx;
    dots(splitModalBody)[3].click(); // move to Thursday = Legs, without touching Monday
    pill(splitModalBody).click();
    pillMenuOption(splitModalBody, "Rest").click();

    expect(pill(splitModalBody).textContent.trim()).toContain("Rest");
    expect(pillMenu(splitModalBody)).toBeNull(); // menu closes on selection
    expect(splitModalBody.querySelector(".split-day-rest-note")).not.toBeNull();

    // Monday (not visited) must be untouched.
    dots(splitModalBody)[0].click();
    expect(pill(splitModalBody).textContent.trim()).toContain("Push");
  });

  it("tapping the pill again while the menu is open closes it without changing the day", () => {
    const { splitModalBody } = ctx;
    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();
    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).toBeNull();
    expect(pill(splitModalBody).textContent.trim()).toContain("Push"); // unchanged
  });

  it("a tap elsewhere in the carousel dismisses the open menu instead of also performing that tap's own action", () => {
    const { splitModalBody } = ctx;
    const dayName = () => splitModalBody.querySelector(".split-carousel-day").textContent;
    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();

    splitModalBody.querySelector('[data-carousel-dir="1"]').click(); // first click: dismiss only
    expect(pillMenu(splitModalBody)).toBeNull();
    expect(dayName()).toBe("Monday"); // arrow's own action did NOT also fire

    splitModalBody.querySelector('[data-carousel-dir="1"]').click(); // second click: now it navigates
    expect(dayName()).toBe("Tuesday");
  });

  it("tapping a weekday dot while the menu is open dismisses it without also navigating", () => {
    const { splitModalBody } = ctx;
    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();

    dots(splitModalBody)[3].click(); // first click: dismiss only
    expect(pillMenu(splitModalBody)).toBeNull();
    expect(splitModalBody.querySelector(".split-carousel-day").textContent).toBe("Monday");

    dots(splitModalBody)[3].click(); // second click: now it navigates
    expect(splitModalBody.querySelector(".split-carousel-day").textContent).toBe("Thursday");
  });

  it("tapping an exercise row while the menu is open dismisses it instead of opening the editor", () => {
    const { splitModalBody, calls } = ctx;
    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();

    exRows(splitModalBody)[0].click(); // first click: dismiss only
    expect(pillMenu(splitModalBody)).toBeNull();
    expect(calls.editorOpenedWith).toBeUndefined();

    exRows(splitModalBody)[0].click(); // second click: now it opens the editor
    expect(calls.editorOpenedWith).toEqual({ label: "Push", name: "Bench Press" });
  });

  it("a tap outside the carousel entirely dismisses the open menu", () => {
    const { splitModalBody } = ctx;
    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();

    splitModalBody.click(); // outside .split-carousel, but still inside the modal body
    expect(pillMenu(splitModalBody)).toBeNull();
  });

  it("Escape dismisses the open menu without changing the day", () => {
    const { splitModalBody } = ctx;
    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pillMenu(splitModalBody)).toBeNull();
    expect(pill(splitModalBody).textContent.trim()).toContain("Push"); // unchanged
  });
});

describe("renderSplitStepReview — listener cleanup across repeated renders", () => {
  // The wizard can be closed and reopened many times in one page load, and
  // renderSplitStepReview() re-binds reviewDismissMenuOnOutsideClick /
  // reviewDismissMenuOnEscape on `document` every time it runs, removing the
  // previous pair first. Every other test in this file only calls
  // renderSplitStepReview() once, so none of them would notice if that
  // removeEventListener cleanup were silently dropped -- the stale listener
  // from the first render would keep firing on `document` alongside the new
  // one, both racing to read/write the shared reviewPillMenuOpen flag. These
  // tests call it a second time (simulating a reopen) specifically to catch
  // that class of regression.
  it("a stale outside-click listener from a previous render doesn't block the new render's outside-click dismiss", () => {
    const ctx = loadReviewStep({ generatedDays: PPL_DAYS, generatedSchedule: { ...PPL_SCHEDULE } });
    ctx.renderSplitStepReview(); // first render (e.g. wizard opened once)
    ctx.renderSplitStepReview(); // re-render (e.g. wizard closed and reopened)
    const { splitModalBody } = ctx;

    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();

    splitModalBody.click(); // outside .split-carousel, but still inside the modal body
    expect(pillMenu(splitModalBody)).toBeNull();
  });

  it("a stale Escape listener from a previous render doesn't block the new render's Escape dismiss", () => {
    const ctx = loadReviewStep({ generatedDays: PPL_DAYS, generatedSchedule: { ...PPL_SCHEDULE } });
    ctx.renderSplitStepReview();
    ctx.renderSplitStepReview();
    const { splitModalBody } = ctx;

    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pillMenu(splitModalBody)).toBeNull();
    expect(pill(splitModalBody).textContent.trim()).toContain("Push"); // unchanged
  });

  it("re-rendering a third time still leaves exactly one working outside-click dismiss path, not a growing pile of stale ones", () => {
    const ctx = loadReviewStep({ generatedDays: PPL_DAYS, generatedSchedule: { ...PPL_SCHEDULE } });
    ctx.renderSplitStepReview();
    ctx.renderSplitStepReview();
    ctx.renderSplitStepReview();
    const { splitModalBody } = ctx;

    pill(splitModalBody).click();
    expect(pillMenu(splitModalBody)).not.toBeNull();

    splitModalBody.click();
    expect(pillMenu(splitModalBody)).toBeNull();
  });
});

describe("renderSplitStepReview — exercise editor wiring", () => {
  it("clicking an exercise row opens the editor for that exact (label, exercise) pair", () => {
    const { renderSplitStepReview, splitModalBody, calls } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE, // Monday = Push
    });
    renderSplitStepReview();

    exRows(splitModalBody)[1].click(); // Overhead Press

    expect(calls.editorOpenedWith).toEqual({ label: "Push", name: "Overhead Press" });
  });

  it("a day label containing the old '::' join character doesn't collide with an unrelated exercise's prescription key", () => {
    // Regression: prescriptionKey() used to join label+name with a bare
    // "::" -- day labels are unrestricted free text (no maxlength, no
    // character filter on #split-custom-input), so label="Push::Legs",
    // name="Bench Press" produced the SAME key as label="Push",
    // name="Legs::Bench Press". Two unrelated (day, exercise) pairs would
    // silently share one prescription object. Testing the real
    // prescriptionKey()/getPrescription() directly (not derived display
    // text) since the exact sets/reps bucket values aren't the point here.
    const { prescriptionKey, getPrescription } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });

    const keyA = prescriptionKey("Push::Legs", "Bench Press");
    const keyB = prescriptionKey("Push", "Legs::Bench Press");
    expect(keyA).not.toBe(keyB);

    const prescriptionA = getPrescription("Push::Legs", "Bench Press");
    prescriptionA.sets = 99; // mutate A specifically
    const prescriptionB = getPrescription("Push", "Legs::Bench Press");
    expect(prescriptionB.sets).not.toBe(99); // B is a distinct object, unaffected by A's edit
  });
});

describe("renderSplitStepReview — save", () => {
  it("writes the carousel's current schedule and prescriptions, not the originally generated schedule", () => {
    localStorage.clear();
    const { renderSplitStepReview, splitModalBody, SPLIT_PLAN_KEY, calls } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: { ...PPL_SCHEDULE },
    });
    renderSplitStepReview();

    pill(splitModalBody).click(); // open the picker for Monday
    pillMenuOption(splitModalBody, "Pull").click(); // reassign Monday: Push -> Pull
    splitModalBody.querySelector("#split-save-btn").click();

    const saved = JSON.parse(localStorage.getItem(SPLIT_PLAN_KEY));
    expect(saved.schedule.monday).toBe("Pull"); // the reassigned value, not "Push"
    expect(saved.schedule.wednesday).toBe("Rest");
    expect(Object.keys(saved.schedule)).toHaveLength(7);
    expect(saved.exercisePrescriptions).toBeTypeOf("object");
    expect(calls.closed).toBe(true);
    expect(calls.replanned).toBe(true);
  });

  it("labels the primary button 'Save plan' normally, 'Save changes' when editing an existing plan", () => {
    // Regression: the type-selection step already switches its own primary
    // button between "Generate my plan" / "Save changes" off
    // splitWizard.isEditingExistingPlan; the review step's Save button
    // picked up the same branch later and needs the same coverage, or an
    // edit session reads as "Save changes" -> ... -> "Save plan", which
    // looks like two different actions instead of one continuous edit.
    const fresh = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
      isEditingExistingPlan: false,
    });
    fresh.renderSplitStepReview();
    expect(fresh.splitModalBody.querySelector("#split-save-btn").textContent.trim()).toBe("Save plan");

    const editing = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
      isEditingExistingPlan: true,
    });
    editing.renderSplitStepReview();
    expect(editing.splitModalBody.querySelector("#split-save-btn").textContent.trim()).toBe("Save changes");
  });

  it("never mutates splitWizard.generatedSchedule -- only the saved copy changes", () => {
    const generatedSchedule = { ...PPL_SCHEDULE };
    const { renderSplitStepReview, splitModalBody, splitWizard } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule,
    });
    renderSplitStepReview();

    pill(splitModalBody).click(); // open the picker for Monday
    pillMenuOption(splitModalBody, "Pull").click(); // reassign Monday

    expect(splitWizard.generatedSchedule.monday).toBe("Push"); // untouched
  });
});

describe("renderSplitStepReview — trust boundary (real DOM, not source-text regex)", () => {
  // tests/test_split_review_step.py pins that each interpolation site calls
  // escapeHtml/escapeAttr in the template SOURCE -- it can't tell a working
  // implementation from a broken one, only that the call site is present.
  // This runs the real escaping against a real jsdom document, so a broken
  // escapeHtml (e.g. someone "simplifies" it into a no-op) fails here even
  // though the source-text regex would still pass.
  const XSS_NAME = '<img src=x onerror="window.__pwned=1">';

  it("neutralizes a malicious exercise name into inert text, not a live element", () => {
    const days = [{ label: "Push", exercises: [XSS_NAME] }];
    const schedule = { monday: "Push", tuesday: "Rest", wednesday: "Rest", thursday: "Rest", friday: "Rest", saturday: "Rest", sunday: "Rest" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: days,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    expect(splitModalBody.querySelector(".split-ex-name img")).toBeNull();
    expect(splitModalBody.querySelector(".split-ex-name").textContent).toBe(XSS_NAME);
  });

  it("escapes a quote in an exercise name so it can't break out of the row's data attribute", () => {
    const evil = 'Bench" onmouseover="window.__pwned=1';
    const days = [{ label: "Push", exercises: [evil] }];
    const schedule = { monday: "Push", tuesday: "Rest", wednesday: "Rest", thursday: "Rest", friday: "Rest", saturday: "Rest", sunday: "Rest" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: days,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    const row = splitModalBody.querySelector(".split-ex-row");
    expect(row.getAttribute("onmouseover")).toBeNull();
    expect(row.dataset.exerciseEdit).toBe(evil);
  });

  it("escapes a malicious day label rendered in the pill", () => {
    const evilLabel = '<img src=x onerror="window.__pwned=1">';
    const days = [{ label: evilLabel, exercises: ["Bench Press"] }];
    const schedule = { monday: evilLabel, tuesday: "Rest", wednesday: "Rest", thursday: "Rest", friday: "Rest", saturday: "Rest", sunday: "Rest" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: days,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    expect(pill(splitModalBody).querySelector("img")).toBeNull();
    expect(pill(splitModalBody).textContent).toContain(evilLabel);
  });
});
