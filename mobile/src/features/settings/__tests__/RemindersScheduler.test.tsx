import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { setLanguage } from '@/i18n';
import { addDays, toIsoDate } from '@/logic/dates';
import { chooseReminders, resetReminderPref } from '@/store/remindersPref';
import { USER, dataHarness, nutritionRow } from '@/testing/dataHarness';

import { RemindersScheduler } from '../RemindersScheduler';

const mockReminders = { schedule: jest.fn(), cancel: jest.fn() };
jest.mock('@/ui/reminders', () => ({
  scheduleReminders: (...a: unknown[]) => mockReminders.schedule(...a),
  cancelReminders: (...a: unknown[]) => mockReminders.cancel(...a),
}));

const TODAY = toIsoDate(new Date());
const day = (back: number) => addDays(TODAY, -back);
const local = (iso: string, hour: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, hour);
};

const profile = (over: Record<string, unknown> = {}) => ({
  user_id: USER, aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
  goal_weight_kg: 62, height_cm: 165, distribution_mode: 'stable', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: day(30), last_adjustment_on: day(2),
  last_adjustment_reason: null, last_adjustment_delta: null, last_adjustment_at: null, weekly_distribution: null, goal_achieved_weight_kg: null, goal_achieved_aspiration: null,
  goal_handled_weight_kg: null, goal_handled_aspiration: null, inactivity_notified_on: null, extra: {}, ...over,
});
const weight = (back: number) => ({ user_id: USER, log_date: day(back), kg: 70, logged_at: new Date(`${day(back)}T09:00:00Z`).toISOString(), extra: {} });

type Harness = ReturnType<typeof dataHarness>;
async function open(h: Harness = dataHarness()) {
  const view = await render(
    <h.Provider>
      <RemindersScheduler />
    </h.Provider>,
  );
  return { h, view };
}
const lastPlan = () => mockReminders.schedule.mock.calls[mockReminders.schedule.mock.calls.length - 1] as [{ id: string; at: Date }[], Record<string, { title: string; body: string }>];

beforeEach(async () => {
  jest.clearAllMocks();
  mockReminders.schedule.mockResolvedValue(undefined);
  mockReminders.cancel.mockResolvedValue(undefined);
  resetReminderPref();
  await AsyncStorage.clear();
  setLanguage('en');
});

describe('with reminders off', () => {
  it('nothing is scheduled, and any waiting are cleared', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    await open(h);
    await waitFor(() => expect(mockReminders.cancel).toHaveBeenCalled());
    expect(mockReminders.schedule).not.toHaveBeenCalled();
  });
});

