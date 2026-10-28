/** One function per kind of case in the split generator's golden file (scripts/edge_golden.py), used twice: by golden_split.test.ts against the
 *  answers the Python gave, and by parity_more.check.ts for tests/test_edge_functions.py, which runs the same inputs through Python and this side by side. */
import { customDaysOf, handPicked, optionalPositiveFloat } from "../api/routes/planning.ts";
import {
  buildFallbackPlan,
  buildPrompt,
  buildSuggestPrompt,
  beginnerFallback,
  describeLifter,
  extractJson,
  longestTrainingStreak,
  type PickedExercises,
  validatePlan,
} from "../_shared/splitPlanner.ts";

type Pairs = [string, string[]][] | null;
const picked = (pairs: Pairs): PickedExercises | null => (pairs === null ? null : new Map(pairs));

/** A prompt is compared by its SHA-256 and length (it carries the whole exercise list); the Python side keeps the text of every 40th for a readable failure. */
export async function digestOf(text: string): Promise<{ sha256: string; chars: number }> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return { sha256: [...hash].map((b) => b.toString(16).padStart(2, "0")).join(""), chars: [...text].length };
}

type Fallback = [string, number, string[] | null, string | null, Pairs, string | null];
type Validate = [unknown, number, Pairs, string | null, { min_exercises?: number; max_exercises?: number; top_up_short_days?: boolean } | null];

export const RUNNERS: Record<string, (input: any) => unknown | Promise<unknown>> = {
  fallback: ([split, days, custom, goal, pairs, location]: Fallback) => buildFallbackPlan(split, days, custom, goal, picked(pairs), location),
  prompts: async ([split, days, custom, goal, pairs, location]: Fallback) => await digestOf(buildPrompt(split, days, custom, goal, picked(pairs), location)),
  suggestPrompts: async ([days, goal, gender, goalWeight, currentWeight, location]: [number, string | null, string | null, number | null, number | null, string | null]) =>
    await digestOf(buildSuggestPrompt(days, goal, gender, goalWeight, currentWeight, location)),
  lifters: ([gender, goalWeight, currentWeight]: [string | null, number | null, number | null]) => describeLifter(gender, goalWeight, currentWeight),
  beginner: ([split, days, goal, location]: [string, number, string | null, string | null]) => beginnerFallback(split, days, goal, location),
  validate: ([parsed, days, pairs, location, options]: Validate) => {
    try {
      return validatePlan(parsed, days, picked(pairs), location, options ? { minExercises: options.min_exercises, maxExercises: options.max_exercises, topUpShortDays: options.top_up_short_days } : {});
    } catch {
      return "ERR";
    }
  },
  streaks: (schedule: Record<string, string>) => longestTrainingStreak(schedule),
  extracted: (text: string) => {
    try {
      return { ok: extractJson(text) };
    } catch {
      return "ERR";
    }
  },
  floats: (value: unknown) => optionalPositiveFloat(value),
  customDays: (value: unknown) => customDaysOf(value),
  handPicked: (value: unknown) => {
    const result = handPicked(value);
    return result === null ? null : [...result.entries()];
  },
};
