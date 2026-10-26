import { ApiError, type Api } from '../client';
import { GENERATE_TIMEOUT_MS, planEndpoints } from '../plan';

const PLAN = {
  ok: true,
  days: [{ label: 'Push', exercises: ['Dips'] }],
  schedule: { monday: 'Push' },
  rationale: 'Because.',
  split_type: 'ppl',
};

const fakeApi = (request: (...args: any[]) => Promise<any>): Api => ({ request, get: jest.fn(), post: jest.fn(), del: jest.fn(), upload: jest.fn() }) as unknown as Api;

describe('generateSplit', () => {
  it('posts the request with a long timeout and returns the checked plan', async () => {
    const request = jest.fn(async () => PLAN);
    const generated = await planEndpoints(fakeApi(request)).generateSplit({ split_type: 'ppl', days_per_week: 3 });
    expect(request).toHaveBeenCalledWith('/api/generate-split', { method: 'POST', json: { split_type: 'ppl', days_per_week: 3 }, timeoutMs: GENERATE_TIMEOUT_MS });
    expect(generated).toMatchObject({ days: [{ label: 'Push', exercises: ['Dips'] }], rationale: 'Because.', splitType: 'ppl' });
    expect(generated.schedule.monday).toBe('Push');
    expect(generated.schedule.tuesday).toBe('Rest');
    expect(GENERATE_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it('an answer that is not a plan is an error, not an empty plan', async () => {
    await expect(planEndpoints(fakeApi(async () => ({ ok: true, days: [] }))).generateSplit({})).rejects.toMatchObject({ status: 502 });
  });

  it('lets the server’s refusals through untouched (consent, daily limit, bad request)', async () => {
    for (const error of [new ApiError('Turn on AI.', 403, { needs_ai_consent: true }), new ApiError('You have built 5 plans today.', 429, {}, 3600), new ApiError('Unknown split type.', 400)]) {
      await expect(planEndpoints(fakeApi(async () => { throw error; })).generateSplit({})).rejects.toBe(error);
    }
  });
});
