import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { toTimestamp } from '@/data/mappers';
import { addDays, toIsoDate } from '@/logic/dates';
import { USER, dataHarness, nutritionRow } from '@/testing/dataHarness';

import { InactivityBanner } from '../InactivityBanner';

const TODAY = toIsoDate(new Date());
const day = (back: number) => addDays(TODAY, -back);
const at = (iso: string) => new Date(`${iso}T09:00:00`).getTime();

const profile = (over: Record<string, unknown> = {}) => ({
  user_id: USER, aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
  goal_weight_kg: 62, height_cm: 165, distribution_mode: 'stable', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: day(30), last_adjustment_on: day(2),
  last_adjustment_reason: null, last_adjustment_delta: null, last_adjustment_at: null, weekly_distribution: null, goal_achieved_weight_kg: null, goal_achieved_aspiration: null,
  goal_handled_weight_kg: null, goal_handled_aspiration: null, inactivity_notified_on: null, extra: {}, ...over,
});
const weight = (back: number) => ({ user_id: USER, log_date: day(back), kg: 70, logged_at: toTimestamp(at(day(back))), extra: {} });

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <InactivityBanner />
    </h.Provider>,
  );
  return h;
}
const settleQueries = async (h: ReturnType<typeof dataHarness>) => {
  await waitFor(() => expect(h.db.calls).toContain('read:coaching_profiles'));
  await act(async () => undefined);
};

describe('the "it\'s been N days" nudge', () => {
  it('shows once nothing has been logged for three days, with how many', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    h.db.seed('weight_entries', [weight(4)]);
    h.db.seed('nutrition_entries', [nutritionRow('a', day(6), at(day(6)))]);
    await open(h);
    expect(await screen.findByTestId('inactivity')).toHaveTextContent(/^⚠️ It's been 4 days since you logged your weight or food — come back to keep your calorie target accurate\.$/);
  });

  it('is not shown for two days away, nor with recent food or a recent weigh-in', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    h.db.seed('weight_entries', [weight(2)]);
    await open(h);
    await settleQueries(h);
    expect(screen.queryByTestId('inactivity')).toBeNull();
  });

  it('the later of food and weight counts', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile()]);
    h.db.seed('weight_entries', [weight(8)]);
    h.db.seed('nutrition_entries', [nutritionRow('a', day(1), at(day(1)))]);
    await open(h);
    await settleQueries(h);
    expect(screen.queryByTestId('inactivity')).toBeNull();
  });

  it('with nothing ever logged, counts from the day the profile was made', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile({ created_on: day(10) })]);
    await open(h);
    expect(await screen.findByTestId('inactivity')).toHaveTextContent(/It's been 10 days/);
  });

  it.each([['weights'], ['nutritionRecent']] as const)('does not flash while the %s are still loading', async (fetcher) => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile({ created_on: day(30) })]);
    (jest.spyOn(h.data.fetch, fetcher) as jest.SpyInstance).mockReturnValue(new Promise(() => undefined));
    await open(h);
    await settleQueries(h);
    expect(screen.queryByTestId('inactivity')).toBeNull();
  });

  it('is not shown without a coaching profile', async () => {
    const h = await open();
    await settleQueries(h);
    expect(screen.queryByTestId('inactivity')).toBeNull();
  });

  it('dismissing hides it, and it stays hidden for the day (kept on the account)', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile({ created_on: day(10), extra: { note: 'kept' } })]);
    await open(h);
    await fireEvent.press(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByTestId('inactivity')).toBeNull());
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ inactivity_notified_on: TODAY, created_on: day(10), extra: { note: 'kept' }, aspiration: 'lose' });
  });

  it('a dismissal from an earlier day does not hide it', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile({ created_on: day(10), inactivity_notified_on: day(1) })]);
    await open(h);
    expect(await screen.findByTestId('inactivity')).toBeOnTheScreen();
  });

  it('a dismissal made today is already there on the next visit', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile({ created_on: day(10), inactivity_notified_on: TODAY })]);
    await open(h);
    await settleQueries(h);
    expect(screen.queryByTestId('inactivity')).toBeNull();
  });
});
