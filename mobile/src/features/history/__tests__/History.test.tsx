import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { addDays, parseIso, toIsoDate } from '@/logic/dates';
import { USER, dataHarness, nutritionRow } from '@/testing/dataHarness';

import StreakScreen from '../StreakScreen';
import WeightHistoryScreen from '../WeightHistoryScreen';

const NOW = new Date();
const TODAY = toIsoDate(NOW);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const label = (day: string) => `${MONTHS[(parseIso(day) as Date).getMonth()]} ${(parseIso(day) as Date).getFullYear()}`;
const long = (day: string) => (parseIso(day) as Date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
const at = (day: string, hour = 9) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};
const weight = (day: string, kg: number) => ({ user_id: USER, log_date: day, kg, logged_at: new Date(at(day)).toISOString(), extra: {} });
const iso = (ms: number) => new Date(ms).toISOString();

const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};

/** The page has two month navigators (the weight list's and the logging calendar's); the first is the list's. */
const first = async (name: string) => (await screen.findAllByRole('button', { name }))[0];

async function openStreak(h = dataHarness()) {
  await render(
    <h.Provider>
      <StreakScreen />
    </h.Provider>,
  );
  return h;
}

async function openWeight(h = dataHarness()) {
  await render(
    <h.Provider>
      <WeightHistoryScreen />
    </h.Provider>,
  );
  return h;
}

describe('the streak page', () => {
  it('shows the current and longest streak and marks the days that counted', async () => {
    const h = dataHarness();
    const days = [TODAY, addDays(TODAY, -1), addDays(TODAY, -2)];
    h.db.seed('nutrition_entries', days.map((d, i) => nutritionRow(`n${i}`, d, at(d))));
    await openStreak(h);
    await waitFor(() => expect(screen.getByTestId('streak-current')).toHaveTextContent('3'));
    expect(screen.getByTestId('streak-longest')).toHaveTextContent('3');
    expect(screen.getByLabelText(`${long(TODAY)}, Streak day`)).toBeOnTheScreen();
    expect(screen.getByText(label(TODAY))).toBeOnTheScreen();
  });

  it('counts this month’s days: those with something and those without, up to today only', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('n', TODAY, at(TODAY))]);
    await openStreak(h);
    const dayOfMonth = NOW.getDate();
    await waitFor(() => expect(screen.getByTestId('streak-summary-active')).toHaveTextContent('1 Streak day'));
    expect(screen.getByTestId('streak-summary-none')).toHaveTextContent(`${dayOfMonth - 1} No activity`);
  });

  it('a month with nothing says so', async () => {
    await openStreak();
    expect(await screen.findByText('No activity logged this month yet.')).toBeOnTheScreen();
  });

  it('the arrows move between months; forward stops at this month', async () => {
    await openStreak();
    const next = await screen.findByRole('button', { name: 'Next month' });
    expect(next.props.accessibilityState.disabled).toBe(true);
    await press('Previous month');
    const prev = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
    expect(await screen.findByText(`${MONTHS[prev.getMonth()]} ${prev.getFullYear()}`)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Next month' }).props.accessibilityState.disabled).toBe(false);
    await press('Next month');
    expect(await screen.findByText(label(TODAY))).toBeOnTheScreen();
  });

  it('back stops at the first month the app has data for', async () => {
    await openStreak();
    for (let i = 0; i < 15; i++) {
      const back = await screen.findByRole('button', { name: 'Previous month' });
      if (back.props.accessibilityState.disabled) break;
      await fireEvent.press(back);
    }
    expect(screen.getByRole('button', { name: 'Previous month' }).props.accessibilityState.disabled).toBe(true);
    const earliest = new Date(addDays(TODAY, -400).replace(/-/g, '/'));
    expect(screen.getByText(`${MONTHS[earliest.getMonth()]} ${earliest.getFullYear()}`)).toBeOnTheScreen();
  });

  it('a log made with no signal counts at once', async () => {
    const h = dataHarness();
    h.goOffline();
    await openStreak(h);
    await waitFor(() => expect(screen.getByTestId('streak-current')).toHaveTextContent('0'));
    await act(async () => {
      await h.data.actions.saveFood(TODAY, { id: 'n', food: 'Egg', addedAt: Date.now(), grams: 50, unit: 'g', baseCalories: 143, baseCarbs: 0, baseFat: 9, baseProtein: 12 });
    });
    await waitFor(() => expect(screen.getByTestId('streak-current')).toHaveTextContent('1'));
  });
});

