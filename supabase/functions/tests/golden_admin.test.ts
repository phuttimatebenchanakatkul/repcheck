/** The owner's side against answers the PYTHON code gave (scripts/edge_golden.py wrote them; a Python test fails if they go stale). */
import { assertEquals } from "@std/assert";

import { FEATURE_LABELS, MAX_SOURCE, MODERATED_DISPLAY_NAME, PAGE_LABELS, RANGES, REPORT_PAGE_LIMIT, WAITLIST_LIMIT, WAITLIST_ORIGINS, WAITLIST_WINDOW } from "../_shared/admin.ts";
import { ADMIN_RUNNERS } from "./admin_runners.ts";

type Pair = [unknown, unknown];
const golden: Record<string, Pair[]> = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/admin_golden.json", import.meta.url)));
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === 0 ? 0 : x)));

for (const name of Object.keys(ADMIN_RUNNERS)) {
  Deno.test(`golden admin: ${name} (${golden[name].length} cases from the Python code)`, () => {
    for (const [i, [input, expected]] of golden[name].entries()) {
      assertEquals(clean(ADMIN_RUNNERS[name](input)), clean(expected), `case ${i}: ${JSON.stringify(input)?.slice(0, 300)}`);
    }
  });
}

Deno.test("golden admin: the ranges, labels and waitlist limits are the Python's", () => {
  // deno-lint-ignore no-explicit-any
  const c = golden.constants[0][1] as Record<string, any>;
  assertEquals([...RANGES], c.ranges);
  assertEquals([MODERATED_DISPLAY_NAME, REPORT_PAGE_LIMIT, [WAITLIST_LIMIT, WAITLIST_WINDOW, MAX_SOURCE]], [c.moderated, c.page_limit, c.waitlist]);
  assertEquals([...WAITLIST_ORIGINS].sort(), c.origins);
  assertEquals(clean(PAGE_LABELS), c.pages);
  assertEquals(clean(FEATURE_LABELS), c.features);
});
