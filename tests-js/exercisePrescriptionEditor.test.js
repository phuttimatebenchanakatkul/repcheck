// DOM-level coverage for the split wizard's per-exercise sets/reps editor
// (the Hyrox-style .split-ex-editor-* modal opened by tapping a row in
// renderSplitStepReview's carousel). See reviewStep.test.js for the row ->
// editor wiring; this file covers the editor's own open/edit/reset/close
// behaviour in isolation.
import { describe, expect, it } from "vitest";
import { loadExercisePrescriptionEditor } from "./support/loadExercisePrescriptionEditor.js";

describe("exercise prescription editor — open", () => {
  it("populates the title, current sets/reps, and standard captions", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    expect(ed.title.textContent).toBe("Bench Press");
    expect(ed.setsInput.value).toBe("4");
    expect(ed.repsInput.value).toBe("8");
    expect(ed.setsBase.textContent).toBe("Standard: 4");
    expect(ed.repsBase.textContent).toBe("Standard: 8");
    expect(ed.overlay.classList.contains("is-open")).toBe(true);
  });

  it("uses the isolation-exercise bucket for curls/pushdowns/raises", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Tricep Pushdown");

    expect(ed.setsInput.value).toBe("3");
    expect(ed.repsInput.value).toBe("10");
  });

  it("loads each exercise's own prescription independently", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");
    ed.setsInput.value = "5";
    ed.setsInput.dispatchEvent(new Event("input"));
    ed.closeExercisePrescriptionEditor();

    ed.openExercisePrescriptionEditor("Push", "Overhead Press");
    expect(ed.setsInput.value).toBe("4"); // unaffected by Bench Press's edit

    ed.openExercisePrescriptionEditor("Push", "Bench Press");
    expect(ed.setsInput.value).toBe("5"); // Bench Press's edit persisted
  });

  it("neither box starts marked as edited when values match standard", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");
    expect(ed.setsBox.classList.contains("is-edited")).toBe(false);
    expect(ed.repsBox.classList.contains("is-edited")).toBe(false);
  });
});

describe("exercise prescription editor — editing", () => {
  it("typing a new sets value updates the store and marks only the sets box edited", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    ed.setsInput.value = "5";
    ed.setsInput.dispatchEvent(new Event("input"));

    expect(ed.getPrescription("Push", "Bench Press").sets).toBe(5);
    expect(ed.setsBox.classList.contains("is-edited")).toBe(true);
    expect(ed.repsBox.classList.contains("is-edited")).toBe(false);
  });

  it("typing a new reps value updates the store and marks only the reps box edited", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    ed.repsInput.value = "12";
    ed.repsInput.dispatchEvent(new Event("input"));

    expect(ed.getPrescription("Push", "Bench Press").reps).toBe(12);
    expect(ed.repsBox.classList.contains("is-edited")).toBe(true);
    expect(ed.setsBox.classList.contains("is-edited")).toBe(false);
  });

  it("ignores empty, zero, and non-numeric input instead of corrupting the stored value", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    for (const bad of ["", "0", "-3", "abc"]) {
      ed.setsInput.value = bad;
      ed.setsInput.dispatchEvent(new Event("input"));
    }

    expect(ed.getPrescription("Push", "Bench Press").sets).toBe(4); // untouched
  });

  it("clamps a typed value past the input's own max to the stored prescription", () => {
    // Regression: a typed value (unlike a spinner click) isn't clamped by
    // the browser on its own -- sets-input has max="20", reps-input max="50".
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    ed.setsInput.value = "999";
    ed.setsInput.dispatchEvent(new Event("input"));
    expect(ed.getPrescription("Push", "Bench Press").sets).toBe(20); // clamped to max

    ed.repsInput.value = "500";
    ed.repsInput.dispatchEvent(new Event("input"));
    expect(ed.getPrescription("Push", "Bench Press").reps).toBe(50); // clamped to max
  });

  it("doesn't overwrite the visible input while typing, but snaps it to the clamped value on blur", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    ed.setsInput.value = "999";
    ed.setsInput.dispatchEvent(new Event("input"));
    expect(ed.setsInput.value).toBe("999"); // not fought mid-keystroke

    ed.setsInput.dispatchEvent(new Event("blur"));
    expect(ed.setsInput.value).toBe("20"); // corrected once the user leaves the field
  });
});

describe("exercise prescription editor — reset", () => {
  it("reset restores both values to standard and clears the edited state", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");
    ed.setsInput.value = "6";
    ed.setsInput.dispatchEvent(new Event("input"));
    ed.repsInput.value = "3";
    ed.repsInput.dispatchEvent(new Event("input"));
    expect(ed.setsBox.classList.contains("is-edited")).toBe(true);

    ed.resetBtn.click();

    expect(ed.setsInput.value).toBe("4");
    expect(ed.repsInput.value).toBe("8");
    expect(ed.getPrescription("Push", "Bench Press")).toEqual({ sets: 4, reps: 8 });
    expect(ed.setsBox.classList.contains("is-edited")).toBe(false);
    expect(ed.repsBox.classList.contains("is-edited")).toBe(false);
  });
});

describe("exercise prescription editor — close paths", () => {
  it("the close button hides the overlay and triggers a carousel re-render", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    ed.closeBtn.click();

    expect(ed.overlay.classList.contains("is-open")).toBe(false);
    expect(ed.calls.rerendered).toBe(true);
  });

  it("clicking the dimmed backdrop closes it, but clicking inside the modal does not", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    ed.title.click(); // inside the modal
    expect(ed.overlay.classList.contains("is-open")).toBe(true);

    ed.overlay.click(); // the overlay itself (the backdrop)
    expect(ed.overlay.classList.contains("is-open")).toBe(false);
  });

  it("Escape closes the editor only while it's open", () => {
    const ed = loadExercisePrescriptionEditor();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(ed.overlay.classList.contains("is-open")).toBe(false); // no-op, wasn't open

    ed.openExercisePrescriptionEditor("Push", "Bench Press");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(ed.overlay.classList.contains("is-open")).toBe(false);
  });
});

describe("exercise prescription editor — how to perform", () => {
  it("delegates to openExerciseDetailModal with the exercise currently open", () => {
    const ed = loadExercisePrescriptionEditor();
    ed.openExercisePrescriptionEditor("Push", "Bench Press");

    ed.howtoBtn.click();

    expect(ed.calls.howtoOpenedWith).toBe("Bench Press");
  });

  it("is a no-op if somehow clicked with no exercise open", () => {
    const ed = loadExercisePrescriptionEditor();
    expect(() => ed.howtoBtn.click()).not.toThrow();
    expect(ed.calls.howtoOpenedWith).toBeNull();
  });
});
