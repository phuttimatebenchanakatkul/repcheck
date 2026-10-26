import { expectedFiles, extractDictionaries, extractLiteral, SOURCE } from '../../../scripts/export-i18n';
import appEn from '../app.en.json';
import appTh from '../app.th.json';
import en from '../en.json';
import th from '../th.json';
import { detectLanguage, getLanguage, isLanguage, setLanguage, subscribe, t, translate } from '../index';

import fs from 'fs';

const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

describe('translate() follows the website t()', () => {
  it('uses the language, then English, then the key itself', () => {
    expect(translate('en', 'nav.home')).toBe('Home');
    expect(translate('th', 'nav.home')).toBe(th['nav.home' as keyof typeof th]);
    expect(translate('th', 'workouts.wizard.stepLocation')).toBe(en['workouts.wizard.stepLocation' as keyof typeof en]); // the English fallback
    expect(translate('th', 'no.such.key')).toBe('no.such.key');
  });

  it('keeps a key that is deliberately empty empty (it must not fall through to English or the key)', () => {
    const empty = Object.keys(th).find((k) => (th as Record<string, string>)[k] === '');
    if (empty) expect(translate('th', empty)).toBe('');
  });

  it('fills every {placeholder}, wherever it appears, and leaves unknown ones alone', () => {
    expect(translate('en', 'tour.stepCount', { n: 2, total: 5 })).toBe('2 of 5');
    expect(translate('en', 'tour.stepCount', { n: 2 })).toBe('2 of {total}');
    expect(translate('en', 'tour.stepCount', { n: '{total}', total: 9 })).toBe('9 of 9'); // replaced in order: documented behaviour, not escaped
  });

  it('does not treat inherited object properties as keys', () => {
    expect(translate('en', 'constructor')).toBe('constructor');
    expect(translate('en', 'toString')).toBe('toString');
    expect(translate('en', '__proto__')).toBe('__proto__');
  });
});

describe('language state', () => {
  afterEach(() => setLanguage('en'));

  it('t() follows setLanguage and tells subscribers once per real change', () => {
    const seen: string[] = [];
    const unsubscribe = subscribe(() => seen.push(getLanguage()));
    setLanguage('th');
    setLanguage('th'); // no change: no notification
    expect(t('nav.home')).toBe(th['nav.home' as keyof typeof th]);
    setLanguage('en');
    unsubscribe();
    setLanguage('th');
    expect(seen).toEqual(['th', 'en']);
  });

  it('detects Thai from the first device language only', () => {
    expect(detectLanguage(['th'])).toBe('th');
    expect(detectLanguage(['th-TH', 'en'])).toBe('th');
    expect(detectLanguage(['TH_th'])).toBe('th');
    expect(detectLanguage(['en', 'th'])).toBe('en');
    expect(detectLanguage([null, undefined, 'th'])).toBe('th');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(['fr'])).toBe('en');
  });

  it('isLanguage accepts exactly the two', () => {
    expect(['en', 'th'].every(isLanguage)).toBe(true);
    expect([null, undefined, 'EN', 'fr', 5, {}].some(isLanguage)).toBe(false);
  });
});

describe('the dictionaries', () => {
  it('Thai has no key English lacks, and only the known gaps are untranslated', () => {
    const extra = Object.keys(th).filter((k) => !(k in en));
    const missing = Object.keys(en).filter((k) => !(k in th));
    expect(extra).toEqual([]);
    expect(missing).toEqual([
      'workouts.wizard.stepLocation',
      'workouts.wizard.locationTitle',
      'workouts.wizard.location.gym.title',
      'workouts.wizard.location.gym.sub',
      'workouts.wizard.location.home.title',
      'workouts.wizard.location.home.sub',
      'workouts.wizard.location.hybrid.title',
      'workouts.wizard.location.hybrid.sub',
    ]);
  });

  it('a Thai string never uses a placeholder its English string does not have (it would show as literal text)', () => {
    for (const key of Object.keys(th)) {
      const allowed = new Set(vars((en as Record<string, string>)[key] ?? ''));
      for (const name of vars((th as Record<string, string>)[key])) expect([key, allowed.has(name)]).toEqual([key, true]);
    }
  });

  it('the app strings exist in both languages with the same placeholders, and none shadows a website string', () => {
    expect(Object.keys(appTh).sort()).toEqual(Object.keys(appEn).sort());
    for (const key of Object.keys(appEn)) {
      expect(key.startsWith('app.')).toBe(true);
      expect(key in en).toBe(false);
      expect(vars((appTh as Record<string, string>)[key]).sort()).toEqual(vars((appEn as Record<string, string>)[key]).sort());
      expect((appEn as Record<string, string>)[key].length).toBeGreaterThan(0);
      expect((appTh as Record<string, string>)[key].length).toBeGreaterThan(0);
    }
  });

  it('every error reason the sign-in screen can show has a message in both languages', () => {
    for (const reason of ['invalid-credentials', 'email-not-confirmed', 'rate-limited', 'weak-password', 'unavailable', 'failed']) {
      expect(`app.auth.error.${reason}` in appEn).toBe(true);
      expect(`app.auth.error.${reason}` in appTh).toBe(true);
    }
  });
});

describe('the export from static/i18n.js', () => {
  it('the committed JSON is exactly what the exporter produces now (run npm run i18n:export after editing the website strings)', () => {
    // compared with line endings normalised: a Windows checkout may have turned the files' LF into CRLF
    for (const [file, text] of Object.entries(expectedFiles())) expect(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(text);
  });

  it('finds the literal even with braces, quotes and comments inside it', () => {
    const source = 'x; const DICTIONARIES = { en: { "a": "has } brace", \'b\': "q\\"uote", /* } */ "c": "d" }, th: { // }\n "a": "é" } }; after';
    expect(extractDictionaries(source)).toEqual({ en: { a: 'has } brace', b: 'q"uote', c: 'd' }, th: { a: 'é' } });
    expect(extractLiteral(source).endsWith('}')).toBe(true);
  });

  it('refuses a source without the dictionaries instead of writing empty files', () => {
    expect(() => extractDictionaries('const OTHER = {}')).toThrow(/DICTIONARIES/);
    expect(() => extractDictionaries('const DICTIONARIES = { en: {} }')).toThrow(/th/);
    expect(() => extractLiteral('const DICTIONARIES = { en: {')).toThrow(/unbalanced/);
  });

  it('reads the real website file', () => {
    expect(fs.existsSync(SOURCE)).toBe(true);
    expect(Object.keys(extractDictionaries(fs.readFileSync(SOURCE, 'utf8')).en).length).toBe(Object.keys(en).length);
  });
});
