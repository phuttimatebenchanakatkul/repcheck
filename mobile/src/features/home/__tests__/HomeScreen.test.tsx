import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { addDays, toIsoDate } from '@/logic/dates';
import { USER, dataHarness, nutritionRow } from '@/testing/dataHarness';

import HomeScreen from '../HomeScreen';

const mockNavigate = jest.fn();
const mockPush = jest.fn();
const mockSignOut = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate, push: mockPush }) }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ state: { status: 'ready', profile: { name: 'Sam' }, session: { user: { id: 'user-1' } } } }) }));
jest.mock('@/auth/actions', () => ({ signOut: (...args: unknown[]) => mockSignOut(...args) }));
jest.mock('@/supabase/client', () => ({ getSupabase: () => ({ marker: 'supabase' }) }));

const NOW = new Date();
const TODAY = toIsoDate(NOW);
const at = (day: string, hour: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <HomeScreen />
    </h.Provider>,
  );
  return h;
}

const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};

beforeEach(() => {
  mockNavigate.mockClear();
  mockPush.mockClear();
  mockSignOut.mockClear();
});

describe('the top of the page', () => {
  it('greets the person by name', async () => {
    await open();
    expect(await screen.findByText(/Hey Sam/)).toBeOnTheScreen();
  });

  it('a day with nothing logged: a zero streak and the default goal left', async () => {
    await open();
    await waitFor(() => expect(screen.getByTestId('streak-count').props.children).toBe('0 day streak'));
    expect(screen.getByTestId('home-consumed').props.children).toBe(0);
    expect(screen.getByTestId('home-remaining').props.children).toBe('1985 left');
  });
});

describe('the streak', () => {
  it('counts consecutive days with something logged, ending today', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(TODAY, 8)), nutritionRow('b', addDays(TODAY, -1), at(addDays(TODAY, -1), 8)), nutritionRow('c', addDays(TODAY, -2), at(addDays(TODAY, -2), 8))]);
    await open(h);
    await waitFor(() => expect(screen.getByTestId('streak-count').props.children).toBe('3 day streak'));
    expect(screen.getAllByLabelText(/Streak day$/)).toHaveLength(3);
    expect(screen.getByText('Longest streak ever: 3')).toBeOnTheScreen();
  });

  it('a streak that ran to yesterday is still alive before today has anything', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('b', addDays(TODAY, -1), at(addDays(TODAY, -1), 8)), nutritionRow('c', addDays(TODAY, -2), at(addDays(TODAY, -2), 8))]);
    await open(h);
    await waitFor(() => expect(screen.getByTestId('streak-count').props.children).toBe('2 day streak'));
  });

  it('a gap ends it', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(TODAY, 8)), nutritionRow('c', addDays(TODAY, -3), at(addDays(TODAY, -3), 8))]);
    await open(h);
    await waitFor(() => expect(screen.getByTestId('streak-count').props.children).toBe('1 day streak'));
  });

  it('a workout or a weigh-in counts, and so does something the server alone records', async () => {
    const h = dataHarness({ activityDates: async () => ({ [addDays(TODAY, -2)]: ['challenge'] }) });
    h.db.seed('workout_entries', [{ user_id: USER, id: 'w', log_date: TODAY, exercise: 'Squat', added_at: new Date(at(TODAY, 9)).toISOString(), unilateral: false, extra: {} }]);
    h.db.seed('weight_entries', [{ user_id: USER, log_date: addDays(TODAY, -1), kg: 80, logged_at: new Date(at(addDays(TODAY, -1), 9)).toISOString(), extra: {} }]);
    await open(h);
    await waitFor(() => expect(screen.getByTestId('streak-count').props.children).toBe('3 day streak'));
  });

  it('a log made with no signal counts straight away', async () => {
    const h = dataHarness();
    h.goOffline();
    await open(h);
    await waitFor(() => expect(screen.getByTestId('streak-count').props.children).toBe('0 day streak'));
    await act(async () => {
      await h.data.actions.saveFood(TODAY, { id: 'n', food: 'Egg', addedAt: Date.now(), grams: 50, unit: 'g', baseCalories: 143, baseCarbs: 0, baseFat: 9, baseProtein: 12 });
    });
    await waitFor(() => expect(screen.getByTestId('streak-count').props.children).toBe('1 day streak'));
  });
});

describe('calories and macros today', () => {
  it('shows what has been eaten against the goal', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(TODAY, 8), { grams: 200, base_calories: 150, base_protein: 10, base_fat: 5, base_carbs: 20 })]);
    await open(h);
    await waitFor(() => expect(screen.getByTestId('home-consumed').props.children).toBe(300));
    expect(screen.getByTestId('home-remaining').props.children).toBe('1685 left');
    expect(screen.getByText('Protein 20 / 150 g')).toBeOnTheScreen();
  });

  it('says how far over when over', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(TODAY, 8), { grams: 1000, base_calories: 250 })]);
    await open(h);
    await waitFor(() => expect(screen.getByTestId('home-remaining').props.children).toBe('515 kcal over'));
  });

  it('does not count yesterday', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('y', addDays(TODAY, -1), at(addDays(TODAY, -1), 8), { grams: 1000, base_calories: 250 })]);
    await open(h);
    await waitFor(() => expect(screen.getByTestId('streak-count').props.children).toBe('1 day streak'));
    expect(screen.getByTestId('home-consumed').props.children).toBe(0);
  });
});

