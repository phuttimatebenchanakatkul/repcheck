/** The coaching calculation (api/routes/coaching.py): the website's own coaching_engine, run on the server. */
import type { Json } from '../supabase/database.types';
import { ApiError, type Api } from './client';

export interface Targets {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  bmr: number;
  tdee: number;
}

export interface Calculation {
  targets: Targets;
  /** The week laid out day by day (more on training days), when the person chose to spread calories; null for a stable target. */
  distribution: Json | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** Reads the server's answer; null unless it carries all four targets. (bmr and tdee are shown for transparency, so default to 0.) */
export function parseCalculation(body: unknown): Calculation | null {
  if (!isRecord(body) || !isRecord(body.targets)) return null;
  const t = body.targets;
  const calories = whole(t.calories);
  const protein = whole(t.protein);
  const fat = whole(t.fat);
  const carbs = whole(t.carbs);
  if (calories === null || protein === null || fat === null || carbs === null) return null;
  return {
    targets: { calories, protein, fat, carbs, bmr: whole(t.bmr) ?? 0, tdee: whole(t.tdee) ?? 0 },
    distribution: isRecord(body.distribution) || Array.isArray(body.distribution) ? (body.distribution as Json) : null,
  };
}

export function coachingEndpoints(api: Api) {
  return {
    /**
     * Works out calorie and macro targets for a set of answers. Throws ApiError: 400 with the reason in words safe to show (an unrealistic
     * weight, a missing choice). An answer that is not a set of targets is a 502.
     */
    async calculateTargets(request: Record<string, unknown>): Promise<Calculation> {
      const body = await api.post('/api/coaching/calculate', request);
      const calculation = parseCalculation(body);
      if (!calculation) throw new ApiError("Couldn't read that result. Please try again.", 502, body);
      return calculation;
    },
  };
}
