/**
 * The website's public pages the app links to. Every one of them opens without an account (they are in `_PUBLIC_ENDPOINTS` in
 * app.py), so a reviewer or a person who has not signed in can read them; the app opens them in an in-app browser sheet.
 */
export const WEBSITE_URL = 'https://repcheck-q0m4.onrender.com';

export const LEGAL_LINKS = [
  { key: 'support', path: '/support', label: 'settings.legal.support' },
  { key: 'privacy', path: '/privacy', label: 'settings.legal.privacy' },
  { key: 'terms', path: '/terms', label: 'settings.legal.terms' },
  { key: 'cookies', path: '/cookies', label: 'settings.legal.cookies' },
  { key: 'refunds', path: '/refunds', label: 'settings.legal.refunds' },
  { key: 'sources', path: '/sources', label: 'settings.legal.sources' },
] as const;

/** What is sent to the AI service, and how it is handled: the section of the privacy policy the AI switch points to. */
export const AI_PRIVACY_URL = `${WEBSITE_URL}/privacy#ai`;
