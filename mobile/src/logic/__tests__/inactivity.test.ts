import { INACTIVITY_DAYS, idleDays, inactivityNotice } from '../inactivity';

describe('how long someone has been away', () => {
  it('counts from the later of the last weigh-in and the last food log', () => {
    expect(idleDays('2026-01-01', '2026-10-20', '2026-10-22', '2026-10-27')).toBe(5);
    expect(idleDays('2026-01-01', '2026-10-24', '2026-10-22', '2026-10-27')).toBe(3);
  });

  it('either one alone is enough', () => {
    expect(idleDays('2026-01-01', '2026-10-25', null, '2026-10-27')).toBe(2);
    expect(idleDays('2026-01-01', null, '2026-10-24', '2026-10-27')).toBe(3);
  });

  it('with neither, from the day the profile was made', () => {
    expect(idleDays('2026-10-20', null, null, '2026-10-27')).toBe(7);
  });

  it('with nothing to count from, there is no count', () => {
    expect(idleDays(null, null, null, '2026-10-27')).toBeNull();
  });

  it('is never negative (a log dated tomorrow, a clock that moved)', () => {
    expect(idleDays(null, '2026-10-29', null, '2026-10-27')).toBe(0);
  });

  it('is the same across a clock change', () => {
    expect(idleDays(null, '2026-10-24', null, '2026-10-26')).toBe(2);
    expect(idleDays(null, '2026-03-26', null, '2026-03-29')).toBe(3);
  });
});

describe('when to say so', () => {
  it('three days or more, until dismissed today', () => {
    expect(INACTIVITY_DAYS).toBe(3);
    expect(inactivityNotice(2, null, '2026-10-27')).toBeNull();
    expect(inactivityNotice(3, null, '2026-10-27')).toBe(3);
    expect(inactivityNotice(40, null, '2026-10-27')).toBe(40);
  });

  it('a dismissal lasts the day, not longer', () => {
    expect(inactivityNotice(5, '2026-10-27', '2026-10-27')).toBeNull();
    expect(inactivityNotice(5, '2026-10-26', '2026-10-27')).toBe(5);
  });

  it('nothing to count is nothing to say', () => {
    expect(inactivityNotice(null, null, '2026-10-27')).toBeNull();
  });
});
