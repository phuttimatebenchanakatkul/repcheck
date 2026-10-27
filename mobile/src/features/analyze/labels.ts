import type { TranslationKey, Vars } from '@/i18n';
import { relativeDay } from '@/logic/analyzeResult';

type Translate = (key: TranslationKey, vars?: Vars) => string;

/** "Today", "Yesterday", "3 days ago", then "Oct 20": the label on a row of the recent analyses and the history. */
export function whenLabel(createdAt: string, now: number, locale: string, t: Translate): string {
  const label = relativeDay(createdAt, now);
  if (!label) return '';
  switch (label.kind) {
    case 'today':
      return t('analyze.today');
    case 'yesterday':
      return t('analyze.yesterday');
    case 'days':
      return t('analyze.daysAgo', { n: label.n });
    case 'date':
      return new Date(label.ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }
}

/** "Oct 2026": the heading of a month in the history. */
export function monthHeading(ms: number | null, locale: string): string {
  return ms === null ? '' : new Date(ms).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
