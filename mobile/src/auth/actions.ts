/**
 * The ways in and out. Pure functions over the Supabase client (handed in, so tests use a fake) that return a result the
 * screens turn into words; none of them throws for an expected failure (wrong password, an unconfirmed address).
 */
import type { Supabase } from '@/supabase/client';

export type AuthResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-credentials' | 'email-not-confirmed' | 'rate-limited' | 'weak-password' | 'cancelled' | 'unavailable' | 'failed' }
  | { ok: false; reason: 'confirm-email' }; // sign-up worked; the person must open the email before signing in

interface AuthLikeError {
  code?: string;
  status?: number;
  message?: string;
}

/** Maps a Supabase Auth error to a reason. Codes first (stable), status as a fallback, never the message text. */
export function reasonFor(error: AuthLikeError | null | undefined): Extract<AuthResult, { ok: false }>['reason'] {
  if (!error) return 'failed';
  switch (error.code) {
    case 'invalid_credentials':
    case 'user_not_found':
      return 'invalid-credentials';
    case 'email_not_confirmed':
      return 'email-not-confirmed';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rate-limited';
    case 'weak_password':
      return 'weak-password';
  }
  if (error.status === 429) return 'rate-limited';
  if (error.status === 0 || error.status === undefined) return 'unavailable';
  return 'failed';
}

export async function signInWithEmail(supabase: Supabase, email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? { ok: false, reason: reasonFor(error) } : { ok: true };
}

/**
 * Creates the account. With "Confirm email" on (it must be), there is no session until the address is confirmed, which is
 * reported as `confirm-email`. The profile is created later, by the first signed-in launch (AuthProvider), so a person who
 * confirms on another device still ends up with one.
 */
export async function signUpWithEmail(supabase: Supabase, email: string, password: string, name: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() } } });
  if (error) return { ok: false, reason: reasonFor(error) };
  return data.session ? { ok: true } : { ok: false, reason: 'confirm-email' };
}

export async function signOut(supabase: Supabase): Promise<void> {
  await supabase.auth.signOut();
}

/** Exchanges an Apple identity token (from expo-apple-authentication) for a session. */
export async function signInWithAppleToken(supabase: Supabase, identityToken: string, nonce: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce });
  return error ? { ok: false, reason: reasonFor(error) } : { ok: true };
}
