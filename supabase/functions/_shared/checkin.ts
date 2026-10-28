/** AI-assisted weekly check-in analysis (a port of checkin_analyzer.py).
 *
 * The safe numeric bounds (the +/-150 kcal/week cap, the per-gender minimum-calorie floor, the fat/carb split for the diet style) still
 * come entirely from coachingEngine's deterministic weeklyAdjustment(). This asks Gemini to weigh in on the calorie DELTA itself,
 * anchored to the deterministic suggestion, with front/back progress photos when the person gave them (optional). A failure here is
 * never the person's problem: the caller falls back to the deterministic number.
 *
 * One deliberate difference: the Python prompt asked for "Current bodyweight: {profile.get('weightKg')}", a key the profile never has,
 * so the model was told "None kg". This tells it the real weight.
 */
import { WEEKLY_ADJUSTMENT_LIMIT } from "./coachingData.ts";
import type { Adjustment, Profile, Targets } from "./coachingEngine.ts";
import type { Gemini, Image } from "./gemini.ts";
import { pyStrip } from "./nameFilter.ts";
import { pyInt, pyRound, pyTruthy } from "./pyNumbers.ts";

export const CHECKIN_MODEL = "gemini-3.5-flash";
/** Hard ceiling on the call: without it a stalled request would keep "Complete check-in" disabled for as long as it hung. */
export const CHECKIN_TIMEOUT_MS = 30_000;
export const MAX_REASON_CHARS = 400;

export class CheckinAnalysisError extends Error {}

type Entry = Record<string, unknown>;

/** The model's answer as JSON: the whole text, or what is inside the first ``` fence. */
export function extractJson(textIn: string): unknown {
  let text = pyStrip(textIn);
  const fenced = /```(?:json)?\s*(.*?)```/s.exec(text);
  if (fenced) text = pyStrip(fenced[1]);
  return JSON.parse(text);
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "boolean" ? (v ? "True" : "False") : v === null || v === undefined ? "None" : String(v));

export function buildPrompt(
  profile: Profile,
  current: Targets | null,
  weights: readonly Entry[],
  calorieDays: readonly Entry[],
  baseline: Adjustment | null,
  hasFront: boolean,
  hasBack: boolean,
): string {
  // (Python's round() and sum() raise on a calorie count that is not a number; so does this, and the caller falls back)
  const calories = (d: Entry): number => {
    if (typeof d.calories !== "number" || Number.isNaN(d.calories)) throw new TypeError("calories");
    return d.calories;
  };
  const weightLines = weights.map((e) => `  - ${str(e.date)}: ${str(e.kg)} kg`).join("\n") || "  (none logged)";
  const calorieLines = calorieDays.map((d) => `  - ${str(d.date)}: ${pyRound(calories(d))} kcal`).join("\n") || "  (none logged)";

  // The model must be told what the person is being ASKED to eat, not only what they did eat; otherwise there is no gap for it to
  // close, and a week whose trend looks fine comes back as 0 even when they ate hundreds of kcal off target every day.
  const target = current ? pyRound(current.calories) : null;
  const logged = calorieDays.length ? pyRound(calorieDays.reduce((n, d) => n + calories(d), 0) / calorieDays.length) : null;
  const targetLine = target !== null ? `Their CURRENT daily calorie target is ${target} kcal.` : "";
  const adherenceLine = target !== null && logged !== null
    ? ` They actually averaged ${logged} kcal/day across the days they logged, which is ${Math.abs(logged - target)} kcal ${logged > target ? "above" : "below"} that target.`
    : "";

  const baselineLine = baseline
    ? "A deterministic trend calculation (weight change vs. target rate, calorie adherence) " +
      `already suggests a ${baseline.delta >= 0 ? "+" : "-"}${Math.abs(baseline.delta)} kcal/day change, reasoning: "${baseline.reason}".`
    // weeklyAdjustment returns null for two different reasons (too little logged data, or the week is on track), and does not say which.
    : "The deterministic trend calculation didn't suggest a specific number this week " +
      "(either the week looks on-track already, or there wasn't enough logged data to " +
      "judge confidently) -- use the raw weigh-ins, calories, and photo(s) above to make " +
      "your own call.";
  const photoNote = hasFront && hasBack
    ? "The user has also provided front AND back progress photos for today."
    : hasFront
    ? "The user has also provided a front progress photo for today."
    : hasBack
    ? "The user has also provided a back progress photo for today."
    : "";

  return (
    "You are a sports-nutrition coaching assistant inside a fitness app, reviewing a " +
    "user's weekly check-in to recommend a small calorie-target adjustment for next week.\n\n" +
    `Goal: ${str(profile.aspiration)} weight. Gender: ${str(profile.gender)}. ` +
    `Current bodyweight: ${str(profile.weight_kg)} kg.\n` +
    `${targetLine}${adherenceLine}\n\n` +
    `Weigh-ins logged this week:\n${weightLines}\n\n` +
    `Calories logged this week:\n${calorieLines}\n\n` +
    `${baselineLine}\n\n` +
    `${photoNote}\n\n` +
    (hasFront || hasBack
      ? "Look at the photo(s) for visible week-over-week body composition change if this isn't " +
        "the user's first check-in with photos (you only have this week's photo(s) to go on, so " +
        "judge general leanness/composition, not a before/after comparison) — use it only as a " +
        "sanity check alongside the numeric trend, not as the primary signal (a single photo " +
        "can't out-weigh a clear multi-day weight trend).\n\n"
      : "") +
    "Decide a calorie delta for next week: a NEGATIVE number to cut calories (not losing " +
    "fast enough while trying to lose, or gaining too fast while trying to gain / maintain), " +
    "a POSITIVE number to add calories (losing too fast while trying to lose, gaining too " +
    "slowly while trying to gain, or has drifted down while trying to maintain), or 0 if " +
    "everything looks on track.\n\n" +
    "IMPORTANT — do not return 0 just because the weight trend looks fine. If the trend is " +
    "where it should be but their average intake sits meaningfully away from their current " +
    "target (roughly 100 kcal/day or more), then the TARGET is the thing that's wrong, not " +
    "their eating: move the target TOWARD what they actually ate — a POSITIVE delta if they " +
    "ate above target, NEGATIVE if below — because that intake is demonstrably producing the " +
    "result they want. Telling someone to eat 1800 kcal while they lose weight steadily on " +
    "2500 is a bad recommendation; close as much of that gap as the cap below allows. Return " +
    "0 only when the weight trend AND their intake-vs-target are both already where they " +
    "should be.\n\n" +
    "You may agree with, or adjust, the deterministic suggestion " +
    "above based on the numbers (and photo(s), if provided), but the delta MUST be within " +
    `-${WEEKLY_ADJUSTMENT_LIMIT} to +${WEEKLY_ADJUSTMENT_LIMIT} kcal/day — never outside that ` +
    "range.\n\n" +
    "Respond with ONLY raw JSON (no markdown fences, no commentary) matching exactly this " +
    'shape: {"delta": -100, "reason": "One or two plain sentences a non-expert user would ' +
    'understand, explaining why, mentioning the photo(s) if they influenced the call."}'
  );
}

