/** Grading a lift: the website's `analyze_form_gemini.py` and `pipeline.py` on the Edge runtime.
 *
 * There is no ffmpeg here to cut the clip, so Gemini is given the WHOLE upload through its file store and told which stretch to
 * look at (`startOffset`/`endOffset` do what `trim_video.py` did: skip the first 5 seconds unless that would leave under 3, keep
 * at most 60). Gemini also reports how long the clip is, which replaces ffprobe. Everything else is the Python's: the prompt (generated,
 * see analyzeData.ts), the reading of the scores, the retry-and-budget loop around the call, and the words the person is told.
 */
import { EXERCISES, FORM_NUMBERS as N, GENERIC_SECONDARY_NOTES, PROMPT_WITH_RESEARCH, PROMPT_WITHOUT_RESEARCH, SENTINELS, type ExerciseNotes } from "./analyzeData.ts";
import { GeminiError, GeminiFileRejected, type Gemini, type GeminiFile } from "./gemini.ts";
import { pyStrip } from "./nameFilter.ts";
import { asciiDigits } from "./pyNumbers.ts";
import { pyFloatRepr } from "./pyText.ts";

/** Why a clip could not be graded, in words safe to show the person. */
export class FormFailure extends Error {}

/** What Python's `\s`, `\d` and `\w` match in a text pattern (checked against every code point by a test). */
const SPACE = "[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const DIGITS = "\\p{Nd}";
const WORD = "[\\p{L}\\p{N}_]";
export const PY_CLASSES = { space: SPACE, digits: DIGITS, word: WORD };

const LABEL_TO_KEY = new Map(Object.entries(EXERCISES).map(([key, cfg]) => [pyStrip(cfg.label).toLowerCase(), key]));

/** A curated exercise by key or label; anything else gets generic notes under the name given. */
export function resolveExercise(name: string): ExerciseNotes {
  if (Object.hasOwn(EXERCISES, name)) return EXERCISES[name];
  const key = LABEL_TO_KEY.get(pyStrip(name).toLowerCase());
  if (key) return EXERCISES[key];
  return { label: pyStrip(name), secondary_notes: GENERIC_SECONDARY_NOTES };
}

/** `build_prompt`: the generated template with the exercise and the clip's length filled in. */
export function buildPrompt(config: ExerciseNotes, durationSeconds: number): string {
  const template = config.research_notes ? PROMPT_WITH_RESEARCH : PROMPT_WITHOUT_RESEARCH;
  return template
    .replaceAll(SENTINELS.label, () => config.label)
    .replaceAll(SENTINELS.notes, () => config.secondary_notes)
    .replaceAll(SENTINELS.research, () => config.research_notes ?? "")
    .replaceAll(SENTINELS.duration, () => pyFloatRepr(durationSeconds));
}

const SCORE = (label: string) => new RegExp(`${label}:${SPACE}*(${DIGITS}+)`, "u");
const toInt = (digits: string) => Number(asciiDigits(digits));

export interface Scores {
  stretch: number | null;
  squeeze: number | null;
  overall: number | null;
  favored: string | null;
  reps: number | null;
}

/** STRETCH_SCORE / SQUEEZE_SCORE / OVERALL_SCORE (0-100), FAVORED and REPS out of the model's reply; null for what is missing. */
export function parseScores(text: string): Scores {
  const score = (label: string) => {
    const match = SCORE(label).exec(text);
    return match ? Math.max(0, Math.min(100, toInt(match[1]))) : null;
  };
  const favored = new RegExp(`FAVORED:${SPACE}*(stretch|squeeze|balanced)`, "iu").exec(text);
  const reps = new RegExp(`REPS:${SPACE}*(${DIGITS}+)`, "u").exec(text);
  return {
    stretch: score("STRETCH_SCORE"),
    squeeze: score("SQUEEZE_SCORE"),
    overall: score("OVERALL_SCORE"),
    favored: favored ? favored[1].toLowerCase() : null,
    reps: reps ? toInt(reps[1]) : null,
  };
}

