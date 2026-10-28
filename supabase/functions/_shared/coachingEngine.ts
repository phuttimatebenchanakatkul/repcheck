/** Personalized nutrition coaching: turns a short questionnaire into a calorie/macro target, then re-tunes that target week over
 *  week from the logged weight and calories. A port of coaching_engine.py: deliberately rule-based (Katch-McArdle for the resting
 *  rate, standard activity multipliers, protein per kg of lean mass), not a language model's guess. The ranges and constants are
 *  GENERATED from the Python (coachingData.ts); the arithmetic keeps Python's rounding (a tie goes to the even number).
 */
import * as K from "./coachingData.ts";
import { pyRound, pyRound2 } from "./pyNumbers.ts";

export type Aspiration = "lose" | "maintain" | "gain";

export interface Profile {
  aspiration: string;
  gender: string;
  activity_level: string;
  protein_preference: string;
  diet_preference: string;
  body_fat_range_id: string;
  weight_kg: number;
  height_cm: number | null;
  loss_rate_pct: number | null;
  gain_rate_pct: number | null;
}

export interface Targets {
  calories: number;
  protein: number;
  fat?: number;
  carbs?: number;
  [key: string]: unknown;
}

/** Fat and carbs as grams for the calories left after protein, shaped by the chosen diet style. Shared by the first calculation and
 *  the weekly tune, so a tune can never silently revert a keto or low-fat person to the default split. */
function splitFatCarbs(calories: number, proteinCalories: number, diet: string): [number, number] {
  if (diet === "keto") {
    const carbs = K.KETO_CARBS_G;
    const fatCalories = Math.max(0, calories - proteinCalories - carbs * 4);
    return [pyRound(fatCalories / 9), carbs];
  }
  const percent = Object.hasOwn(K.DIET_FAT_PERCENT_OF_CALORIES, diet) ? K.DIET_FAT_PERCENT_OF_CALORIES[diet] : K.FAT_PERCENT_OF_CALORIES;
  const fat = pyRound(calories * percent / 9);
  const remaining = Math.max(0, calories - proteinCalories - fat * 9);
  return [fat, pyRound(remaining / 4)];
}

export const minCaloriesFor = (gender: string): number => (gender === "male" ? K.MIN_CALORIES_MALE : K.MIN_CALORIES_FEMALE);
export const bodyFatRangesFor = (gender: string) => (gender === "male" ? K.MALE_BODY_FAT_RANGES : K.FEMALE_BODY_FAT_RANGES);

function rangeMidpoint(gender: string, id: string): number {
  const found = bodyFatRangesFor(gender).find((r) => r.id === id);
  return found ? (found.min + found.max) / 2 : 20.0; // sane fallback if an unknown id ever slips through
}

const lookup = (table: Readonly<Record<string, number>>, key: string, fallback: number): number => (Object.hasOwn(table, key) ? table[key] : fallback);

