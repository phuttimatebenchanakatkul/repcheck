/** Small rules about the account's own settings: how long a deletion can be undone, and how its date reads. */

/** Deleting an account schedules it; it is erased this many days later and can be kept until then (api/accounts.py GRACE_DAYS). */
export const ACCOUNT_GRACE_DAYS = 30;

/** The day a deletion becomes final ("2026-11-26") as a date in the person's language; the text as given when it is not one. */
export function formatDueDate(due: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const date = new Date(`${due}T00:00:00`);
  return Number.isNaN(date.getTime()) ? due : date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Which sign-in the account uses, for "Signed in with Apple — email is managed there". Null for a plain email account. */
export function providerName(provider: unknown): string | null {
  if (provider === 'apple') return 'Apple';
  if (provider === 'google') return 'Google';
  return null;
}

/** The theme a person chose as what React Native's Appearance takes: no choice (null) hands the decision back to the device. */
export function colorSchemeOverride(theme: 'light' | 'dark' | null): 'light' | 'dark' | 'unspecified' {
  return theme ?? 'unspecified';
}
