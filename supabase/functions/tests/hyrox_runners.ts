/** One function per kind of case in the HYROX golden file (scripts/edge_golden.py): used by golden_hyrox.test.ts against the Python's answers
 *  and by parity_more.check.ts for tests/test_edge_functions.py, which runs the same inputs through both languages side by side. */
import { clock, coerceBullets, coerceResult, buildPrompt } from "../_shared/hyrox.ts";
import { pyTitle } from "../_shared/pyText.ts";

const orErr = (fn: () => unknown): unknown => {
  try {
    return fn();
  } catch {
    return "ERR";
  }
};

// deno-lint-ignore no-explicit-any
export const HYROX_RUNNERS: Record<string, (input: any) => unknown> = {
  prompts: (race: Record<string, unknown>) => orErr(() => buildPrompt(race)),
  coerced: (text: string) => coerceResult(text),
  bullets: (value: unknown) => coerceBullets(value),
  clocks: (value: unknown) => orErr(() => clock(value)),
  titles: (text: string) => pyTitle(text),
};
