import { runWebsiteScript } from '@/testing/website';

import {
  DEFAULT_UNITS,
  displayToKg,
  formatDistanceKm,
  formatHeightCm,
  formatHourLabel,
  formatTime,
  formatWeightKg,
  heightUnitLabel,
  kgToDisplay,
  localeFor,
  resolveUnits,
  weightUnitLabel,
  type UnitPrefs,
} from '../units';

/** The website's RepCheckUnits with a given stored preference. */
function website(stored: Partial<UnitPrefs>) {
  const window = runWebsiteScript('units.js', (w) => {
    w.localStorage.setItem('repcheck_units_v1', JSON.stringify(stored));
  });
  return window.RepCheckUnits;
}

const COMBOS: UnitPrefs[] = [];
for (const weight of ['kg', 'lb'] as const) for (const height of ['cm', 'ftin'] as const) for (const distance of ['km', 'm'] as const) for (const clock of ['12h', '24h'] as const) COMBOS.push({ weight, height, distance, clock });

describe.each(COMBOS.map((c) => [JSON.stringify(c), c] as const))('units %s: parity with static/units.js', (_label, units) => {
  const w = website(units);

  it('weights', () => {
    for (const kg of [0.4, 45, 61.234, 72.5, 80, 99.95, 100.05, 135.7, 400]) {
      expect(kgToDisplay(kg, units)).toBe(w.kgToDisplay(kg));
      expect(formatWeightKg(kg, units)).toBe(w.formatWeightKg(kg));
    }
    expect(weightUnitLabel(units)).toBe(w.weightUnitLabel());
    for (const typed of ['70', '154.3', ' 12 ', '12abc', '', 'abc', '-3', '0', '1e2']) {
      const mine = displayToKg(typed, units);
      const theirs = w.displayToKg(typed);
      expect(Number.isNaN(mine) ? 'NaN' : mine).toBe(Number.isNaN(theirs) ? 'NaN' : theirs);
    }
  });

  it('heights', () => {
    for (const cm of [100, 150, 152.4, 160, 170.2, 175, 180.34, 182.88, 183, 190, 201.5, 59.5 * 2.54 + 0.01]) {
      expect(formatHeightCm(cm, units)).toBe(w.formatHeightCm(cm));
    }
    expect(heightUnitLabel(units)).toBe(w.heightUnitLabel());
  });

  it('distances', () => {
    for (const km of [0.1, 0.5, 1, 1.25, 5, 21.0975, 42.195]) expect(formatDistanceKm(km, units)).toBe(w.formatDistanceKm(km));
  });

  it('clock labels and times', () => {
    for (let hour = 0; hour < 24; hour++) expect(formatHourLabel(hour, units)).toBe(w.formatHourLabel(hour));
    for (const ms of [new Date(2026, 0, 1, 0, 5).getTime(), new Date(2026, 5, 1, 12, 0).getTime(), new Date(2026, 5, 1, 13, 45).getTime(), new Date(2026, 5, 1, 23, 59).getTime()]) {
      expect(formatTime(ms, units, 'en-US')).toBe(w.formatTime(ms));
    }
  });
});

describe('resolveUnits', () => {
  it('fills defaults for NULL (never set) and drops values it does not know', () => {
    expect(resolveUnits(null)).toEqual(DEFAULT_UNITS);
    expect(resolveUnits({})).toEqual(DEFAULT_UNITS);
    expect(resolveUnits({ weight: null, height: null, distance: null, clock: null })).toEqual(DEFAULT_UNITS);
    expect(resolveUnits({ weight: 'stone', height: 'furlong', distance: 'mi', clock: '25h' })).toEqual(DEFAULT_UNITS);
    expect(resolveUnits({ weight: 'lb', clock: '24h' })).toEqual({ weight: 'lb', height: 'cm', distance: 'km', clock: '24h' });
  });

  it('keeps every valid choice', () => {
    for (const c of COMBOS) expect(resolveUnits(c)).toEqual(c);
  });
});

describe('reading and writing weights', () => {
  const lb: UnitPrefs = { ...DEFAULT_UNITS, weight: 'lb' };

  it('a typed pound figure is stored as kilograms and shown back unchanged', () => {
    const kg = displayToKg('154.3', lb);
    expect(kg).toBeCloseTo(69.99, 1);
    expect(kgToDisplay(kg, lb)).toBe(154.3);
  });

  it('5 ft 12 in carries into the next foot', () => {
    expect(formatHeightCm(71.6 * 2.54, { ...DEFAULT_UNITS, height: 'ftin' })).toBe('6\'0"');
  });
});

describe('locale', () => {
  it('Thai uses th-TH, everything else en-US', () => {
    expect(localeFor('th')).toBe('th-TH');
    expect(localeFor('en')).toBe('en-US');
  });
});
