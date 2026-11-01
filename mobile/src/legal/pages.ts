/**
 * The policy pages the app carries itself: Terms, Privacy, Sources, Support, Cookies and Refunds. They used to open the website in a browser
 * sheet; the app is moving off Render, so the text now lives here and is drawn natively (no web view, no network).
 *
 * `pages.generated.json` is written by `scripts/gen_mobile_legal.py` from the website's own templates while the website still exists
 * (tests/test_mobile_legal.py fails when it is stale). When the website is retired the JSON becomes the source and is edited directly.
 */
import generated from './pages.generated.json';

export const LEGAL_PAGE_KEYS = ['privacy', 'terms', 'support', 'cookies', 'refunds', 'sources'] as const;
export type LegalPageKey = (typeof LEGAL_PAGE_KEYS)[number];

export interface LegalLink {
  /** Another page of this set, optionally scrolled to a heading or list entry. */
  page?: LegalPageKey;
  section?: string;
  /** An address outside the app: https, or mailto. */
  href?: string;
}

export interface LegalRun {
  t: string;
  b?: boolean;
  i?: boolean;
  c?: boolean;
  link?: LegalLink;
}

export type LegalBlock =
  | { type: 'updated' | 'p' | 'h'; runs: LegalRun[]; id?: string }
  | { type: 'ul'; items: { runs: LegalRun[]; note?: string; id?: string }[] };

export const LEGAL_PAGES = generated.pages as unknown as Record<LegalPageKey, { blocks: LegalBlock[] }>;

export function isLegalPage(value: unknown): value is LegalPageKey {
  return typeof value === 'string' && (LEGAL_PAGE_KEYS as readonly string[]).includes(value);
}

/** What the router is given to open a page (and scroll to an entry on it). */
export const routeParams = (page: LegalPageKey, section?: string): { pathname: '/legal/[page]'; params: { page: LegalPageKey; section?: string } } => ({
  pathname: '/legal/[page]',
  params: section ? { page, section } : { page },
});

/** The text of a run list, for tests and for accessibility labels. */
export const plainText = (runs: readonly LegalRun[]): string => runs.map((r) => r.t).join('');
