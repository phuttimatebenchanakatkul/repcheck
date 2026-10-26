import { useSyncExternalStore } from 'react';

import appEn from './app.en.json';
import appTh from './app.th.json';
import websiteEn from './en.json';
import websiteTh from './th.json';

// The website's strings (generated, do not edit: scripts/export-i18n.js) plus the app's own `app.*` strings.
const en = { ...websiteEn, ...appEn };
const th = { ...websiteTh, ...appTh };

/** Same keys and {vars} as the website's translations; the app adds its own under `app.`. */
export type Language = 'en' | 'th';
export type TranslationKey = keyof typeof en;
export type Vars = Record<string, string | number>;

export const LANGUAGES: readonly Language[] = ['en', 'th'];

const dictionaries: Record<Language, Readonly<Record<string, string>>> = { en, th };

/**
 * `key` in `lang`, with `{name}` placeholders filled from `vars`. The website's rules, exactly: a key missing from the
 * language falls back to English, then to the key itself; a key that maps to "" stays "" (it must not fall through);
 * placeholders are replaced everywhere they appear and are NOT escaped, so a caller putting user-controlled text in `vars`
 * must treat the result as plain text (React Native renders it as text, never as markup).
 */
export function translate(lang: Language, key: string, vars?: Vars): string {
  const own = dictionaries[lang] ?? {};
  let text: string;
  if (Object.prototype.hasOwnProperty.call(own, key)) text = own[key];
  else if (Object.prototype.hasOwnProperty.call(dictionaries.en, key)) text = dictionaries.en[key];
  else text = key;
  if (vars) {
    for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
  }
  return text;
}

/** Thai if the device's first preferred language is Thai, else English. */
export function detectLanguage(languageCodes: readonly (string | null | undefined)[]): Language {
  const first = languageCodes.find((code) => !!code);
  return first && first.toLowerCase().split(/[-_]/)[0] === 'th' ? 'th' : 'en';
}

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'th';
}

let current: Language = 'en';
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  listeners.forEach((notify) => notify());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The key as written in the current language (typed: a misspelt key is a compile error). */
export function t(key: TranslationKey, vars?: Vars): string {
  return translate(current, key, vars);
}

/** Re-renders the caller when the language changes; returns the language and a bound `t`. */
export function useTranslation(): { language: Language; t: typeof t } {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { language, t: (key, vars) => translate(language, key, vars) };
}