// Python's MULTILINE `^` and `$` know only "\n"; JavaScript's also know "\r", U+2028 and U+2029, so they are spelled out.
const LINE_START = "(?<![^\\n])";
const LINE_END = "(?![^\\n])";
const STRIP_SCORES = new RegExp(
  `${LINE_START}(?:STRETCH_SCORE|SQUEEZE_SCORE|OVERALL_SCORE|REPS):${SPACE}*${DIGITS}+${SPACE}*${LINE_END}\\n?|${LINE_START}FAVORED:${SPACE}*${WORD}+${SPACE}*${LINE_END}\\n?`,
  "gu",
);

export function stripScoreLines(text: string): string {
  return text.replace(STRIP_SCORES, "");
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska", ".webm": "video/webm",
};

export function videoMimeType(suffix: string): string {
  return MIME_TYPES[suffix.toLowerCase()] ?? "video/mp4";
}

export interface Window {
  /** Seconds into the clip where the model starts looking. */
  start: number;
  /** Where it stops. */
  end: number;
  /** How much footage that is (what the model is told). */
  length: number;
}

/** What `trim_video` kept of an upload, decided from the length Gemini measured: skip the first 5 s unless that leaves under 3 s,
 *  keep at most 60 s. A clip that is too short, or too small to be a video when no length is known, is refused. */
export function clipWindow(durationSeconds: number | null, sizeBytes: number): Window {
  let start: number = N.START_SECONDS;
  if (durationSeconds !== null && durationSeconds < N.START_SECONDS + N.MIN_USABLE_SECONDS) start = 0;
  if (durationSeconds === null) {
    if (sizeBytes < N.MIN_USABLE_BYTES) throw new FormFailure("Couldn't read that video. Please upload a clear clip of your full set.");
    return { start, end: start + N.DURATION_SECONDS, length: N.DURATION_SECONDS };
  }
  const length = Math.min(N.DURATION_SECONDS, durationSeconds - start);
  if (length < N.MIN_USABLE_SECONDS) {
    throw new FormFailure(`That clip is too short to analyze. Please upload a video of at least ${N.MIN_USABLE_SECONDS} seconds showing your full set.`);
  }
  return { start, end: start + length, length: Math.round(length * 10) / 10 };
}

const seconds = (n: number) => `${Math.round(n * 1000) / 1000}s`;

export interface Graded {
  feedback: string;
  exercise_label: string;
  stretch_score: number | null;
  squeeze_score: number | null;
  overall_score: number;
  favored: string | null;
  reps: number | null;
}

