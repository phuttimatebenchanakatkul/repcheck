/**
 * Unit preferences and conversions: static/units.js is the original. Values are always STORED canonically (kg, cm, km); these only
 * convert at the display and input boundary, so changing units never rewrites logged data.
 */
export interface UnitPrefs {
  weight: 'kg' | 'lb';
  height: 'cm' | 'ftin';
  distance: 'km' | 'm';
  clock: '12h' | '24h';
}

export const DEFAULT_UNITS: UnitPrefs = { weight: 'kg', height: 'cm', distance: 'km', clock: '12h' };

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

/** Stored preferences (possibly partial, with NULLs for "never set", or junk) -> a complete valid set. */
export function resolveUnits(stored?: Partial<Record<keyof UnitPrefs, unknown>> | null): UnitPrefs {
  const pick = <K extends keyof UnitPrefs>(key: K, allowed: readonly UnitPrefs[K][]): UnitPrefs[K] => {
    const value = stored?.[key];
    return (allowed as readonly unknown[]).includes(value) ? (value as UnitPrefs[K]) : DEFAULT_UNITS[key];
  };
  return { weight: pick('weight', ['kg', 'lb']), height: pick('height', ['cm', 'ftin']), distance: pick('distance', ['km', 'm']), clock: pick('clock', ['12h', '24h']) };
}

export function weightUnitLabel(units: UnitPrefs): string {
  return units.weight === 'lb' ? 'lb' : 'kg';
}

/** A number (one decimal) in the person's unit. */
export function kgToDisplay(kg: number, units: UnitPrefs): number {
  const v = units.weight === 'lb' ? kg / KG_PER_LB : kg;
  return Math.round(v * 10) / 10;
}

/** What a person typed (in their unit) -> kg; NaN if it is not a number. */
export function displayToKg(value: unknown, units: UnitPrefs): number {
  const v = Number.parseFloat(String(value));
  if (!Number.isFinite(v)) return NaN;
  return units.weight === 'lb' ? v * KG_PER_LB : v;
}

export function formatWeightKg(kg: number, units: UnitPrefs): string {
  return `${kgToDisplay(kg, units)} ${weightUnitLabel(units)}`;
}

export function heightUnitLabel(units: UnitPrefs): string {
  return units.height === 'ftin' ? 'ft/in' : 'cm';
}

export function formatHeightCm(cm: number, units: UnitPrefs): string {
  if (units.height !== 'ftin') return `${Math.round(cm)} cm`;
  const totalIn = cm / CM_PER_IN;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`; // 5'12" reads wrong: carry it into the next foot
}

export function formatDistanceKm(km: number, units: UnitPrefs): string {
  return units.distance === 'm' ? `${Math.round(km * 1000)}m` : `${km}km`;
}

/** "1 AM" / "13:00" style label for an hour row. */
export function formatHourLabel(hour: number, units: UnitPrefs): string {
  if (units.clock === '24h') return `${String(hour).padStart(2, '0')}:00`;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The time of day of an instant, in the person's clock format and language. */
export function formatTime(epochMs: number, units: UnitPrefs, locale: string): string {
  return new Date(epochMs).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: units.clock !== '24h' });
}

/** The BCP-47 locale for a UI language (the website's RepCheckI18n.locale()). */
export function localeFor(language: 'en' | 'th'): string {
  return language === 'th' ? 'th-TH' : 'en-US';
}
