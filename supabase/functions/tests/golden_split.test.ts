/** The split generator against answers the PYTHON code gave (scripts/edge_golden.py wrote them; a Python test fails if they go stale),
 *  so these checks run offline, in `deno task test`, with no Python in the loop. */
import { assertEquals } from "@std/assert";

import { MAX_CUSTOM_DAYS, MAX_GOAL_CHARS, SPLIT_TYPES } from "../api/routes/planning.ts";
import { GEMINI_MODEL } from "../_shared/gemini.ts";
import {
  BEGINNER_EXERCISE_RANGE_BY_DAYS,
  BEGINNER_MAX_EXERCISES,
  BEGINNER_MIN_EXERCISES,
  BEGINNER_SPLIT_BY_DAYS,
  DAY_TYPE_POOLS,
  DAY_TYPE_WIDE_POOLS,
  DEFAULT_TRAIN_PATTERNS,
  GOAL_KEYWORD_MAP,
  KEYWORD_POOL,
  LOCATION_ALLOWED,
  MAX_ACCEPTABLE_STREAK,
  MAX_GOAL_DAY_TYPES,
  SPLIT_DAY_TYPES,
  SUGGEST_GEMINI_MODEL,
  SUGGEST_RESPONSE_SCHEMA,
  SUGGESTIBLE_SPLIT_TYPES,
  WEEKDAY_ORDER,
} from "../_shared/splitPlanner.ts";
import { RUNNERS } from "./split_runners.ts";

type Pair = [unknown, unknown];
const golden: Record<string, Pair[]> = JSON.parse(
  await new Response((await Deno.open(new URL("./fixtures/split_golden.json.gz", import.meta.url))).readable.pipeThrough(new DecompressionStream("gzip"))).text(),
);

/** JSON has no -0 and no undefined: compare what would survive a round trip. */
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === 0 ? 0 : x)));

for (const name of Object.keys(RUNNERS)) {
  Deno.test(`golden: ${name} (${golden[name].length} cases from the Python code)`, async () => {
    for (const [i, [input, expected]] of golden[name].entries()) {
      const got = await RUNNERS[name](input);
      // a prompt is kept as a hash and a length (the Python side also keeps the text of every 40th, for a person to read)
      const want = expected !== null && typeof expected === "object" && "sha256" in expected ? { sha256: (expected as any).sha256, chars: (expected as any).chars } : expected;
      assertEquals(clean(got), clean(want), `case ${i}: ${JSON.stringify(input).slice(0, 300)}`);
    }
  });
}

const upperTypes = (schema: unknown): unknown =>
  Array.isArray(schema)
    ? schema.map(upperTypes)
    : schema !== null && typeof schema === "object"
    ? Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toUpperCase() : upperTypes(v)]))
    : schema;

Deno.test("golden: the library, the pools, the keywords, the patterns and the limits are the Python's", () => {
  const c = golden.constants[0][1] as Record<string, any>;
  assertEquals(clean(DAY_TYPE_POOLS), c.dayTypePools);
  assertEquals(clean(DAY_TYPE_WIDE_POOLS), c.wide);
  assertEquals(clean(SPLIT_DAY_TYPES), c.splitDayTypes);
  assertEquals(clean(KEYWORD_POOL), c.keywordPool);
  assertEquals(clean(GOAL_KEYWORD_MAP), c.goalKeywords);
  assertEquals(clean(DEFAULT_TRAIN_PATTERNS), c.patterns);
  assertEquals(Object.fromEntries(Object.entries(LOCATION_ALLOWED).map(([k, v]) => [k, [...v].sort()])), c.locationAllowed);
  assertEquals(clean(BEGINNER_EXERCISE_RANGE_BY_DAYS), c.beginnerRanges);
  assertEquals(clean(BEGINNER_SPLIT_BY_DAYS), c.beginnerSplits);
  assertEquals([...SUGGESTIBLE_SPLIT_TYPES], c.suggestible);
  assertEquals(MAX_GOAL_DAY_TYPES, c.maxGoal);
  assertEquals(MAX_ACCEPTABLE_STREAK, c.maxStreak);
  assertEquals(SUGGEST_GEMINI_MODEL, c.suggestModel);
  assertEquals(GEMINI_MODEL, c.model);
  assertEquals(BEGINNER_MIN_EXERCISES, c.beginnerMin);
  assertEquals(BEGINNER_MAX_EXERCISES, c.beginnerMax);
  assertEquals([...WEEKDAY_ORDER], c.weekdays);
  assertEquals(clean(SUGGEST_RESPONSE_SCHEMA), upperTypes(c.schema));
  assertEquals(MAX_CUSTOM_DAYS, c.routeLimits.customDays);
  assertEquals(MAX_GOAL_CHARS, c.routeLimits.goalChars);
  assertEquals([...SPLIT_TYPES].sort(), c.routeLimits.splitTypes);
});
