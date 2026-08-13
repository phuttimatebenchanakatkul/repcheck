// Direct coverage for getSetsRepsBucket()/getSetsRepsText()/getSetsRepsDefault()
// (templates/workouts.html) -- ship's coverage audit flagged that both harnesses
// consuming these functions (loadReviewStep.js, loadExercisePrescriptionEditor.js)
// injected a simplified 2-branch stand-in instead of exercising the real 4-branch
// bucket chain, so the exact-match named-lift allowlist and the isolation-exercise
// branch had zero real coverage.
import { describe, expect, it } from "vitest";
import { loadSetsRepsBuckets } from "./support/loadSetsRepsBuckets.js";

const { getSetsRepsText, getSetsRepsDefault } = loadSetsRepsBuckets();

describe("getSetsRepsDefault / getSetsRepsText — bucket matching", () => {
  it("gives isolation exercises (lateral raise, rear delt, face pull, front raise) 3x12-15", () => {
    expect(getSetsRepsDefault("Lateral Raise")).toEqual({ sets: 3, reps: 12 });
    expect(getSetsRepsText("Lateral Raise")).toBe("3 sets • 12-15 reps");
    expect(getSetsRepsDefault("Rear Delt Fly")).toEqual({ sets: 3, reps: 12 });
  });

  it("gives smaller isolation movements (curl, extension, pushdown, ...) 3x10-12", () => {
    expect(getSetsRepsDefault("Bicep Curl")).toEqual({ sets: 3, reps: 10 });
    expect(getSetsRepsText("Tricep Pushdown")).toBe("3 sets • 10-12 reps");
    expect(getSetsRepsDefault("Calf Raise")).toEqual({ sets: 3, reps: 10 });
  });

  it("gives the exact named-lift allowlist 4x6-8, NOT the generic compound bucket's 4x8-10", () => {
    // Regression target: this exact-match branch is easy to accidentally
    // collapse into the broader press/squat/deadlift/row branch below it,
    // since both match "flat bench press".
    expect(getSetsRepsDefault("Flat Bench Press")).toEqual({ sets: 4, reps: 6 });
    expect(getSetsRepsText("Flat Bench Press")).toBe("4 sets • 6-8 reps");
    expect(getSetsRepsDefault("Deadlift")).toEqual({ sets: 4, reps: 6 });
  });

  it("gives a non-exact-match compound lift the generic 4x8-10 bucket, not the named allowlist", () => {
    // "Incline Bench Press" contains "press" but isn't in the exact-match
    // set, so it must fall through to the broader bucket.
    expect(getSetsRepsDefault("Incline Bench Press")).toEqual({ sets: 4, reps: 8 });
    expect(getSetsRepsText("Leg Press")).toBe("4 sets • 8-10 reps");
    expect(getSetsRepsDefault("Pull-Up")).toEqual({ sets: 4, reps: 8 });
  });

  it("falls back to 3x10-12 for an unrecognized custom exercise name", () => {
    expect(getSetsRepsDefault("Battle Ropes")).toEqual({ sets: 3, reps: 10 });
    expect(getSetsRepsText("My Custom Backyard Exercise")).toBe("3 sets • 10-12 reps");
  });

  it("matching is case-insensitive", () => {
    expect(getSetsRepsDefault("FLAT BENCH PRESS")).toEqual({ sets: 4, reps: 6 });
    expect(getSetsRepsDefault("lateral raise")).toEqual({ sets: 3, reps: 12 });
  });

  it("getSetsRepsText and getSetsRepsDefault always derive from the same bucket (can't desync)", () => {
    // The exact regression the shared-bucket refactor targets: text's sets
    // count and default's sets count, and text's repsLow and default's
    // reps, must always agree for every input -- they're now two views of
    // one lookup instead of two independently-maintained regex chains.
    const names = ["Lateral Raise", "Bicep Curl", "Flat Bench Press", "Leg Press", "Unrecognized Exercise"];
    for (const name of names) {
      const def = getSetsRepsDefault(name);
      const text = getSetsRepsText(name);
      expect(text.startsWith(`${def.sets} sets •`)).toBe(true);
      expect(text).toContain(`${def.reps}-`);
    }
  });
});
