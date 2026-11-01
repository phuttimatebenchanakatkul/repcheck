import { isLegalPage, LEGAL_PAGE_KEYS, LEGAL_PAGES, plainText, routeParams, type LegalBlock, type LegalRun } from '../pages';

type Key = (typeof LEGAL_PAGE_KEYS)[number];
const runsOf = (block: LegalBlock): LegalRun[] => (block.type === 'ul' ? block.items.flatMap((i) => i.runs) : block.runs);
const everyRun = (page: Key) => LEGAL_PAGES[page].blocks.flatMap(runsOf);
const ids = (page: Key) =>
  new Set(LEGAL_PAGES[page].blocks.flatMap((b) => (b.type === 'ul' ? b.items.map((i) => i.id) : [b.id])).filter((x): x is string => !!x));
const text = (page: Key) =>
  LEGAL_PAGES[page].blocks.map((b) => (b.type === 'ul' ? b.items.map((i) => plainText(i.runs)).join(' ') : plainText(b.runs))).join('\n');

describe('the policy pages the app carries', () => {
  it('has all six, each with real content', () => {
    expect([...LEGAL_PAGE_KEYS].sort()).toEqual(['cookies', 'privacy', 'refunds', 'sources', 'support', 'terms']);
    for (const key of LEGAL_PAGE_KEYS) {
      const blocks = LEGAL_PAGES[key].blocks;
      expect(blocks.length).toBeGreaterThan(3);
      expect(blocks.some((b) => b.type === 'h')).toBe(true);
      expect(blocks.some((b) => b.type === 'p')).toBe(true);
    }
  });

  it('gives the router the page, and the entry to scroll to only when there is one', () => {
    expect(routeParams('terms')).toEqual({ pathname: '/legal/[page]', params: { page: 'terms' } });
    expect(routeParams('privacy', 'ai')).toEqual({ pathname: '/legal/[page]', params: { page: 'privacy', section: 'ai' } });
    expect(routeParams('privacy', '')).toEqual({ pathname: '/legal/[page]', params: { page: 'privacy' } });
  });

  it('knows a page key when it sees one', () => {
    expect(isLegalPage('privacy')).toBe(true);
    for (const bad of ['', 'Privacy', 'about', 'constructor', undefined, null, 5, ['privacy']]) expect(isLegalPage(bad)).toBe(false);
  });

  it('has no template left-overs, markup or empty runs in its text', () => {
    for (const key of LEGAL_PAGE_KEYS) {
      for (const run of everyRun(key)) {
        expect(run.t).not.toBe('');
        expect(run.t).not.toMatch(/\{\{|\{%|<\/?[a-z]|&[a-z]+;|&#/i);
      }
    }
  });

  it('only links to places that exist: another page of the set (and a real entry on it), https, or mailto', () => {
    let internal = 0;
    for (const key of LEGAL_PAGE_KEYS) {
      for (const run of everyRun(key)) {
        const link = run.link;
        if (!link) continue;
        if (link.page) {
          internal++;
          expect(isLegalPage(link.page)).toBe(true);
          if (link.section) expect(ids(link.page)).toContain(link.section);
          expect(link.href).toBeUndefined();
        } else {
          expect(link.href).toMatch(/^(https:\/\/\S+|mailto:[^\s@]+@[^\s@]+)$/);
        }
      }
    }
    expect(internal).toBeGreaterThan(10);
  });

  it('keeps the facts the stores and the law lean on', () => {
    expect(text('privacy')).toContain('30 days'); // the account-deletion grace the app also states
    expect(text('privacy')).toMatch(/Gemini/);
    expect(ids('privacy')).toContain('ai'); // the AI switch in Settings points here
    expect(text('terms')).toMatch(/not medical advice/i);
    expect(text('terms')).toContain('Phuttimate Benchanakatkul'); // the trader must be identifiable before the contract is made
    expect(text('support')).toMatch(/@/);
    expect(text('cookies')).toMatch(/Secure/); // the page was rendered with production's cookie settings
    expect(text('refunds')).toMatch(/free/i);
  });

  it('lists every health source with its publisher, and credits the data providers', () => {
    const lists = LEGAL_PAGES.sources.blocks.filter((b): b is Extract<LegalBlock, { type: 'ul' }> => b.type === 'ul');
    const items = lists.flatMap((l) => l.items);
    expect(items.length).toBeGreaterThan(20);
    expect(items.filter((i) => i.note).length).toBeGreaterThan(20);
    expect(items.every((i) => i.runs.some((r) => r.link?.href?.startsWith('https://')))).toBe(true);
    expect(ids('sources')).toContain('credits');
    expect(items.some((i) => plainText(i.runs).includes('Open Food Facts'))).toBe(true);
    expect(items.some((i) => plainText(i.runs).includes('fatsecret'))).toBe(true);
  });
});
