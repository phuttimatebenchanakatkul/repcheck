/** The coaching calculation (api/routes/coaching.py): the website's own coaching_engine, run on the server. */
import { parseAdjustment, type Adjustment } from '../logic/checkin';
import type { Json } from '../supabase/database.types';
import { ApiError, type Api } from './client';
import type { PickedImage } from './scan';

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

/** The check-in may call a model that reads photos; the server caps that at 30 s, so this leaves room for the upload and the trip. */
export const CHECKIN_TIMEOUT_MS = 60_000;

export type PhotoAngle = 'front' | 'back';

export function checkinEndpoints(api: Api) {
  return {
    /**
     * The week's calorie adjustment: null when no change is needed ("on track"), else the new targets and why. Throws ApiError: 400 with the
     * reason in words safe to show (a missing profile field), anything else the general line. An answer that is neither is a 502, never
     * "on track", so a failed check-in does not spend the week.
     */
    async weeklyAdjustment(request: Record<string, unknown>): Promise<Adjustment | null> {
      const body = await api.request('/api/coaching/weekly-adjustment', { method: 'POST', json: request, timeoutMs: CHECKIN_TIMEOUT_MS });
      const adjustment = parseAdjustment(body);
      if (adjustment === undefined) throw new ApiError("Couldn't read that result. Please try again.", 502, body);
      return adjustment;
    },

    /** Keeps one progress photo for the check-in; its id, or null if it could not be kept (best effort: the check-in goes on without it). */
    async uploadCheckinPhoto(image: PickedImage, angle: PhotoAngle, date: string): Promise<number | null> {
      try {
        const form = new FormData();
        form.append('photo', { uri: image.uri, name: image.name ?? 'photo.jpg', type: image.mimeType ?? 'image/jpeg' } as unknown as Blob);
        form.append('angle', angle);
        form.append('date', date);
        const body = await api.upload('/api/checkin/photo', form, CHECKIN_TIMEOUT_MS);
        return typeof body.id === 'number' ? body.id : null;
      } catch {
        return null;
      }
    },
  };
}
