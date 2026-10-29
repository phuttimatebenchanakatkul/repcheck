/** Planning: the HYROX race analysis and the workout-split generator. */
import type { Router } from "../../_shared/app.ts";
import { getProfile } from "../../_shared/accounts.ts";
import { pyJsonLength } from "../../_shared/chats.ts";
import { hasConsent, refusal } from "../../_shared/consent.ts";
import { analyzeRace } from "../../_shared/hyrox.ts";
import { fail, json, jsonBody } from "../../_shared/http.ts";
import { friendlyWait, RATE_LIMITS, release, reserveUse, track } from "../../_shared/limits.ts";
import { pyStrip } from "../../_shared/nameFilter.ts";
import { pyFloat, pyInt, pyTruthy } from "../../_shared/pyNumbers.ts";
import { pyStr } from "../../_shared/pyText.ts";
import { generateSplitPlan, suggestSplitPlan, WORKOUT_EXERCISES } from "../../_shared/splitPlanner.ts";

const FEATURE = "split_generation";
const HYROX_FEATURE = "hyrox_analysis";
export const MAX_RACE_SEGMENTS = 40; // a race is 8 runs + 8 stations + transitions
export const MAX_RACE_CHARS = 20_000;
export const SPLIT_TYPES = new Set(["ppl", "upper_lower", "full_body", "bro_split", "custom", "ai_suggest"]);
export const MAX_CUSTOM_DAYS = 14;
export const MAX_GOAL_CHARS = 300;
const MAX_LABEL_CHARS = 60;

const VALID = new Set(WORKOUT_EXERCISES);
/** Python's text[:n]: n characters, counted as code points, not UTF-16 units. */
const clip = (s: string, n: number): string => [...s].slice(0, n).join("");
const has = (o: Record<string, unknown>, key: string): boolean => Object.hasOwn(o, key);

/** A body weight from the coaching profile, or null. Everything about that profile is optional here, so anything missing, non-numeric or
 *  implausible counts as "not provided": a bad weight costs the prompt one detail, not the person their plan. */
export function optionalPositiveFloat(value: unknown): number | null {
  if (typeof value === "boolean") return null;
  const n = pyFloat(value);
  return n >= 20 && n <= 500 ? n : null;
}

/** The person's own day names, trimmed and cut to 60 characters; [] when there are none; null when the list is not a short list of text. */
export function customDaysOf(raw: unknown): string[] | null {
  if (!pyTruthy(raw)) return [];
  if (!Array.isArray(raw) || raw.length > MAX_CUSTOM_DAYS || !raw.every((d) => typeof d === "string")) return null;
  return (raw as string[]).filter((d) => pyStrip(d)).map((d) => clip(pyStrip(d), MAX_LABEL_CHARS));
}

/** The exercises picked per custom day, kept only if they are in the real library: nothing unvalidated reaches the prompt or the fallback plan. */
export function handPicked(raw: unknown): Map<string, string[]> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const cleaned = new Map<string, string[]>();
  for (const [label, names] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(names)) continue;
    const picked = names.filter((n): n is string => typeof n === "string" && VALID.has(n));
    if (picked.length) cleaned.set(clip(label, MAX_LABEL_CHARS), picked);
  }
  return cleaned;
}

