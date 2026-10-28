/** Workout-split generation: the port of split_planner.py. Which day types to train, which exercises belong to each, and where in the week they land.
 *
 * The model is asked first, so the plan reads like a coach put it together, but its answer is never trusted as it comes: every exercise is checked
 * against the library (and the person's training location), the week is checked against the recovery rule, and any failure falls back to
 * buildFallbackPlan, which is deterministic and always succeeds. Everything here reproduces the Python down to the text of the prompts;
 * tests/test_edge_functions.py runs the two side by side and scripts/edge_golden.py writes the Python's answers for the offline tests.
 */
import type { Gemini } from "./gemini.ts";
import { pyStrip } from "./nameFilter.ts";
import { pyDumps, pyFixed, pyFloatRepr, pyStr } from "./pyText.ts";
import { EXERCISE_CATEGORIES, EXERCISE_LOCATIONS } from "./workoutData.ts";

/** The model that picks the split type as well as the exercises (a slightly stronger one than the type-already-chosen path's default). */
export const SUGGEST_GEMINI_MODEL = "gemini-3.5-flash-lite";

export const WORKOUT_EXERCISES: readonly string[] = Object.values(EXERCISE_CATEGORIES).flat();
const VALID_EXERCISES = new Set(WORKOUT_EXERCISES);
export const WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** More consecutive training days than this (wrapping week to week) is taken for a mistake by the model. */
export const MAX_ACCEPTABLE_STREAK = 3;

const cat = (name: string): readonly string[] => EXERCISE_CATEGORIES[name];
const CHEST = cat("Chest");
const BACK = cat("Back");
const SHOULDERS = cat("Shoulders");
const ARMS = cat("Arms");
const LEGS = cat("Legs");
const CORE = cat("Core");
const MOBILITY = cat("Mobility & Flexibility");
const ATHLETIC = cat("Athletic / Speed & Agility");
const FUNCTIONAL = cat("Functional / Real-World Strength");
const BALANCE = cat("Balance & Stability");
const PRENATAL = cat("Prenatal / Low-Impact");
const CONDITIONING = cat("Full Body / Conditioning");

export const SPLIT_DAY_TYPES: Readonly<Record<string, readonly string[]>> = {
  ppl: ["Push", "Pull", "Legs"],
  upper_lower: ["Upper", "Lower"],
  full_body: ["Full Body"],
  bro_split: ["Chest", "Back", "Legs", "Shoulders", "Arms"],
};

/** A well-rounded leg pool, named rather than sliced by position (a new entry in the library's Legs list would otherwise change which muscles it covers). */
const LEGS_BALANCED = [
  "Squat", "Leg Press", "Walking Lunge", "Bulgarian Split Squat",
  "Lying Leg Curl Machine", "Calf Raise", "Hip Thrust", "Leg Extension",
];

export const DAY_TYPE_POOLS: Readonly<Record<string, readonly string[]>> = {
  Push: [...CHEST.slice(0, 4), ...SHOULDERS.slice(0, 2), "Tricep Pushdown"],
  Pull: [...BACK.slice(0, 5), "Bicep Curl", "Hammer Curl"],
  Legs: LEGS_BALANCED.slice(0, 6),
  Upper: [...CHEST.slice(0, 2), ...BACK.slice(0, 2), ...SHOULDERS.slice(0, 1), "Bicep Curl"],
  Lower: [...LEGS_BALANCED.slice(0, 5), ...CORE.slice(0, 1)],
  "Full Body": [CHEST[0], "Pull-Up", "Squat", SHOULDERS[0], "Bicep Curl", CORE[0]],
  Chest: ["Flat Bench Press", "Incline Bench Press", "Dumbbell Bench Press", "Chest Fly", "Cable Crossover", "Push-Up"],
  Back: BACK.slice(0, 6),
  Shoulders: SHOULDERS.slice(0, 6),
  Arms: ["Bicep Curl", "Hammer Curl", "Preacher Curl", "Tricep Pushdown", "Overhead Tricep Extension", "Skull Crusher"],
  Mobility: MOBILITY.slice(0, 8),
  Athletic: ATHLETIC.slice(0, 8),
  Functional: FUNCTIONAL.slice(0, 8),
  Balance: BALANCE.slice(0, 8),
  Prenatal: PRENATAL.slice(0, 8),
  Conditioning: CONDITIONING.slice(0, 8),
};

const unknownPoolNames = Object.values(DAY_TYPE_POOLS).flat().filter((name) => !VALID_EXERCISES.has(name));
if (unknownPoolNames.length) throw new Error(`DAY_TYPE_POOLS references unknown exercise name(s): ${unknownPoolNames}`);

/** Checked in this order: the first keyword a label contains decides its day type. */
export const KEYWORD_POOL: readonly (readonly [string, string])[] = [
  ["push", "Push"], ["pull", "Pull"], ["leg", "Legs"], ["upper", "Upper"], ["lower", "Lower"],
  ["chest", "Chest"], ["back", "Back"], ["shoulder", "Shoulders"], ["arm", "Arms"],
  ["core", "Chest"], ["ab", "Chest"], ["full", "Full Body"],
  ["mobility", "Mobility"], ["flexib", "Mobility"], ["stretch", "Mobility"],
  ["athletic", "Athletic"], ["speed", "Athletic"], ["agility", "Athletic"], ["sprint", "Athletic"],
  ["power", "Athletic"], ["plyo", "Athletic"],
  ["functional", "Functional"], ["carry", "Functional"], ["carrying", "Functional"],
  ["balance", "Balance"], ["stability", "Balance"],
  ["prenatal", "Prenatal"], ["pregnan", "Prenatal"],
  ["conditioning", "Conditioning"], ["hyrox", "Conditioning"], ["endurance", "Conditioning"],
];

