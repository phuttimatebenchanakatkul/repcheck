/** Counting the reps in a challenge clip: the website's `rep_form_analyzer.py` and `video_trimmer.py` on the Edge runtime.
 *
 * As with the lift grader (analyzeForm.ts), there is no ffmpeg to cut the clip, so Gemini is given the whole upload and told to look at the
 * first 25 seconds (the old trimmer also shrank it to 480p at 15 frames a second; Gemini is asked for 15 a second here too). The instructions
 * for each exercise are generated from the Python (challengeData.ts); the reading of the answer, the three tries and the words the person
 * is told are the Python's. One difference: the whole thing is held to one time budget (the website had none), because a function has a
 * wall-clock limit and the model this uses can be slow.
 */
import { CHALLENGE_LABELS, CHALLENGE_NUMBERS as N, CHALLENGE_PROMPTS } from "./challengeData.ts";
import { PY_CLASSES, realClock, type Clock } from "./analyzeForm.ts";
import { videoMimeType } from "./analyzeForm.ts";
import { GeminiError, GeminiFileRejected, type Gemini, type GeminiFile } from "./gemini.ts";
import { pyStrip } from "./nameFilter.ts";
import { asciiDigits } from "./pyNumbers.ts";

/** The message is safe to show the person. */
export class RepCountFailure extends Error {}

export const UPLOAD_SECONDS = 45;
/** How long the model gets for the whole count, all tries included. */
export const COUNT_BUDGET_SECONDS = 75;
/** Don't start another try with less than this left. */
export const MIN_TRY_SECONDS = 12;

const BUSY = "The rep counter is busy right now (high demand). Please wait a moment and record again.";
/** API answers worth another try: the model was overloaded for a moment, or a short rate-limit spike (the website's list). */
const TRANSIENT = new Set([429, 500, 503]);

export const isChallengeExercise = (exercise: string): boolean => Object.hasOwn(CHALLENGE_LABELS, exercise);

const SPACE = PY_CLASSES.space;
const DIGITS = PY_CLASSES.digits;
const lastOf = (re: RegExp, text: string): RegExpExecArray | null => {
  let found: RegExpExecArray | null = null;
  for (const m of text.matchAll(re)) found = m;
  return found;
};

export interface RepCount {
  reps: number;
  rejected: number;
  notes: string;
}

/** `_parse_response`: REPS / REJECTED / NOTES are the last three lines asked for, so the LAST match of each counts. */
export function parseResponse(text: string): RepCount {
  const reps = lastOf(new RegExp(`REPS:${SPACE}*(${DIGITS}+)`, "gu"), text);
  if (!reps) throw new RepCountFailure("Couldn't count reps from the video. Please try a clearer recording.");
  const rejected = lastOf(new RegExp(`REJECTED:${SPACE}*(${DIGITS}+)`, "gu"), text);
  const notes = lastOf(new RegExp(`NOTES:${SPACE}*([^\\n]+)`, "gu"), text);
  return {
    reps: Number(asciiDigits(reps[1])),
    rejected: rejected ? Number(asciiDigits(rejected[1])) : 0,
    notes: notes ? pyStrip(notes[1]) : "",
  };
}

export interface CountOptions {
  clock?: Clock;
  /** The model; the code's default is the website's. */
  model?: string;
  budgetSeconds?: number;
  uploadSeconds?: number;
  /** For tests and the side-by-side run. */
  onModel?: (info: { prompt: string; raw: string }) => void;
}

/** The model's answer to the instructions: up to three tries, a short pause after a busy answer or an empty one. */
async function ask(gemini: Gemini, file: GeminiFile, prompt: string, clock: Clock, budgetSeconds: number, model: string): Promise<string> {
  const started = clock.now();
  const left = () => budgetSeconds - (clock.now() - started) / 1000;
  for (let attempt = 0; attempt <= N.MAX_SAFETY_BLOCK_RETRIES; attempt++) {
    const remaining = left();
    if (remaining < MIN_TRY_SECONDS) throw new RepCountFailure(BUSY);
    let text: string | null;
    try {
      text = await gemini.generate({
        model,
        contents: [{ role: "user", videos: [{ fileUri: file.uri, mimeType: file.mimeType, startOffset: "0s", endOffset: `${N.CHALLENGE_SECONDS}s`, fps: N.SAMPLE_FPS }], text: prompt }],
        temperature: 0,
        attempts: 1, // the tries are counted here
        timeoutMs: Math.floor(remaining * 1000),
      });
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      // a transient answer, or the model not answering in time, clears in a second or two; anything else will not fix itself
      const transient = e.status === undefined ? /timeout/i.test(`${e.name} ${e.message}`) : TRANSIENT.has(e.status);
      if (transient && attempt < N.MAX_SAFETY_BLOCK_RETRIES) {
        await clock.sleep(2000 * (attempt + 1));
        continue;
      }
      if (transient) throw new RepCountFailure(BUSY);
      console.warn("Gemini error during rep count:", e.message);
      throw new RepCountFailure("An error has occurred. Please record again.");
    }
    if (text) return text;
    // empty + a block is flaky on ordinary footage: try again before giving up
    if (attempt < N.MAX_SAFETY_BLOCK_RETRIES) await clock.sleep(2000);
  }
  return "";
}

/** Count the valid reps in one clip. Throws RepCountFailure. */
export async function countReps(gemini: Gemini, data: Uint8Array, suffix: string, exercise: string, options: CountOptions = {}): Promise<RepCount> {
  if (!isChallengeExercise(exercise)) throw new RepCountFailure(`Unknown challenge exercise: ${exercise}`);
  if (!gemini.configured) throw new RepCountFailure("The rep counter isn't available right now. Please try again later.");
  const clock = options.clock ?? realClock;
  let file: GeminiFile;
  try {
    file = await gemini.upload(data, videoMimeType(suffix), (options.uploadSeconds ?? UPLOAD_SECONDS) * 1000);
  } catch (e) {
    if (e instanceof GeminiFileRejected) {
      throw new RepCountFailure("That recording couldn't be processed — it may have been too short. Please record for at least a few seconds and try again.");
    }
    if (e instanceof GeminiError) throw new RepCountFailure(BUSY);
    throw e;
  }
  try {
    const prompt = CHALLENGE_PROMPTS[exercise];
    const raw = await ask(gemini, file, prompt, clock, options.budgetSeconds ?? COUNT_BUDGET_SECONDS, options.model ?? N.GEMINI_MODEL);
    options.onModel?.({ prompt, raw });
    return parseResponse(raw);
  } finally {
    await gemini.deleteFile(file.name);
  }
}
