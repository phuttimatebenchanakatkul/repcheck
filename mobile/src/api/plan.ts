/** The split planner route (api/routes/planning.py). */
import { parseGenerated, type Generated } from '../logic/splitPlan';
import { ApiError, type Api } from './client';

/** Building a plan can take the model a while; the default 30 s is too short. */
export const GENERATE_TIMEOUT_MS = 90_000;

export function planEndpoints(api: Api) {
  return {
    /**
     * Asks the server for a split. Throws ApiError: 403 `needsAiConsent` (the AI path only), 429 with `retryAfter` when the daily number
     * of plans is used up, 400 for a request it refuses (the message is safe to show). An answer that is not a usable plan is a 502.
     */
    async generateSplit(request: Record<string, unknown>): Promise<Generated> {
      const body = await api.request('/api/generate-split', { method: 'POST', json: request, timeoutMs: GENERATE_TIMEOUT_MS });
      const generated = parseGenerated(body);
      if (!generated) throw new ApiError("Couldn't read that plan. Please try again.", 502, body);
      return generated;
    },
  };
}
