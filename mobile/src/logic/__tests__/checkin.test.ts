import type { CoachingData } from '../coachingProfile';
import {
  CHECKIN_INTERVAL_DAYS,
  checkinDaysRemaining,
  checkinRequest,
  currentTargets,
  cycleDay,
  goalHandled,
  goalReached,
  macroRows,
  parseAdjustment,
  weekDates,
} from '../checkin';

const profile = (over: Partial<CoachingData> = {}): CoachingData => ({
  aspiration: 'lose', gender: 'female', weightKg: 70, goalWeightKg: 62, heightCm: 165, bodyFatRangeId: 'f3', activityLevel: 'lift_only', proteinPreference: 'high',
  dietPreference: 'low_carb', distribution: 'stable', lossRatePct: 0.5, gainRatePct: null, createdOn: '2026-10-01', lastAdjustmentOn: '2026-10-20', ...over,
});

describe('when a check-in is due', () => {
  it('seven days after the last one', () => {
    expect(CHECKIN_INTERVAL_DAYS).toBe(7);
    expect(checkinDaysRemaining(profile(), false, '2026-10-20')).toBe(7);
    expect(checkinDaysRemaining(profile(), false, '2026-10-21')).toBe(6);
    expect(checkinDaysRemaining(profile(), false, '2026-10-26')).toBe(1);
    expect(checkinDaysRemaining(profile(), false, '2026-10-27')).toBe(0);
    expect(checkinDaysRemaining(profile(), false, '2026-11-15')).toBe(0);
  });

  it('counts from the day the profile was made until there has been a check-in', () => {
    expect(checkinDaysRemaining(profile({ lastAdjustmentOn: null }), false, '2026-10-04')).toBe(4);
    expect(checkinDaysRemaining(profile({ lastAdjustmentOn: null, createdOn: null }), false, '2026-10-04')).toBe(0);
  });

  it('no profile, no check-in; a reached goal makes it due at once', () => {
    expect(checkinDaysRemaining(null, false, '2026-10-27')).toBeNull();
    expect(checkinDaysRemaining(null, true, '2026-10-27')).toBeNull();
    expect(checkinDaysRemaining(profile(), true, '2026-10-21')).toBe(0);
  });

  it('a clock change does not make a day longer or shorter', () => {
    expect(checkinDaysRemaining(profile({ lastAdjustmentOn: '2026-03-25' }), false, '2026-03-29')).toBe(3);
    expect(checkinDaysRemaining(profile({ lastAdjustmentOn: '2026-10-24' }), false, '2026-10-26')).toBe(5);
  });
});

describe('the goal', () => {
  it('is reached when the newest weigh-in is at or past it, in the direction of the goal', () => {
    expect(goalReached(profile(), 62)).toBe(true);
    expect(goalReached(profile(), 61.9)).toBe(true);
    expect(goalReached(profile(), 62.1)).toBe(false);
    expect(goalReached(profile({ aspiration: 'gain', goalWeightKg: 80 }), 80)).toBe(true);
    expect(goalReached(profile({ aspiration: 'gain', goalWeightKg: 80 }), 79.9)).toBe(false);
  });

  it('maintaining has no goal to reach, and no weigh-in or goal means none reached', () => {
    expect(goalReached(profile({ aspiration: 'maintain' }), 62)).toBe(false);
    expect(goalReached(profile(), null)).toBe(false);
    expect(goalReached(profile({ goalWeightKg: null }), 50)).toBe(false);
    expect(goalReached(null, 50)).toBe(false);
  });

  it('has been dealt with when the same goal in the same direction is marked', () => {
    expect(goalHandled(profile(), { weightKg: 62, aspiration: 'lose' })).toBe(true);
    expect(goalHandled(profile(), { weightKg: 61, aspiration: 'lose' })).toBe(false);
    expect(goalHandled(profile(), { weightKg: 62, aspiration: 'gain' })).toBe(false);
    expect(goalHandled(profile(), { weightKg: null, aspiration: null })).toBe(false);
    expect(goalHandled(null, { weightKg: 62, aspiration: 'lose' })).toBe(false);
  });
});

