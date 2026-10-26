import type { Endpoints } from '@/api/endpoints';
import type { Supabase } from '@/supabase/client';

import { signInWithEmail, type AuthResult } from './actions';

/**
 * Email + password sign-in that also covers an account imported from the old website, whose password Supabase does not know yet
 * (MOBILE_APP_PLAN.md, "Passwords"). Supabase is tried first and always wins. Only when it says the credentials are wrong is the
 * server asked, once, to check them against the old hash and carry the password across; then Supabase is tried again.
 *
 * The server answers the same "no" for an unknown address, an account with no old hash and a wrong password, so nothing here (or
 * on the wire) tells a stranger whether an address has an account.
 */
export async function signInWithMigration(supabase: Supabase, api: Pick<Endpoints, 'legacyLogin'>, email: string, password: string): Promise<AuthResult> {
  const first = await signInWithEmail(supabase, email, password);
  if (first.ok || first.reason !== 'invalid-credentials') return first;

  let outcome;
  try {
    outcome = await api.legacyLogin(email.trim(), password);
  } catch {
    return first; // the server is not helping: report what Supabase said
  }
  switch (outcome) {
    case 'migrated':
      return signInWithEmail(supabase, email, password); // now Supabase knows it (or says the address still needs confirming)
    case 'reset-required':
      return { ok: false, reason: 'reset-required' };
    case 'rate-limited':
      return { ok: false, reason: 'rate-limited' };
    case 'unavailable':
      return { ok: false, reason: 'unavailable' };
    default:
      return first; // 'mismatch': an ordinary wrong password
  }
}