describe('the quick actions', () => {
  it('open the nutrition and workouts tabs', async () => {
    await open();
    await press('Log a food');
    expect(mockNavigate).toHaveBeenCalledWith('/nutrition');
    await press('Log an exercise');
    expect(mockNavigate).toHaveBeenCalledWith('/workouts');
  });

  it('signing out goes through the auth action with the app’s client', async () => {
    await open();
    await press('Log out');
    expect(mockSignOut).toHaveBeenCalledWith({ marker: 'supabase' });
  });
});

describe('weighing in', () => {
  it('saves a weight for today, shows it as the latest, and sends it when there is signal', async () => {
    const h = await open();
    expect(await screen.findByText('No weight logged yet')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '81.5');
    await press('Save');
    await waitFor(() => expect(screen.getByTestId('latest-weight').props.children.join('')).toBe('Latest: 81.5 kg'));
    expect(screen.getByLabelText('Weight (kg)').props.value).toBe('');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('weight_entries')).toMatchObject([{ user_id: USER, log_date: TODAY, kg: 81.5 }]);
  });

  it('the save button waits for a number', async () => {
    await open();
    expect((await screen.findByRole('button', { name: 'Save' })).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Weight (kg)'), '80');
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState.disabled).toBe(false);
  });

  it.each([['0'], ['abc'], ['401'], ['-5']])('refuses "%s" and queues nothing', async (typed) => {
    const h = await open();
    await fireEvent.changeText(await screen.findByLabelText('Weight (kg)'), typed);
    await press('Save');
    expect(await screen.findByText('Enter a valid weight.')).toBeOnTheScreen();
    expect(h.outbox.pending(USER)).toEqual([]);
  });

  it('a person who uses pounds types pounds and kilograms are stored', async () => {
    const h = dataHarness();
    h.db.seed('user_settings', [{ user_id: USER, units_weight: 'lb' }]);
    await open(h);
    await fireEvent.changeText(await screen.findByLabelText('Weight (lb)'), '180');
    await press('Save');
    await waitFor(() => expect(h.outbox.pending(USER)).toHaveLength(1));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('weight_entries')[0].kg).toBeCloseTo(81.6466, 3);
    await waitFor(() => expect(screen.getByTestId('latest-weight').props.children.join('')).toBe('Latest: 180 lb'));
  });

  it('with no signal the weight shows and waits', async () => {
    const h = dataHarness();
    h.goOffline();
    await open(h);
    await fireEvent.changeText(await screen.findByLabelText('Weight (kg)'), '79');
    await press('Save');
    await waitFor(() => expect(screen.getByTestId('latest-weight').props.children.join('')).toBe('Latest: 79 kg'));
    await act(async () => {
      await h.flush();
    });
    expect(h.outbox.pending(USER)).toHaveLength(1);
  });

  it('a second weigh-in on the same day replaces the first', async () => {
    const h = await open();
    for (const typed of ['82', '81']) {
      await fireEvent.changeText(await screen.findByLabelText('Weight (kg)'), typed);
      await press('Save');
      await waitFor(() => expect(screen.getByLabelText('Weight (kg)').props.value).toBe(''));
    }
    expect(h.outbox.pending(USER)).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('latest-weight').props.children.join('')).toBe('Latest: 81 kg'));
  });
});

describe('survivors: the week and the longest streak', () => {
  it('shows the last seven days, today last', async () => {
    await open();
    await waitFor(() => expect(screen.getAllByLabelText(/No activity$|Streak day$/)).toHaveLength(7));
  });

  it('with nothing logged there is no "longest streak" line', async () => {
    await open();
    await screen.findByTestId('streak-count');
    expect(screen.queryByText(/Longest streak ever/)).toBeNull();
  });
});

describe('the history pages', () => {
  it('the streak card opens the streak history, the weight card the weight history', async () => {
    await open();
    await press('Streak history');
    expect(mockPush).toHaveBeenCalledWith('/streaks');
    await press('View history');
    expect(mockPush).toHaveBeenCalledWith('/weight');
  });
});

describe('survivors: today’s workouts line, longest streak', () => {
  const workout = (n: number) => ({ user_id: USER, id: `w${n}`, log_date: TODAY, exercise: `Lift ${n}`, added_at: new Date(at(TODAY, 8 + n)).toISOString(), unilateral: false, extra: {} });

  it('says how many exercises were done today: one, then several, none says nothing', async () => {
    const one = dataHarness();
    one.db.seed('workout_entries', [workout(1)]);
    const view = await render(<one.Provider><HomeScreen /></one.Provider>);
    expect(await screen.findByText('Workouts: 1 exercise')).toBeOnTheScreen();
    await view.unmount();

    const two = dataHarness();
    two.db.seed('workout_entries', [workout(1), workout(2)]);
    await render(<two.Provider><HomeScreen /></two.Provider>);
    expect(await screen.findByText('Workouts: 2 exercises')).toBeOnTheScreen();
  });

  it('no workout today: no line', async () => {
    await open();
    await screen.findByTestId('streak-count');
    expect(screen.queryByText(/^Workouts:/)).toBeNull();
  });

  it('a streak of one day still shows the longest streak', async () => {
    const h = dataHarness();
    h.db.seed('nutrition_entries', [nutritionRow('a', TODAY, at(TODAY, 8))]);
    await open(h);
    expect(await screen.findByText('Longest streak ever: 1')).toBeOnTheScreen();
  });
});
