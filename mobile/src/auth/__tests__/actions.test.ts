import type { Supabase } from '@/supabase/client';

import { exchangeRecoveryCode, reasonFor, requestPasswordReset, resendConfirmation, signInWithAppleToken, signInWithEmail, signOut, signUpWithEmail, updatePassword } from '../actions';
import { parseAuthCallback } from '../google';

type Auth = Record<string, jest.Mock>;
const client = (auth: Auth) => ({ auth }) as unknown as Supabase;

describe('reasonFor', () => {
  it.each([
    [{ code: 'invalid_credentials', status: 400 }, 'invalid-credentials'],
    [{ code: 'user_not_found' }, 'invalid-credentials'],
    [{ code: 'email_not_confirmed', status: 400 }, 'email-not-confirmed'],
    [{ code: 'over_request_rate_limit', status: 429 }, 'rate-limited'],
    [{ code: 'over_email_send_rate_limit' }, 'rate-limited'],
    [{ code: 'weak_password', status: 422 }, 'weak-password'],
    [{ code: 'same_password', status: 422 }, 'weak-password'],
    [{ code: 'otp_expired', status: 403 }, 'link-invalid'],
    [{ code: 'flow_state_expired', status: 400 }, 'link-invalid'],
    [{ code: 'flow_state_not_found', status: 404 }, 'link-invalid'],
    [{ code: 'bad_code_verifier', status: 400 }, 'link-invalid'],
    [{ name: 'AuthPKCECodeVerifierMissingError', status: 400 }, 'link-invalid'],
    [{ status: 429 }, 'rate-limited'],
    [{ status: 0 }, 'unavailable'],
    [{}, 'unavailable'],
    [{ status: 500 }, 'failed'],
    [{ status: 400, code: 'something_else' }, 'failed'],
    [null, 'failed'],
    [undefined, 'failed'],
  ])('%j -> %s', (error, reason) => {
    expect(reasonFor(error as never)).toBe(reason);
  });

  it('goes by code, never by message text (which Supabase may reword)', () => {
    expect(reasonFor({ message: 'Invalid login credentials', status: 400 })).toBe('failed');
  });
});

