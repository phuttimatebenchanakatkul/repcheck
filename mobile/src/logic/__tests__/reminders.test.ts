import { CHECKIN_HOUR, INACTIVITY_HOUR, planReminders, type ReminderInput } from '../reminders';

// The phone's own time zone throughout: a reminder is for 6 pm on a day, wherever that is.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

const input = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  now: at(2026, 10, 27, 12),
  hasProfile: true,
  createdOn: '2026-10-01',
  lastAdjustmentOn: '2026-10-25',
  latestWeightDay: '2026-10-27',
  latestFoodDay: '2026-10-26',
  ...over,
});
const find = (plan: ReturnType<typeof planReminders>, id: string) => plan.find((p) => p.id === id)?.at;

describe('the hours', () => {
  it('are an evening for being away and a morning for the check-in', () => {
    expect(INACTIVITY_HOUR).toBe(18);
    expect(CHECKIN_HOUR).toBe(9);
  });
});

describe('without a coaching profile', () => {
  it('there is nothing to remind of', () => {
    expect(planReminders(input({ hasProfile: false }))).toEqual([]);
  });
});

describe('being away', () => {
  it('is reminded of on the evening the third quiet day begins, counting from the later of food and weight', () => {
    expect(find(planReminders(input()), 'inactivity')).toEqual(at(2026, 10, 30, 18));
    expect(find(planReminders(input({ latestWeightDay: '2026-10-20', latestFoodDay: '2026-10-26' })), 'inactivity')).toEqual(at(2026, 10, 29, 18));
    expect(find(planReminders(input({ latestWeightDay: '2026-10-26', latestFoodDay: '2026-10-20' })), 'inactivity')).toEqual(at(2026, 10, 29, 18));
  });

  it('counts from the day the profile was made when nothing was ever logged', () => {
    expect(find(planReminders(input({ latestWeightDay: null, latestFoodDay: null, createdOn: '2026-10-26' })), 'inactivity')).toEqual(at(2026, 10, 29, 18));
  });

  it('with nothing to count from, there is no reminder', () => {
    expect(find(planReminders(input({ latestWeightDay: null, latestFoodDay: null, createdOn: null })), 'inactivity')).toBeUndefined();
  });

  it('already away: this evening if it is still ahead, else tomorrow evening, once', () => {
    const away = { latestWeightDay: '2026-10-20', latestFoodDay: null };
    expect(find(planReminders(input({ ...away, now: at(2026, 10, 27, 12) })), 'inactivity')).toEqual(at(2026, 10, 27, 18));
    expect(find(planReminders(input({ ...away, now: at(2026, 10, 27, 17, 59) })), 'inactivity')).toEqual(at(2026, 10, 27, 18));
    expect(find(planReminders(input({ ...away, now: at(2026, 10, 27, 18) })), 'inactivity')).toEqual(at(2026, 10, 28, 18));
    expect(find(planReminders(input({ ...away, now: at(2026, 10, 27, 23, 30) })), 'inactivity')).toEqual(at(2026, 10, 28, 18));
    expect(planReminders(input({ ...away })).filter((p) => p.id === 'inactivity')).toHaveLength(1);
  });

  it('exactly at the hour of the third day is already past', () => {
    expect(find(planReminders(input({ latestWeightDay: '2026-10-24', latestFoodDay: null, now: at(2026, 10, 27, 18) })), 'inactivity')).toEqual(at(2026, 10, 28, 18));
    expect(find(planReminders(input({ latestWeightDay: '2026-10-24', latestFoodDay: null, now: at(2026, 10, 27, 17, 59) })), 'inactivity')).toEqual(at(2026, 10, 27, 18));
  });

  it('crosses a month end', () => {
    expect(find(planReminders(input({ now: at(2026, 10, 30, 12), latestWeightDay: '2026-10-30', latestFoodDay: null })), 'inactivity')).toEqual(at(2026, 11, 2, 18));
  });
});

describe('the weekly check-in', () => {
  it('is reminded of the morning it falls due, seven days after the last', () => {
    expect(find(planReminders(input()), 'checkin')).toEqual(at(2026, 11, 1, 9));
  });

  it('counts from the day the profile was made until there has been one', () => {
    expect(find(planReminders(input({ lastAdjustmentOn: null, createdOn: '2026-10-25' })), 'checkin')).toEqual(at(2026, 11, 1, 9));
  });

  it('is not reminded of when it is already due', () => {
    expect(find(planReminders(input({ lastAdjustmentOn: '2026-10-20' })), 'checkin')).toBeUndefined();
  });

  it('due this morning and the hour passed: no reminder; due this morning and the hour is ahead: one', () => {
    expect(find(planReminders(input({ lastAdjustmentOn: '2026-10-20', now: at(2026, 10, 27, 9) })), 'checkin')).toBeUndefined();
    expect(find(planReminders(input({ lastAdjustmentOn: '2026-10-20', now: at(2026, 10, 27, 8, 59) })), 'checkin')).toEqual(at(2026, 10, 27, 9));
  });

  it('with nothing to count from, there is no reminder', () => {
    expect(find(planReminders(input({ lastAdjustmentOn: null, createdOn: null })), 'checkin')).toBeUndefined();
  });

  it('is not moved by logging food or weight', () => {
    expect(find(planReminders(input({ latestWeightDay: '2026-10-27' })), 'checkin')).toEqual(find(planReminders(input({ latestWeightDay: null })), 'checkin'));
  });
});

describe('both', () => {
  it('are two reminders, each at most once', () => {
    const plan = planReminders(input());
    expect(plan.map((p) => p.id).sort()).toEqual(['checkin', 'inactivity']);
  });

  it('a day on which the clocks change is still 6 pm', () => {
    const plan = planReminders(input({ now: at(2026, 3, 27, 12), latestWeightDay: '2026-03-27', latestFoodDay: null, lastAdjustmentOn: '2026-03-27' }));
    expect(find(plan, 'inactivity')).toEqual(at(2026, 3, 30, 18));
    expect(find(plan, 'checkin')).toEqual(at(2026, 4, 3, 9));
  });
});
