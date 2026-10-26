/**
 * The history pages' arithmetic: weigh-ins by month and year, the stats and the line chart, the per-row change, and the logging calendar
 * (templates/weight_history.html and templates/streaks.html are the originals). Pure, so the pages are only layout.
 */
import { toIsoDate } from './dates';

/** The part of a weigh-in this arithmetic reads (src/data/mappers.ts WeightEntry satisfies it). */
export interface WeightEntryLike {
  day: string;
  kg: number;
}

/** A change of this many kg or less reads as "no change" (the website's threshold). */
export const FLAT_KG = 0.05;

export interface Month {
  year: number;
  /** 0-11. */
  month: number;
}

export const monthOf = (date: Date): Month => ({ year: date.getFullYear(), month: date.getMonth() });

export function shiftMonth(m: Month, by: number): Month {
  const index = m.year * 12 + m.month + by;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

export const sameMonth = (a: Month, b: Month): boolean => a.year === b.year && a.month === b.month;
export const compareMonth = (a: Month, b: Month): number => a.year * 12 + a.month - (b.year * 12 + b.month);

export function daysInMonth({ year, month }: Month): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Every day of a month as ISO strings. */
export function monthDays(m: Month): string[] {
  return Array.from({ length: daysInMonth(m) }, (_, i) => toIsoDate(new Date(m.year, m.month, i + 1)));
}

const prefix = (year: number, month?: number): string => (month === undefined ? `${year}-` : `${year}-${String(month + 1).padStart(2, '0')}`);

/** Entries of one month (oldest first). */
export function entriesForMonth(entries: readonly WeightEntryLike[], m: Month): WeightEntryLike[] {
  return entries.filter((e) => e.day.startsWith(prefix(m.year, m.month))).sort((a, b) => a.day.localeCompare(b.day));
}

export function entriesForYear(entries: readonly WeightEntryLike[], year: number): WeightEntryLike[] {
  return entries.filter((e) => e.day.startsWith(prefix(year))).sort((a, b) => a.day.localeCompare(b.day));
}

export type Direction = 'up' | 'down' | 'flat';

export const directionOf = (change: number): Direction => (change > FLAT_KG ? 'up' : change < -FLAT_KG ? 'down' : 'flat');

export interface WeightStats {
  latest: number;
  average: number;
  change: number;
  direction: Direction;
}

/** Latest, average and the change from the first to the last of the period; null for no entries. */
export function weightStats(entries: readonly WeightEntryLike[]): WeightStats | null {
  if (!entries.length) return null;
  const sorted = entries.slice().sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted[0].kg;
  const latest = sorted[sorted.length - 1].kg;
  const average = sorted.reduce((sum, e) => sum + e.kg, 0) / sorted.length;
  const change = latest - first;
  return { latest, average, change, direction: directionOf(change) };
}

export interface WeightRow {
  day: string;
  kg: number;
  /** Change from the entry before it (null for the oldest). */
  delta: number | null;
  direction: Direction | null;
}

/** The month's list, newest first, each with its change from the one before. */
export function weightRows(entries: readonly WeightEntryLike[]): WeightRow[] {
  const sorted = entries.slice().sort((a, b) => b.day.localeCompare(a.day));
  return sorted.map((entry, i) => {
    const previous = sorted[i + 1];
    const delta = previous ? entry.kg - previous.kg : null;
    return { day: entry.day, kg: entry.kg, delta, direction: delta === null ? null : directionOf(delta) };
  });
}

export interface YearMonthRow {
  month: number;
  latest: number | null;
  average: number | null;
}

/** December down to January: each month's latest and average weight, or none. */
export function yearRows(entries: readonly WeightEntryLike[], year: number): YearMonthRow[] {
  const rows: YearMonthRow[] = [];
  for (let month = 11; month >= 0; month--) {
    const inMonth = entriesForMonth(entries, { year, month });
    rows.push(
      inMonth.length
        ? { month, latest: inMonth[inMonth.length - 1].kg, average: inMonth.reduce((s, e) => s + e.kg, 0) / inMonth.length }
        : { month, latest: null, average: null },
    );
  }
  return rows;
}

export interface ChartPoint {
  day: string;
  kg: number;
  x: number;
  y: number;
}

export const CHART = { width: 640, height: 140, pad: 10 } as const;

/** Points for the line chart, spread across the width and scaled between the lightest and heaviest; none until there are two entries. */
export function chartPoints(entries: readonly WeightEntryLike[]): ChartPoint[] {
  const sorted = entries.slice().sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length < 2) return [];
  const values = sorted.map((e) => e.kg);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const { width, height, pad } = CHART;
  return sorted.map((e, i) => ({
    day: e.day,
    kg: e.kg,
    x: pad + (i / (sorted.length - 1)) * (width - pad * 2),
    y: pad + (1 - (e.kg - min) / span) * (height - pad * 2),
  }));
}

export interface CalendarSummary {
  /** Days up to and including today that had something. */
  active: number;
  /** Days up to and including today that did not. */
  inactive: number;
}

/** A month's counts: days after today are neither. */
export function calendarSummary(days: readonly string[], today: string, has: (day: string) => boolean): CalendarSummary {
  let active = 0;
  let inactive = 0;
  for (const day of days) {
    if (day > today) continue;
    if (has(day)) active++;
    else inactive++;
  }
  return { active, inactive };
}
