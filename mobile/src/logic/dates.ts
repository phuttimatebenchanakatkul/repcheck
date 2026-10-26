/**
 * Calendar days, as the person lives them. A "day" is a local `YYYY-MM-DD` string everywhere in the app (that is what the database
 * columns hold too): never a UTC date, so a late-night log lands on the day the person experienced. Arithmetic goes through local
 * `Date` fields (not 24-hour millisecond steps), so a daylight-saving change cannot skip or repeat a day.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The local-midnight Date for an ISO day, or null if it is not a real calendar day (`2026-02-30`, `2026-1-5`, anything else). */
export function parseIso(iso: unknown): Date | null {
  if (typeof iso !== 'string') return null;
  const match = ISO.exec(iso);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function isIsoDate(value: unknown): value is string {
  return parseIso(value) !== null;
}

function mustParse(iso: string): Date {
  const date = parseIso(iso);
  if (!date) throw new RangeError(`not a calendar day: ${String(iso)}`);
  return date;
}

export function addDays(iso: string, days: number): string {
  const date = mustParse(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). Counted on the calendar in UTC, so a daylight-saving change cannot make a day 23 or 25 hours. */
export function daysBetween(from: string, to: string): number {
  const utcDay = (iso: string): number => {
    const date = mustParse(iso);
    const t = new Date(0);
    t.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    return t.getTime();
  };
  return (utcDay(to) - utcDay(from)) / 86_400_000;
}

/** The Monday of the week containing `iso` (the website's weeks start on Monday). */
export function startOfWeek(iso: string): string {
  const date = mustParse(iso);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return toIsoDate(date);
}

/** Monday..Sunday of the week containing `iso`. */
export function weekDays(iso: string): string[] {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 0 = Sunday ... 6 = Saturday, like Date.getDay(). */
export function weekdayIndex(iso: string): number {
  return mustParse(iso).getDay();
}

/**
 * The instant (epoch ms) a thing logged "now" is stamped with when filed under `day`: that day's date at the wall-clock time of
 * `now`, so backfilling a past day still carries a sensible time of day. With `hour`, exactly that hour on the hour (a specific
 * hour row's "+").
 */
export function stampOnDay(day: string, now: Date, hour?: number): number {
  const date = mustParse(day);
  if (hour === undefined) date.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
  else date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

export function hourOf(epochMs: number): number {
  return new Date(epochMs).getHours();
}

/** The local day an instant falls on. */
export function dayOf(epochMs: number): string {
  return toIsoDate(new Date(epochMs));
}
