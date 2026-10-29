/** The HYROX race analysis: the port of hyrox_coach.py. One race's split times in, a short read of where the time went and a tip for each of
 *  the eight stations out. Nothing is stored; the app sends the whole race each time. The Flask version kept a per-session budget in a cookie
 *  that the API never used (the per-account limit replaced it), so that part is not ported. */
import type { Gemini } from "./gemini.ts";
import { pyStrip } from "./nameFilter.ts";
import { pyRound, pyTruthy } from "./pyNumbers.ts";
import { pyStr, pyTitle } from "./pyText.ts";

/** The eight stations in race order; tips come back keyed by these so the app can line each up with the station it drew. */
export const STATION_KEYS = ["skierg", "sledPush", "sledPull", "burpeeBroadJump", "row", "farmersCarry", "lunges", "wallBalls"] as const;
export const VALID_RATINGS = new Set(["strong", "solid", "focus"]);
export const MAX_DETAIL_BULLETS = 5;
export const TEMPERATURE = 0.4;

export interface Tip {
  key: string;
  rating: string;
  tip: string;
  detail: string[];
}
export interface Analysis {
  overall: string;
  overall_detail: string[];
  tips: Tip[];
  limited: boolean;
  retry_after_seconds: number;
  /** The model could not be reached or gave nothing usable: the neutral tips are not an analysis, so the use is given back. */
  failed: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
/** `row.get(key) or fallback` */
const orElse = (v: unknown, fallback: string): unknown => (pyTruthy(v) ? v : fallback);

/** m:ss for a number of seconds, rounded (half to even) and never negative. A text or a missing number is an error, as it is in Python. */
export function clock(seconds: unknown): string {
  const n = typeof seconds === "number" ? seconds : typeof seconds === "boolean" ? Number(seconds) : NaN;
  if (typeof seconds !== "number" && typeof seconds !== "boolean") throw new TypeError("not a number");
  if (!Number.isFinite(n)) throw new RangeError("not finite");
  const whole = BigInt(pyRound(n));
  const total = whole < 0n ? 0n : whole;
  return `${total / 60n}:${String(total % 60n).padStart(2, "0")}`;
}

export const neutralTips = (): Tip[] => STATION_KEYS.map((key) => ({ key, rating: "solid", tip: "", detail: [] }));

/** The text sent to the model for one race. Throws, as the Python does, when a total or a split time is not a number. */
export function buildPrompt(raceIn: Record<string, unknown> | null): string {
  const race = raceIn ?? {};
  const category = pyTitle(pyStr(orElse(race.category, "open")));
  const format = pyTitle(pyStr(orElse(race.format, "singles")));
  const gender = pyTitle(pyStr(orElse(race.gender, ""))) || "unspecified";
  const total = clock(pyTruthy(race.total_seconds) ? race.total_seconds : 0);

  const segments = pyTruthy(race.segments) ? race.segments : [];
  if (!Array.isArray(segments)) throw new TypeError("segments");
  const runLines: string[] = [];
  const stationLines: string[] = [];
  for (const seg of segments) {
    if (!isObject(seg)) continue;
    const seconds = seg.seconds;
    if (typeof seconds !== "number" && typeof seconds !== "boolean") continue;
    const title = pyStrip(pyStr(pyTruthy(seg.title) ? seg.title : orElse(seg.key, "")));
    if (seg.type === "run") {
      runLines.push(`- ${title}: ${clock(seconds)}`);
    } else {
      const key = pyStrip(pyStr(orElse(seg.key, "")));
      stationLines.push(`- ${title} (key: ${key}): ${clock(seconds)}`);
    }
  }
  const runsBlock = runLines.length ? runLines.join("\n") : "(no run splits recorded)";
  const stationsBlock = stationLines.length ? stationLines.join("\n") : "(no station splits recorded)";
  const keysCsv = STATION_KEYS.join(", ");

  return "You are RepCheck's HYROX race coach. A HYROX race is eight 1km runs " +
    "alternating with eight functional stations. Below is one athlete's " +
    "race, broken down by how long each segment took. Analyze where their " +
    "time actually went and give focused, practical coaching to help them " +
    "finish faster next time.\n\n" +
    `Race: ${gender} ${category} ${format} · total ${total}\n\n` +
    `Runs:\n${runsBlock}\n\n` +
    `Stations:\n${stationsBlock}\n\n` +
    "Return ONLY a JSON object with this exact shape:\n" +
    "{\n" +
    '  "overall": "ONE short, precise, direct sentence naming the single ' +
    "biggest opportunity to save time. No warm-up filler, no fluff -- get " +
    'straight to the point.",\n' +
    '  "overall_detail": [\n' +
    '    "2-5 short bullet points expanding on \\"overall\\": where the ' +
    "time actually went (slowest stations, running vs stations), why it " +
    "likely happened, and the priority order to fix it. This is the fuller " +
    'explanation for someone who taps to read more."\n' +
    "  ],\n" +
    '  "tips": [\n' +
    "    {\n" +
    '      "key": "<station key>",\n' +
    '      "rating": "strong|solid|focus",\n' +
    '      "tip": "ONE short, precise, direct sentence -- the single most ' +
    'actionable cue for THIS station. No fluff.",\n' +
    '      "detail": [\n' +
    '        "2-4 short bullet points with deeper coaching for this ' +
    "station: technique cues, pacing, common mistakes, strategy -- the " +
    'fuller version for someone who taps to read more."\n' +
    "      ]\n" +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Rules:\n" +
    `- Include exactly one tips entry for EACH of these 8 station keys: ${keysCsv}.\n` +
    "- rating: 'strong' = one of their fastest/best stations, 'focus' = one " +
    "of the biggest time-loss opportunities, 'solid' = fine, in between. " +
    "Base this on the actual split times above relative to the rest of " +
    "their race.\n" +
    '- Keep "overall" and every "tip" SHORT, PRECISE, and DIRECT -- one ' +
    "sentence each, no throat-clearing, no repeating what the bullets " +
    "below already say.\n" +
    '- Bullets in "overall_detail" and each tip\'s "detail" are short ' +
    "phrases or sentences, concrete and doable (a cue, a pacing idea, a " +
    "grip/technique fix, a strategy) -- not generic 'train more'.\n" +
    "- Absolutely no clinical jargon anywhere. Write like an encouraging " +
    "human coach talking to a friend, not a physiologist.\n" +
    "- Do not include any text outside the JSON object.";
}

/** Whatever the model put in a "detail" field as a clean list of short texts, at most MAX_DETAIL_BULLETS, junk tolerated. */
export function coerceBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const bullets: string[] = [];
  for (const item of raw) {
    const text = pyStrip(pyStr(pyTruthy(item) ? item : ""));
    if (text) bullets.push(text);
    if (bullets.length >= MAX_DETAIL_BULLETS) break;
  }
  return bullets;
}

