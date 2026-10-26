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
  it('legacyLogin posts the credentials and maps every answer the server gives', async () => {
    const post = jest.fn(async () => ({ ok: true }));
    expect(await endpoints(fakeApi({ post })).legacyLogin('a@b.co', 'pw')).toBe('migrated');
    expect(post).toHaveBeenCalledWith('/api/auth/legacy-login', { email: 'a@b.co', password: 'pw' });
    const failing = (error: ApiError) => endpoints(fakeApi({ post: async () => { throw error; } })).legacyLogin('a@b.co', 'pw');
    expect(await failing(new ApiError('no', 401))).toBe('mismatch');
    expect(await failing(new ApiError('reset', 409, { reset_required: true }))).toBe('reset-required');
    expect(await failing(new ApiError('slow', 429, {}, 60))).toBe('rate-limited');
    expect(await failing(new ApiError('offline', 0))).toBe('unavailable');
  });

  it('legacyLogin does not mistake an unrelated 409 or a server error for an answer', async () => {
    const failing = (error: ApiError) => endpoints(fakeApi({ post: async () => { throw error; } })).legacyLogin('a@b.co', 'pw');
    await expect(failing(new ApiError('conflict', 409))).rejects.toMatchObject({ status: 409 });
    await expect(failing(new ApiError('boom', 500))).rejects.toMatchObject({ status: 500 });
  });

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

  describe('custom foods and exercises', () => {
    const food = { id: 5, name: 'Shake', emoji: '🥤', calories: 300, protein: 30, fat: 5, carbs: 30, barcode: null, servingLabel: '1 bottle', servingGrams: 400, servings: [] };
    const exercise = { id: 2, name: 'Sled push', emoji: null, mode: 'both' as const };

    it('lists them, and an answer without the list is an empty one', async () => {
      const get = jest.fn(async (path: string) => (path === '/api/custom-foods' ? { ok: true, foods: [food] } : { ok: true, exercises: [exercise] }));
      const api = endpoints(fakeApi({ get }));
      expect(await api.listCustomFoods()).toEqual([food]);
      expect(await api.listCustomExercises()).toEqual([exercise]);
      expect(get).toHaveBeenCalledWith('/api/custom-foods');
      expect(get).toHaveBeenCalledWith('/api/custom-exercises');
      const empty = endpoints(fakeApi({ get: async () => ({ ok: true }) }));
      expect(await empty.listCustomFoods()).toEqual([]);
      expect(await empty.listCustomExercises()).toEqual([]);
    });

    it('creates one by posting it and returns what the server made', async () => {
      const post = jest.fn(async (path: string) => (path === '/api/custom-foods' ? { ok: true, food } : { ok: true, exercise }));
      const api = endpoints(fakeApi({ post }));
      const input = { name: 'Shake', protein: 30, fat: 5, carbs: 30, servingLabel: '1 bottle', servingGrams: 400 };
      expect(await api.createCustomFood(input)).toEqual(food);
      expect(post).toHaveBeenCalledWith('/api/custom-foods', input);
      expect(await api.createCustomExercise({ name: 'Sled push', mode: 'both' })).toEqual(exercise);
      expect(post).toHaveBeenCalledWith('/api/custom-exercises', { name: 'Sled push', mode: 'both' });
    });

    it('lets the server’s refusal through untouched', async () => {
      const refusal = new ApiError('You already have a custom food saved for this barcode.', 409);
      const api = endpoints(fakeApi({ post: async () => { throw refusal; } }));
      await expect(api.createCustomFood({ name: 'x', protein: 1, fat: 1, carbs: 1 })).rejects.toBe(refusal);
    });

    it('deletes by id', async () => {
      const del = jest.fn(async () => ({ ok: true }));
      const api = endpoints(fakeApi({ del }));
      await api.deleteCustomFood(5);
      await api.deleteCustomExercise(2);
      expect(del).toHaveBeenCalledWith('/api/custom-foods/5');
      expect(del).toHaveBeenCalledWith('/api/custom-exercises/2');
    });
  });

  describe('activityDates', () => {
    it('asks for the days in the person’s own time zone and returns the map', async () => {
      const get = jest.fn(async () => ({ ok: true, dates: { '2026-10-25': ['challenge'] } }));
      expect(await endpoints(fakeApi({ get })).activityDates(420)).toEqual({ '2026-10-25': ['challenge'] });
      expect(get).toHaveBeenCalledWith('/api/activity/dates', { tz_offset_minutes: 420 });
    });

    it('a negative offset (west of Greenwich) is sent as it is', async () => {
      const get = jest.fn(async () => ({ ok: true, dates: {} }));
      await endpoints(fakeApi({ get })).activityDates(-300);
      expect(get).toHaveBeenCalledWith('/api/activity/dates', { tz_offset_minutes: -300 });
    });

    it('an answer without dates is no days', async () => {
      expect(await endpoints(fakeApi({ get: async () => ({ ok: true }) })).activityDates(0)).toEqual({});
    });
  });
});
