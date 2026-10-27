import { ACCOUNT_GRACE_DAYS, colorSchemeOverride, formatDueDate, providerName } from '../account';

describe('the deletion date', () => {
  it('reads as a date in the person’s language', () => {
    expect(formatDueDate('2026-11-26', 'en-US')).toBe('November 26, 2026');
    expect(formatDueDate('2026-11-26', 'en-GB')).toBe('26 November 2026');
    expect(formatDueDate('2026-11-26', 'th-TH')).toMatch(/พฤศจิกายน/);
  });

  it('is the day itself, whatever the time zone', () => {
    expect(formatDueDate('2026-01-01', 'en-US')).toBe('January 1, 2026');
    expect(formatDueDate('2026-12-31', 'en-US')).toBe('December 31, 2026');
  });

  it('text that is not a date is shown as it came', () => {
    expect(formatDueDate('soon', 'en-US')).toBe('soon');
    expect(formatDueDate('2026-13-45', 'en-US')).toBe('2026-13-45');
    expect(formatDueDate('', 'en-US')).toBe('');
  });
});

describe('the grace period', () => {
  it('is thirty days', () => {
    expect(ACCOUNT_GRACE_DAYS).toBe(30);
  });
});

describe('who manages the email', () => {
  it('Apple and Google do; an email account manages its own', () => {
    expect(providerName('apple')).toBe('Apple');
    expect(providerName('google')).toBe('Google');
    expect(providerName('email')).toBeNull();
    expect(providerName(undefined)).toBeNull();
    expect(providerName(5)).toBeNull();
  });
});

describe('the theme handed to the device', () => {
  it('a choice is passed on; no choice leaves it to the device', () => {
    expect(colorSchemeOverride('dark')).toBe('dark');
    expect(colorSchemeOverride('light')).toBe('light');
    expect(colorSchemeOverride(null)).toBe('unspecified');
  });
});
