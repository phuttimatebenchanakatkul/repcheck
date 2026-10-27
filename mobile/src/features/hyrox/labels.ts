import { CATEGORIES, FORMATS, GENDERS } from '@/logic/hyrox';

type T = (key: never, vars?: Record<string, string | number>) => string;

/** "Men Open Singles": a race's gender, category and format, as the website words it. A hand-built race says so instead. */
export function comboLabel(t: T, gender: string | null, category: string, format: string | null): string {
  const tr = t as unknown as (key: string, vars?: Record<string, string | number>) => string;
  if (category === 'custom') return tr('hyrox.category.custom.title');
  const cat = (CATEGORIES as readonly string[]).includes(category) ? tr(`hyrox.category.${category}.title`) : category;
  const fmt = format && (FORMATS as readonly string[]).includes(format) ? tr(`hyrox.format.${format}.title`) : (format ?? 'Mixed Relay');
  const who = gender && (GENDERS as readonly string[]).includes(gender) ? tr(`hyrox.gender.${gender}`) : 'Mixed';
  return tr('hyrox.finishLabel', { gender: who, category: cat, format: fmt });
}

/** "Oct 27, 2026" in the person's language. */
export function raceDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}
