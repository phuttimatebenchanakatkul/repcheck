import { dayTitle } from '../dayTitle';

const labels = { today: 'Today', yesterday: 'Yesterday' };

describe('dayTitle', () => {
  it('names today and yesterday', () => {
    expect(dayTitle('2026-10-26', '2026-10-26', 'en-US', labels)).toBe('Today');
    expect(dayTitle('2026-10-25', '2026-10-26', 'en-US', labels)).toBe('Yesterday');
  });

  it('yesterday crosses a month and a year', () => {
    expect(dayTitle('2026-09-30', '2026-10-01', 'en-US', labels)).toBe('Yesterday');
    expect(dayTitle('2025-12-31', '2026-01-01', 'en-US', labels)).toBe('Yesterday');
  });

  it('tomorrow and older days are written out in the locale', () => {
    expect(dayTitle('2026-10-27', '2026-10-26', 'en-US', labels)).toBe('Tuesday, Oct 27');
    expect(dayTitle('2026-10-24', '2026-10-26', 'en-US', labels)).toBe('Saturday, Oct 24');
  });

  it('uses the language of the person', () => {
    expect(dayTitle('2026-10-24', '2026-10-26', 'th-TH', labels)).toMatch(/24/);
    expect(dayTitle('2026-10-24', '2026-10-26', 'th-TH', labels)).not.toBe(dayTitle('2026-10-24', '2026-10-26', 'en-US', labels));
  });

  it('an unreadable day is shown as it is, not as "Invalid Date"', () => {
    expect(dayTitle('nonsense', '2026-10-26', 'en-US', labels)).toBe('nonsense');
  });
});
