// The analyze page's exercise picker is a substring search over exercise
// names, which on its own can't answer the two things people actually type:
// a plural ("curls") and a muscle group ("abs"). These cover the alias layer
// that fixes that -- see renderExerciseModalSearch() in templates/index.html.

import { describe, expect, it } from "vitest";
import { loadExerciseSearch } from "./support/loadExerciseSearch.js";

const CATEGORIES = {
  Chest: ["Flat Bench Press", "Push-Up"],
  Core: ["Plank", "Russian Twist", "Hanging Leg Raise"],
  Legs: ["Back Squat", "Walking Lunge"],
};

const { exSearchTerms, exSearchCategoryNames } = loadExerciseSearch(CATEGORIES);

// Mirrors the tiering inside renderExerciseModalSearch(): literal matches
// first, then alias substring matches, then whole-category hits.
function search(library, query) {
  const q = query.trim().toLowerCase();
  const terms = exSearchTerms(q);
  const exact = library.filter((name) => name.toLowerCase().includes(q));
  const aliased = library.filter((name) => terms.some((term) => name.toLowerCase().includes(term)));
  return Array.from(new Set([...exact, ...aliased, ...exSearchCategoryNames(terms)]));
}

describe("exercise picker search aliases", () => {
  it("strips a trailing plural so 'curls' finds 'Bicep Curl'", () => {
    expect(exSearchTerms("curls")).toContain("curl");
    expect(search(["Bicep Curl", "Hammer Curl", "Plank"], "curls")).toEqual([
      "Bicep Curl",
      "Hammer Curl",
    ]);
  });

  it("does not strip an 's' that is part of a short word", () => {
    // "dips" is long enough to depluralize; "abs" is not -- it is handled by
    // the category alias instead, and stripping it would search for "ab".
    expect(exSearchTerms("dips")).toContain("dip");
    expect(exSearchTerms("abs")).not.toContain("ab");
  });

  it("maps a muscle-group query to that whole category", () => {
    expect(search(["Flat Bench Press"], "abs")).toEqual([
      "Plank",
      "Russian Twist",
      "Hanging Leg Raise",
    ]);
    expect(search([], "quads")).toContain("Back Squat");
  });

  it("finds movements filed under a different common name", () => {
    const library = ["Landmine Rotation", "Low-to-High Cable Chop", "Bicep Curl"];
    const results = search(library, "twist");
    expect(results).toContain("Landmine Rotation");
    expect(results).toContain("Low-to-High Cable Chop");
    expect(results).not.toContain("Bicep Curl");
  });

  it("ranks the literal match above the looser alias hits", () => {
    const library = ["Landmine Rotation", "Russian Twist"];
    expect(search(library, "twist")[0]).toBe("Russian Twist");
  });

  it("leaves an ordinary query alone", () => {
    expect(exSearchTerms("squat")).toEqual(["squat"]);
    expect(exSearchCategoryNames(["squat"])).toEqual([]);
  });

  it("lists a name once when it matches on more than one tier", () => {
    // "Russian Twist" is both a literal match and a member of the Core
    // category that "twist" pulls in -- it must not render twice.
    const results = search(["Russian Twist"], "twist");
    expect(results.filter((name) => name === "Russian Twist")).toHaveLength(1);
  });
});
