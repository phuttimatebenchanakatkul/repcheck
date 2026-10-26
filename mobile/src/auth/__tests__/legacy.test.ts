import type { LegacyLogin } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import type { Supabase } from '@/supabase/client';

import { signInWithMigration } from '../legacy';

const INVALID = { code: 'invalid_credentials', status: 400 };

/** A Supabase whose sign-in answers from a script, one answer per call. */
function supabase(...answers: (object | null)[]) {
  const signInWithPassword = jest.fn(async () => ({ error: answers.length ? answers.shift() : null }));
  return { client: { auth: { signInWithPassword } } as unknown as Supabase, signInWithPassword };
}

function api(outcome: LegacyLogin | Error) {
  const legacyLogin = jest.fn(async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  return { api: { legacyLogin }, legacyLogin };
}

describe('signInWithMigration', () => {
  it('a normal sign-in never asks the server about the old website', async () => {
    const s = supabase(null);
    const a = api('migrated');
    expect(await signInWithMigration(s.client, a.api, 'a@b.co', 'pw')).toEqual({ ok: true });
    expect(a.legacyLogin).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'email_not_confirmed', status: 400 }, 'email-not-confirmed'],
    [{ code: 'over_request_rate_limit', status: 429 }, 'rate-limited'],
    [{ status: 0 }, 'unavailable'],
    [{ status: 500 }, 'failed'],
  ])('only a wrong-credentials answer triggers the fallback: %j', async (error, reason) => {
    const s = supabase(error);
    const a = api('migrated');
    expect(await signInWithMigration(s.client, a.api, 'a@b.co', 'pw')).toEqual({ ok: false, reason });
    expect(a.legacyLogin).not.toHaveBeenCalled();
  });

  it('a migrated password is then signed in with Supabase itself, with the same values', async () => {
    const s = supabase(INVALID, null);
    const a = api('migrated');
    expect(await signInWithMigration(s.client, a.api, ' a@b.co ', ' pw ')).toEqual({ ok: true });
    expect(a.legacyLogin).toHaveBeenCalledWith('a@b.co', ' pw ');
    expect(s.signInWithPassword.mock.calls).toEqual([[{ email: 'a@b.co', password: ' pw ' }], [{ email: 'a@b.co', password: ' pw ' }]]);
  });

  it('after migrating, an unconfirmed address is reported as such (the app then offers the confirmation email)', async () => {
    const s = supabase(INVALID, { code: 'email_not_confirmed', status: 400 });
    expect(await signInWithMigration(s.client, api('migrated').api, 'a@b.co', 'pw')).toEqual({ ok: false, reason: 'email-not-confirmed' });
  });

  it('an ordinary wrong password stays an ordinary wrong password', async () => {
    const s = supabase(INVALID);
    expect(await signInWithMigration(s.client, api('mismatch').api, 'a@b.co', 'pw')).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(s.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['reset-required', 'reset-required'],
    ['rate-limited', 'rate-limited'],
    ['unavailable', 'unavailable'],
  ] as const)('the server saying %s is passed on', async (outcome, reason) => {
    const s = supabase(INVALID);
    expect(await signInWithMigration(s.client, api(outcome).api, 'a@b.co', 'pw')).toEqual({ ok: false, reason });
    expect(s.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('a server that errors does not hide what Supabase said', async () => {
    const s = supabase(INVALID);
    expect(await signInWithMigration(s.client, api(new ApiError('boom', 500)).api, 'a@b.co', 'pw')).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('asks the server at most once per attempt', async () => {
    const s = supabase(INVALID, INVALID);
    const a = api('migrated');
    expect(await signInWithMigration(s.client, a.api, 'a@b.co', 'pw')).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(a.legacyLogin).toHaveBeenCalledTimes(1);
  });
});