/** Free-text goal words that, without the model, are reason enough to work a matching day type into the split. Checked in this order. */
export const GOAL_KEYWORD_MAP: readonly (readonly [string, readonly string[]])[] = [
  ["Prenatal", ["pregnan", "prenatal", "expecting", "trimester"]],
  ["Athletic", [
    "faster", "speed", "agility", "sprint", "explosive", "vertical jump", "quicker",
    "athletic performance", "my sport", "for soccer", "for basketball", "for football",
    "for tennis", "for track", "power",
  ]],
  ["Functional", [
    "carry", "carrying", "lift my", "lift heavy things", "lift objects", "everyday strength",
    "functional strength", "real-world", "real life", "practical strength", "bed-ridden",
    "bedridden", "caregiv", "pick up my", "lift and carry",
  ]],
  ["Balance", ["balance", "stability", "fall risk", "falling", "elderly", "senior citizen"]],
  ["Mobility", ["mobility", "flexib", "stretch", "range of motion", "recovery", "injur"]],
  ["Conditioning", ["hyrox", "conditioning", "endurance", "cardio", "stamina", "engine", "metcon"]],
];

/** How many goal-driven day types may be blended into a split on top of the one the person chose. */
export const MAX_GOAL_DAY_TYPES = 2;

/** Monday-first training patterns that keep streaks to two in a row wherever the day count allows. */
export const DEFAULT_TRAIN_PATTERNS: Readonly<Record<number, readonly boolean[]>> = {
  1: [true, false, false, false, false, false, false],
  2: [true, false, false, true, false, false, false],
  3: [true, false, true, false, true, false, false],
  4: [true, true, false, true, true, false, false],
  5: [true, true, false, true, true, false, true],
  6: [true, true, false, true, true, true, false],
  7: [true, true, true, true, true, true, true],
};

/** Which EXERCISE_LOCATIONS tags suit each answer to "Where do you usually train?". */
export const LOCATION_ALLOWED: Readonly<Record<string, ReadonlySet<string>>> = {
  home: new Set(["home", "both"]),
  gym: new Set(["gym", "both"]),
  hybrid: new Set(["home", "gym", "both"]),
};

export type Location = "home" | "gym" | "hybrid" | null;
/** A person's own exercises per custom day, in the order they were given. */
export type PickedExercises = ReadonlyMap<string, readonly string[]>;

export interface Day {
  label: string;
  exercises: string[];
}
export interface Plan {
  days: Day[];
  schedule: Record<string, string>;
  rationale: string;
  split_type?: string;
}

/** An answer to "where do you train" that is none of the three counts as no answer. */
export function normalizeLocation(location: unknown): Location {
  return typeof location === "string" && Object.hasOwn(LOCATION_ALLOWED, location) ? (location as Location) : null;
}

/** The pool cut down to what can be done at the person's location (the whole pool if that would leave nothing). */
export function filterByLocation(pool: readonly string[], location: string | null): string[] {
  const allowed = location !== null && Object.hasOwn(LOCATION_ALLOWED, location) ? LOCATION_ALLOWED[location] : undefined;
  if (!allowed) return [...pool];
  const filtered = pool.filter((name) => Object.hasOwn(EXERCISE_LOCATIONS, name) && allowed.has(EXERCISE_LOCATIONS[name]));
  return filtered.length ? filtered : [...pool];
}

/** Which DAY_TYPE_POOLS key a label means: an exact match, else the first keyword it contains ("Chest Day" is Chest), else Full Body. */
export function dayTypeForLabel(label: string): string {
  if (Object.hasOwn(DAY_TYPE_POOLS, label)) return label;
  const lower = label.toLowerCase();
  for (const [keyword, dayType] of KEYWORD_POOL) if (lower.includes(keyword)) return dayType;
  return "Full Body";
}

/** The full categories to draw more exercises from when a day comes up short (the curated pools thin out under a location filter). */
export const DAY_TYPE_WIDE_POOLS: Readonly<Record<string, readonly string[]>> = {
  Push: [...CHEST, ...SHOULDERS, ...ARMS],
  Pull: [...BACK, ...ARMS],
  Legs: LEGS,
  Upper: [...CHEST, ...BACK, ...SHOULDERS, ...ARMS],
  Lower: [...LEGS, ...CORE],
  "Full Body": [...CHEST, ...BACK, ...LEGS, ...SHOULDERS, ...ARMS, ...CORE],
  Chest: CHEST,
  Back: BACK,
  Shoulders: SHOULDERS,
  Arms: ARMS,
  Mobility: MOBILITY,
  Athletic: ATHLETIC,
  Functional: FUNCTIONAL,
  Balance: BALANCE,
  Prenatal: PRENATAL,
  Conditioning: CONDITIONING,
};

