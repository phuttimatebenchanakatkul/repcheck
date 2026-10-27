import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { addDays, parseIso, startOfWeek, toIsoDate, weekDays } from '@/logic/dates';
import { USER, dataHarness, nutritionRow } from '@/testing/dataHarness';

import FullStatsScreen from '../FullStatsScreen';
import LoggingHistoryScreen from '../LoggingHistoryScreen';

const NOW = new Date();
const TODAY = toIsoDate(NOW);
const at = (day: string, hour = 9) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};
const long = (day: string) => (parseIso(day) as Date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const meal = (id: string, day: string, over: Record<string, unknown> = {}) => nutritionRow(id, day, at(day), over);

async function open(Screen: () => React.JSX.Element, h = dataHarness()) {
  await render(
    <h.Provider>
      <Screen />
    </h.Provider>,
  );
  return h;
}

describe('logging history', () => {
  it('counts the month’s days by what happened to them', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('a', TODAY)]);
    h.db.seed('day_status_overrides', [{ user_id: USER, log_date: addDays(TODAY, -1), status: 'fasting' }, { user_id: USER, log_date: addDays(TODAY, -2), status: 'incomplete' }]);
    await open(LoggingHistoryScreen, h);
    const day = NOW.getDate();
    await waitFor(() => expect(screen.getByTestId('count-logged')).toHaveTextContent('1 logged'));
    if (day >= 3) {
      expect(screen.getByTestId('count-fasting')).toHaveTextContent('1 fasting');
      expect(screen.getByTestId('count-incomplete')).toHaveTextContent('1 incomplete');
      expect(screen.getByTestId('count-none')).toHaveTextContent(`${day - 3} not logged`);
    }
  });

  it('a month with nothing says so', async () => {
    await open(LoggingHistoryScreen);
    expect(await screen.findByText('Nothing logged this month yet.')).toBeOnTheScreen();
  });

  it('a fasting mark on a day with food is ignored in favour of "incomplete" only when set; the mark wins over automatic', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('a', TODAY)]);
    h.db.seed('day_status_overrides', [{ user_id: USER, log_date: TODAY, status: 'incomplete' }]);
    await open(LoggingHistoryScreen, h);
    await waitFor(() => expect(screen.getByTestId('count-incomplete')).toHaveTextContent('1 incomplete'));
    expect(screen.getByTestId('count-logged')).toHaveTextContent('0 logged');
  });

  it('a day with food can be marked incomplete, and put back to logged', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('a', TODAY)]);
    await open(LoggingHistoryScreen, h);
    await press(`${long(TODAY)}, logged`);
    expect(await screen.findByText('How should this day count?')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Logged' }).props.accessibilityState.selected).toBe(true);
    await press('Incomplete logging');
    await waitFor(() => expect(screen.getByTestId('count-incomplete')).toHaveTextContent('1 incomplete'));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('day_status_overrides')).toEqual([{ user_id: USER, log_date: TODAY, status: 'incomplete' }]);
    await press(`${long(TODAY)}, incomplete`);
    await press('Logged');
    await waitFor(() => expect(screen.getByTestId('count-logged')).toHaveTextContent('1 logged'));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('day_status_overrides')).toEqual([]);
  });

  it('a day without food can be marked fasting', async () => {
    const h = await open(LoggingHistoryScreen);
    await press(`${long(TODAY)}, not logged`);
    expect(screen.getByRole('button', { name: 'Not logged' }).props.accessibilityState.selected).toBe(true);
    await press('Fasting');
    await waitFor(() => expect(screen.getByTestId('count-fasting')).toHaveTextContent('1 fasting'));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('day_status_overrides')).toMatchObject([{ log_date: TODAY, status: 'fasting' }]);
  });

  it('works with no signal: the mark shows and waits', async () => {
    const h = dataHarness();
    h.goOffline();
    await open(LoggingHistoryScreen, h);
    await press(`${long(TODAY)}, not logged`);
    await press('Fasting');
    await waitFor(() => expect(screen.getByTestId('count-fasting')).toHaveTextContent('1 fasting'));
    await act(async () => {
      expect((await h.flush()).retryInMs).not.toBeNull();
    });
    expect(h.outbox.pending(USER).length).toBeGreaterThan(0);
  });

  it('a food logged offline makes its day logged at once', async () => {
    const h = dataHarness();
    h.goOffline();
    await open(LoggingHistoryScreen, h);
    await screen.findByText('Nothing logged this month yet.');
    await act(async () => {
      await h.data.actions.saveFood(TODAY, { id: 'n', food: 'Egg', addedAt: Date.now(), grams: 50, unit: 'g', baseCalories: 143, baseCarbs: 0, baseFat: 9, baseProtein: 12 });
    });
    await waitFor(() => expect(screen.getByTestId('count-logged')).toHaveTextContent('1 logged'));
  });

  it('the month can be changed, and days after today cannot be opened', async () => {
    await open(LoggingHistoryScreen);
    await press('Previous month');
    await press('Next month');
    const last = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate();
    if (NOW.getDate() < last) {
      const future = toIsoDate(new Date(NOW.getFullYear(), NOW.getMonth(), last));
      expect(screen.queryByRole('button', { name: `${long(future)}, not logged` })).toBeNull();
    }
  });
});

