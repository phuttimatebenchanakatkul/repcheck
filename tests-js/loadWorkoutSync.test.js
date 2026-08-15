// Guards that the extraction itself stays honest. If templates/workouts.html
// changes shape enough that the markers no longer find their targets,
// workoutSync.test.js would silently test stale or empty code without this
// -- so it fails loudly and specifically instead.
import { describe, expect, it } from "vitest";
import { extractSource } from "./support/loadWorkoutSync.js";

describe("extractSource (workout sync)", () => {
  it("finds loadLog, the sync functions, and saveLog", () => {
    const source = extractSource();
    expect(source).toContain("function loadLog()");
    expect(source).toContain("function pushWorkoutDay(dateIso, attempt = 0)");
    expect(source).toContain("function scheduleWorkoutDaySync(dateIso)");
    expect(source).toContain("function saveLog(dateIso)");
    expect(source).toContain("workoutDaySyncTimers");
  });
});