/** The exercises for a day label: the person's own picks if they made some for this exact label (a pick is a choice, not a guess, so the location filter leaves it alone), else the label's pool. */
export function poolForLabel(label: string, picked: PickedExercises | null, location: string | null): string[] {
  const own = picked?.get(label);
  if (own && own.length) return [...own];
  return filterByLocation(DAY_TYPE_POOLS[dayTypeForLabel(label)], location);
}

/** Fill a day that came up short of `minExercises` from its own day type (narrow pool, then the wide one), and cut it to `maxExercises`. */
export function topUpExercises(exercises: readonly string[], label: string, location: string | null, minExercises: number, maxExercises: number): string[] {
  const out = [...exercises];
  if (out.length >= minExercises) return out.slice(0, maxExercises);
  const seen = new Set(out);
  const dayType = dayTypeForLabel(label);
  const sources = [filterByLocation(DAY_TYPE_POOLS[dayType], location), filterByLocation(DAY_TYPE_WIDE_POOLS[dayType] ?? [], location)];
  for (const source of sources) {
    for (const candidate of source) {
      if (out.length >= minExercises) break;
      if (!seen.has(candidate)) {
        out.push(candidate);
        seen.add(candidate);
      }
    }
  }
  return out.slice(0, maxExercises);
}

function defaultSchedule(days: readonly Day[], daysPerWeek: number): Record<string, string> {
  const pattern = DEFAULT_TRAIN_PATTERNS[daysPerWeek];
  const schedule: Record<string, string> = {};
  let next = 0;
  WEEKDAY_ORDER.forEach((weekday, i) => {
    if (pattern[i]) {
      schedule[weekday] = (next < days.length ? days[next] : days[0]).label;
      next++;
    } else {
      schedule[weekday] = "Rest";
    }
  });
  return schedule;
}

const GOAL_RATIONALE_PHRASES: Readonly<Record<string, string>> = {
  Mobility: "flexibility work gets dedicated time instead of being squeezed into the end of a lifting session",
  Athletic: "sprint mechanics, jumps, and change-of-direction work get dedicated practice, since those skills need their own session rather than a lifting-day add-on",
  Functional: "real-world carrying and lifting strength gets trained directly, not just assumed as a side effect of machine work",
  Balance: "balance and stability get deliberate, focused practice",
  Prenatal: "the plan leans on a low-impact, joint-friendly pool suited to pregnancy instead of the higher-impact default exercises",
  Conditioning: "hybrid-style strength-and-endurance work (carries, sled/kettlebell/dumbbell conditioning) gets its own session instead of being left out of a pure-strength rotation",
};

/** The extra day types a free-text goal calls for, in priority order, minus those the split already has, at most MAX_GOAL_DAY_TYPES. */
export function detectGoalDayTypes(goal: string | null | undefined, existingLabels: readonly string[]): string[] {
  if (!goal) return [];
  const lower = goal.toLowerCase();
  const matched: string[] = [];
  for (const [dayType, keywords] of GOAL_KEYWORD_MAP) {
    if (existingLabels.includes(dayType) || matched.includes(dayType)) continue;
    if (keywords.some((kw) => lower.includes(kw))) matched.push(dayType);
    if (matched.length >= MAX_GOAL_DAY_TYPES) break;
  }
  return matched;
}

export function defaultRationale(daysPerWeek: number, goalDayTypes: readonly string[] = [], prenatalWholePlan = false): string {
  if (prenatalWholePlan) {
    return "Since you mentioned being pregnant, every day in this plan draws from a low-impact, " +
      "joint-friendly exercise pool instead of the usual higher-impact defaults, rather than just " +
      "one day of the week — always confirm any exercise routine with your doctor or midwife first.";
  }
  let base: string;
  if (daysPerWeek <= 3) {
    base = `Training ${daysPerWeek} day(s) a week with rest spread between them gives full recovery ` +
      "between sessions, which favors strength and consistent progress.";
  } else if (daysPerWeek <= 5) {
    base = "Training days are grouped in short pairs with rest in between so no muscle group goes " +
      "consecutive days without recovery, balancing growth stimulus with recovery time.";
  } else {
    base = "At this frequency, consecutive training days are unavoidable — the split rotates muscle " +
      "groups so the same tissue isn't stressed two days running, but keep an eye on fatigue and " +
      "insert an extra rest day if recovery starts to suffer.";
  }
  for (const dayType of goalDayTypes) {
    const phrase = Object.hasOwn(GOAL_RATIONALE_PHRASES, dayType) ? GOAL_RATIONALE_PHRASES[dayType] : undefined;
    if (phrase) {
      const article = "AEIOU".includes(dayType[0]) ? "An" : "A";
      base += ` ${article} ${dayType} day is worked into the rotation, so ${phrase}.`;
    }
  }
  return base;
}

/** The goal day types that really get a slot: at least one day always stays the person's own split. */
function reserveGoalDayTypes(goalDayTypes: readonly string[], daysPerWeek: number): string[] {
  return daysPerWeek <= 1 ? [] : goalDayTypes.slice(0, daysPerWeek - 1);
}

function buildLabelSequence(baseLabels: readonly string[], reserved: readonly string[], daysPerWeek: number): string[] {
  const remaining = daysPerWeek - reserved.length;
  const fill: string[] = [];
  for (let i = 0; i < remaining; i++) fill.push(baseLabels[i % baseLabels.length]);
  return [...fill, ...reserved];
}

