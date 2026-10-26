import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import type { Supabase } from '@/supabase/client';

import { reasonFor, type AuthResult } from './actions';

/**
 * Google sign-in through Supabase's OAuth (PKCE) in the system browser sheet. It needs, in the Supabase dashboard, the Google
 * provider enabled with a Google OAuth client, and `repcheck://auth-callback` in the allowed redirect URLs; until then the
 * sign-in screen does not offer it (see EXPO_PUBLIC_GOOGLE_SIGN_IN in .env.example). Not yet exercised against a real
 * Google account: see MOBILE_APP_PLAN.md, "Phase 2 status".
 */
export const GOOGLE_ENABLED = process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN === '1';

export type CallbackParams = { code: string } | { error: string };

/** The `code` (or the provider's error) from the URL the browser sheet comes back with. The code is in the query string under PKCE. */
export function parseAuthCallback(url: string): CallbackParams | null {
  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');
  const parts = [queryStart >= 0 ? url.slice(queryStart + 1, hashStart > queryStart ? hashStart : undefined) : '', hashStart >= 0 ? url.slice(hashStart + 1) : ''];
  for (const part of parts) {
    const params = new URLSearchParams(part);
    const error = params.get('error_description') ?? params.get('error');
    if (error) return { error };
    const code = params.get('code');
    if (code) return { code };
  }
  return null;
}

export async function signInWithGoogle(supabase: Supabase): Promise<AuthResult> {
  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) return { ok: false, reason: reasonFor(error) };

  const browser = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (browser.type !== 'success') return { ok: false, reason: 'cancelled' };
  const callback = parseAuthCallback(browser.url);
  if (!callback || 'error' in callback) return { ok: false, reason: 'failed' };
  const exchanged = await supabase.auth.exchangeCodeForSession(callback.code);
  return exchanged.error ? { ok: false, reason: reasonFor(exchanged.error) } : { ok: true };
}
