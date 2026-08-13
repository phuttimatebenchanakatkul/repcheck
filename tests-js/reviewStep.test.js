// DOM-level coverage for renderSplitStepReview()'s interactive state
// machine -- the carousel's prev/next/dot navigation, the day-pill cycle
// gesture, and the exercise row -> editor wiring. These were the pieces
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
  return body.querySelector("[data-cycle-day]");
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

  it("clicking the day pill cycles the CURRENTLY SHOWN day's assignment, not some other day", () => {
    const { splitModalBody } = ctx;
    dots(splitModalBody)[3].click(); // move to Thursday = Legs, without touching Monday
    pill(splitModalBody).click();
    expect(pill(splitModalBody).textContent.trim()).toContain("Rest");

    // Monday (not visited) must be untouched.
    dots(splitModalBody)[0].click();
    expect(pill(splitModalBody).textContent.trim()).toContain("Push");
  });

  it("cycles through every unique label then Rest, then wraps back", () => {
    const { splitModalBody } = ctx;
    // Monday starts as Push.
    const pillText = () => pill(splitModalBody).textContent.trim();
    expect(pillText()).toContain("Push");
    pill(splitModalBody).click();
    expect(pillText()).toContain("Pull");
    pill(splitModalBody).click();
    expect(pillText()).toContain("Legs");
    pill(splitModalBody).click();
    expect(pillText()).toContain("Rest");
    expect(splitModalBody.querySelector(".split-day-rest-note")).not.toBeNull();
    pill(splitModalBody).click();
    expect(pillText()).toContain("Push"); // wraps back
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
});

describe("renderSplitStepReview — save", () => {
  it("writes the carousel's current schedule and prescriptions, not the originally generated schedule", () => {
    localStorage.clear();
    const { renderSplitStepReview, splitModalBody, SPLIT_PLAN_KEY, calls } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: { ...PPL_SCHEDULE },
    });
    renderSplitStepReview();

    pill(splitModalBody).click(); // cycle Monday: Push -> Pull
    splitModalBody.querySelector("#split-save-btn").click();

    const saved = JSON.parse(localStorage.getItem(SPLIT_PLAN_KEY));
    expect(saved.schedule.monday).toBe("Pull"); // the cycled value, not "Push"
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

    pill(splitModalBody).click(); // cycle Monday

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
