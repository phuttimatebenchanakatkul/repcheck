import { ApiError } from '@/api/client';
import type { Endpoints, Profile } from '@/api/endpoints';

import { loadOrCreateProfile, nameFromMetadata } from '../profile';

const PROFILE = (name: string): Profile => ({ id: 'u', name, friend_code: 'RC-AAAAAA', onboarding_completed: false, ai_consent: false, deleted_at: null, due_at: null });

function fake(opts: { existing?: Profile | null; ensure?: (name?: string) => Promise<{ profile: Profile; created: boolean }> }) {
  const ensureProfile = jest.fn(opts.ensure ?? (async (name?: string) => ({ profile: PROFILE(name ?? 'Provider Name'), created: true })));
  const getProfile = jest.fn(async () => opts.existing ?? null);
  return { api: { getProfile, ensureProfile } as unknown as Endpoints, ensureProfile, getProfile };
}

const refused = () => new ApiError('Please choose a different name.', 400);

describe('loadOrCreateProfile', () => {
  it('uses an existing profile and creates nothing', async () => {
    const { api, ensureProfile } = fake({ existing: PROFILE('Sam') });
    expect(await loadOrCreateProfile(api, ['Hint'])).toEqual({ state: 'ready', profile: PROFILE('Sam') });
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it('creates the profile with the first usable hint', async () => {
    const { api, ensureProfile } = fake({});
    const outcome = await loadOrCreateProfile(api, [null, '  ', ' Typed Name ', 'Apple Name']);
    expect(outcome).toMatchObject({ state: 'ready', profile: { name: 'Typed Name' } });
    expect(ensureProfile).toHaveBeenCalledTimes(1);
    expect(ensureProfile).toHaveBeenCalledWith('Typed Name');
  });

  it('drops a hint the name filter refuses and tries the next, then the provider default', async () => {
    const { api, ensureProfile } = fake({
      ensure: async (name) => {
        if (name === 'Bad One' || name === 'Worse') throw refused();
        return { profile: PROFILE(name ?? 'Provider Name'), created: true };
      },
    });
    expect(await loadOrCreateProfile(api, ['Bad One', 'Worse'])).toMatchObject({ state: 'ready', profile: { name: 'Provider Name' } });
    expect(ensureProfile.mock.calls.map((c) => c[0])).toEqual(['Bad One', 'Worse', undefined]);
  });

  it('asks an email account for a name when nothing usable is left', async () => {
    const { api } = fake({
      ensure: async () => {
        throw new ApiError('Please enter your name.', 400);
      },
    });
    expect(await loadOrCreateProfile(api, [])).toEqual({ state: 'needs-name' });
    expect(await loadOrCreateProfile(api, ['  '])).toEqual({ state: 'needs-name' });
  });

  it('does not swallow a server error while trying a hint (even though the default would have worked)', async () => {
    const { api, ensureProfile } = fake({
      ensure: async (name) => {
        if (name) throw new ApiError('boom', 500);
        return { profile: PROFILE('Provider Name'), created: true };
      },
    });
    await expect(loadOrCreateProfile(api, ['Name'])).rejects.toMatchObject({ status: 500 });
    expect(ensureProfile).toHaveBeenCalledTimes(1);
  });

  it('does not swallow a network error', async () => {
    const { api } = fake({ ensure: async () => { throw new ApiError('no signal', 0); } });
    await expect(loadOrCreateProfile(api, [])).rejects.toMatchObject({ status: 0 });
  });

  it('does not swallow an error that is not an ApiError', async () => {
    const { api } = fake({ ensure: async () => { throw new TypeError('bug'); } });
    await expect(loadOrCreateProfile(api, ['Name'])).rejects.toThrow(TypeError);
  });

  it('a failure to read the profile surfaces (the screen offers a retry)', async () => {
    const api = { getProfile: jest.fn(async () => { throw new ApiError('no signal', 0); }), ensureProfile: jest.fn() } as unknown as Endpoints;
    await expect(loadOrCreateProfile(api, ['x'])).rejects.toMatchObject({ status: 0 });
  });
});

describe('nameFromMetadata', () => {
  it('prefers full_name, falls back to name, trims, and ignores anything that is not a non-empty string', () => {
    expect(nameFromMetadata({ full_name: ' Sam Lifter ', name: 'x' })).toBe('Sam Lifter');
    expect(nameFromMetadata({ name: 'Provider' })).toBe('Provider');
    for (const bad of [{}, null, undefined, { full_name: '' }, { full_name: '   ' }, { full_name: 5 }, { full_name: ['a'] }, { full_name: null, name: null }]) {
      expect(nameFromMetadata(bad as never)).toBeNull();
    }
  });
});