/** The plan without the model. `customDays` are the person's own day names (only a "custom" split uses them). */
export function buildFallbackPlan(
  splitType: string,
  daysPerWeek: number,
  customDays: readonly string[] | null = null,
  goal: string | null = null,
  picked: PickedExercises | null = null,
  location: string | null = null,
): Plan {
  const baseLabels = splitType === "custom" && customDays && customDays.length
    ? [...customDays]
    : [...(Object.hasOwn(SPLIT_DAY_TYPES, splitType) ? SPLIT_DAY_TYPES[splitType] : SPLIT_DAY_TYPES.full_body)];

  let goalDayTypes = detectGoalDayTypes(goal, baseLabels);

  // "Hybrid" training means dedicated strength-and-endurance work as well, blended in the way a matching goal would be and under the same cap.
  if (location === "hybrid" && !goalDayTypes.includes("Conditioning") && !baseLabels.includes("Conditioning") && goalDayTypes.length < MAX_GOAL_DAY_TYPES) {
    goalDayTypes = [...goalDayTypes, "Conditioning"];
  }

  // Pregnancy changes the whole plan, not one day of it, unless every day's exercises were hand-picked (that choice wins).
  const everyDayPicked = !!picked && picked.size > 0 && baseLabels.every((label) => (picked.get(label)?.length ?? 0) > 0);
  if (goalDayTypes.includes("Prenatal") && !everyDayPicked) {
    const days = Array.from({ length: daysPerWeek }, () => ({ label: "Prenatal", exercises: poolForLabel("Prenatal", picked, location) }));
    return { days, schedule: defaultSchedule(days, daysPerWeek), rationale: defaultRationale(daysPerWeek, [], true) };
  }

  const reserved = reserveGoalDayTypes(goalDayTypes, daysPerWeek);
  const days = buildLabelSequence(baseLabels, reserved, daysPerWeek).map((label) => ({ label, exercises: poolForLabel(label, picked, location) }));
  return { days, schedule: defaultSchedule(days, daysPerWeek), rationale: defaultRationale(daysPerWeek, reserved) };
}

/** The model's answer as JSON: the whole text, or what is inside the first ``` fence. */
export function extractJson(textIn: string): unknown {
  let text = pyStrip(textIn);
  const fenced = /```(?:json)?\s*(.*?)```/s.exec(text);
  if (fenced) text = pyStrip(fenced[1]);
  return JSON.parse(text);
}

