/**
 * "Here is what you could log" for the food and exercise pickers. Every suggestion comes from what the person has ACTUALLY logged
 * (their recent foods, what they tend to eat around this hour, their recent exercises): nothing is invented, and someone with no
 * history gets an empty list. static/suggestions.js is the original.
 */
import { dayOf } from './dates';

/** A food must recur on at least this many DIFFERENT days near the hour to count as a habit rather than a one-off. */
export const TOP_PICK_MIN_DAYS = 2;

interface Timed {
  addedAt?: number | null;
}

function newestFirst<T extends Timed>(entries: readonly T[]): T[] {
  return entries.slice().sort((a, b) => (b && b.addedAt ? b.addedAt : 0) - (a && a.addedAt ? a.addedAt : 0));
}

/** Distinct values of `field`, newest logged first, at most `limit`. */
function recentNames<T extends Timed>(entries: readonly T[], field: keyof T, limit: number): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of newestFirst(entries)) {
    const name = entry ? (entry[field] as unknown) : null;
    if (typeof name !== 'string' || !name || seen.has(name)) continue;
    seen.add(name);
    if (names.length < limit) names.push(name);
  }
  return names;
}

export function recentFoods(entries: readonly (Timed & { food: string })[], limit: number): string[] {
  return recentNames(entries, 'food', limit);
}

export function recentExercises(entries: readonly (Timed & { exercise: string })[], limit: number): string[] {
  return recentNames(entries, 'exercise', limit);
}

/**
 * Foods the person genuinely tends to eat around `hour`: logged within the hour +/- 1 (wrapping midnight: 23 and 0 are one apart)
 * on at least TOP_PICK_MIN_DAYS different days, most recurring first.
 */
export function topPicksForHour(entries: readonly (Timed & { food: string })[], hour: number, limit: number): string[] {
  const daysByFood = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry || !entry.food || !entry.addedAt) continue;
    const when = new Date(entry.addedAt);
    let diff = Math.abs(when.getHours() - hour);
    if (diff > 12) diff = 24 - diff;
    if (diff > 1) continue;
    const days = daysByFood.get(entry.food) ?? new Set<string>();
    days.add(dayOf(entry.addedAt));
    daysByFood.set(entry.food, days);
  }
  return Array.from(daysByFood, ([food, days]) => ({ food, days: days.size }))
    .filter((row) => row.days >= TOP_PICK_MIN_DAYS)
    .sort((a, b) => b.days - a.days)
    .slice(0, limit)
    .map((row) => row.food);
}
