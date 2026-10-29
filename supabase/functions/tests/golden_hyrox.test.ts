/** The HYROX race analysis against answers the PYTHON code gave (scripts/edge_golden.py wrote them; a Python test fails if they go stale). */
import { assertEquals } from "@std/assert";

import { GEMINI_MODEL } from "../_shared/gemini.ts";
import { MAX_DETAIL_BULLETS, neutralTips, STATION_KEYS, VALID_RATINGS } from "../_shared/hyrox.ts";
import { HYROX_RUNNERS } from "./hyrox_runners.ts";

type Pair = [unknown, unknown];
const golden: Record<string, Pair[]> = JSON.parse(
  await new Response((await Deno.open(new URL("./fixtures/hyrox_golden.json.gz", import.meta.url))).readable.pipeThrough(new DecompressionStream("gzip"))).text(),
);

/** JSON has no -0 and no undefined: compare what would survive a round trip. */
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === 0 ? 0 : x)));

for (const name of Object.keys(HYROX_RUNNERS)) {
  Deno.test(`golden hyrox: ${name} (${golden[name].length} cases from the Python code)`, () => {
    for (const [i, [input, expected]] of golden[name].entries()) {
      assertEquals(clean(HYROX_RUNNERS[name](input)), clean(expected), `case ${i}: ${JSON.stringify(input)?.slice(0, 300)}`);
    }
  });
}

Deno.test("golden hyrox: the stations, ratings, limits and neutral tips are the Python's", () => {
  // deno-lint-ignore no-explicit-any
  const c = golden.constants[0][1] as Record<string, any>;
  assertEquals([...STATION_KEYS], c.stations);
  assertEquals([...VALID_RATINGS].sort(), c.ratings);
  assertEquals(MAX_DETAIL_BULLETS, c.bullets);
  assertEquals(GEMINI_MODEL, c.model);
  assertEquals(neutralTips(), c.neutral);
});