export function calculateTargets(profile: Profile) {
  const weightKg = profile.weight_kg;
  const gender = profile.gender;
  const bodyFatPct = rangeMidpoint(gender, profile.body_fat_range_id);

  const leanMassKg = weightKg * (1 - bodyFatPct / 100);
  const bmr = 370 + 21.6 * leanMassKg; // Katch-McArdle

  const tdee = bmr * lookup(K.ACTIVITY_MULTIPLIERS, profile.activity_level, 1.2);

  let rawCalories: number;
  if (profile.aspiration === "lose") {
    let rate = profile.loss_rate_pct || K.LOSS_RATE_DEFAULT_PCT;
    rate = Math.max(K.LOSS_RATE_MIN_PCT, Math.min(K.LOSS_RATE_MAX_PCT, rate));
    const span = K.LOSS_RATE_MAX_PCT - K.LOSS_RATE_MIN_PCT;
    const t = span ? (rate - K.LOSS_RATE_MIN_PCT) / span : 0.5;
    const deficit = K.LOSS_RATE_DEFICIT_FRACTION_MIN + t * (K.LOSS_RATE_DEFICIT_FRACTION_MAX - K.LOSS_RATE_DEFICIT_FRACTION_MIN);
    rawCalories = tdee * (1 - deficit);
  } else if (profile.aspiration === "gain") {
    let rate = profile.gain_rate_pct || K.GAIN_RATE_DEFAULT_PCT;
    rate = Math.max(K.GAIN_RATE_MIN_PCT, Math.min(K.GAIN_RATE_MAX_PCT, rate));
    const span = K.GAIN_RATE_MAX_PCT - K.GAIN_RATE_MIN_PCT;
    const t = span ? (rate - K.GAIN_RATE_MIN_PCT) / span : 0.5;
    const surplus = K.GAIN_RATE_SURPLUS_FRACTION_MIN + t * (K.GAIN_RATE_SURPLUS_FRACTION_MAX - K.GAIN_RATE_SURPLUS_FRACTION_MIN);
    rawCalories = tdee * (1 + surplus);
  } else {
    rawCalories = tdee * (1 + lookup(K.ASPIRATION_ADJUSTMENT, profile.aspiration, 0.0));
  }
  const calories = Math.max(minCaloriesFor(gender), pyRound(rawCalories));

  const activityProtein = lookup(K.ACTIVITY_PROTEIN_MULTIPLIER, profile.activity_level, 1.0);
  const perKgLean = lookup(K.PROTEIN_G_PER_KG_LEAN, profile.protein_preference, 2.0) * activityProtein;
  let protein = pyRound(perKgLean * leanMassKg);
  if (profile.aspiration === "lose") protein += pyRound(lookup(K.LOSE_WEIGHT_PROTEIN_BUMP_G, profile.protein_preference, 25) * activityProtein);

  const [fat, carbs] = splitFatCarbs(calories, protein * 4, profile.diet_preference || "balanced");
  return { bmr: pyRound(bmr), tdee: pyRound(tdee), calories, protein, fat, carbs };
}

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** Splits a flat daily target across a Mon-Sun week: +10% on training days, -10% on rest days, so the week still averages out. With no
 *  split plan it falls back to a fixed alternating pattern. Protein stays constant: it is a muscle-preservation floor. */
export function distributeWeeklyCalories(daily: number, protein: number, fat: number, carbs: number, trainingDays: ReadonlySet<string>) {
  const days = trainingDays.size ? trainingDays : new Set(["monday", "wednesday", "friday", "saturday"]);
  const result: Record<string, { calories: number; protein: number; fat: number; carbs: number }> = {};
  for (const day of WEEKDAYS) {
    const factor = days.has(day) ? 1.10 : 0.90;
    result[day] = { calories: pyRound(daily * factor), protein, fat: pyRound(fat * factor), carbs: pyRound(carbs * factor) };
  }
  return result;
}

/** The inputs were not what a check-in sends (Python's KeyError, TypeError, ValueError, AttributeError at this point). */
export class BadCheckin extends Error {}

type Entry = Record<string, unknown>;

function number(entry: Entry, key: string): number {
  if (!Object.hasOwn(entry, key)) throw new BadCheckin(`missing ${key}`);
  const v = entry[key];
  if (typeof v !== "number" || Number.isNaN(v)) throw new BadCheckin(`${key} is not a number`);
  return v;
}

export interface Adjustment {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  delta: number;
  reason: string;
  weight_change_kg?: number;
  avg_calories_logged?: number;
}

const WEEKLY_REASONS = {
  tooSlow: {
    lose: "Weight loss has stalled this week, so calories have been trimmed slightly.",
    gain: "Weight gain has stalled this week, so calories have been increased slightly.",
    maintain: "Weight drifted up this week, so calories have been trimmed slightly.",
  },
  tooFast: {
    lose: "You're losing faster than the sustainable range, so calories have been raised slightly.",
    gain: "You're gaining faster than intended, so calories have been trimmed slightly.",
    maintain: "Weight drifted down this week, so calories have been raised slightly.",
  },
} as const;

/** Looks at one week of real data and proposes a calorie tweak. Null when there is too little data to say anything (fewer than two
 *  weigh-ins or three logged days), or when nothing needs changing. Throws BadCheckin for entries that are not what a check-in sends. */