describe('with reminders on', () => {
  const on = async () => chooseReminders(true);

  it('schedules the away and check-in reminders from the data, in the person’s words', async () => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile({ last_adjustment_on: day(2) })]);
    h.db.seed('weight_entries', [weight(1)]);
    await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    const [plan, content] = lastPlan();
    expect(plan.map((p) => p.id).sort()).toEqual(['checkin', 'inactivity']);
    expect(plan.find((p) => p.id === 'inactivity')?.at).toEqual(local(addDays(day(1), 3), 18));
    expect(plan.find((p) => p.id === 'checkin')?.at).toEqual(local(addDays(day(2), 7), 9));
    expect(content.inactivity).toEqual({ title: 'RepCheck', body: "You haven't logged your weight or food in a few days — come back to keep your calorie target accurate." });
    expect(content.checkin).toEqual({ title: 'Weekly check-in', body: 'Time to check in — this keeps your calorie target accurate to how your week actually went.' });
  });

  it('without a coaching profile, nothing is waiting', async () => {
    await on();
    const { h } = await open();
    await waitFor(() => expect(h.db.calls).toContain('read:coaching_profiles'));
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    expect(lastPlan()[0]).toEqual([]);
  });

  it('waits for the data before working anything out', async () => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    jest.spyOn(h.data.fetch, 'weights').mockReturnValue(new Promise(() => undefined));
    await open(h);
    await waitFor(() => expect(h.db.calls).toContain('read:coaching_profiles'));
    await act(async () => undefined);
    expect(mockReminders.schedule).not.toHaveBeenCalled();
  });

  it.each([['weights'], ['nutritionRecent'], ['coachingRow']] as const)('waits for the %s too', async (fetcher) => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    (jest.spyOn(h.data.fetch, fetcher) as jest.SpyInstance).mockReturnValue(new Promise(() => undefined));
    await open(h);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50)); // time for everything that is not pending to arrive
    });
    expect(mockReminders.schedule).not.toHaveBeenCalled();
  });

  it('logging food moves the away reminder out of the way', async () => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    h.db.seed('weight_entries', [weight(10)]);
    await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    const before = lastPlan()[0].find((p) => p.id === 'inactivity')?.at as Date;
    const calls = mockReminders.schedule.mock.calls.length;
    await act(async () => {
      await h.data.actions.saveFood(TODAY, { id: 'f1', food: 'Rice', addedAt: new Date().getTime(), grams: 100, unit: 'g', baseCalories: 100, baseCarbs: 20, baseFat: 0, baseProtein: 2 });
    });
    await waitFor(() => expect(mockReminders.schedule.mock.calls.length).toBeGreaterThan(calls));
    const after = lastPlan()[0].find((p) => p.id === 'inactivity')?.at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    expect(after).toEqual(local(addDays(TODAY, 3), 18));
  });

  it('does not schedule again when nothing it depends on changed', async () => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    const { view } = await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    const calls = mockReminders.schedule.mock.calls.length;
    await view.rerender(
      <h.Provider>
        <RemindersScheduler />
      </h.Provider>,
    );
    await act(async () => undefined);
    expect(mockReminders.schedule.mock.calls.length).toBe(calls);
  });

  it('a change of language is scheduled in the new language', async () => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    const calls = mockReminders.schedule.mock.calls.length;
    await act(async () => setLanguage('th'));
    await waitFor(() => expect(mockReminders.schedule.mock.calls.length).toBeGreaterThan(calls));
    expect(lastPlan()[1].inactivity.body).not.toBe("You haven't logged your weight or food in a few days — come back to keep your calorie target accurate.");
  });

  it('turning reminders off clears them', async () => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    mockReminders.cancel.mockClear();
    await act(async () => {
      await chooseReminders(false);
    });
    await waitFor(() => expect(mockReminders.cancel).toHaveBeenCalled());
  });

  it('the saved choice is read at start-up: on from the last visit', async () => {
    await AsyncStorage.setItem('repcheck_reminders', 'on');
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
  });

  it('coming back to the front after the evening hour has passed schedules the next evening', async () => {
    await on();
    // Only the clock is faked: timers and promises run for real.
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'nextTick', 'setImmediate', 'clearImmediate'], now: new Date(2026, 9, 27, 17, 0) });
    try {
      let change: (state: string) => void = () => undefined;
      jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
        change = handler;
        return { remove: jest.fn() };
      }) as never);
      const h = dataHarness();
      h.db.seed('coaching_profiles', [profile({ created_on: '2026-09-01', last_adjustment_on: '2026-10-26' })]);
      h.db.seed('weight_entries', [{ user_id: USER, log_date: '2026-10-20', kg: 70, logged_at: new Date(2026, 9, 20, 9).toISOString(), extra: {} }]);
      await open(h);
      await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
      expect(lastPlan()[0].find((p) => p.id === 'inactivity')?.at).toEqual(new Date(2026, 9, 27, 18, 0));
      const calls = mockReminders.schedule.mock.calls.length;
      jest.setSystemTime(new Date(2026, 9, 27, 19, 0));
      await act(async () => change('active'));
      await waitFor(() => expect(mockReminders.schedule.mock.calls.length).toBeGreaterThan(calls));
      expect(lastPlan()[0].find((p) => p.id === 'inactivity')?.at).toEqual(new Date(2026, 9, 28, 18, 0));
    } finally {
      jest.useRealTimers();
    }
  });

  it('coming back to the front plans again, so a new day is counted', async () => {
    await on();
    let change: (state: string) => void = () => undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
      change = handler;
      return { remove };
    }) as never);
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile({ created_on: day(30) })]);
    h.db.seed('weight_entries', [weight(10)]); // already away: the reminder is for the next 6 pm
    const { view } = await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    const calls = mockReminders.schedule.mock.calls.length;
    await act(async () => change('background'));
    expect(mockReminders.schedule.mock.calls.length).toBe(calls);
    await act(async () => change('active'));
    expect(mockReminders.schedule.mock.calls.length).toBeGreaterThanOrEqual(calls);
    await view.unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('signing out takes the reminders with it', async () => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    const { view } = await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    mockReminders.cancel.mockClear();
    await view.unmount();
    expect(mockReminders.cancel).toHaveBeenCalled();
  });

  it('food that is the latest thing logged counts too', async () => {
    await on();
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    h.db.seed('nutrition_entries', [nutritionRow('a', day(1), new Date().getTime())]);
    await open(h);
    await waitFor(() => expect(mockReminders.schedule).toHaveBeenCalled());
    expect(lastPlan()[0].find((p) => p.id === 'inactivity')?.at).toEqual(local(addDays(day(1), 3), 18));
  });
});