export interface Clock {
  /** Milliseconds, only ever subtracted. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const realClock: Clock = { now: () => performance.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** How long the clip may take to reach Gemini and be processed there. */
export const UPLOAD_SECONDS = 45;

const isTimeout = (e: unknown) => e !== null && e !== undefined && `${(e as Error).name} ${(e as Error).message}`.toLowerCase().includes("timeout");

/** `call_gemini`: up to three tries within one time budget, a blocked or empty answer retried at once, an error after a pause. */
async function callGemini(gemini: Gemini, file: GeminiFile, window: Window, prompt: string, clock: Clock, budgetSeconds: number, model?: string): Promise<string> {
  const started = clock.now();
  const left = () => budgetSeconds - (clock.now() - started) / 1000;
  let lastError: unknown = null;
  let timedOut = false;
  for (let attempt = 0; attempt <= N.MAX_SAFETY_BLOCK_RETRIES; attempt++) {
    const remaining = left();
    if (remaining < N.MIN_ATTEMPT_SECONDS) {
      timedOut = true;
      break;
    }
    let text: string | null;
    try {
      text = await gemini.generate({
        model: model ?? N.GEMINI_MODEL,
        contents: [{ role: "user", videos: [{ fileUri: file.uri, mimeType: file.mimeType, startOffset: seconds(window.start), endOffset: seconds(window.end), fps: N.SAMPLE_FPS }], text: prompt }],
        temperature: 0,
        thinkingLevel: N.THINKING_LEVEL,
        attempts: 1, // the retries are counted here, against the budget
        timeoutMs: Math.floor(remaining * 1000),
      });
    } catch (e) {
      lastError = e;
      if (attempt < N.MAX_SAFETY_BLOCK_RETRIES && left() > N.MIN_ATTEMPT_SECONDS + 2) await clock.sleep(2000);
      continue;
    }
    if (text) return text;
    lastError = null; // empty + blocked is flaky on ordinary footage: try again
  }
  if (timedOut || isTimeout(lastError)) {
    throw new FormFailure(
      `That analysis took longer than ${budgetSeconds} seconds, so we stopped waiting. This is usually a busy moment on our end, not a problem with your video -- please try again.`,
    );
  }
  if (lastError !== null) throw new FormFailure(`Gemini request failed after retries: ${(lastError as Error).message}`);
  throw new FormFailure("Gemini didn't return a usable response for this video. Please try again.");
}

export interface GradeOptions {
  clock?: Clock;
  /** The model; the code's default is `N.GEMINI_MODEL`. */
  model?: string;
  budgetSeconds?: number;
  /** How long the clip may take to reach Gemini and be processed (default `UPLOAD_SECONDS`). */
  uploadSeconds?: number;
  /** For tests and the side-by-side run: what was sent and received. */
  onModel?: (info: { prompt: string; window: Window; raw: string }) => void;
}

/** Grade one clip: put it in Gemini's file store, ask the model about the stretch of it that counts, remove it again. Throws FormFailure. */
export async function gradeClip(gemini: Gemini, data: Uint8Array, suffix: string, exercise: string, options: GradeOptions = {}): Promise<Graded> {
  if (!gemini.configured) throw new FormFailure("Form analysis isn't available right now. Please try again later.");
  const clock = options.clock ?? realClock;
  let file: GeminiFile;
  try {
    file = await gemini.upload(data, videoMimeType(suffix), (options.uploadSeconds ?? UPLOAD_SECONDS) * 1000);
  } catch (e) {
    if (e instanceof GeminiFileRejected) throw new FormFailure("Couldn't read that video. Please upload a clear clip of your full set.");
    if (e instanceof GeminiError) throw new FormFailure("Couldn't process that video. Please try uploading it again.");
    throw e;
  }
  try {
    const window = clipWindow(file.durationSeconds, data.length);
    const config = resolveExercise(exercise);
    const prompt = buildPrompt(config, window.length);
    const raw = await callGemini(gemini, file, window, prompt, clock, options.budgetSeconds ?? N.BUDGET_SECONDS, options.model);
    options.onModel?.({ prompt, window, raw });
    const scores = parseScores(raw);
    // The prompt has the model say UNSCORABLE (and nothing else) when the clip shows no assessable set. It counts only at the very start of the
    // reply and only when no score parsed, so a normal graded reply that mentions the word cannot throw a good analysis away.
    const unscorable = new RegExp(`^${SPACE}*UNSCORABLE:${SPACE}*([^\n]*)`, "u").exec(raw);
    if (unscorable && scores.overall === null) {
      const reason = pyStrip(unscorable[1]);
      throw new FormFailure(`We couldn't analyze that video${reason ? ` — ${reason}` : "."} Please upload a clear clip of your full set and try again.`);
    }
    if (scores.overall === null) throw new FormFailure("We couldn't score that video. Please try uploading it again.");
    return {
      feedback: stripScoreLines(raw),
      exercise_label: config.label,
      stretch_score: scores.stretch,
      squeeze_score: scores.squeeze,
      overall_score: scores.overall,
      favored: scores.favored,
      reps: scores.reps,
    };
  } finally {
    await gemini.deleteFile(file.name);
  }
}
