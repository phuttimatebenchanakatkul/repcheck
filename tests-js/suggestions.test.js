// The food and workout log search sheets open on suggestions, and the
// promise behind them is that NOTHING is invented: every food and exercise
// offered is one the user has logged before. These tests pin that down --
// the "no history means no suggestions" case above all, since that is the
// one a well-meaning fallback would quietly break by inventing picks.
//
// Exercises the real static/suggestions.js (see support/loadSuggestions.js),
// which templates/nutrition.html and templates/workouts.html call into.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadSuggestions, atHour } from "./support/loadSuggestions.js";

// Local noon, so a timestamp converted back to a calendar date can't slip a
// day in either direction whatever timezone the test machine is in.
const NOW = new Date(2026, 7, 16, 12, 0, 0);
const TODAY = "2026-08-16";
const YESTERDAY = "2026-08-15";
const TWO_DAYS_AGO = "2026-08-14";

const food = (name, offset, hour) => ({ food: name, addedAt: atHour(NOW, offset, hour) });
const exercise = (name, offset, hour) => ({ exercise: name, addedAt: atHour(NOW, offset, hour) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("broken storage", () => {
  it("survives missing and corrupt storage", () => {
    const s = loadSuggestions({ repcheck_nutrition_log_v1: "{not json" });
    expect(s.recentFoods(3)).toEqual([]);
    expect(s.topPicksForHour(12, 3)).toEqual([]);
    expect(s.recentExercises(3)).toEqual([]);
  });
});

describe("nothing is invented", () => {
  it("suggests no food at all for a user who has never logged food", () => {
    const s = loadSuggestions({});
    expect(s.topPicksForHour(12, 3)).toEqual([]);
    expect(s.recentFoods(3)).toEqual([]);
  });

  it("suggests no exercise at all for a user who has never logged one", () => {
    const s = loadSuggestions({});
    expect(s.recentExercises(3)).toEqual([]);
  });

  it("only ever returns names the user actually logged", () => {
    const s = loadSuggestions({
      repcheck_nutrition_log_v1: { [YESTERDAY]: [food("Pad Thai", -1, 12)] },
      repcheck_workout_log_v2: { [YESTERDAY]: [exercise("Deadlift", -1, 18)] },
    });
    expect(s.recentFoods(3)).toEqual(["Pad Thai"]);
    expect(s.recentExercises(3)).toEqual(["Deadlift"]);
  });
});

describe("this hour's top picks", () => {
  it("needs the food on two different days near the hour before suggesting it", () => {
    const oneDayOnly = loadSuggestions({
      repcheck_nutrition_log_v1: { [YESTERDAY]: [food("Coffee", -1, 8)] },
    });
    expect(oneDayOnly.topPicksForHour(8, 5)).toEqual([]);

    const twoDays = loadSuggestions({
      repcheck_nutrition_log_v1: {
        [YESTERDAY]: [food("Coffee", -1, 8)],
        [TWO_DAYS_AGO]: [food("Coffee", -2, 8)],
      },
    });
    expect(twoDays.topPicksForHour(8, 5)).toEqual(["Coffee"]);
  });

  it("counts an hour either side, so 7:50 and 8:15 are the same habit", () => {
    const s = loadSuggestions({
      repcheck_nutrition_log_v1: {
        [YESTERDAY]: [{ food: "Coffee", addedAt: atHour(NOW, -1, 7, 50) }],
        [TWO_DAYS_AGO]: [{ food: "Coffee", addedAt: atHour(NOW, -2, 8, 15) }],
      },
    });
    expect(s.topPicksForHour(8, 5)).toEqual(["Coffee"]);
    expect(s.topPicksForHour(15, 5)).toEqual([]); // and not at an unrelated hour
  });

  it("ranks by how many distinct days the food recurs on", () => {
    const s = loadSuggestions({
      repcheck_nutrition_log_v1: {
        [TODAY]: [food("Eggs", 0, 8)],
        [YESTERDAY]: [food("Eggs", -1, 8), food("Toast", -1, 8)],
        [TWO_DAYS_AGO]: [food("Eggs", -2, 8), food("Toast", -2, 8)],
      },
    });
    expect(s.topPicksForHour(8, 5)).toEqual(["Eggs", "Toast"]);
  });
});

describe("recent lists", () => {
  it("returns distinct names, most recently logged first", () => {
    const s = loadSuggestions({
      repcheck_workout_log_v2: {
        [TODAY]: [exercise("Bench Press", 0, 9)],
        [YESTERDAY]: [exercise("Squat", -1, 18), exercise("Bench Press", -1, 17)],
      },
    });
    expect(s.recentExercises(5)).toEqual(["Bench Press", "Squat"]);
  });

  it("reads a caller-supplied log instead of storage when given one", () => {
    // How templates/nutrition.html and templates/workouts.html call in --
    // their in-memory log is ahead of localStorage mid-session.
    const s = loadSuggestions({ repcheck_workout_log_v2: { [YESTERDAY]: [exercise("Stale", -1, 9)] } });
    const live = { [TODAY]: [exercise("Fresh", 0, 9)] };
    expect(s.recentExercises(5, live)).toEqual(["Fresh"]);
  });
});