/** The longest run of consecutive training days in a weekday-to-label-or-"Rest" schedule, wrapping from Sunday to Monday. */
export function longestTrainingStreak(schedule: Readonly<Record<string, string>>): number {
  let streak = 0;
  let max = 0;
  for (const day of [...WEEKDAY_ORDER, ...WEEKDAY_ORDER]) {
    if ((Object.hasOwn(schedule, day) ? schedule[day] : "Rest") !== "Rest") {
      streak++;
      max = Math.max(max, streak);
    } else {
      streak = 0;
    }
    if (max >= 14) break;
  }
  return max;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const get = (o: Record<string, unknown>, key: string, fallback: unknown): unknown => (Object.hasOwn(o, key) ? o[key] : fallback);

/** Python's `for item in value`: a list's items, a string's characters, a dict's keys; anything else cannot be walked. */
function walk(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [...value];
  if (isObject(value)) return Object.keys(value);
  throw new TypeError("not iterable");
}

/** `item in VALID_EXERCISES`: a list or dict cannot even be asked. */
function inLibrary(item: unknown): boolean {
  if (Array.isArray(item) || isObject(item)) throw new TypeError("unhashable");
  return typeof item === "string" && VALID_EXERCISES.has(item);
}

export interface ValidateOptions {
  minExercises?: number;
  maxExercises?: number;
  topUpShortDays?: boolean;
}

/** The model's plan, cleaned, or an Error saying what is wrong with it (the caller then falls back). */
export function validatePlan(
  parsed: unknown,
  daysPerWeek: number,
  picked: PickedExercises | null = null,
  location: string | null = null,
  { minExercises = 3, maxExercises = 8, topUpShortDays = false }: ValidateOptions = {},
): Plan {
  if (!isObject(parsed)) throw new TypeError("not an object");
  const days = parsed.days;
  if (!Array.isArray(days) || days.length !== daysPerWeek) throw new Error("wrong number of days");

  const allowedTags = location !== null && Object.hasOwn(LOCATION_ALLOWED, location) ? LOCATION_ALLOWED[location] : undefined;

  const cleanedDays: Day[] = [];
  for (const day of days) {
    if (!isObject(day)) throw new TypeError("not an object");
    const label = pyStrip(pyStr(get(day, "label", "")));
    const own = picked && picked.size ? picked.get(label) : undefined;
    const ownPicks = own && own.length ? own : null;
    let exercises: string[];
    if (ownPicks || !allowedTags) {
      exercises = walk(get(day, "exercises", [])).filter(inLibrary) as string[];
    } else {
      exercises = walk(get(day, "exercises", [])).filter((e) => inLibrary(e) && allowedTags.has(EXERCISE_LOCATIONS[e as string])) as string[];
    }
    if (label && topUpShortDays && !ownPicks && exercises.length < minExercises) {
      exercises = topUpExercises(exercises, label, location, minExercises, maxExercises);
    }
    if (!label || exercises.length < minExercises) throw new Error("invalid day entry");
    if (ownPicks) {
      // The model was told to copy these verbatim; anything else means it did not follow the instruction, so the whole answer is not trusted.
      if (exercises.length !== ownPicks.length || exercises.some((e, i) => e !== ownPicks[i])) throw new Error("AI did not preserve user-picked exercises");
      cleanedDays.push({ label, exercises });
    } else {
      cleanedDays.push({ label, exercises: exercises.slice(0, maxExercises) });
    }
  }

  const validLabels = new Set([...cleanedDays.map((d) => d.label), "Rest"]);
  const schedule = parsed.schedule;
  if (!isObject(schedule) || Object.keys(schedule).length !== WEEKDAY_ORDER.length || !WEEKDAY_ORDER.every((d) => Object.hasOwn(schedule, d))) {
    throw new Error("invalid schedule shape");
  }
  const cleanedSchedule: Record<string, string> = {};
  for (const weekday of WEEKDAY_ORDER) {
    const value = pyStrip(pyStr(schedule[weekday]));
    cleanedSchedule[weekday] = validLabels.has(value) ? value : "Rest";
  }

  if (longestTrainingStreak(cleanedSchedule) > Math.max(MAX_ACCEPTABLE_STREAK, daysPerWeek)) throw new Error("schedule violates recovery cadence");

  const rationale = pyStrip(pyStr(get(parsed, "rationale", ""))) || defaultRationale(daysPerWeek);
  return { days: cleanedDays, schedule: cleanedSchedule, rationale };
}

/** The text sent to the model to build a plan for a split type the person picked. */
export function buildPrompt(
  splitType: string,
  daysPerWeek: number,
  customDays: readonly string[] | null,
  goalIn: string | null = null,
  picked: PickedExercises | null = null,
  location: string | null = null,
): string {
  const splitDescriptions: Record<string, string> = {
    ppl: "a Push/Pull/Legs (PPL) split",
    upper_lower: "an Upper/Lower split",
    full_body: "a Full Body split (every session trains the whole body)",
    bro_split: "a bro split (one muscle group per day: Chest, Back, Legs, Shoulders, Arms)",
    custom: `a custom split with these day names: ${(customDays ?? []).join(", ")}`,
  };
  const splitDesc = Object.hasOwn(splitDescriptions, splitType) ? splitDescriptions[splitType] : "a general strength split";

  let pickedInstruction = "";
  if (picked && picked.size) {
    pickedInstruction = "\nThe user has already hand-picked their own exercises for these specific day(s) using the " +
      `app's exercise picker: ${pyDumps(picked)}\n` +
      'For any day whose label appears in that mapping, copy its "exercises" list into your ' +
      "output EXACTLY as given (same exercises, same order, do not add, remove, or substitute " +
      "any) -- your only job for those days is choosing where they land in the weekly schedule. " +
      "For any other day (not in that mapping), choose exercises yourself as normal.\n";
  }

  const goal = pyStrip(goalIn ?? "");
  let goalInstruction = "";
  if (goal) {
    goalInstruction = "\nThe user also typed in their own words what they're personally trying to achieve: " +
      `"${goal}"\n` +
      "Blend this into the split rather than ignoring it or overriding the split type/day count " +
      "they picked: keep the same total number of training days, but let some of those days' " +
      "labels and exercise selection shift to actually address the stated goal. Examples of how " +
      "to interpret different goals:\n" +
      "- Mobility/flexibility alongside building muscle -> dedicate a day (or days) to a " +
      '"Mobility" focus using stretching/mobility-drill exercises, on its own day rather than ' +
      "squeezed onto the end of a lifting day — e.g. Tuesday: Mobility, Wednesday: Push.\n" +
      "- Wanting to move faster / be more explosive for a specific sport -> dedicate a day to an " +
      '"Athletic" or sport-specific-sounding focus using sprint, jump, agility-ladder, and ' +
      "medicine-ball throw exercises.\n" +
      "- Pregnancy (mentions being pregnant/expecting/prenatal) -> this changes the WHOLE plan, " +
      "not just one day: use only low-impact, joint-friendly exercises (the Prenatal/Low-Impact " +
      "pool and light Mobility work) across all days, skip anything high-impact, maximal-effort, " +
      "or that involves lying flat on the back for long periods, and lower the exercises-per-day " +
      "count if that reads as more appropriate than a packed session.\n" +
      "- Everyday/real-world strength goals (e.g. wanting to be able to lift and carry a family " +
      'member, or general "functional strength") -> dedicate a day to a "Functional" focus ' +
      "using carrying, ground-to-standing, and loaded-carry exercises rather than machine " +
      "isolation work.\n" +
      "- Balance, fall-risk, or general stability concerns -> dedicate a day (or work exercises " +
      "in) using the Balance & Stability pool.\n" +
      "Only introduce a day type the goal actually calls for; don't invent extra focuses the user " +
      "didn't ask for.\n";
  }

  let locationInstruction = "";
  let allowedExercises: string[];
  if (location === "home" || location === "gym") {
    allowedExercises = filterByLocation(WORKOUT_EXERCISES, location);
    if (picked && picked.size) {
      // The picked names are copied verbatim whatever the location, so they stay in the "only these" list too.
      const pickedNames = new Set([...picked.values()].flat());
      allowedExercises = [...allowedExercises, ...[...pickedNames].filter((n) => !allowedExercises.includes(n))];
    }
    locationInstruction = `\nThe user said they usually train at ${location === "home" ? "home" : "the gym"}. ` +
      "Only choose exercises doable there — see the restricted exercise list below.\n";
  } else if (location === "hybrid") {
    allowedExercises = [...WORKOUT_EXERCISES];
    locationInstruction = "\nThe user said they train hybrid-style (a mix of gym and home, including HYROX-style " +
      "strength-and-endurance/conditioning work). Feel free to draw from both gym and home " +
      "exercises, and make sure at least one day leans on strength-and-endurance conditioning " +
      "work (loaded carries, kettlebell/dumbbell complexes, sled work, wall balls, machine " +
      "intervals) rather than only pure muscle-isolation lifting.\n";
  } else {
    allowedExercises = [...WORKOUT_EXERCISES];
  }

  return `You are a strength coach designing ${splitDesc}, adjusted to exactly ${daysPerWeek} ` +
    "training day(s) per week, optimized for muscle growth, strength, and recovery." +
    `${pickedInstruction}${goalInstruction}${locationInstruction}\n` +
    "Cycle through the split's day types as needed to fill that many days " +
    "(e.g. a 3-day-type split done 5 days/week repeats types like Day1, Day2, Day3, Day1, Day2).\n\n" +
    "You MUST only use exercise names from this exact list (copy them verbatim, do not invent, " +
    `rename, or modify any): ${pyDumps(allowedExercises)}\n\n` +
    "Pick 6-8 well-rounded exercises per day from that list, appropriate for that day's focus.\n\n" +
    "Then place the training days onto an actual weekly schedule (Monday through Sunday). " +
    "Apply this recovery principle: as a rule of thumb, plan roughly one rest day for every " +
    "two consecutive training days, to support recovery and long-term growth — though back-to-" +
    "back days are more acceptable when they hit different muscle groups (e.g. Push then Legs) " +
    "than when they repeat the same one (e.g. Push then Push). At higher frequencies " +
    `(${daysPerWeek} days/week) some consecutive training days are unavoidable; rotate muscle ` +
    "groups across those days to manage it.\n\n" +
    "Respond with ONLY raw JSON (no markdown fences, no commentary) matching exactly this shape:\n" +
    '{"days": [{"label": "Push", "exercises": ["Flat Bench Press", "Overhead Press", "..."]}], ' +
    '"schedule": {"monday": "Push", "tuesday": "Rest", "wednesday": "Pull", "thursday": "Rest", ' +
    '"friday": "Legs", "saturday": "Rest", "sunday": "Rest"}, ' +
    '"rationale": "one or two sentences explaining why this weekly placement supports recovery ' +
    'and growth"}\n' +
    `The "days" array must have exactly ${daysPerWeek} entries. The "schedule" object must have ` +
    'all seven lowercase weekday keys, each set to one of the day labels used in "days" or "Rest", ' +
    `with exactly ${daysPerWeek} non-Rest entries.`;
}

// ---------- the AI-suggested split ("Let AI build it"): the person never picks a split type, and is treated as a complete beginner ----------

/** Outer bounds across every frequency; the real per-day window shrinks as days per week rise. */
export const BEGINNER_MIN_EXERCISES = 3;
export const BEGINNER_MAX_EXERCISES = 6;

/** [min, max] exercises per day at each weekly frequency: more, shorter sessions as frequency rises, so the week stays doable. */
export const BEGINNER_EXERCISE_RANGE_BY_DAYS: Readonly<Record<number, readonly [number, number]>> = {
  1: [5, 6], 2: [5, 6], 3: [4, 6], 4: [4, 5], 5: [4, 5], 6: [3, 4], 7: [3, 4],
};
export const beginnerExerciseRange = (daysPerWeek: number): readonly [number, number] => BEGINNER_EXERCISE_RANGE_BY_DAYS[daysPerWeek];

/** What a beginner runs at each frequency when the model is unavailable or gives nothing usable. */
export const BEGINNER_SPLIT_BY_DAYS: Readonly<Record<number, string>> = {
  1: "full_body", 2: "full_body", 3: "full_body", 4: "upper_lower", 5: "ppl", 6: "ppl", 7: "ppl",
};

export const SUGGESTIBLE_SPLIT_TYPES = ["ppl", "upper_lower", "full_body", "bro_split"] as const;

/** Makes the model answer in this shape instead of asking for it in the prompt and hoping (about one answer in eight came back with a stray brace). Its type names are the REST API's upper-case ones. */
export const SUGGEST_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    split_type: { type: "STRING", enum: [...SUGGESTIBLE_SPLIT_TYPES] },
    days: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, exercises: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["label", "exercises"],
      },
    },
    schedule: {
      type: "OBJECT",
      properties: Object.fromEntries(WEEKDAY_ORDER.map((d) => [d, { type: "STRING" }])),
      required: [...WEEKDAY_ORDER],
    },
    rationale: { type: "STRING" },
  },
  required: ["split_type", "days", "schedule", "rationale"],
};