/** {delta, reason} with the delta clamped to +/-150. Throws CheckinAnalysisError on any failure: the caller falls back to the
 *  deterministic baseline instead of letting it become a 500. `photos` is 0, 1 or 2 pictures (front, then back). */
export async function analyzeCheckin(
  gemini: Gemini,
  profile: Profile,
  current: Targets,
  weights: readonly Entry[],
  calorieDays: readonly Entry[],
  baseline: Adjustment | null,
  photos: readonly Image[],
): Promise<{ delta: number; reason: string }> {
  if (!gemini.configured) throw new CheckinAnalysisError("GEMINI_API_KEY environment variable is not set.");
  try {
    const prompt = buildPrompt(profile, current, weights, calorieDays, baseline, photos.length > 0, photos.length > 1);
    const text = await gemini.generate({
      model: CHECKIN_MODEL,
      contents: [{ role: "user", text: prompt, images: photos }],
      timeoutMs: CHECKIN_TIMEOUT_MS,
      attempts: 1,
    });
    if (text === null) throw new Error("no text");
    const parsed = extractJson(text);
    const answer = parsed as Record<string, unknown>; // anything but an object has no "delta", which is the next check (null throws, and that is caught too)
    if (!Object.hasOwn(answer, "delta")) throw new Error("no delta");
    const asked = pyInt(answer.delta);
    if (Number.isNaN(asked)) throw new Error("delta is not a whole number");
    const delta = Math.max(-WEEKLY_ADJUSTMENT_LIMIT, Math.min(WEEKLY_ADJUSTMENT_LIMIT, asked));
    const given = answer.reason;
    const reason = [...pyStrip(pyTruthy(given) ? str(given) : "")].slice(0, MAX_REASON_CHARS).join("");
    if (!reason) throw new CheckinAnalysisError("Empty reason from model.");
    return { delta, reason };
  } catch (e) {
    if (e instanceof CheckinAnalysisError) throw e;
    throw new CheckinAnalysisError("Couldn't analyze this check-in.");
  }
}