export function register(router: Router): void {
  router.post("/api/hyrox/analyze", async ({ request, services, identity }) => {
    const userId = identity.id;
    const profile = await services.db.transaction((tx) => getProfile(tx, userId));
    if (!profile) return fail("No profile yet. Create it first.", 404);
    if (!hasConsent(profile)) return refusal();
    const payload = await jsonBody(request);
    const race = pyTruthy(payload.race) ? payload.race : {};
    if (race === null || typeof race !== "object" || Array.isArray(race)) return fail("Invalid race.", 400);
    const segments = (race as Record<string, unknown>).segments;
    if (!Array.isArray(segments) || !segments.length) return fail("Race has no segments to analyze.", 400);
    if (segments.length > MAX_RACE_SEGMENTS || pyJsonLength(race) > MAX_RACE_CHARS) return fail("Invalid race.", 400);

    const reservation = await reserveUse(services.db, services.settings, identity, HYROX_FEATURE);
    if (!reservation.allowed) {
      // the shape the app already understands: a normal message, not an error
      return json({
        ok: true,
        overall: `You've analyzed ${RATE_LIMITS[HYROX_FEATURE][0]} races today. Please check back in ${friendlyWait(reservation.retryAfter)}.`,
        overall_detail: [],
        tips: [],
        limited: true,
        retry_after_seconds: reservation.retryAfter,
      });
    }
    let result;
    try {
      result = await analyzeRace(services.gemini, race as Record<string, unknown>);
    } catch (e) {
      await release(services.db, userId, HYROX_FEATURE, reservation);
      throw e;
    }
    if (result.failed) await release(services.db, userId, HYROX_FEATURE, reservation); // the model was unreachable: the neutral tips are not an analysis
    else await track(services.db, userId, "hyrox_ai_analysis");
    return json({ ok: true, overall: result.overall, overall_detail: result.overall_detail, tips: result.tips, limited: result.limited, retry_after_seconds: result.retry_after_seconds });
  });

  router.post("/api/generate-split", async ({ request, services, identity }) => {
    const userId = identity.id;
    const payload = await jsonBody(request);
    const splitType = pyStrip(pyStr(has(payload, "split_type") ? payload.split_type : ""));
    const goal = clip(pyStrip(pyStr(pyTruthy(payload.goal) ? payload.goal : "")), MAX_GOAL_CHARS);
    const location = pyStrip(pyStr(pyTruthy(payload.location) ? payload.location : "")).toLowerCase();

    if (!SPLIT_TYPES.has(splitType)) return fail("Unknown split type.", 400);
    const asked = typeof payload.days_per_week === "boolean" ? NaN : pyInt(payload.days_per_week);
    if (Number.isNaN(asked)) return fail("days_per_week must be a number.", 400);
    if (!(asked >= 1 && asked <= 7)) return fail("days_per_week must be between 1 and 7.", 400);
    const daysPerWeek = asked;
    const customDays = customDaysOf(payload.custom_days);
    if (customDays === null) return fail(splitType === "custom" ? "Please name at least one custom day." : "Invalid custom days.", 400);
    if (splitType === "custom" && !customDays.length) return fail("Please name at least one custom day.", 400);
    const picked = handPicked(payload.custom_days_exercises);

    // Only the model-built path needs the person's consent to AI processing; the others never leave the server.
    const needsConsent = splitType === "ai_suggest";
    const profile = await services.db.transaction((tx) => getProfile(tx, userId));
    if (!profile) return fail("No profile yet. Create it first.", 404);
    if (needsConsent && !hasConsent(profile)) return refusal();

    const reservation = await reserveUse(services.db, services.settings, identity, FEATURE);
    if (!reservation.allowed) {
      return json({
        ok: false,
        error: `You've built ${RATE_LIMITS[FEATURE][0]} plans today. Please check back in ${friendlyWait(reservation.retryAfter)}.`,
        limited: true,
        retry_after_seconds: reservation.retryAfter,
      }, 429, { "Retry-After": String(reservation.retryAfter) });
    }
    let plan;
    try {
      if (splitType === "ai_suggest") {
        const gender = pyStrip(pyStr(pyTruthy(payload.gender) ? payload.gender : "")).toLowerCase();
        plan = await suggestSplitPlan(services.gemini, {
          daysPerWeek,
          goal,
          gender: gender === "male" || gender === "female" ? gender : null,
          goalWeightKg: optionalPositiveFloat(payload.goal_weight_kg),
          currentWeightKg: optionalPositiveFloat(payload.current_weight_kg),
          location,
        });
      } else {
        plan = await generateSplitPlan(services.gemini, { splitType, daysPerWeek, customDays, goal, picked, location });
      }
    } catch (e) {
      await release(services.db, userId, FEATURE, reservation);
      throw e;
    }
    if (splitType === "ai_suggest") await track(services.db, userId, "split_ai_suggested");
    return json({ ok: true, ...plan });
  });
}