describe('email sign-in and sign-up', () => {
  it('signs in with the trimmed email and the password untouched', async () => {
    const signInWithPassword = jest.fn(async () => ({ error: null }));
    expect(await signInWithEmail(client({ signInWithPassword }), '  a@b.co ', ' p w ')).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: ' p w ' });
  });

  it('reports a wrong password as a reason, not an exception', async () => {
    const signInWithPassword = jest.fn(async () => ({ error: { code: 'invalid_credentials', status: 400 } }));
    expect(await signInWithEmail(client({ signInWithPassword }), 'a@b.co', 'x')).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('sign-up carries the typed name in user metadata and reports "confirm your email" when there is no session', async () => {
    const signUp = jest.fn(async () => ({ data: { session: null }, error: null }));
    expect(await signUpWithEmail(client({ signUp }), ' a@b.co', 'secret123', '  Sam  ')).toEqual({ ok: false, reason: 'confirm-email' });
    expect(signUp).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret123', options: { data: { full_name: 'Sam' } } });
  });

  it('sign-up with an immediate session is a success', async () => {
    const signUp = jest.fn(async () => ({ data: { session: { access_token: 't' } }, error: null }));
    expect(await signUpWithEmail(client({ signUp }), 'a@b.co', 'secret123', 'Sam')).toEqual({ ok: true });
  });

  it('sign-up maps a weak password and a rate limit', async () => {
    const weak = jest.fn(async () => ({ data: { session: null }, error: { code: 'weak_password', status: 422 } }));
    expect(await signUpWithEmail(client({ signUp: weak }), 'a@b.co', '1', 'S')).toEqual({ ok: false, reason: 'weak-password' });
    const limited = jest.fn(async () => ({ data: { session: null }, error: { status: 429 } }));
    expect(await signUpWithEmail(client({ signUp: limited }), 'a@b.co', 'x', 'S')).toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('signOut calls Supabase', async () => {
    const signOutFn = jest.fn(async () => ({ error: null }));
    await signOut(client({ signOut: signOutFn }));
    expect(signOutFn).toHaveBeenCalledTimes(1);
  });
});

describe('Apple', () => {
  it('hands Supabase the identity token and the RAW nonce', async () => {
    const signInWithIdToken = jest.fn(async () => ({ error: null }));
    expect(await signInWithAppleToken(client({ signInWithIdToken }), 'id-token', 'raw-nonce')).toEqual({ ok: true });
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'id-token', nonce: 'raw-nonce' });
  });

  it('reports a refusal as a reason', async () => {
    const signInWithIdToken = jest.fn(async () => ({ error: { status: 400, code: 'bad_jwt' } }));
    expect(await signInWithAppleToken(client({ signInWithIdToken }), 't', 'n')).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('parseAuthCallback (Google)', () => {
  it('reads the PKCE code from the query string', () => {
    expect(parseAuthCallback('repcheck://auth-callback?code=abc123')).toEqual({ code: 'abc123' });
    expect(parseAuthCallback('exp://192.168.1.2:8081/--/auth-callback?code=abc&state=x')).toEqual({ code: 'abc' });
  });

  it('prefers the provider error, and its description over its code', () => {
    expect(parseAuthCallback('repcheck://auth-callback?error=access_denied&error_description=User+said+no')).toEqual({ error: 'User said no' });
    expect(parseAuthCallback('repcheck://auth-callback#error=access_denied')).toEqual({ error: 'access_denied' });
    expect(parseAuthCallback('repcheck://auth-callback?code=abc&error=oops')).toEqual({ error: 'oops' });
  });

  it('also finds a code in the fragment', () => {
    expect(parseAuthCallback('repcheck://auth-callback#code=frag')).toEqual({ code: 'frag' });
  });

  it('returns null when there is neither', () => {
    expect(parseAuthCallback('repcheck://auth-callback')).toBeNull();
    expect(parseAuthCallback('repcheck://auth-callback?foo=bar#baz=1')).toBeNull();
    expect(parseAuthCallback('')).toBeNull();
  });

  it('never takes tokens from the URL: only a code is accepted', () => {
    expect(parseAuthCallback('repcheck://auth-callback#access_token=a&refresh_token=b')).toBeNull();
  });
});

describe('password reset and confirmation', () => {
  it('requestPasswordReset trims the address and says where the link must come back to', async () => {
    const resetPasswordForEmail = jest.fn(async () => ({ error: null }));
    expect(await requestPasswordReset(client({ resetPasswordForEmail }), ' a@b.co ', 'repcheck://reset-password')).toEqual({ ok: true });
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', { redirectTo: 'repcheck://reset-password' });
  });

  it('requestPasswordReset reports a rate limit, and nothing else about the address', async () => {
    const limited = jest.fn(async () => ({ error: { code: 'over_email_send_rate_limit', status: 429 } }));
    expect(await requestPasswordReset(client({ resetPasswordForEmail: limited }), 'a@b.co', 'x')).toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('resendConfirmation asks for another sign-up email for the trimmed address', async () => {
    const resend = jest.fn(async () => ({ error: null }));
    expect(await resendConfirmation(client({ resend }), ' a@b.co ')).toEqual({ ok: true });
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@b.co' });
  });

  it('resendConfirmation reports the failure', async () => {
    const resend = jest.fn(async () => ({ error: { code: 'over_email_send_rate_limit', status: 429 } }));
    expect(await resendConfirmation(client({ resend }), 'a@b.co')).toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('exchangeRecoveryCode swaps the code and reports a dead link as such', async () => {
    const exchangeCodeForSession = jest.fn(async () => ({ error: null }));
    expect(await exchangeRecoveryCode(client({ exchangeCodeForSession }), 'abc')).toEqual({ ok: true });
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    const dead = jest.fn(async () => ({ error: { code: 'flow_state_expired', status: 400 } }));
    expect(await exchangeRecoveryCode(client({ exchangeCodeForSession: dead }), 'abc')).toEqual({ ok: false, reason: 'link-invalid' });
  });

  it('updatePassword sets exactly the password, untouched, and reports a refusal', async () => {
    const updateUser = jest.fn(async () => ({ error: null }));
    expect(await updatePassword(client({ updateUser }), ' new pw ')).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ password: ' new pw ' });
    const weak = jest.fn(async () => ({ error: { code: 'weak_password', status: 422 } }));
    expect(await updatePassword(client({ updateUser: weak }), 'x')).toEqual({ ok: false, reason: 'weak-password' });
  });
});
