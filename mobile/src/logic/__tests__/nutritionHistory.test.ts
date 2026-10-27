import { ON_TARGET_TOLERANCE, chartScale, dayStatus, heightPercent, overrideFor, statusCounts, statusOptions, weekStats, type WeekDay } from '../nutritionHistory';

describe('a day’s status', () => {
  it('logged with food, none without; fasting and incomplete override either', () => {
    expect(dayStatus(true, undefined)).toBe('logged');
    expect(dayStatus(false, undefined)).toBe('none');
    expect(dayStatus(false, null)).toBe('none');
    expect(dayStatus(true, 'fasting')).toBe('fasting');
    expect(dayStatus(false, 'fasting')).toBe('fasting');
    expect(dayStatus(true, 'incomplete')).toBe('incomplete');
    expect(dayStatus(false, 'incomplete')).toBe('incomplete');
  });

  it('an override it does not know is ignored', () => {
    expect(dayStatus(true, 'logged')).toBe('logged');
    expect(dayStatus(false, 'weird')).toBe('none');
    expect(dayStatus(false, '')).toBe('none');
  });

  it('agrees with the website’s own getDayStatus', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '../../../../static/coaching.js'), 'utf8') as string;
    const body = (name: string) => {
      const start = source.indexOf(`function ${name}(`);
      let depth = 0;
      let i = source.indexOf('{', start);
      const from = start;
      for (; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) break;
      }
      return source.slice(from, i + 1);
    };
    // eslint-disable-next-line no-new-func
    const site = new Function(`${body('hasEntries')}\n${body('getDayStatus')}\nreturn getDayStatus;`)() as (d: string, log: Record<string, unknown>, map: Record<string, string>) => string;
    for (const hasEntries of [true, false]) {
      for (const override of [undefined, 'fasting', 'incomplete', 'logged', 'junk']) {
        const log = hasEntries ? { '2026-10-26': [{ id: 'a' }] } : { '2026-10-26': [] };
        const map: Record<string, string> = override === undefined ? {} : { '2026-10-26': override };
        expect(dayStatus(hasEntries, override)).toBe(site('2026-10-26', log, map));
      }
    }
  });
});

describe('what a day can be marked', () => {
  it('a day with food: left as logged or marked incomplete', () => {
    expect(statusOptions(true).map((o) => o.choice)).toEqual(['logged', 'incomplete']);
    expect(statusOptions(true).map((o) => o.labelKey)).toEqual(['coaching.status.logged.title', 'coaching.status.incomplete.title']);
  });

  it('a day without: left as not logged or marked fasting', () => {
    expect(statusOptions(false).map((o) => o.choice)).toEqual(['logged', 'fasting']);
    expect(statusOptions(false).map((o) => o.labelKey)).toEqual(['coaching.status.notLogged.title', 'coaching.status.fasting.title']);
  });

  it('"logged" clears the mark, the others store it', () => {
    expect(overrideFor('logged')).toBeNull();
    expect(overrideFor('fasting')).toBe('fasting');
    expect(overrideFor('incomplete')).toBe('incomplete');
  });
});

describe('a month’s counts', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  const status = (map: Record<string, 'logged' | 'fasting' | 'incomplete'>) => (day: string) => map[day] ?? 'none';

  it('counts each status up to today and nothing after it', () => {
    const counts = statusCounts(days, '2026-10-04', status({ '2026-10-01': 'logged', '2026-10-02': 'fasting', '2026-10-03': 'incomplete', '2026-10-05': 'logged' }));
    expect(counts).toEqual({ logged: 1, fasting: 1, incomplete: 1, none: 1 });
  });

  it('today is counted', () => {
    expect(statusCounts(days, '2026-10-01', status({ '2026-10-01': 'logged' }))).toEqual({ logged: 1, fasting: 0, incomplete: 0, none: 0 });
  });

  it('a past month counts every day', () => {
    expect(statusCounts(days, '2027-01-01', status({}))).toEqual({ logged: 0, fasting: 0, incomplete: 0, none: 5 });
  });
});

describe('full stats', () => {
  const week = (...calories: (number | null)[]): WeekDay[] => calories.map((c, i) => ({ day: `2026-10-${26 + i}`, calories: c ?? 0, hasData: c !== null }));

  it('averages only the days with food and rounds the mean', () => {
    expect(weekStats(week(2000, null, 1000, 1001), 2000).average).toBe(1334);
    expect(weekStats(week(null, null), 2000).average).toBeNull();
    expect(weekStats(week(1500, 1501), 2000).average).toBe(1501);
  });

  it('a day with food that adds up to zero calories still counts as logged', () => {
    const stats = weekStats([{ day: 'a', calories: 0, hasData: true }, { day: 'b', calories: 1000, hasData: true }], 2000);
    expect(stats).toMatchObject({ logged: 2, average: 500 });
  });

  it('on target means within 10% of the goal, either side, edges included', () => {
    expect(ON_TARGET_TOLERANCE).toBe(0.1);
    const days = week(1800, 2200, 1799, 2201, 2000);
    expect(weekStats(days, 2000)).toMatchObject({ onTarget: 3, logged: 5 });
  });

  it('days without food are never on target, whatever the goal', () => {
    expect(weekStats(week(null, null), 0)).toEqual({ average: null, onTarget: 0, logged: 0 });
  });

  it('the chart is a little taller than the tallest of the goal and the biggest day', () => {
    expect(chartScale(week(1000, 3000), 2000)).toBeCloseTo(3000 * 1.08, 9);
    expect(chartScale(week(1000, 1500), 2000)).toBeCloseTo(2000 * 1.08, 9);
    expect(chartScale(week(null), 0)).toBe(1);
  });

  it('heights are percentages of that scale', () => {
    const scale = chartScale(week(1000, 3000), 2000);
    expect(heightPercent(3000, scale)).toBeCloseTo(100 / 1.08, 9);
    expect(heightPercent(0, scale)).toBe(0);
    expect(heightPercent(1500, 3000)).toBe(50);
  });
});

describe('survivors: the smallest chart', () => {
  it('a goal or day of exactly one calorie still scales by the margin', () => {
    expect(chartScale([{ day: 'a', calories: 1, hasData: true }], 0)).toBeCloseTo(1.08, 9);
    expect(chartScale([{ day: 'a', calories: 0, hasData: false }], 1)).toBeCloseTo(1.08, 9);
  });
});
