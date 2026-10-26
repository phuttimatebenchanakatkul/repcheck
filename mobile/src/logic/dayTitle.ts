import { addDays, parseIso } from './dates';

/** "Today" / "Yesterday" / a friendly date ("Monday, 26 Oct") for any other day: the website's dayTitle(). */
export function dayTitle(day: string, today: string, locale: string, labels: { today: string; yesterday: string }): string {
  if (day === today) return labels.today;
  if (day === addDays(today, -1)) return labels.yesterday;
  const date = parseIso(day);
  return date ? date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' }) : day;
}
