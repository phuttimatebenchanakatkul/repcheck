/**
 * The website, for the one thing that still points at it: the link a person shares to add them as a friend (it opens a page that hands off to the app).
 * The policy pages are NOT links any more: the app carries them (src/legal) and opens them as screens.
 */
export const WEBSITE_URL = 'https://repcheck-q0m4.onrender.com';

export const LEGAL_LINKS = [
  { key: 'support', label: 'settings.legal.support' },
  { key: 'privacy', label: 'settings.legal.privacy' },
  { key: 'terms', label: 'settings.legal.terms' },
  { key: 'cookies', label: 'settings.legal.cookies' },
  { key: 'refunds', label: 'settings.legal.refunds' },
  { key: 'sources', label: 'settings.legal.sources' },
] as const;

/** What is sent to the AI service, and how it is handled: the section of the privacy policy the AI switch points to. */
export const AI_PRIVACY = { page: 'privacy', section: 'ai' } as const;
