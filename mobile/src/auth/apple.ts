import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import type { Supabase } from '@/supabase/client';

import { reasonFor, signInWithAppleToken, type AuthResult } from './actions';

export interface AppleSignIn {
  result: AuthResult;
  /** The name Apple shared; it is sent on the FIRST sign-in only, so it has to be kept now or never. */
  fullName: string | null;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Native Sign in with Apple. Apple gets the SHA-256 of a random nonce and puts that hash in the identity token; Supabase is
 * given the RAW nonce and hashes it itself to compare, which is what stops a stolen token being replayed.
 */
export async function signInWithApple(supabase: Supabase): Promise<AppleSignIn> {
  const rawNonce = hex(await Crypto.getRandomBytesAsync(16));
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return { result: { ok: false, reason: 'failed' }, fullName: null };
    const name = credential.fullName ? AppleAuthentication.formatFullName(credential.fullName).trim() : '';
    return { result: await signInWithAppleToken(supabase, credential.identityToken, rawNonce), fullName: name || null };
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { result: { ok: false, reason: 'cancelled' }, fullName: null };
    return { result: { ok: false, reason: reasonFor(error as { code?: string; status?: number }) }, fullName: null };
  }
}

export function appleSignInAvailable(): Promise<boolean> {
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}