/** The deterministic plan held to the same per-day window the model's is: pools run up to 8 deep, and a location filter can thin one to 2. */
function fitPlanExerciseCounts(plan: Plan, location: string | null, minExercises: number, maxExercises: number): Plan {
  for (const day of plan.days) day.exercises = topUpExercises(day.exercises, day.label, location, minExercises, maxExercises);
  return plan;
}

export function beginnerFallback(splitType: string, daysPerWeek: number, goal: string | null, location: string | null): Plan {
  const [min, max] = beginnerExerciseRange(daysPerWeek);
  const plan = fitPlanExerciseCounts(buildFallbackPlan(splitType, daysPerWeek, null, goal, null, location), location, min, max);
  plan.split_type = splitType;
  return plan;
}

/** The "who this plan is for" lines. Every field is optional: the coaching profile they come from is filled in apart from the wizard. */
export function describeLifter(gender: string | null, goalWeightKg: number | null, currentWeightKg: number | null): string {
  const bits: string[] = [];
  if (gender === "male" || gender === "female") bits.push(`- Gender: ${gender}`);
  if (currentWeightKg) bits.push(`- Current weight: ${pyFloatRepr(currentWeightKg)} kg`);
  if (goalWeightKg) {
    bits.push(`- Goal weight: ${pyFloatRepr(goalWeightKg)} kg`);
    if (currentWeightKg) {
      const delta = goalWeightKg - currentWeightKg;
      if (delta < -0.5) bits.push(`- They are trying to LOSE about ${pyFixed(Math.abs(delta), 1)} kg`);
      else if (delta > 0.5) bits.push(`- They are trying to GAIN about ${pyFixed(delta, 1)} kg`);
      else bits.push("- They are trying to MAINTAIN their current weight");
    }
  }
  return bits.join("\n");
}

