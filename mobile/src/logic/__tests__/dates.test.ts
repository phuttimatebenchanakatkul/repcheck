import { extractFunction, lift, readRepoFile } from '@/testing/website';

import { addDays, dayOf, daysBetween, hourOf, isIsoDate, parseIso, stampOnDay, startOfWeek, toIsoDate, weekdayIndex, weekDays } from '../dates';

const template = readRepoFile('templates', 'nutrition.html');
const website = lift<{ toIsoDate: (d: Date) => string; startOfWeek: (d: Date) => Date }>(
  template,
  [extractFunction(template, 'toIsoDate'), extractFunction(template, 'startOfWeek')],
  ['toIsoDate', 'startOfWeek'],
);

const SAMPLES = [
  new Date(2026, 0, 1, 0, 0, 0),
  new Date(2026, 0, 1, 23, 59, 59),
  new Date(2026, 1, 28, 12),
  new Date(2028, 1, 29, 12), // a leap day
  new Date(2026, 11, 31, 23, 30),
  new Date(2026, 2, 8, 2, 30), // around a US daylight-saving change
  new Date(2026, 9, 25, 0, 0, 1),
  new Date(1999, 5, 15, 6),
];

describe('toIsoDate and startOfWeek: parity with the nutrition page', () => {
  it.each(SAMPLES.map((d) => [d.toString(), d] as const))('%s', (_label, date) => {
    expect(toIsoDate(date)).toBe(website.toIsoDate(date));
    expect(startOfWeek(toIsoDate(date))).toBe(website.toIsoDate(website.startOfWeek(date)));
  });

  it('every day of 2026 starts its week on the same Monday as the website', () => {
    for (let day = new Date(2026, 0, 1); day.getFullYear() === 2026; day.setDate(day.getDate() + 1)) {
      expect(startOfWeek(toIsoDate(day))).toBe(website.toIsoDate(website.startOfWeek(new Date(day))));
    }
  });
});

describe('parsing', () => {
  it('accepts real days only', () => {
    expect(isIsoDate('2026-10-26')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-1-5', '26-01-01', '2026/01/01', '2026-01-01T00:00:00', '', ' 2026-01-01', null, undefined, 20260101, {}]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });

  it('parseIso gives local midnight', () => {
    const d = parseIso('2026-10-26') as Date;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 26, 0, 0]);
  });

  it('arithmetic on something that is not a day is an error, not a silent NaN', () => {
    expect(() => addDays('nope', 1)).toThrow(RangeError);
    expect(() => daysBetween('2026-01-01', 'x')).toThrow(RangeError);
    expect(() => startOfWeek('')).toThrow(RangeError);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts days across months, years, leap days', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-06-15', 0)).toBe('2026-06-15');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('counts days between, signed', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1);
    expect(daysBetween('2026-01-02', '2026-01-01')).toBe(-1);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('walking day by day through a whole year never skips or repeats a day (daylight saving included)', () => {
    let day = '2026-01-01';
    const seen = new Set<string>();
    for (let i = 0; i < 365; i++) {
      expect(seen.has(day)).toBe(false);
      seen.add(day);
      expect(daysBetween(day, addDays(day, 1))).toBe(1);
      day = addDays(day, 1);
    }
    expect(day).toBe('2027-01-01');
  });

  it('a week is Monday to Sunday and contains the day it was asked about', () => {
    const week = weekDays('2026-10-25'); // a Sunday
    expect(week).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(weekDays('2026-10-19')).toEqual(week);
    expect(weekdayIndex('2026-10-25')).toBe(0);
    expect(weekdayIndex('2026-10-26')).toBe(1);
  });
});

describe('stamping an entry on a day', () => {
  const now = new Date(2026, 9, 26, 14, 35, 52, 999);

  it('keeps the wall-clock time of day on the chosen day (seconds kept, milliseconds dropped)', () => {
    const stamp = new Date(stampOnDay('2026-10-20', now));
    expect([toIsoDate(stamp), stamp.getHours(), stamp.getMinutes(), stamp.getSeconds(), stamp.getMilliseconds()]).toEqual(['2026-10-20', 14, 35, 52, 0]);
  });

  it('an hour row stamps exactly that hour', () => {
    const stamp = new Date(stampOnDay('2026-10-20', now, 8));
    expect([toIsoDate(stamp), stamp.getHours(), stamp.getMinutes(), stamp.getSeconds()]).toEqual(['2026-10-20', 8, 0, 0]);
    expect(new Date(stampOnDay('2026-10-20', now, 0)).getHours()).toBe(0);
  });

  it('dayOf and hourOf read an instant back in local time', () => {
    const ms = new Date(2026, 9, 26, 23, 59, 0).getTime();
    expect(dayOf(ms)).toBe('2026-10-26');
    expect(hourOf(ms)).toBe(23);
  });
});

describe('survivors: stamping on an hour', () => {
  it('lands exactly on the hour, with no minutes, seconds or milliseconds from the clock', () => {
    const now = new Date(2026, 9, 26, 14, 37, 52, 431);
    expect(stampOnDay('2026-10-20', now, 9)).toBe(new Date(2026, 9, 20, 9, 0, 0, 0).getTime());
  });

  it('without an hour it keeps the clock’s minutes and seconds but not its milliseconds', () => {
    const now = new Date(2026, 9, 26, 14, 37, 52, 431);
    expect(stampOnDay('2026-10-20', now)).toBe(new Date(2026, 9, 20, 14, 37, 52, 0).getTime());
  });

  it('daysBetween counts whole calendar days', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-11-01', '2026-11-03')).toBe(2);
    expect(daysBetween('2026-03-09', '2026-03-07')).toBe(-2);
  });
});

describe('survivors 2: counting days', () => {
  it('counts calendar days across month ends, leap days and years, in both directions', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(daysBetween('2028-02-27', '2028-03-02')).toBe(4); // a leap year
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2025-12-31')).toBe(-1);
    expect(daysBetween('2026-10-26', '2026-10-26')).toBe(0);
    expect(daysBetween('2025-01-01', '2026-01-01')).toBe(365);
  });

  it('is always a whole number, whatever zone the phone is in (it never goes through local clock arithmetic)', () => {
    for (const [from, to] of [['2026-03-07', '2026-03-09'], ['2026-11-01', '2026-11-03'], ['2026-03-28', '2026-04-01'], ['2026-10-24', '2026-10-26']]) {
      expect(Number.isInteger(daysBetween(from, to))).toBe(true);
    }
  });

  it('refuses a day that is not a real day', () => {
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(RangeError);
    expect(() => daysBetween('2026-03-01', 'nonsense')).toThrow(RangeError);
  });
});
