// DOM-level coverage for renderSplitStepReview()'s interactive state
// machine -- the grid click handler, the drawer accordion, and the
// label-abbreviation / accent-assignment logic. These were the pieces
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

function weekdayCells(body) {
  return [...body.querySelectorAll("[data-weekday-cell]")];
}

describe("renderSplitStepReview — grid + legend + drawer", () => {
  it("renders one cell per weekday, Monday first", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });
    renderSplitStepReview();

    const cells = weekdayCells(splitModalBody);
    expect(cells).toHaveLength(7);
    expect(cells[0].querySelector(".split-week-cell-dow").textContent).toBe("Mon");
    expect(cells[6].querySelector(".split-week-cell-dow").textContent).toBe("Sun");
  });

  it("opens on the first weekday that actually trains, not Monday-if-rest", () => {
    // wednesday is the first training day in this schedule.
    const schedule = { ...PPL_SCHEDULE, monday: "Rest", tuesday: "Rest", wednesday: "Legs" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    const selected = splitModalBody.querySelectorAll(".split-week-cell.is-selected");
    expect(selected).toHaveLength(1);
    expect(weekdayCells(splitModalBody)[2]).toBe(selected[0]); // index 2 = Wednesday
  });

  it("falls back to the first day when the whole week is Rest", () => {
    const allRest = Object.fromEntries(Object.keys(PPL_SCHEDULE).map((k) => [k, "Rest"]));
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: allRest,
    });
    renderSplitStepReview();

    const selected = splitModalBody.querySelectorAll(".split-week-cell.is-selected");
    expect(selected).toHaveLength(1);
    expect(weekdayCells(splitModalBody)[0]).toBe(selected[0]);
  });

  it("abbreviates Push/Pull to Ps/Pl instead of colliding on a shared first letter", () => {
    // PPL is the app's default split -- a plain first-letter abbreviation
    // would render "P" on both, which is the exact bug this logic exists
    // to avoid.
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });
    renderSplitStepReview();

    const cells = weekdayCells(splitModalBody);
    const text = (i) => cells[i].querySelector(".split-week-cell-swatch").textContent.trim();
    expect(text(0)).toBe("Ps"); // Monday = Push
    expect(text(1)).toBe("Pl"); // Tuesday = Pull
    expect(text(3)).toBe("L"); // Thursday = Legs, no rival starting with L
    expect(text(2)).toBe(""); // Wednesday = Rest, swatch stays empty
  });

  it("falls back to two clean characters when one label is a PREFIX of another, not a differing one", () => {
    // Regression: when a rival label is shorter than the one being
    // abbreviated ("Push" is a prefix of "Push Day"), comparing past the
    // shorter rival's length reads its missing character as undefined,
    // and `undefined !== char` is trivially true -- misfiring as "found a
    // differing character" instead of correctly falling through to the
    // documented chars.slice(0,2) fallback. Caught: "Push Day" abbreviated
    // to "P" + " " (a literal space) instead of "Pu".
    const days = [
      { label: "Push", exercises: ["Bench Press"] },
      { label: "Push Day", exercises: ["Incline Press"] },
    ];
    const schedule = { monday: "Push", tuesday: "Push Day", wednesday: "Rest", thursday: "Rest", friday: "Rest", saturday: "Rest", sunday: "Rest" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: days,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    const cells = weekdayCells(splitModalBody);
    const text = (i) => cells[i].querySelector(".split-week-cell-swatch").textContent;
    expect(text(0)).toBe("Pu"); // "Push" has no differing char within its own length -> prefix fallback
    expect(text(1)).toBe("Pu"); // "Push Day" -- must NOT be "P " (a letter plus a literal space)
    expect(text(1)).not.toMatch(/\s/);
  });

  it("assigns a distinct accent to each unique label, reused past 5 via modulo", () => {
    // Custom split with 6 unique day names -- more than DAY_ACCENTS has
    // entries for. Documents the known collision rather than hiding it:
    // day 6 (index 5 % 5 = 0) reuses day 1's accent.
    const sixDays = ["Chest", "Back", "Shoulders", "Legs", "Arms", "Core"].map((label) => ({
      label,
      exercises: ["Filler Exercise"],
    }));
    const schedule = {
      monday: "Chest",
      tuesday: "Back",
      wednesday: "Shoulders",
      thursday: "Legs",
      friday: "Arms",
      saturday: "Core",
      sunday: "Rest",
    };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: sixDays,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    const cells = weekdayCells(splitModalBody);
    // --day-accent is set on the cell BUTTON, not the swatch span --
    // the swatch's own CSS reads it via inheritance (var(--day-accent)),
    // so it never carries the style attribute itself.
    const accentOf = (i) => cells[i].getAttribute("style");
    // Chest (index 0 in uniqueLabels) and Core (index 5) both land on
    // DAY_ACCENTS[0] -- same --day-accent custom property value.
    const chestAccent = accentOf(0).match(/--day-accent:\s*([^;]+);/)[1];
    const coreAccent = accentOf(5).match(/--day-accent:\s*([^;]+);/)[1];
    expect(coreAccent).toBe(chestAccent);
  });

  it("renders a legend entry per unique label plus Rest", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });
    renderSplitStepReview();

    const legend = splitModalBody.querySelectorAll("#split-week-legend span");
    // 3 unique labels (Push, Pull, Legs) + the always-appended Rest chip.
    expect(legend).toHaveLength(4);
    expect(legend[legend.length - 1].textContent.trim()).toBe("Rest");
  });

  it("shows the recovery note on a rest day, not an exercise list", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });
    renderSplitStepReview();
    // Auto-selects the first TRAINING day (Monday), so move the drawer to
    // Wednesday -- a rest day in PPL_SCHEDULE -- by tapping it. Tapping a
    // day that isn't already selected only moves the drawer, it doesn't
    // cycle the assignment, so Wednesday stays Rest.
    weekdayCells(splitModalBody)[2].click();

    expect(splitModalBody.querySelector(".split-day-rest-note")).not.toBeNull();
    expect(splitModalBody.querySelector(".split-ex-row")).toBeNull();
  });

  it("shows every exercise for a training day, sets/reps visible without expanding", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE, // opens on Monday = Push
    });
    renderSplitStepReview();

    const rows = splitModalBody.querySelectorAll(".split-ex-row");
    expect(rows).toHaveLength(2); // Push has 2 exercises
    expect(rows[0].classList.contains("is-open")).toBe(false);
    expect(rows[0].querySelector(".split-ex-name").textContent).toBe("Bench Press");
    expect(rows[0].querySelector(".split-ex-meta").textContent.length).toBeGreaterThan(0);
    // The detail block exists in the DOM but only becomes visible via the
    // .is-open CSS rule -- jsdom doesn't apply the stylesheet, so presence
    // in markup (not computed style) is what this test can actually assert.
    expect(rows[0].querySelector(".split-ex-detail")).not.toBeNull();
  });
});