export function buildSuggestPrompt(
  daysPerWeek: number,
  goalIn: string | null,
  gender: string | null,
  goalWeightKg: number | null,
  currentWeightKg: number | null,
  location: string | null,
): string {
  const [minExercises, maxExercises] = beginnerExerciseRange(daysPerWeek);
  const lifter = describeLifter(gender, goalWeightKg, currentWeightKg);
  const lifterBlock = lifter ? `\nAbout this person:\n${lifter}\n` : "";

  const goal = pyStrip(goalIn ?? "");
  let goalBlock = "";
  if (goal) {
    goalBlock = `\nIn their own words, what they want out of training: "${goal}"\n` +
      "Let this steer which split you choose and which exercises you pick. If the goal calls for " +
      "work outside plain muscle-building (mobility/flexibility, speed and agility for a sport, " +
      "real-world carrying strength, balance, pregnancy-safe low-impact training, or " +
      "strength-and-endurance conditioning), give it a dedicated day rather than tacking it onto " +
      "the end of a lifting day.\n";
  }

  let allowedExercises: string[];
  let locationBlock: string;
  if (location === "home" || location === "gym") {
    allowedExercises = filterByLocation(WORKOUT_EXERCISES, location);
    locationBlock = `\nThey train at ${location === "home" ? "home" : "the gym"}, so only choose exercises ` +
      "doable there — the list below is already restricted to those.\n";
  } else if (location === "hybrid") {
    allowedExercises = [...WORKOUT_EXERCISES];
    locationBlock = "\nThey train hybrid-style (a mix of gym and home, including HYROX-style " +
      "strength-and-endurance work), so both gym and home exercises are fair game.\n";
  } else {
    allowedExercises = [...WORKOUT_EXERCISES];
    locationBlock = "";
  }

  return "You are a strength coach building a weekly training split for a COMPLETE BEGINNER — someone " +
    "who has essentially never trained before and does not know any exercises yet. Choose the " +
    "split type FOR them; they have not picked one and would not know which to pick.\n" +
    `${lifterBlock}` +
    `- They can train exactly ${daysPerWeek} day(s) per week.\n` +
    `${goalBlock}${locationBlock}\n` +
    "Because they are a complete beginner:\n" +
    "- Favor simple, foundational, low-skill-ceiling movements over advanced or highly technical " +
    "lifts. Machines, dumbbells, and bodyweight beat barbell max-effort work here.\n" +
    "- Prefer a split where each session is easy to understand and hard to get wrong.\n" +
    "- At low weekly frequency, full-body sessions usually beat body-part splits, because every " +
    "session still trains everything and a missed day costs less.\n" +
    "- Do NOT overload the session. A beginner who finishes their workout comes back; one who is " +
    "buried in volume quits. This matters MORE the more days they train: at higher weekly " +
    "frequency, each individual session must be shorter and more focused so the WEEKLY total stays " +
    "sustainable, not the same full session repeated on every training day. Never design a plan " +
    "where the exercise count per day is the same regardless of how often they train.\n\n" +
    `Choose exactly one split type from this list: ${pyDumps([...SUGGESTIBLE_SPLIT_TYPES])}\n` +
    '("ppl" = Push/Pull/Legs, "upper_lower" = Upper/Lower, "full_body" = every session trains the ' +
    'whole body, "bro_split" = one muscle group per day.)\n\n' +
    "You MUST only use exercise names from this exact list (copy them verbatim, do not invent, " +
    `rename, or modify any): ${pyDumps(allowedExercises)}\n\n` +
    `Give each day exactly ${maxExercises} exercises from that list (never more than ` +
    `${maxExercises}, and never fewer than ${minExercises} -- ${daysPerWeek} day(s)/week gets ` +
    "SHORTER sessions than a lower frequency would, on purpose, so the week as a whole stays " +
    `realistic for someone brand new to training). Aim for ${maxExercises} rather than the ` +
    "minimum — any name that isn't copied exactly from the list gets discarded, so a day built at " +
    "the minimum can end up short.\n\n" +
    "Then place the training days onto an actual weekly schedule (Monday through Sunday). Apply " +
    "this recovery principle: roughly one rest day for every two consecutive training days. " +
    "Back-to-back days are more acceptable when they hit different muscle groups (e.g. Push then " +
    `Legs) than the same one. At ${daysPerWeek} day(s)/week, rotate muscle groups across any ` +
    "consecutive days.\n\n" +
    "Respond with ONLY raw JSON (no markdown fences, no commentary) matching exactly this shape:\n" +
    '{"split_type": "full_body", ' +
    '"days": [{"label": "Full Body", "exercises": ["Goblet Squat", "Dumbbell Bench Press", "..."]}], ' +
    '"schedule": {"monday": "Full Body", "tuesday": "Rest", "wednesday": "Full Body", ' +
    '"thursday": "Rest", "friday": "Full Body", "saturday": "Rest", "sunday": "Rest"}, ' +
    '"rationale": "one or two sentences, addressed to the beginner, explaining why you chose this ' +
    'split and this weekly placement"}\n' +
    `The "days" array must have exactly ${daysPerWeek} entries. The "schedule" object must have ` +
    'all seven lowercase weekday keys, each set to one of the day labels used in "days" or "Rest", ' +
    `with exactly ${daysPerWeek} non-Rest entries.`;
}

