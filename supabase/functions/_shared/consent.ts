/** Consent to AI processing (App Review 5.1.2(i)).
 *
 * Everything that sends a person's content to Google Gemini (photos, lift videos, chat messages, workout logs, body
 * stats) needs their explicit consent first, and they must be able to take it back. The app asks before the first
 * request leaves the device; these checks make the server refuse regardless, so a stale screen or a direct API call
 * cannot skip the question.
 */
import type { Tx } from "./db.ts";
import { json } from "./http.ts";

export const CONSENT_ERROR = "AI features are off for your account. Turn them on in Settings, under AI features, to use this.";

export const hasConsent = (profile: { ai_consent_at?: unknown } | null | undefined): boolean => !!profile?.ai_consent_at;

export const refusal = (): Response => json({ ok: false, needs_ai_consent: true, error: CONSENT_ERROR }, 403);

/** Record or withdraw consent. Granting again keeps the original timestamp: it records when the person first agreed,
 *  which is what a consent record is for. Returns whether the profile exists. */
export async function setConsent(tx: Tx, userId: string, granted: boolean): Promise<boolean> {
  const sql = granted
    ? "update public.profiles set ai_consent_at = coalesce(ai_consent_at, now()) where id = $1 returning id"
    : "update public.profiles set ai_consent_at = null where id = $1 returning id";
  return (await tx.one(sql, [userId])) !== null;
}