export function weeklyAdjustment(profile: Profile, current: Targets, weights: readonly Entry[], calorieDays: readonly Entry[]): Adjustment | null {
  if (weights.length < 2 || calorieDays.length < 3) return null;

  const weightKg = profile.weight_kg;
  // sorted by date, a stable sort; dates must all be text or all be numbers, as Python can only order like with like
  for (const e of weights) if (!Object.hasOwn(e, "date")) throw new BadCheckin("missing date");
  const kinds = new Set(weights.map((e) => typeof e.date));
  if (kinds.size > 1 || ![...kinds].every((k) => k === "string" || k === "number")) throw new BadCheckin("dates cannot be ordered");
  const sorted = [...weights].sort((a, b) => (a.date as string | number) < (b.date as string | number) ? -1 : (a.date as string | number) > (b.date as string | number) ? 1 : 0);
  const first = number(sorted[0], "kg");
  const last = number(sorted[sorted.length - 1], "kg");
  const change = last - first;
  const changePct = first ? (change / first) * 100 : 0;

  const calories = calorieDays.map((d) => number(d, "calories"));
  const avg = calories.reduce((a, b) => a + b, 0) / calories.length;
  if (!Object.hasOwn(current, "calories") || typeof current.calories !== "number") throw new BadCheckin("target calories");
  const gap = avg - current.calories; // positive = eating over target

  const aspiration = profile.aspiration as Aspiration;
  // Expected weekly weight-change bands per goal (% of bodyweight a week).
  const [low, high] = aspiration === "lose" ? [-1.0, -0.3] : aspiration === "gain" ? [0.15, 0.5] : [-0.3, 0.3];

  let delta: number;
  let reason: string;
  if (low <= changePct && changePct <= high) {
    // On track: only nudge for a clear, sustained adherence gap, so a single big day does not whipsaw the target.
    if (Math.abs(gap) < 100) return null;
    const step = Math.min(K.WEEKLY_ADJUSTMENT_LIMIT, pyRound(Math.abs(gap) * 0.3));
    // The delta follows the SIGN of the gap: it moves the target TOWARD what was actually eaten, because the trend is inside the
    // goal's band, so what was eaten is provably producing the intended result and the target was the thing that was wrong.
    delta = gap > 0 ? step : -step;
    reason = "Your weight trend looks on track, but you've been eating " +
      `${gap > 0 ? "more" : "less"} than your target most days, ` +
      `so the target's been ${gap > 0 ? "raised" : "lowered"} ` +
      "toward what's actually working.";
  } else {
    const tooSlow = (aspiration === "lose" && changePct > high) || (aspiration === "gain" && changePct < low) || (aspiration === "maintain" && changePct > high);
    // Bigger miss -> bigger (but still capped) correction.
    const magnitude = Math.min(K.WEEKLY_ADJUSTMENT_LIMIT, Math.max(1, pyRound(Math.abs(changePct - (tooSlow ? high : low)) * weightKg * 33)));
    if (aspiration === "lose") delta = tooSlow ? -magnitude : magnitude;
    else if (aspiration === "gain") delta = tooSlow ? magnitude : -magnitude;
    else delta = changePct > 0 ? -magnitude : magnitude; // maintain: pull back toward baseline regardless of direction
    reason = (tooSlow ? WEEKLY_REASONS.tooSlow : WEEKLY_REASONS.tooFast)[aspiration];
    if (reason === undefined) throw new BadCheckin("aspiration"); // Python's KeyError on an unknown goal
  }

  delta = Math.max(-K.WEEKLY_ADJUSTMENT_LIMIT, Math.min(K.WEEKLY_ADJUSTMENT_LIMIT, delta));
  if (delta === 0) return null;

  const newCalories = Math.max(minCaloriesFor(profile.gender), current.calories + delta);
  // Protein stays fixed (it is set from lean mass, not from calorie balance); the whole change goes into fat and carbs.
  if (!Object.hasOwn(current, "protein") || typeof current.protein !== "number") throw new BadCheckin("target protein");
  const [fat, carbs] = splitFatCarbs(newCalories, current.protein * 4, profile.diet_preference || "balanced");
  return { calories: newCalories, protein: current.protein, fat, carbs, delta, reason, weight_change_kg: pyRound2(change), avg_calories_logged: pyRound(avg) };
}

/** The same {calories, protein, fat, carbs, delta, reason} shape, from a delta that something else decided (the model's, after a
 *  photo review), run through the same safety floor and diet-aware split, so an AI-suggested delta is never applied raw. */
export function applyCalorieDelta(profile: Profile, current: Targets, deltaIn: number, reason: string): Adjustment | null {
  const delta = Math.max(-K.WEEKLY_ADJUSTMENT_LIMIT, Math.min(K.WEEKLY_ADJUSTMENT_LIMIT, pyRound(deltaIn)));
  if (delta === 0) return null;
  if (typeof current.calories !== "number" || typeof current.protein !== "number") throw new BadCheckin("targets"); // Python's KeyError / TypeError
  const newCalories = Math.max(minCaloriesFor(profile.gender), current.calories + delta);
  const [fat, carbs] = splitFatCarbs(newCalories, current.protein * 4, profile.diet_preference || "balanced");
  return { calories: newCalories, protein: current.protein, fat, carbs, delta, reason };
}