describe('weight history: nothing logged', () => {
  it('says so and offers to log today’s weight', async () => {
    const h = await openWeight();
    expect(await screen.findByText('No weight logged yet')).toBeOnTheScreen();
    await press('Log your weight');
    await fireEvent.changeText(await screen.findByLabelText('Weight (kg)'), '80.5');
    await press('Save');
    await waitFor(() => expect(h.outbox.pending(USER).length).toBeGreaterThan(0));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('weight_entries')).toMatchObject([{ log_date: TODAY, kg: 80.5 }]);
    expect(await screen.findByTestId('stat-latest')).toHaveTextContent('80.5 kg');
  });
});

describe('weight history: a month', () => {
  const lastMonth = (d: number) => {
    const day = new Date(NOW.getFullYear(), NOW.getMonth() - 1, d);
    return toIsoDate(day);
  };

  async function withWeights() {
    const h = dataHarness();
    h.db.seed('weight_entries', [weight(lastMonth(2), 82), weight(lastMonth(10), 81), weight(lastMonth(20), 80.5), weight(addDays(lastMonth(1), -60), 90)]);
    await openWeight(h);
    await screen.findByTestId('stat-latest');
    return h;
  }

  it('opens on the month of the latest weigh-in, with its stats', async () => {
    await withWeights();
    expect(screen.getAllByText(label(lastMonth(1)))).toHaveLength(2); // the list and the logging calendar both open there
    expect(screen.getByTestId('stat-latest')).toHaveTextContent('80.5 kg');
    expect(screen.getByTestId('stat-average')).toHaveTextContent('81.2 kg');
    expect(screen.getByTestId('stat-change')).toHaveTextContent('-1.5 kg');
  });

  it('lists the month newest first, each row with its change from the one before', async () => {
    await withWeights();
    expect(screen.getAllByText('80.5 kg')).toHaveLength(2); // the stat and the newest row
    expect(screen.getByText('-0.5 kg')).toBeOnTheScreen();
    expect(screen.getByText('-1 kg')).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  it('the arrows change month; an empty month says so; forward stops at this month', async () => {
    await withWeights();
    await fireEvent.press(await first('Next month'));
    expect((await screen.findAllByText(label(TODAY))).length).toBeGreaterThan(0);
    expect(screen.getByText(/No weight logged in/)).toBeOnTheScreen();
    expect((await first('Next month')).props.accessibilityState.disabled).toBe(true);
  });

  it('one entry in a month shows no chart, just the hint', async () => {
    const h = dataHarness();
    h.db.seed('weight_entries', [weight(addDays(TODAY, 0), 80)]);
    await openWeight(h);
    expect(await screen.findByText('Log at least two entries in this period to see a trend line.')).toBeOnTheScreen();
  });

  it('with two or more there is a chart instead of the hint', async () => {
    await withWeights();
    expect(screen.queryByText('Log at least two entries in this period to see a trend line.')).toBeNull();
  });

  it('pounds are shown when that is the setting', async () => {
    const h = dataHarness();
    h.db.seed('user_settings', [{ user_id: USER, units_weight: 'lb' }]);
    h.db.seed('weight_entries', [weight(TODAY, 100)]);
    await openWeight(h);
    await waitFor(() => expect(screen.getByTestId('stat-latest')).toHaveTextContent('220.5 lb'));
  });

  it('the year view lists the months December to January and a tap on a month with data opens it', async () => {
    await withWeights();
    await fireEvent.press(screen.getByRole('radio', { name: 'Year' }));
    const monthName = MONTHS[(parseIso(lastMonth(1)) as Date).getMonth()];
    const row = await screen.findByRole('button', { name: new RegExp(`^${monthName}, 80.5 kg`) });
    expect(screen.getByText('avg 81.2 kg')).toBeOnTheScreen();
    expect(screen.getAllByText('No data').length).toBeGreaterThan(0);
    await fireEvent.press(row);
    expect((await screen.findAllByText(label(lastMonth(1)))).length).toBeGreaterThan(0);
    expect(screen.getByRole('radio', { name: 'Month' }).props.accessibilityState.selected).toBe(true);
  });

  it('the year arrows change the year', async () => {
    await withWeights();
    await fireEvent.press(screen.getByRole('radio', { name: 'Year' }));
    const year = (parseIso(lastMonth(1)) as Date).getFullYear();
    expect(await screen.findByText(String(year))).toBeOnTheScreen();
    await fireEvent.press(await first('Previous month'));
    expect(await screen.findByText(String(year - 1))).toBeOnTheScreen();
    await fireEvent.press(await first('Next month'));
    expect(await screen.findByText(String(year))).toBeOnTheScreen();
  });
});

describe('weight history: the logging calendar', () => {
  it('counts the days logged and not logged this month, and opens a day', async () => {
    const h = dataHarness();
    h.db.seed('weight_entries', [weight(TODAY, 80), weight(addDays(TODAY, -1), 81)]);
    await openWeight(h);
    await waitFor(() => expect(screen.getByTestId('logged-count')).toHaveTextContent(NOW.getDate() >= 2 ? '2 logged' : '1 logged'));
    expect(screen.getByTestId('not-logged-count')).toBeOnTheScreen();
    if (NOW.getDate() >= 2) {
      await fireEvent.press(screen.getByRole('button', { name: `${long(addDays(TODAY, -1))}, Logged` }));
      expect(await screen.findByTestId('popup-weight')).toHaveTextContent('81 kg');
      expect(screen.queryByLabelText('Weight (kg)')).toBeNull(); // a past day is read-only
    }
  });

  it('a day with no weight says so', async () => {
    const h = dataHarness();
    h.db.seed('weight_entries', [weight(TODAY, 80)]);
    await openWeight(h);
    if (NOW.getDate() >= 3) {
      await fireEvent.press(await screen.findByRole('button', { name: `${long(addDays(TODAY, -2))}, Not logged` }));
      expect(await screen.findByTestId('popup-empty')).toHaveTextContent('not logged');
    }
  });

  it('today can be logged or replaced from its popup, which then closes', async () => {
    const h = dataHarness();
    h.db.seed('weight_entries', [weight(TODAY, 80)]);
    await openWeight(h);
    await fireEvent.press(await screen.findByRole('button', { name: `${long(TODAY)}, Logged` }));
    expect(await screen.findByTestId('popup-weight')).toHaveTextContent('80 kg');
    await fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '79.2');
    await press('Save');
    await waitFor(() => expect(screen.queryByTestId('popup-weight')).toBeNull());
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('weight_entries')).toMatchObject([{ log_date: TODAY, kg: 79.2 }]);
  });

  it('days after today cannot be opened', async () => {
    const h = dataHarness();
    h.db.seed('weight_entries', [weight(TODAY, 80)]);
    await openWeight(h);
    await screen.findByTestId('stat-latest');
    const last = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate();
    if (NOW.getDate() < last) {
      const future = toIsoDate(new Date(NOW.getFullYear(), NOW.getMonth(), last));
      expect(screen.queryByRole('button', { name: `${long(future)}, Not logged` })).toBeNull();
    }
  });
});

