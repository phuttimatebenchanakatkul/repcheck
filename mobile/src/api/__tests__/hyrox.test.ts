import { ApiError, type Api } from '../client';
import { hyroxEndpoints } from '../hyrox';

const api = (over: Partial<Record<keyof Api, jest.Mock>>) => ({ post: jest.fn(), get: jest.fn(), del: jest.fn(), upload: jest.fn(), request: jest.fn(), ...over }) as unknown as Api;
const RESULT = { gender: 'men', category: 'open', format: 'singles', total_seconds: 4000 };

describe('submitHyroxResult', () => {
  it('posts the time and says it was taken', async () => {
    const post = jest.fn(async () => ({ ok: true, id: 3 }));
    expect(await hyroxEndpoints(api({ post })).submitHyroxResult(RESULT)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/hyrox/results', RESULT);
  });

  it('is best effort: a refusal or no signal is false and never throws', async () => {
    expect(await hyroxEndpoints(api({ post: jest.fn().mockRejectedValue(new ApiError("That time isn't a plausible race finish.", 400)) })).submitHyroxResult(RESULT)).toBe(false);
    expect(await hyroxEndpoints(api({ post: jest.fn().mockRejectedValue(new ApiError('offline', 0)) })).submitHyroxResult(RESULT)).toBe(false);
    expect(await hyroxEndpoints(api({ post: jest.fn().mockRejectedValue(new Error('x')) })).submitHyroxResult(RESULT)).toBe(false);
  });
});
