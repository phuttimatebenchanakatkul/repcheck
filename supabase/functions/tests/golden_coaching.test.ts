/** The coaching code against answers the PYTHON code gave (scripts/edge_golden.py wrote them; a Python test fails if they go stale),
 *  so these checks run offline, in `deno task test`, with no Python in the loop. */
import { assertEquals } from "@std/assert";

import { buildPrompt, extractJson } from "../_shared/checkin.ts";
import { validateProfile } from "../_shared/coaching.ts";
import { type Adjustment, applyCalorieDelta, BadCheckin, calculateTargets, distributeWeeklyCalories, type Profile, type Targets, weeklyAdjustment } from "../_shared/coachingEngine.ts";
import { pyInt, pyRound, pyRound2 } from "../_shared/pyNumbers.ts";

type Pair<I, O> = [I, O];
const golden: Record<string, Pair<unknown, unknown>[]> = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/coaching_golden.json", import.meta.url)));

/** JSON has no -0, and Python's int(-0.0) is 0: compare numbers without the sign of zero. */
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === 0 ? 0 : x)));

function all<I, O>(name: string, run: (input: I) => unknown) {
  Deno.test(`golden: ${name} (${golden[name].length} cases from the Python code)`, () => {
    for (const [i, [input, expected]] of golden[name].entries()) {
      assertEquals(clean(run(input as I)), clean(expected), `case ${i}: ${JSON.stringify(input).slice(0, 300)}`);
    }
  });
}

all<Record<string, unknown>, unknown>("profiles", (payload) => validateProfile(payload));
all<Profile, unknown>("targets", (profile) => calculateTargets(profile));
all<[Targets & { fat: number; carbs: number }, string[]], unknown>("distributions", ([t, days]) => distributeWeeklyCalories(t.calories, t.protein, t.fat, t.carbs, new Set(days)));
all<[Profile, Targets, Record<string, unknown>[], Record<string, unknown>[]], unknown>("weekly", ([p, cur, weights, days]) => {
  try {
    return weeklyAdjustment(p, cur, weights, days);
  } catch (e) {
    if (!(e instanceof BadCheckin)) throw e;
    return "ERR";
  }
});
all<[Profile, Targets, number, string], unknown>("applied", ([p, cur, delta, reason]) => {
  try {
    return applyCalorieDelta(p, cur, delta, reason);
  } catch (e) {
    if (!(e instanceof BadCheckin)) throw e;
    return "ERR";
  }
});
all<[Profile, Targets | null, Record<string, unknown>[], Record<string, unknown>[], Adjustment | null, boolean, boolean], unknown>("prompts", ([p, cur, weights, days, baseline, front, back]) =>
  buildPrompt(p, cur, weights, days, baseline, front, back)
);
all<string, unknown>("extracted", (text) => {
  try {
    return { ok: extractJson(text) };
  } catch {
    return "ERR";
  }
});
all<number, unknown>("rounds", (x) => [pyRound(x), pyRound2(x)]);
all<unknown, unknown>("ints", (v) => {
  const n = pyInt(v);
  return Number.isNaN(n) ? "ERR" : n;
});