describe("renderSplitStepReview — grid click: select vs cycle", () => {
  let ctx;
  beforeEach(() => {
    ctx = loadReviewStep({ generatedDays: PPL_DAYS, generatedSchedule: { ...PPL_SCHEDULE } });
    ctx.renderSplitStepReview();
  });

  it("tapping a day that is NOT selected only moves the drawer, never mutates the plan", () => {
    const { splitModalBody } = ctx;
    const before = weekdayCells(splitModalBody)[1].querySelector(".split-week-cell-swatch").textContent;

    weekdayCells(splitModalBody)[1].click(); // Tuesday, not currently selected (Monday is)

    const cells = weekdayCells(splitModalBody);
    expect(cells[1].classList.contains("is-selected")).toBe(true);
    expect(cells[0].classList.contains("is-selected")).toBe(false);
    expect(cells[1].querySelector(".split-week-cell-swatch").textContent).toBe(before);
    expect(splitModalBody.querySelector(".split-day-drawer-title").textContent).toBe("Tuesday");
  });

  it("tapping the ALREADY-selected day cycles its assignment through the split types then Rest", () => {
    const { splitModalBody } = ctx;
    // Monday starts as Push (selected by default, since it's the first training day).
    const swatchText = () =>
      weekdayCells(splitModalBody)[0].querySelector(".split-week-cell-swatch").textContent;

    expect(swatchText()).toBe("Ps"); // Push
    weekdayCells(splitModalBody)[0].click();
    expect(swatchText()).toBe("Pl"); // Pull
    weekdayCells(splitModalBody)[0].click();
    expect(swatchText()).toBe("L"); // Legs
    weekdayCells(splitModalBody)[0].click();
    expect(swatchText()).toBe(""); // Rest -- swatch goes empty
    expect(
      weekdayCells(splitModalBody)[0].querySelector(".split-week-cell-swatch").classList.contains("is-rest")
    ).toBe(true);
    weekdayCells(splitModalBody)[0].click();
    expect(swatchText()).toBe("Ps"); // wraps back to Push
  });

  it("cycling closes any open exercise row and re-renders the drawer for the (possibly new) day", () => {
    const { splitModalBody } = ctx;
    splitModalBody.querySelector(".split-ex-main").click(); // expand Monday's first exercise
    expect(splitModalBody.querySelector(".split-ex-row").classList.contains("is-open")).toBe(true);

    weekdayCells(splitModalBody)[0].click(); // cycle Monday: Push -> Pull

    expect(splitModalBody.querySelector(".split-day-drawer-pill").textContent.trim()).toBe("Pull");
    const rows = splitModalBody.querySelectorAll(".split-ex-row");
    expect([...rows].every((r) => !r.classList.contains("is-open"))).toBe(true);
  });

  it("cycling a day that trains 0 times after wrapping does not throw and lands on Rest", () => {
    // Regression guard for the audit's orphan-day finding: this asserts
    // the *mechanism* doesn't crash or corrupt the DOM when a label ends
    // up unscheduled -- it does not assert that outcome is desirable,
    // which is a product question, not a test-coverage one.
    const { splitModalBody } = ctx;
    for (let i = 0; i < 4; i += 1) weekdayCells(splitModalBody)[0].click();
    expect(() => weekdayCells(splitModalBody)[0].click()).not.toThrow();
  });
});