describe('survivors: numbers, hints, colours', () => {
  it('each circle is numbered with its day of the month', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('n', TODAY, at(TODAY))]);
    await openStreak(h);
    await screen.findByTestId('streak-current');
    const last = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate();
    for (const n of [1, 9, 10, last]) expect(screen.getByText(String(n), { exact: true })).toBeOnTheScreen();
    expect(screen.queryByText(String(last + 1), { exact: true })).toBeNull();
  });

  it('a month with activity has no "nothing logged" hint', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('n', TODAY, at(TODAY))]);
    await openStreak(h);
    await waitFor(() => expect(screen.getByTestId('streak-summary-active')).toHaveTextContent('1 Streak day'));
    expect(screen.queryByText('No activity logged this month yet.')).toBeNull();
  });

  it('a gain is red, a loss green, no change plain', async () => {
    const h = dataHarness();
    const day = (d: number) => toIsoDate(new Date(NOW.getFullYear(), NOW.getMonth() - 1, d));
    h.db.seed('weight_entries', [weight(day(2), 80), weight(day(10), 82), weight(day(20), 82)]);
    await openWeight(h);
    await screen.findByTestId('stat-change');
    const styleOf = (el: { props: { style?: unknown } }) => Object.assign({}, ...[el.props.style].flat(5).filter(Boolean));
    for (const el of screen.getAllByText('+2 kg')) expect(styleOf(el).color).toBe('#c4382e'); // the day it went up, and the month as a whole
    expect(styleOf(screen.getByText('0 kg')).color).toBe('#6b6d78'); // the day nothing changed
  });

  it('a loss is shown in green', async () => {
    const h = dataHarness();
    const day = (d: number) => toIsoDate(new Date(NOW.getFullYear(), NOW.getMonth() - 1, d));
    h.db.seed('weight_entries', [weight(day(2), 82), weight(day(10), 80)]);
    await openWeight(h);
    const style = Object.assign({}, ...[(await screen.findByTestId('stat-change')).props.style].flat(5).filter(Boolean));
    expect(style.color).toBe('#177e54');
  });

  it('with no weigh-ins there is no logging-history section', async () => {
    await openWeight();
    await screen.findByText('No weight logged yet');
    expect(screen.queryByText('Logging History')).toBeNull();
  });
});
