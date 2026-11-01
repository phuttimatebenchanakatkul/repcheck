/** The form grader against answers the PYTHON code gave (scripts/edge_golden.py wrote them; a Python test fails if they go stale). */
import { assert, assertEquals } from "@std/assert";

import * as analyze from "../_shared/analyze.ts";
import { EXERCISES, FORM_NUMBERS } from "../_shared/analyzeData.ts";
import { buildPrompt, parseScores, PY_CLASSES, resolveExercise, stripScoreLines } from "../_shared/analyzeForm.ts";
import { splitFeedbackSections } from "../_shared/feedback.ts";
import { limitMessage, RATE_LIMITS } from "../_shared/limits.ts";
import { SIGNED_URL_SECONDS } from "../api/routes/analyze.ts";

type Pair = [unknown, unknown];
const golden: Record<string, Pair[]> = JSON.parse(
  await new Response((await Deno.open(new URL("./fixtures/analyze_golden.json.gz", import.meta.url))).readable.pipeThrough(new DecompressionStream("gzip"))).text(),
);

const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === 0 ? 0 : x)));

Deno.test(`golden analyze: the model's markdown becomes the same sections (${golden.sections.length} replies from the Python code)`, () => {
  for (const [i, [input, expected]] of golden.sections.entries()) {
    const [doc, score] = input as [string, number | null];
    assertEquals(clean(splitFeedbackSections(doc, score)), clean(expected), `case ${i}: ${JSON.stringify(doc).slice(0, 400)} @ ${score}`);
  }
});

Deno.test(`golden analyze: scores are read, and score lines removed, as the Python does (${golden.scores.length} replies)`, () => {
  for (const [i, [text, expected]] of golden.scores.entries()) {
    const s = parseScores(text as string);
    assertEquals(clean([[s.stretch, s.squeeze, s.overall, s.favored, s.reps], stripScoreLines(text as string)]), clean(expected), `case ${i}: ${JSON.stringify(text).slice(0, 300)}`);
  }
});

Deno.test(`golden analyze: a name is the same exercise (${golden.exercises.length} names)`, () => {
  for (const [i, [name, expected]] of golden.exercises.entries()) {
    const c = resolveExercise(name as string);
    assertEquals(clean([c.label, c.secondary_notes, c.research_notes ?? null]), clean(expected), `case ${i}: ${JSON.stringify(name)}`);
  }
});

Deno.test(`golden analyze: the prompt is byte for byte the Python's for every exercise and clip length (${golden.prompts.length} prompts)`, async () => {
  let whole = 0;
  for (const [i, [input, expected]] of golden.prompts.entries()) {
    const [name, duration] = input as [string, number];
    const text = buildPrompt(resolveExercise(name), duration);
    const [hash, full] = expected as [string, string | null];
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (full !== null) {
      assertEquals(text, full, `case ${i}`);
      whole++;
    }
    assertEquals(digest, hash, `case ${i}: ${JSON.stringify(input)}`);
  }
  assert(whole >= 10, "the full texts were compared too");
});

Deno.test(`golden analyze: the exercise and the file name are accepted or refused with the same words (${golden.names.length} inputs)`, () => {
  for (const [i, [input, expected]] of golden.names.entries()) {
    const [kind, value] = input as [string, unknown];
    let got: unknown;
    try {
      got = ["ok", kind === "exercise" ? analyze.cleanExercise(value) : analyze.checkSuffix(value as string)];
    } catch (e) {
      if (!(e instanceof analyze.AnalyzeRejected)) throw e;
      got = ["error", e.message];
    }
    assertEquals(got, expected, `case ${i}: ${JSON.stringify(input)}`);
  }
});

Deno.test("golden analyze: the text patterns mean what Python's \\s, \\d and \\w mean, for every code point", () => {
  const mine: Record<string, string> = { "\\s": PY_CLASSES.space, "\\d": `[${PY_CLASSES.digits}]`, "\\w": PY_CLASSES.word };
  for (const [pattern, ranges] of golden.classes as [string, number[][]][]) {
    const re = new RegExp(`^${mine[pattern]}$`, "u");
    let at = 0;
    for (let cp = 0; cp < 0x110000; cp++) {
      if (cp >= 0xD800 && cp <= 0xDFFF) continue;
      while (at < ranges.length && ranges[at][1] < cp) at++;
      const python = at < ranges.length && ranges[at][0] <= cp;
      if (re.test(String.fromCodePoint(cp)) !== python) throw new Error(`${pattern} differs at U+${cp.toString(16)}: Python ${python}`);
    }
  }
});

Deno.test("golden analyze: the numbers and words the routes and the limits share are the Python's", () => {
  // deno-lint-ignore no-explicit-any
  const c = (golden.constants[0] as any)[1];
  assertEquals([analyze.HISTORY_KEEP, analyze.MAX_EXERCISE_LENGTH, analyze.FEATURE, analyze.BUCKET, analyze.MAX_CLIP_BYTES, SIGNED_URL_SECONDS], [c.history_keep, c.max_exercise, c.feature, c.bucket, c.max_clip, c.signed_seconds]);
  assertEquals([...analyze.ALLOWED_EXTENSIONS], c.allowed);
  assertEquals([...analyze.RECORDED_EXTENSIONS], c.recorded);
  assertEquals(analyze.CONTENT_TYPES, c.content_types);
  assertEquals([...RATE_LIMITS.workout_analysis], c.limit);
  assertEquals([1, 59, 60, 3599, 3600, 86399, 86400].map((s) => limitMessage("workout_analysis", s)), c.messages);
  assertEquals(Object.keys(EXERCISES).length, 14);
  assertEquals(FORM_NUMBERS.GEMINI_MODEL.startsWith("gemini-"), true);
});