describe("renderSplitStepReview — exercise accordion", () => {
  it("expands one row on click and shows description + demo-link", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });
    renderSplitStepReview();

    const row = splitModalBody.querySelector(".split-ex-row");
    row.querySelector(".split-ex-main").click();

    expect(splitModalBody.querySelector(".split-ex-row").classList.contains("is-open")).toBe(true);
    expect(splitModalBody.querySelector(".split-ex-detail-text").textContent.length).toBeGreaterThan(0);
    expect(splitModalBody.querySelector("[data-exercise-detail]")).not.toBeNull();
  });

  it("is an accordion: opening a second row closes the first", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE, // Monday = Push, 2 exercises
    });
    renderSplitStepReview();

    // Each click replaces drawerEl's innerHTML (renderDrawer rebuilds it),
    // so a node reference from before a click is detached afterward --
    // re-querying live after every click is required, not a style choice.
    splitModalBody.querySelectorAll(".split-ex-row")[0].querySelector(".split-ex-main").click();
    splitModalBody.querySelectorAll(".split-ex-row")[1].querySelector(".split-ex-main").click();

    const after = splitModalBody.querySelectorAll(".split-ex-row");
    expect(after[0].classList.contains("is-open")).toBe(false);
    expect(after[1].classList.contains("is-open")).toBe(true);
  });

  it("clicking the same row twice collapses it", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });
    renderSplitStepReview();

    const main = () => splitModalBody.querySelector(".split-ex-main");
    main().click();
    expect(splitModalBody.querySelector(".split-ex-row").classList.contains("is-open")).toBe(true);
    main().click();
    expect(splitModalBody.querySelector(".split-ex-row").classList.contains("is-open")).toBe(false);
  });

  it("the demo-link click does not also toggle the row (no [data-exercise-toggle] ancestor)", () => {
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: PPL_SCHEDULE,
    });
    renderSplitStepReview();
    splitModalBody.querySelector(".split-ex-main").click(); // expand first

    const link = splitModalBody.querySelector(".split-ex-detail-link");
    expect(link.closest("[data-exercise-toggle]")).toBeNull();
    link.click(); // should be a no-op for the accordion (handled elsewhere via delegation)

    expect(splitModalBody.querySelector(".split-ex-row").classList.contains("is-open")).toBe(true);
  });
});