describe('full stats', () => {
  const week = weekDays(startOfWeek(TODAY));

  it('averages the days with food and counts those within ten percent of the goal', async () => {
    const h = dataHarness();
    // default goal 1985 kcal: a 2000 kcal day is on target, a 1000 kcal day is not
    h.db.seed('nutrition_entries', [meal('a', week[0], { grams: 100, base_calories: 2000 }), meal('b', week[1], { grams: 100, base_calories: 1000 })]);
    await open(FullStatsScreen, h);
    await waitFor(() => expect(screen.getByTestId('stat-average')).toHaveTextContent('1,500 kcal'));
    expect(screen.getByTestId('stat-target')).toHaveTextContent('1/2 logged');
  });

  it('with nothing logged this week there is no average', async () => {
    await open(FullStatsScreen);
    expect(await screen.findByText('—')).toBeOnTheScreen();
    expect(screen.getByTestId('stat-target')).toHaveTextContent('0/0 logged');
    expect(screen.getByText('Nothing logged this day.')).toBeOnTheScreen();
  });

  it('shows the goal line and a bar per day with its calories', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('a', week[2], { grams: 100, base_calories: 1234 })]);
    await open(FullStatsScreen, h);
    expect(await screen.findByTestId('goal-line')).toHaveTextContent('goal 1,985');
    const bars = screen.getAllByRole('button', { name: /kcal$/ });
    expect(bars).toHaveLength(7);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Wed 2\d?, 1234 kcal|^Wed \d+, 1234 kcal/ })).toBeOnTheScreen());
  });

  it('a day can be chosen to see its calories and macros against the goals', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('a', week[1], { grams: 200, base_calories: 100, base_protein: 20, base_fat: 10, base_carbs: 30 })]);
    await open(FullStatsScreen, h);
    await screen.findByTestId('stat-average');
    await press((parseIso(week[1]) as Date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' }));
    expect(await screen.findByTestId('detail-kcal')).toHaveTextContent('200 total calories');
    expect(screen.getByTestId('detail-protein')).toHaveTextContent('40/150g');
    expect(screen.getByTestId('detail-fat')).toHaveTextContent('20/65g');
    expect(screen.getByTestId('detail-carbs')).toHaveTextContent('60/200g');
  });

  it('only this week’s food is counted', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('old', addDays(week[0], -3), { grams: 100, base_calories: 3000 }), meal('new', week[0], { grams: 100, base_calories: 500 })]);
    await open(FullStatsScreen, h);
    await waitFor(() => expect(screen.getByTestId('stat-average')).toHaveTextContent('500 kcal'));
  });
});

describe('survivors: logging history edges', () => {
  const first = toIsoDate(new Date(NOW.getFullYear(), NOW.getMonth(), 1));

  it('food on the first of the month counts', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('a', first)]);
    await open(LoggingHistoryScreen, h);
    await waitFor(() => expect(screen.getByTestId('count-logged')).toHaveTextContent('1 logged'));
  });

  it('no "nothing logged" hint once anything is logged, marked fasting, or marked incomplete', async () => {
    const withFood = dataHarness();
    withFood.db.seed('nutrition_entries', [meal('a', TODAY)]);
    const view = await render(<withFood.Provider><LoggingHistoryScreen /></withFood.Provider>);
    await waitFor(() => expect(screen.getByTestId('count-logged')).toHaveTextContent('1 logged'));
    expect(screen.queryByText('Nothing logged this month yet.')).toBeNull();
    await view.unmount();

    for (const status of ['fasting', 'incomplete']) {
      const marked = dataHarness();
      marked.db.seed('day_status_overrides', [{ user_id: USER, log_date: TODAY, status }]);
      const v = await render(<marked.Provider><LoggingHistoryScreen /></marked.Provider>);
      await waitFor(() => expect(screen.getByTestId(`count-${status}`)).toHaveTextContent(`1 ${status}`));
      expect(screen.queryByText('Nothing logged this month yet.')).toBeNull();
      await v.unmount();
    }
  });

  it('the popup shows only the day’s current status as chosen', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('a', TODAY)]);
    h.db.seed('day_status_overrides', [{ user_id: USER, log_date: TODAY, status: 'incomplete' }]);
    await open(LoggingHistoryScreen, h);
    await press(`${long(TODAY)}, incomplete`);
    expect(screen.getByRole('button', { name: 'Incomplete logging' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Logged' }).props.accessibilityState.selected).toBe(false);
  });

  it('a day marked fasting shows Fasting as chosen and Not logged as not', async () => {
    const h = dataHarness();
    h.db.seed('day_status_overrides', [{ user_id: USER, log_date: TODAY, status: 'fasting' }]);
    await open(LoggingHistoryScreen, h);
    await press(`${long(TODAY)}, fasting`);
    expect(screen.getByRole('button', { name: 'Fasting' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Not logged' }).props.accessibilityState.selected).toBe(false);
  });
});

describe('survivors: full stats bars', () => {
  it('bars are as tall as the day’s calories are to the chart: twice the food, twice the bar, and none reaches the top', async () => {
    const week = weekDays(startOfWeek(TODAY));
    const h = dataHarness();
    h.db.seed('nutrition_entries', [meal('a', week[0], { grams: 100, base_calories: 1000 }), meal('b', week[1], { grams: 100, base_calories: 2000 })]);
    await open(FullStatsScreen, h);
    await waitFor(() => expect(screen.getByTestId('stat-average')).toHaveTextContent('1,500 kcal'));
    const heightOf = (name: RegExp) => {
      const bar = screen.getByRole('button', { name });
      const child = (bar.children[0] as unknown as { props: { style: { height: number } } });
      return child.props.style.height;
    };
    const mon = heightOf(/^Mon \d+, 1000 kcal$/);
    const tue = heightOf(/^Tue \d+, 2000 kcal$/);
    expect(tue).toBeCloseTo(mon * 2, 5);
    expect(tue).toBeLessThan(160);
    expect(tue).toBeGreaterThan(0);
  });
});
