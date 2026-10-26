/**
 * The ways in and out. Pure functions over the Supabase client (handed in, so tests use a fake) that return a result the
 * screens turn into words; none of them throws for an expected failure (wrong password, an unconfirmed address).
 */
import type { Supabase } from '@/supabase/client';

export type AuthResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'invalid-credentials'
        | 'email-not-confirmed'
        | 'rate-limited'
        | 'weak-password'
        | 'cancelled'
        | 'unavailable'
        | 'failed'
        /** An imported account whose old password the project will not accept: it must be reset by email. */
        | 'reset-required'
        /** The recovery link was already used, expired, or was requested on another device. */
        | 'link-invalid';
    }
  | { ok: false; reason: 'confirm-email' }; // sign-up worked; the person must open the email before signing in

interface AuthLikeError {
  name?: string;
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
    case 'same_password':
      return 'weak-password';
    case 'flow_state_not_found':
    case 'flow_state_expired':
    case 'bad_code_verifier':
    case 'otp_expired':
    case 'validation_failed':
      return 'link-invalid';
  }
  if (error.name === 'AuthPKCECodeVerifierMissingError') return 'link-invalid'; // the reset was asked for on another device
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

/**
 * Emails a password-reset link. The answer never says whether the address has an account (Supabase answers the same either
 * way, and so does this), so it cannot be used to find out who is a member. The link comes back to the app as `redirectTo`.
 */
export async function requestPasswordReset(supabase: Supabase, email: string, redirectTo: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  return error ? { ok: false, reason: reasonFor(error) } : { ok: true };
}

/** Sends the sign-up confirmation email again (for an account that was created but never confirmed, imported ones included). */
export async function resendConfirmation(supabase: Supabase, email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
  return error ? { ok: false, reason: reasonFor(error) } : { ok: true };
}

/**
 * Turns the one-time `code` from a recovery link into a session. That session is only for choosing a new password: the
 * auth provider sees PASSWORD_RECOVERY and holds the person on the new-password screen until it is done.
 */
export async function exchangeRecoveryCode(supabase: Supabase, code: string): Promise<AuthResult> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error ? { ok: false, reason: reasonFor(error) } : { ok: true };
}

export async function updatePassword(supabase: Supabase, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.updateUser({ password });
  return error ? { ok: false, reason: reasonFor(error) } : { ok: true };
}