/** The model's JSON as exactly the shape the app expects: a short overall and its bullets, and one tip per station in race order.
 *  Missing or extra keys are tolerated; text that is not JSON gives the empty result. */
export function coerceResult(rawText: string): [string, string[], Tip[]] {
  let overall = "";
  let overallDetail: string[] = [];
  const tipsByKey = new Map<string, Tip>();
  try {
    const data = JSON.parse(rawText);
    if (isObject(data)) {
      overall = pyStrip(pyStr(pyTruthy(data.overall) ? data.overall : ""));
      overallDetail = coerceBullets(data.overall_detail);
      const tips = pyTruthy(data.tips) ? data.tips : [];
      // a list is walked entry by entry; text or an object has nothing in it that is an entry; any other value cannot be walked at all (Python stops there, and nothing follows)
      for (const entry of Array.isArray(tips) ? tips : []) {
        if (!isObject(entry)) continue;
        const key = pyStrip(pyStr(pyTruthy(entry.key) ? entry.key : ""));
        if (!(STATION_KEYS as readonly string[]).includes(key)) continue;
        let rating = pyStrip(pyStr(orElse(entry.rating, "solid"))).toLowerCase();
        if (!VALID_RATINGS.has(rating)) rating = "solid";
        tipsByKey.set(key, { key, rating, tip: pyStrip(pyStr(pyTruthy(entry.tip) ? entry.tip : "")), detail: coerceBullets(entry.detail) });
      }
    }
  } catch {
    // not JSON, or a value that cannot be walked: whatever was read before it stays
  }
  return [overall, overallDetail, STATION_KEYS.map((key) => tipsByKey.get(key) ?? { key, rating: "solid", tip: "", detail: [] })];
}

/** Ask the model about one race. Any failure gives the neutral tips (the app still draws), and `failed` says nothing usable came back. */
export async function analyzeRace(gemini: Gemini, race: Record<string, unknown>): Promise<Analysis> {
  let overall = "";
  let overallDetail: string[] = [];
  let tips = neutralTips();
  if (gemini.configured) {
    try {
      const text = await gemini.generate({ contents: [{ role: "user", text: buildPrompt(race) }], temperature: TEMPERATURE, json: true });
      [overall, overallDetail, tips] = coerceResult(pyStrip(text ?? ""));
    } catch {
      [overall, overallDetail, tips] = ["", [], neutralTips()];
    }
  }
  return { overall, overall_detail: overallDetail, tips, limited: false, retry_after_seconds: 0, failed: !overall && !tips.some((t) => t.tip) };
}