describe('the week', () => {
  it('is the seven days ending today, oldest first', () => {
    expect(weekDates('2026-10-27')).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(weekDates('2026-03-02')[0]).toBe('2026-02-24');
  });

  it('a day with food cycles between logged and incomplete', () => {
    expect(cycleDay('logged', true)).toEqual({ status: 'incomplete', override: 'incomplete' });
    expect(cycleDay('incomplete', true)).toEqual({ status: 'logged', override: null });
  });

  it('a day without food cycles between not logged and fasting', () => {
    expect(cycleDay('none', false)).toEqual({ status: 'fasting', override: 'fasting' });
    expect(cycleDay('fasting', false)).toEqual({ status: 'none', override: null });
  });

  it('a status the day cannot have starts the cycle from its first', () => {
    expect(cycleDay('fasting', true)).toEqual({ status: 'logged', override: null });
    expect(cycleDay('incomplete', false)).toEqual({ status: 'none', override: null });
  });
});

describe('the request', () => {
  it('works calories out from the macros as the website does', () => {
    expect(currentTargets({ protein: 150, fat: 70, carbs: 200 })).toEqual({ protein: 150, fat: 70, carbs: 200, calories: 2030 });
    expect(currentTargets({ protein: 150.4, fat: 70.4, carbs: 200.4 }).calories).toBe(Math.round(150.4 * 4 + 70.4 * 9 + 200.4 * 4));
  });

  it('has the profile, the targets and the week', () => {
    expect(checkinRequest(profile(), { protein: 150, fat: 70, carbs: 200 }, [{ day: '2026-10-21', kg: 70.2 }, { day: '2026-10-27', kg: 69.5 }], [{ day: '2026-10-22', calories: 2100 }], [4, 5])).toEqual({
      aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
      loss_rate_pct: 0.5, gain_rate_pct: null, current_targets: { protein: 150, fat: 70, carbs: 200, calories: 2030 },
      week_weight_entries: [{ date: '2026-10-21', kg: 70.2 }, { date: '2026-10-27', kg: 69.5 }], week_calorie_days: [{ date: '2026-10-22', calories: 2100 }], photo_ids: [4, 5],
    });
  });

  it('does not share the lists it is given', () => {
    const ids = [1];
    const body = checkinRequest(profile(), { protein: 1, fat: 1, carbs: 1 }, [], [], ids);
    ids.push(2);
    expect(body.photo_ids).toEqual([1]);
  });
});

describe('the answer', () => {
  const adjustment = { calories: 1950, protein: 150, fat: 62, carbs: 198, delta: -80, reason: 'Your weight is not moving.' };

  it('reads an adjustment', () => {
    expect(parseAdjustment({ ok: true, adjustment })).toEqual(adjustment);
  });

  it('null is "on track"', () => {
    expect(parseAdjustment({ ok: true, adjustment: null })).toBeNull();
  });

  it.each([[null], [undefined], ['x'], [{}], [{ ok: true }], [{ adjustment: 'x' }], [{ adjustment: [] }], [{ adjustment: { ...adjustment, calories: '1950' } }], [{ adjustment: { ...adjustment, delta: NaN } }], [{ adjustment: { calories: 1, protein: 1, fat: 1, carbs: 1 } }]])('is not an answer: %j', (body) => {
    expect(parseAdjustment(body)).toBeUndefined();
  });

  it.each(['calories', 'protein', 'fat', 'carbs', 'delta'])('an adjustment without %s is not an answer', (field) => {
    expect(parseAdjustment({ adjustment: { ...adjustment, [field]: undefined } })).toBeUndefined();
  });

  it('a missing reason is empty', () => {
    expect(parseAdjustment({ adjustment: { ...adjustment, reason: undefined } })?.reason).toBe('');
  });
});

describe('what changed', () => {
  const adjustment = { calories: 1950, protein: 150, fat: 62.4, carbs: 198.6, delta: -80, reason: '' };

  it('each macro before, after and by how much', () => {
    expect(macroRows(adjustment, { protein: 150, fat: 70, carbs: 190 })).toEqual([
      { key: 'protein', before: 150, after: 150, diff: 0 },
      { key: 'fat', before: 70, after: 62, diff: -8 },
      { key: 'carbs', before: 190, after: 199, diff: 9 },
    ]);
  });

  it('with nothing to compare to, nothing changed', () => {
    expect(macroRows(adjustment, null).map((r) => r.diff)).toEqual([0, 0, 0]);
  });

  it('rounds the old figure to the nearest too', () => {
    expect(macroRows(adjustment, { protein: 150, fat: 62.6, carbs: 198.6 }).map((r) => r.before)).toEqual([150, 63, 199]);
  });

  it('rounds each side before comparing', () => {
    expect(macroRows({ ...adjustment, fat: 62.5 }, { protein: 150, fat: 62.4, carbs: 199 })[1]).toEqual({ key: 'fat', before: 62, after: 63, diff: 1 });
  });
});
