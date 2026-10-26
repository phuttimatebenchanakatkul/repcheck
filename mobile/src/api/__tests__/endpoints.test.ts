import { ApiError, type Api } from '../client';
import { endpoints, type Profile } from '../endpoints';

const PROFILE: Profile = { id: 'u1', name: 'Sam', friend_code: 'RC-ABC123', onboarding_completed: false, ai_consent: false, deleted_at: null, due_at: null };

function fakeApi(handlers: Partial<Record<'get' | 'post' | 'del', (...args: any[]) => Promise<any>>>): Api {
  return {
    request: jest.fn(),
    upload: jest.fn(),
    get: handlers.get ?? jest.fn(),
    post: handlers.post ?? jest.fn(),
    del: handlers.del ?? jest.fn(),
  } as unknown as Api;
}

describe('endpoints', () => {
  it('health is true only for ok:true', async () => {
    expect(await endpoints(fakeApi({ get: async () => ({ ok: true }) })).health()).toBe(true);
    expect(await endpoints(fakeApi({ get: async () => ({}) })).health()).toBe(false);
  });

  it('getProfile returns the profile, null for the "no profile yet" 404, and rethrows anything else', async () => {
    expect(await endpoints(fakeApi({ get: async () => ({ ok: true, profile: PROFILE }) })).getProfile()).toEqual(PROFILE);
    expect(await endpoints(fakeApi({ get: async () => { throw new ApiError('No profile yet.', 404); } })).getProfile()).toBeNull();
    await expect(endpoints(fakeApi({ get: async () => { throw new ApiError('boom', 500); } })).getProfile()).rejects.toMatchObject({ status: 500 });
    await expect(endpoints(fakeApi({ get: async () => { throw new ApiError('no signal', 0); } })).getProfile()).rejects.toMatchObject({ status: 0 });
  });

  it('ensureProfile posts the name when given and nothing when not', async () => {
    const post = jest.fn(async () => ({ ok: true, created: true, profile: PROFILE }));
    const api = endpoints(fakeApi({ post }));
    expect(await api.ensureProfile('Sam')).toEqual({ profile: PROFILE, created: true });
    expect(post).toHaveBeenLastCalledWith('/api/profile', { name: 'Sam' });
    await api.ensureProfile();
    expect(post).toHaveBeenLastCalledWith('/api/profile', {});
  });

  it('ensureProfile reports an existing profile as not created', async () => {
    const api = endpoints(fakeApi({ post: async () => ({ ok: true, created: false, profile: PROFILE }) }));
    expect((await api.ensureProfile()).created).toBe(false);
  });

  it('rename posts the new name', async () => {
    const post = jest.fn(async () => ({ ok: true }));
    await endpoints(fakeApi({ post })).rename('New');
    expect(post).toHaveBeenCalledWith('/api/account', { name: 'New' });
  });

  it('setAiConsent sends the flag and returns what the server recorded', async () => {
    const post = jest.fn(async (_p: string, body: { granted: boolean }) => ({ ok: true, granted: body.granted }));
    const api = endpoints(fakeApi({ post }));
    expect(await api.setAiConsent(true)).toBe(true);
    expect(await api.setAiConsent(false)).toBe(false);
    expect(post).toHaveBeenCalledWith('/api/ai-consent', { granted: true });
  });

  it('deletion and restore hit the account routes and pass the schedule through', async () => {
    const schedule = { ok: true, deleted_at: '2026-01-01T00:00:00+00:00', due_at: '2026-01-31', grace_days: 30 };
    const del = jest.fn(async () => schedule);
    const post = jest.fn(async () => ({ ok: true }));
    const api = endpoints(fakeApi({ del, post }));
    expect(await api.scheduleDeletion()).toMatchObject({ due_at: '2026-01-31', grace_days: 30 });
    expect(del).toHaveBeenCalledWith('/api/account');
    await api.restoreAccount();
    expect(post).toHaveBeenCalledWith('/api/account/restore');
  });
});
