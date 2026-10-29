/** Answers batches of inputs with the Edge Function code, for tests/test_edge_functions.py to compare with the Python's.
 *  `deno run --allow-read parity_more.check.ts <input.json>` where the JSON holds any of:
 *  {split: {<kind>: [input]} (see split_runners.ts), hashes: [[stored, password]], emails: [raw], images: [base64], userIds: [raw], codes: [raw], offsets: [raw], hyrox: [payload], days: [iso date],
 *   texts: [[raw, limit]], sources: [[reply, question]], requests: [[payload, takesContext]], analysisPrompts: [context], workoutPrompts: [context], instruction: true}.
 */
import { checkPasswordHash } from "../_shared/passwordHash.ts";
import { cleanEmail } from "../_shared/email.ts";
import { inspectImage, PhotoRejected } from "../_shared/photos.ts";
import { cleanText } from "../_shared/rows.ts";
import { buildAnalysisPrompt, buildWorkoutPrompt, ChatRejected, cleanRequest } from "../_shared/chats.ts";
import { attachSources, promptInstruction } from "../_shared/healthSources.ts";
import { buildPrompt, extractJson } from "../_shared/checkin.ts";
import { validateProfile } from "../_shared/coaching.ts";
import { type Adjustment, applyCalorieDelta, BadCheckin, calculateTargets, distributeWeeklyCalories, type Profile, type Targets, weeklyAdjustment } from "../_shared/coachingEngine.ts";
import { pyInt, pyRound, pyRound2 } from "../_shared/pyNumbers.ts";
import { cleanCode, cleanHyroxResult, offsetMinutes, parseUserId, Rejected, todaysExercise } from "../_shared/social.ts";
import { RUNNERS } from "./split_runners.ts";
import { HYROX_RUNNERS } from "./hyrox_runners.ts";
import { FOOD_RUNNERS } from "./food_runners.ts";
import { ADMIN_RUNNERS } from "./admin_runners.ts";

const input = JSON.parse(Deno.readTextFileSync(Deno.args[0]));

const hashes = (input.hashes ?? []).map(([stored, password]: [string, string]) => checkPasswordHash(stored, password));
const emails = (input.emails ?? []).map((raw: unknown) => cleanEmail(raw));
const images = (input.images ?? []).map((b64: string) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  try {
    return inspectImage(bytes);
  } catch (e) {
    if (!(e instanceof PhotoRejected)) throw e;
    return `ERR:${e.status}:${e.message}`;
  }
});
const userIds = (input.userIds ?? []).map((raw: unknown) => parseUserId(raw));
const codes = (input.codes ?? []).map((raw: unknown) => {
  try {
    return cleanCode(raw);
  } catch (e) {
    if (!(e instanceof Rejected)) throw e;
    return `ERR:${e.status}:${e.message}`;
  }
});
const offsets = (input.offsets ?? []).map((raw: unknown) => offsetMinutes(raw));
const hyrox = (input.hyrox ?? []).map((payload: Record<string, unknown>) => {
  try {
    return cleanHyroxResult(payload);
  } catch (e) {
    if (!(e instanceof Rejected)) throw e;
    return `ERR:${e.status}:${e.message}`;
  }
});
const days = (input.days ?? []).map((iso: string) => todaysExercise(undefined, new Date(iso + "T05:00:00Z")));
const texts = (input.texts ?? []).map(([raw, limit]: [unknown, number]) => cleanText(raw, limit));
const sources = (input.sources ?? []).map(([reply, question]: [string, string]) => {
  const [text, found] = attachSources(reply, question);
  return [text, found.map((s) => s.id)];
});
const requests = (input.requests ?? []).map(([payload, takesContext]: [Record<string, unknown>, boolean]) => {
  try {
    return cleanRequest(payload, takesContext);
  } catch (e) {
    if (!(e instanceof ChatRejected)) throw e;
    return `ERR:${e.message}`;
  }
});
const analysisPrompts = (input.analysisPrompts ?? []).map((c: Record<string, unknown>) => buildAnalysisPrompt(c));
const workoutPrompts = (input.workoutPrompts ?? []).map((c: Record<string, unknown>) => buildWorkoutPrompt(c));
const instruction = input.instruction ? promptInstruction() : null;

const profiles = (input.profiles ?? []).map((payload: Record<string, unknown>) => validateProfile(payload));
const targets = (input.targets ?? []).map((profile: Profile) => calculateTargets(profile));
const distributions = (input.distributions ?? []).map(([t, days]: [Record<string, number>, string[]]) =>
  distributeWeeklyCalories(t.calories, t.protein, t.fat, t.carbs, new Set(days))
);
const weekly = (input.weekly ?? []).map(([profile, current, weights, calorieDays]: [Profile, Targets, Record<string, unknown>[], Record<string, unknown>[]]) => {
  try {
    return weeklyAdjustment(profile, current, weights, calorieDays);
  } catch (e) {
    if (!(e instanceof BadCheckin)) throw e;
    return "ERR";
  }
});
const applied = (input.applied ?? []).map(([profile, current, delta, reason]: [Profile, Targets, number, string]) => {
  try {
    return applyCalorieDelta(profile, current, delta, reason);
  } catch (e) {
    if (!(e instanceof BadCheckin)) throw e;
    return "ERR";
  }
});
const checkinPrompts = (input.checkinPrompts ?? []).map(([profile, current, weights, calorieDays, baseline, front, back]: [Profile, Targets | null, Record<string, unknown>[], Record<string, unknown>[], Adjustment | null, boolean, boolean]) =>
  buildPrompt(profile, current, weights, calorieDays, baseline, front, back)
);
const extracted = (input.extracted ?? []).map((text: string) => {
  try {
    return { ok: extractJson(text) };
  } catch {
    return "ERR";
  }
});
const rounds = (input.rounds ?? []).map((x: number) => [pyRound(x), pyRound2(x)]);
const ints = (input.ints ?? []).map((x: unknown) => {
  const n = pyInt(x);
  return Number.isNaN(n) ? "ERR" : n;
});
const photoIds = input.photoIds ? input.photoIds.map(([raw]: [unknown]) => pyInt(raw)).map((n: number) => (Number.isNaN(n) ? "ERR" : n)) : [];

const split: Record<string, unknown[]> = {};
for (const [name, inputs] of Object.entries((input.split ?? {}) as Record<string, unknown[]>)) split[name] = await Promise.all(inputs.map((i) => RUNNERS[name](i)));

const adminKinds: Record<string, unknown[]> = {};
for (const [name, inputs] of Object.entries((input.admin_cases ?? {}) as Record<string, unknown[]>)) adminKinds[name] = inputs.map((i) => ADMIN_RUNNERS[name](i));

const foodKinds: Record<string, unknown[]> = {};
for (const [name, inputs] of Object.entries((input.food_cases ?? {}) as Record<string, unknown[]>)) foodKinds[name] = await Promise.all(inputs.map((i) => FOOD_RUNNERS[name](i)));

const hyroxKinds: Record<string, unknown[]> = {};
for (const [name, inputs] of Object.entries((input.hyrox_cases ?? {}) as Record<string, unknown[]>)) hyroxKinds[name] = inputs.map((i) => HYROX_RUNNERS[name](i));

console.log(JSON.stringify({ split, adminKinds, foodKinds, hyroxKinds, hashes, emails, images, userIds, codes, offsets, hyrox, days, texts, sources, requests, analysisPrompts, workoutPrompts, instruction, profiles, targets, distributions, weekly, applied, checkinPrompts, extracted, rounds, ints, photoIds }));