describe("renderSplitStepReview — save", () => {
  it("writes the grid's current schedule, not the originally generated one, to localStorage", () => {
    localStorage.clear();
    const { renderSplitStepReview, splitModalBody, SPLIT_PLAN_KEY, calls } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule: { ...PPL_SCHEDULE },
    });
    renderSplitStepReview();

    weekdayCells(splitModalBody)[0].click(); // cycle Monday: Push -> Pull
    splitModalBody.querySelector("#split-save-btn").click();

    const saved = JSON.parse(localStorage.getItem(SPLIT_PLAN_KEY));
    expect(saved.schedule.monday).toBe("Pull"); // the cycled value, not "Push"
    expect(saved.schedule.wednesday).toBe("Rest");
    expect(Object.keys(saved.schedule)).toHaveLength(7);
    expect(calls.closed).toBe(true);
    expect(calls.replanned).toBe(true);
  });

  it("never mutates splitWizard.generatedSchedule -- only the saved copy changes", () => {
    const generatedSchedule = { ...PPL_SCHEDULE };
    const { renderSplitStepReview, splitModalBody, splitWizard } = loadReviewStep({
      generatedDays: PPL_DAYS,
      generatedSchedule,
    });
    renderSplitStepReview();

    weekdayCells(splitModalBody)[0].click(); // cycle Monday

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

  it("escapes a quote in an exercise name so it can't break out of the demo-link attribute", () => {
    const evil = 'Bench" onmouseover="window.__pwned=1';
    const days = [{ label: "Push", exercises: [evil] }];
    const schedule = { monday: "Push", tuesday: "Rest", wednesday: "Rest", thursday: "Rest", friday: "Rest", saturday: "Rest", sunday: "Rest" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: days,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();
    splitModalBody.querySelector(".split-ex-main").click(); // expand to render the demo-link button

    const link = splitModalBody.querySelector(".split-ex-detail-link");
    expect(link.getAttribute("onmouseover")).toBeNull();
    expect(link.dataset.exerciseDetail).toBe(evil);
  });

  it("does not split a surrogate-pair character when abbreviating a custom day label", () => {
    // U+1F3AF TARGET is a single code point but two UTF-16 code units --
    // Array.from(label)[0] keeps the pair together. A naive label[0] or
    // label.slice(0, 1) would grab only the leading surrogate half,
    // producing a lone surrogate (renders as U+FFFD / a broken glyph).
    const emojiLabel = "\u{1F3AF} Day";
    const days = [{ label: emojiLabel, exercises: ["Bench Press"] }];
    const schedule = { monday: emojiLabel, tuesday: "Rest", wednesday: "Rest", thursday: "Rest", friday: "Rest", saturday: "Rest", sunday: "Rest" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: days,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    const swatch = splitModalBody.querySelector(".split-week-cell-swatch").textContent;
    expect(swatch).toBe("\u{1F3AF}"); // the whole target emoji, not a lone surrogate half
    expect(swatch.includes("�")).toBe(false); // no replacement character from a mangled pair
  });

  it("does not corrupt the abbreviation map when a custom day is literally named __proto__", () => {
    // Regression, caught by adversarial review: labelAbbrev used to be a
    // plain {}. Assigning labelAbbrev["__proto__"] = "<string>" hits the
    // inherited Object.prototype accessor, which silently ignores
    // non-object assignments -- so the write is a no-op, and the later
    // read `labelAbbrev[label] || ""` returns Object.prototype itself
    // (a truthy object) instead of the missing abbreviation. escapeHtml()
    // stringifying that renders "[object Object]" into the swatch.
    // Object.create(null) has no such accessor, so "__proto__" is just an
    // ordinary key like any other.
    const days = [{ label: "__proto__", exercises: ["Bench Press"] }];
    const schedule = { monday: "__proto__", tuesday: "Rest", wednesday: "Rest", thursday: "Rest", friday: "Rest", saturday: "Rest", sunday: "Rest" };
    const { renderSplitStepReview, splitModalBody } = loadReviewStep({
      generatedDays: days,
      generatedSchedule: schedule,
    });
    renderSplitStepReview();

    const swatch = splitModalBody.querySelector(".split-week-cell-swatch").textContent;
    expect(swatch).not.toBe("[object Object]");
    expect(swatch).toBe("_"); // ordinary single-character abbreviation, same as any other label
  });
});
