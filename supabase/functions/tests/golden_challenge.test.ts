/** The challenge-clip rep counter against answers the PYTHON code gave (scripts/edge_golden.py wrote them; a Python test fails if they go stale). */
import { assertEquals } from "@std/assert";

import { CHALLENGE_LABELS, CHALLENGE_NUMBERS, CHALLENGE_PROMPTS } from "../_shared/challengeData.ts";
import { parseResponse, RepCountFailure } from "../_shared/challengeClip.ts";
import { MAX_UPLOAD_BYTES } from "../_shared/analyze.ts";
import { CLIP_BODY_LIMIT } from "../api/routes/social.ts";

type Pair = [unknown, unknown];
const golden: Record<string, Pair[]> = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/challenge_golden.json", import.meta.url)));
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === 0 ? 0 : x)));

Deno.test(`golden challenge: the model's answer is read as the Python reads it (${golden.parse.length} answers)`, () => {
  for (const [i, [text, expected]] of golden.parse.entries()) {
    let got: unknown;
    try {
      got = ["ok", parseResponse(text as string)];
    } catch (e) {
      if (!(e instanceof RepCountFailure)) throw e;
      got = ["error", e.message];
    }
    assertEquals(clean(got), clean(expected), `case ${i}: ${JSON.stringify(text).slice(0, 300)}`);
  }
});

Deno.test("golden challenge: the instructions are byte for byte the Python's, and the numbers and words are shared", () => {
  for (const [key, [, full]] of golden.prompts as [string, [string, string]][]) assertEquals(CHALLENGE_PROMPTS[key], full, key);
  assertEquals(Object.keys(CHALLENGE_PROMPTS), (golden.prompts as [string, unknown][]).map(([k]) => k));
  // deno-lint-ignore no-explicit-any
  const c = (golden.constants[0] as any)[1];
  assertEquals(CHALLENGE_LABELS, c.labels);
  assertEquals([CHALLENGE_NUMBERS.GEMINI_MODEL, CHALLENGE_NUMBERS.SAMPLE_FPS, CHALLENGE_NUMBERS.MAX_SAFETY_BLOCK_RETRIES], [c.model, c.fps, c.retries]);
  // the ceiling itself differs on purpose (80 MB here, 300 on the website); how the route derives its body limit from it does not
  assertEquals(CLIP_BODY_LIMIT === MAX_UPLOAD_BYTES + 1024 * 1024, c.clip_body_is_upload_plus_a_megabyte);
});
