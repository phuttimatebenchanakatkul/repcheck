import {
  CHART,
  FLAT_KG,
  calendarSummary,
  chartPoints,
  compareMonth,
  daysInMonth,
  directionOf,
  entriesForMonth,
  entriesForYear,
  monthDays,
  monthOf,
  sameMonth,
  shiftMonth,
  weightRows,
  weightStats,
  yearRows,
} from '../history';

const w = (day: string, kg: number) => ({ day, kg });

describe('months', () => {
  it('knows the month of a date, and steps forward and back across year ends', () => {
    expect(monthOf(new Date(2026, 9, 26))).toEqual({ year: 2026, month: 9 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 });
    expect(shiftMonth({ year: 2026, month: 5 }, -18)).toEqual({ year: 2024, month: 11 });
    expect(shiftMonth({ year: 2026, month: 5 }, 25)).toEqual({ year: 2028, month: 6 });
  });

  it('compares months', () => {
    expect(sameMonth({ year: 2026, month: 3 }, { year: 2026, month: 3 })).toBe(true);
    expect(sameMonth({ year: 2026, month: 3 }, { year: 2025, month: 3 })).toBe(false);
    expect(sameMonth({ year: 2026, month: 3 }, { year: 2026, month: 4 })).toBe(false);
    expect(compareMonth({ year: 2026, month: 0 }, { year: 2025, month: 11 })).toBeGreaterThan(0);
    expect(compareMonth({ year: 2025, month: 11 }, { year: 2026, month: 0 })).toBeLessThan(0);
    expect(compareMonth({ year: 2026, month: 4 }, { year: 2026, month: 4 })).toBe(0);
  });

  it('counts the days, leap years included, and lists them as ISO days', () => {
    expect(daysInMonth({ year: 2026, month: 1 })).toBe(28);
    expect(daysInMonth({ year: 2028, month: 1 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 9 })).toBe(31);
    expect(daysInMonth({ year: 2026, month: 3 })).toBe(30);
    const days = monthDays({ year: 2026, month: 1 });
    expect(days).toHaveLength(28);
    expect(days[0]).toBe('2026-02-01');
    expect(days[27]).toBe('2026-02-28');
  });
});

describe('selecting entries', () => {
  const all = [w('2026-10-20', 80), w('2026-09-30', 82), w('2026-10-02', 81), w('2025-10-10', 90), w('2026-01-05', 85)];

  it('a month holds only its own entries, oldest first (October is 10, not 1 or 100)', () => {
    expect(entriesForMonth(all, { year: 2026, month: 9 }).map((e) => e.day)).toEqual(['2026-10-02', '2026-10-20']);
    expect(entriesForMonth(all, { year: 2026, month: 0 }).map((e) => e.day)).toEqual(['2026-01-05']);
    expect(entriesForMonth(all, { year: 2026, month: 5 })).toEqual([]);
  });

  it('a year holds all its months', () => {
    expect(entriesForYear(all, 2026).map((e) => e.day)).toEqual(['2026-01-05', '2026-09-30', '2026-10-02', '2026-10-20']);
    expect(entriesForYear(all, 2025)).toHaveLength(1);
    expect(entriesForYear(all, 2024)).toEqual([]);
  });

  it('does not change the list it was given', () => {
    const before = all.map((e) => e.day);
    entriesForMonth(all, { year: 2026, month: 9 });
    entriesForYear(all, 2026);
    expect(all.map((e) => e.day)).toEqual(before);
  });
});

describe('stats', () => {
  it('no entries, no stats', () => {
    expect(weightStats([])).toBeNull();
  });

  it('latest is the newest, average the mean, change newest minus oldest — whatever order they come in', () => {
    const stats = weightStats([w('2026-10-20', 80), w('2026-10-02', 82), w('2026-10-10', 81)]);
    expect(stats).toEqual({ latest: 80, average: 81, change: -2, direction: 'down' });
  });

  it('one entry has no change', () => {
    expect(weightStats([w('2026-10-02', 82)])).toEqual({ latest: 82, average: 82, change: 0, direction: 'flat' });
  });

  it('a change of up to 0.05 kg reads as flat, beyond it as up or down', () => {
    expect(FLAT_KG).toBe(0.05);
    expect(directionOf(0.05)).toBe('flat');
    expect(directionOf(-0.05)).toBe('flat');
    expect(directionOf(0)).toBe('flat');
    expect(directionOf(0.0501)).toBe('up');
    expect(directionOf(-0.0501)).toBe('down');
  });

  it('does not change the list it was given', () => {
    const entries = [w('2026-10-20', 80), w('2026-10-02', 82)];
    weightStats(entries);
    expect(entries.map((e) => e.day)).toEqual(['2026-10-20', '2026-10-02']);
  });
});

