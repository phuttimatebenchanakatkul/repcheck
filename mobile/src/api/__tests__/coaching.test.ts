import { ApiError, type Api } from '../client';
import { coachingEndpoints, parseCalculation } from '../coaching';

const TARGETS = { calories: 2150, protein: 160, fat: 70, carbs: 230, bmr: 1700, tdee: 2400 };

describe('parseCalculation', () => {
  it('reads targets, and no distribution for a stable plan', () => {
    expect(parseCalculation({ ok: true, targets: TARGETS, distribution: null })).toEqual({ targets: TARGETS, distribution: null });
  });

  it('keeps a week laid out day by day', () => {
    const week = { monday: { calories: 2300 }, tuesday: { calories: 2000 } };
    expect(parseCalculation({ targets: TARGETS, distribution: week })?.distribution).toEqual(week);
    expect(parseCalculation({ targets: TARGETS, distribution: [1, 2] })?.distribution).toEqual([1, 2]);
  });

  it('a missing bmr or tdee is zero (they are for show), but every target is needed', () => {
    expect(parseCalculation({ targets: { calories: 2000, protein: 150, fat: 60, carbs: 200 } })?.targets).toEqual({ calories: 2000, protein: 150, fat: 60, carbs: 200, bmr: 0, tdee: 0 });
    for (const key of ['calories', 'protein', 'fat', 'carbs'] as const) {
      expect(parseCalculation({ targets: { ...TARGETS, [key]: undefined } })).toBeNull();
      expect(parseCalculation({ targets: { ...TARGETS, [key]: '100' } })).toBeNull();
      expect(parseCalculation({ targets: { ...TARGETS, [key]: -1 } })).toBeNull();
      expect(parseCalculation({ targets: { ...TARGETS, [key]: NaN } })).toBeNull();
    }
  });

  it('zero is a number, not a missing one', () => {
    expect(parseCalculation({ targets: { ...TARGETS, carbs: 0 } })?.targets.carbs).toBe(0);
  });

  it('a distribution of the wrong kind is none', () => {
    expect(parseCalculation({ targets: TARGETS, distribution: 'weekly' })?.distribution).toBeNull();
    expect(parseCalculation({ targets: TARGETS, distribution: 5 })?.distribution).toBeNull();
  });

  it.each([[null], [undefined], ['x'], [[]], [{}], [{ targets: null }], [{ targets: [] }]])('not a calculation: %j', (body) => {
    expect(parseCalculation(body)).toBeNull();
  });
});

describe('calculateTargets', () => {
  const api = (post: (...args: unknown[]) => Promise<unknown>) => ({ post, get: jest.fn(), del: jest.fn(), upload: jest.fn(), request: jest.fn() }) as unknown as Api;

  it('posts the answers and returns the targets', async () => {
    const post = jest.fn(async () => ({ ok: true, targets: TARGETS, distribution: null }));
    const result = await coachingEndpoints(api(post)).calculateTargets({ aspiration: 'lose' });
    expect(post).toHaveBeenCalledWith('/api/coaching/calculate', { aspiration: 'lose' });
    expect(result.targets.calories).toBe(2150);
  });

  it('an answer that is not targets is a 502', async () => {
    await expect(coachingEndpoints(api(async () => ({ ok: true }))).calculateTargets({})).rejects.toMatchObject({ status: 502 });
  });

  it('a refusal is passed on with its words', async () => {
    const post = jest.fn().mockRejectedValue(new ApiError('Please enter a realistic weight of at least 35 kg.', 400));
    await expect(coachingEndpoints(api(post)).calculateTargets({})).rejects.toMatchObject({ status: 400, message: 'Please enter a realistic weight of at least 35 kg.' });
  });
});