export interface SuggestInput {
  daysPerWeek: number;
  goal?: string | null;
  gender?: string | null;
  goalWeightKg?: number | null;
  currentWeightKg?: number | null;
  location?: string | null;
}

const clampDays = (n: number): number => Math.max(1, Math.min(7, Math.trunc(n)));

/** A split for someone who did not pick a type: the model chooses the split type as well as the exercises and the week, treating them as a complete beginner.
 *  Same shape as generateSplitPlan plus `split_type`, which split was chosen. Any failure gives the beginner default for that frequency. */
export async function suggestSplitPlan(gemini: Gemini, input: SuggestInput): Promise<Plan> {
  const daysPerWeek = clampDays(input.daysPerWeek);
  const location = normalizeLocation(input.location);
  const fallbackType = BEGINNER_SPLIT_BY_DAYS[daysPerWeek];
  const goal = input.goal ?? null;
  if (!gemini.configured) return beginnerFallback(fallbackType, daysPerWeek, goal, location);
  try {
    const prompt = buildSuggestPrompt(daysPerWeek, goal, input.gender ?? null, input.goalWeightKg ?? null, input.currentWeightKg ?? null, location);
    const text = await gemini.generate({ model: SUGGEST_GEMINI_MODEL, contents: [{ role: "user", text: prompt }], responseSchema: SUGGEST_RESPONSE_SCHEMA });
    if (text === null) throw new Error("the model gave no text");
    const parsed = extractJson(text);
    const [minExercises, maxExercises] = beginnerExerciseRange(daysPerWeek);
    const plan = validatePlan(parsed, daysPerWeek, null, location, { minExercises, maxExercises, topUpShortDays: true });
    // A split type outside the list it was given is the same kind of mistake as an invented exercise name.
    const suggested = pyStrip(pyStr(get(parsed as Record<string, unknown>, "split_type", ""))).toLowerCase();
    plan.split_type = (SUGGESTIBLE_SPLIT_TYPES as readonly string[]).includes(suggested) ? suggested : fallbackType;
    return plan;
  } catch {
    return beginnerFallback(fallbackType, daysPerWeek, goal, location);
  }
}

export interface BuildInput {
  splitType: string;
  daysPerWeek: number;
  customDays?: readonly string[] | null;
  goal?: string | null;
  picked?: PickedExercises | null;
  location?: string | null;
}

/** A plan for the split type the person picked. A custom split is already entirely theirs, so it never asks the model. */
export async function generateSplitPlan(gemini: Gemini, input: BuildInput): Promise<Plan> {
  const daysPerWeek = clampDays(input.daysPerWeek);
  const location = normalizeLocation(input.location);
  const customDays = input.customDays ?? null;
  const goal = input.goal ?? null;
  const picked = input.picked ?? null;
  const fallback = () => buildFallbackPlan(input.splitType, daysPerWeek, customDays, goal, picked, location);
  if (input.splitType === "custom" || !gemini.configured) return fallback();
  try {
    const prompt = buildPrompt(input.splitType, daysPerWeek, customDays, goal, picked, location);
    const text = await gemini.generate({ contents: [{ role: "user", text: prompt }] });
    if (text === null) throw new Error("the model gave no text");
    return validatePlan(extractJson(text), daysPerWeek, picked, location);
  } catch {
    return fallback();
  }
}