describe('the month list', () => {
  it('is newest first, each row with its change from the one before; the oldest has none', () => {
    const rows = weightRows([w('2026-10-02', 82), w('2026-10-20', 80.5), w('2026-10-10', 81)]);
    expect(rows.map((r) => r.day)).toEqual(['2026-10-20', '2026-10-10', '2026-10-02']);
    expect(rows[0]).toMatchObject({ kg: 80.5, delta: -0.5, direction: 'down' });
    expect(rows[1]).toMatchObject({ kg: 81, delta: -1, direction: 'down' });
    expect(rows[2]).toMatchObject({ kg: 82, delta: null, direction: null });
  });

  it('a gain is up, a tiny wobble is flat', () => {
    const rows = weightRows([w('2026-10-01', 80), w('2026-10-02', 81), w('2026-10-03', 81.04)]);
    expect(rows.map((r) => r.direction)).toEqual(['flat', 'up', null]);
  });

  it('is empty for no entries', () => {
    expect(weightRows([])).toEqual([]);
  });
});

describe('the year list', () => {
  it('runs December to January with each month’s latest and average, or nothing', () => {
    const rows = yearRows([w('2026-10-02', 82), w('2026-10-20', 80), w('2026-01-05', 85), w('2025-10-10', 90)], 2026);
    expect(rows.map((r) => r.month)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(rows[2]).toEqual({ month: 9, latest: 80, average: 81 });
    expect(rows[11]).toEqual({ month: 0, latest: 85, average: 85 });
    expect(rows[0]).toEqual({ month: 11, latest: null, average: null });
  });
});

describe('the chart', () => {
  it('needs two entries', () => {
    expect(chartPoints([])).toEqual([]);
    expect(chartPoints([w('2026-10-01', 80)])).toEqual([]);
  });

  it('spreads the points across the width in date order and puts the heaviest at the top', () => {
    const points = chartPoints([w('2026-10-03', 82), w('2026-10-01', 80), w('2026-10-02', 81)]);
    const { width, height, pad } = CHART;
    expect(points.map((p) => p.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(points.map((p) => p.x)).toEqual([pad, width / 2, width - pad]);
    expect(points[0].y).toBe(height - pad); // lightest at the bottom
    expect(points[1].y).toBe(height / 2);
    expect(points[2].y).toBe(pad); // heaviest at the top
  });

  it('equal weights draw a flat line rather than dividing by zero', () => {
    const points = chartPoints([w('2026-10-01', 80), w('2026-10-02', 80)]);
    expect(points.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(points[0].y).toBe(points[1].y);
  });
});

describe('the logging calendar', () => {
  const days = monthDays({ year: 2026, month: 9 });
  const has = (set: string[]) => (day: string) => set.includes(day);

  it('counts the days up to today that had something, and those that did not', () => {
    expect(calendarSummary(days, '2026-10-10', has(['2026-10-01', '2026-10-09', '2026-10-10']))).toEqual({ active: 3, inactive: 7 });
  });

  it('days after today count as neither', () => {
    expect(calendarSummary(days, '2026-10-10', has(['2026-10-20']))).toEqual({ active: 0, inactive: 10 });
  });

  it('a past month counts every day; a future one counts none', () => {
    expect(calendarSummary(days, '2026-12-01', has([]))).toEqual({ active: 0, inactive: 31 });
    expect(calendarSummary(days, '2026-09-30', has([]))).toEqual({ active: 0, inactive: 0 });
  });

  it('today itself counts', () => {
    expect(calendarSummary(days, '2026-10-01', has(['2026-10-01']))).toEqual({ active: 1, inactive: 0 });
  });
});

describe('survivors: the chart’s size', () => {
  it('is the website’s 640 x 140 with 10 of padding', () => {
    expect(CHART).toEqual({ width: 640, height: 140, pad: 10 });
  });
});
