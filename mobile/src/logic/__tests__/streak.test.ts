import { runWebsiteScript } from '@/testing/website';

import { addDays, toIsoDate } from '../dates';
import { activeDaySet, currentStreak, daysFromDates, daysFromTimestamps, lastDays, longestStreak } from '../streak';

const TODAY = new Date(2026, 9, 26, 15, 0, 0);
const TODAY_ISO = '2026-10-26';

/** The website's RepCheckStreak, seeded with a workout log whose days are exactly `days`, and a clock frozen at TODAY. */
function website(days: string[]) {
  const log: Record<string, unknown[]> = {};
  for (const day of days) log[day] = [{ id: day }];
  const window = runWebsiteScript(
    'streak.js',
    (w) => {
      w.localStorage.setItem('repcheck_workout_log_v2', JSON.stringify(log));
    },
    TODAY,
  );
  return window.RepCheckStreak;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomDays(r: () => number): string[] {
  const days: string[] = [];
  for (let back = 0; back < 120; back++) if (r() < 0.55) days.push(addDays(TODAY_ISO, -back));
  return days;
}

describe('streaks: parity with static/streak.js', () => {
  it('current and longest agree on 150 random histories', () => {
    const r = rng(42);
    for (let i = 0; i < 150; i++) {
      const days = randomDays(r);
      const site = website(days);
      const mine = activeDaySet(days);
      expect(currentStreak(mine, TODAY)).toBe(site.current());
      expect(longestStreak(mine)).toBe(site.longest());
    }
  });

  it.each([
    ['nothing at all', []],
    ['only today', [TODAY_ISO]],
    ['only yesterday (today not yet done: the run is kept)', ['2026-10-25']],
    ['yesterday and the day before, not today', ['2026-10-25', '2026-10-24']],
    ['a run ending two days ago (broken)', ['2026-10-24', '2026-10-23']],
    ['today and a gap and a long run', [TODAY_ISO, '2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21']],
    ['a run across a month and year end', ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']],
    ['across a daylight-saving change', ['2026-03-07', '2026-03-08', '2026-03-09', '2026-11-01', '2026-11-02']],
  ])('%s', (_label, days) => {
    const site = website(days);
    const mine = activeDaySet(days);
    expect(currentStreak(mine, TODAY)).toBe(site.current());
    expect(longestStreak(mine)).toBe(site.longest());
  });

  it('known values', () => {
    expect(currentStreak(activeDaySet([TODAY_ISO, '2026-10-25', '2026-10-24']), TODAY)).toBe(3);
    expect(currentStreak(activeDaySet(['2026-10-25', '2026-10-24']), TODAY)).toBe(2);
    expect(currentStreak(activeDaySet(['2026-10-24']), TODAY)).toBe(0);
    expect(longestStreak(activeDaySet(['2026-01-01', '2026-01-02', '2026-01-03', '2026-02-01', '2026-02-02']))).toBe(3);
    expect(longestStreak(new Set())).toBe(0);
    expect(longestStreak(new Set(['2026-05-05']))).toBe(1);
  });

  it('the current run is counted from yesterday only when today has nothing, never both', () => {
    expect(currentStreak(activeDaySet([TODAY_ISO]), TODAY)).toBe(1);
    expect(currentStreak(activeDaySet([TODAY_ISO, '2026-10-24']), TODAY)).toBe(1);
  });
});

describe('where the days come from', () => {
  it('rows keyed by a date column: real days only', () => {
    expect(daysFromDates(['2026-10-01', 'nope', null, undefined, 5, '2026-02-30', '2026-10-02'])).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('instants become the LOCAL day the person experienced', () => {
    const lateEvening = new Date(2026, 9, 26, 23, 30).toISOString();
    const earlyMorning = new Date(2026, 9, 27, 0, 15).getTime();
    expect(daysFromTimestamps([lateEvening, earlyMorning, null, undefined, 'garbage', NaN])).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('sources merge without duplicates', () => {
    const set = activeDaySet(['2026-10-01', '2026-10-02'], ['2026-10-02', '2026-10-03'], []);
    expect(Array.from(set).sort()).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('a day-status override is deliberately not a source (it would let a streak be back-dated)', () => {
    // activeDaySet only ever sees the lists its caller hands it; the data layer is tested not to hand it overrides.
    expect(activeDaySet().size).toBe(0);
  });
});

describe('lastDays', () => {
  it('is the `count` days ending today, oldest first', () => {
    expect(lastDays(TODAY, 7)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
    expect(lastDays(TODAY, 1)).toEqual([toIsoDate(TODAY)]);
    expect(lastDays(TODAY, 0)).toEqual([]);
  });
});
