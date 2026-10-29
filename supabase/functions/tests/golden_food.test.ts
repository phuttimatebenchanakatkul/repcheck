/** The food code against answers the PYTHON code gave (scripts/edge_golden_food.py wrote them; a Python test fails if they go stale). */
import { assertEquals } from "@std/assert";

import { FATSECRET_BARCODE_URL, FATSECRET_FOOD_URL, FATSECRET_TOKEN_URL, MAX_INGREDIENTS } from "../_shared/foodData.ts";
import * as foods from "../_shared/foods.ts";
import { FOOD_RUNNERS } from "./food_runners.ts";

type Pair = [unknown, unknown];
const golden: Record<string, Pair[]> = JSON.parse(
  await new Response((await Deno.open(new URL("./fixtures/food_golden.json.gz", import.meta.url))).readable.pipeThrough(new DecompressionStream("gzip"))).text(),
);

/** JSON has no -0 and no undefined: compare what would survive a round trip. */
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === 0 ? 0 : x)));

for (const name of Object.keys(FOOD_RUNNERS)) {
  Deno.test(`golden food: ${name} (${golden[name].length} cases from the Python code)`, async () => {
    for (const [i, [input, expected]] of golden[name].entries()) {
      assertEquals(clean(await FOOD_RUNNERS[name](input)), clean(expected), `case ${i}: ${JSON.stringify(input)?.slice(0, 400)}`);
    }
  });
}

Deno.test("golden food: the limits, defaults and addresses are the Python's", () => {
  // deno-lint-ignore no-explicit-any
  const c = golden.constants[0][1] as Record<string, any>;
  assertEquals([foods.FOOD_LIMIT, foods.EXERCISE_LIMIT, foods.MAX_NAME, foods.MAX_EMOJI, foods.MAX_LABEL, foods.MAX_BARCODE, foods.MAX_EXTRA_SERVINGS, foods.MAX_MACRO_GRAMS, foods.MAX_SERVING_GRAMS], c.food);
  assertEquals([foods.DEFAULT_FOOD_NAME, foods.DEFAULT_FOOD_EMOJI, [...foods.EXERCISE_MODES]], c.defaults);
  assertEquals(MAX_INGREDIENTS, c.ingredients);
  assertEquals([FATSECRET_TOKEN_URL, FATSECRET_BARCODE_URL, FATSECRET_FOOD_URL], c.token);
});
