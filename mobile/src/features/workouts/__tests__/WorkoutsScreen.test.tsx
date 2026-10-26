import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { addDays, toIsoDate } from '@/logic/dates';
import { WEEKDAY_KEYS } from '@/logic/workouts';
import { USER, dataHarness } from '@/testing/dataHarness';

import WorkoutsScreen from '../WorkoutsScreen';
import { parseReps, parseWeight } from '../WorkoutCard';

const NOW = new Date();
const TODAY = toIsoDate(NOW);
const at = (day: string, hour: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};
const iso = (ms: number) => new Date(ms).toISOString();

const entryRow = (id: string, day: string, exercise: string, hour = 9, over: Record<string, unknown> = {}) => ({
  user_id: USER, id, log_date: day, exercise, added_at: iso(at(day, hour)), unilateral: false, extra: {}, ...over,
});
const setRow = (entryId: string, position: number, over: Record<string, unknown> = {}) => ({
  user_id: USER, entry_id: entryId, position, reps: 10, weight_kg: 60, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {}, ...over,
});

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <WorkoutsScreen />
    </h.Provider>,
  );
  return h;
}

const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('an empty day', () => {
  it('says so and offers to log an exercise', async () => {
    await open();
    expect(await screen.findByText('Nothing logged yet')).toBeOnTheScreen();
    expect(screen.getByText('Today', { exact: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Log an exercise' })).toBeOnTheScreen();
    expect(screen.getByText('No split planned yet.')).toBeOnTheScreen();
  });
});

describe('a day with exercises', () => {
  async function withWorkout() {
    const h = dataHarness();
    h.db.seed('workout_entries', [entryRow('w1', TODAY, 'Flat Bench Press', 9), entryRow('w2', TODAY, 'Pull-Up', 10), entryRow('y', addDays(TODAY, -1), 'Squat', 9), { ...entryRow('o', TODAY, 'Not mine', 8), user_id: 'user-2' }]);
    h.db.seed('workout_sets', [setRow('w1', 0, { reps: 10, weight_kg: 60 }), setRow('w1', 1, { reps: 8, weight_kg: 62.5 }), setRow('w2', 0, { reps: null, weight_kg: null })]);
    await open(h);
    await screen.findByText('Flat Bench Press');
    return h;
  }

  it('lists the exercises in time order with a summary of their sets, and counts them', async () => {
    await withWorkout();
    expect(screen.getAllByText(/^(Flat Bench Press|Pull-Up)$/).map((n) => n.props.children)).toEqual(['Flat Bench Press', 'Pull-Up']);
    expect(screen.getByText(/62.5 kg • 2 sets • 10, 8 reps/)).toBeOnTheScreen();
    expect(screen.getByText(/1 set logged/)).toBeOnTheScreen();
    expect(screen.getByText('2 exercises · 3 sets')).toBeOnTheScreen();
    expect(screen.queryByText('Squat')).toBeNull();
    expect(screen.queryByText('Not mine')).toBeNull();
  });

  it('a finished exercise (every set has its reps) shows a tick; an unfinished one does not', async () => {
    await withWorkout();
    expect(screen.getAllByTestId('complete-check', { hidden: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Flat Bench Press.*✓$/ })).toBeOnTheScreen();
  });

  it('opens to its sets with the weights and reps', async () => {
    await withWorkout();
    await press(/^Flat Bench Press, Show details/);
    expect(await screen.findByText('Set 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Set 1 kg').props.value).toBe('60');
    expect(screen.getByLabelText('Set 2 kg').props.value).toBe('62.5');
    expect(screen.getByLabelText('Set 2 reps').props.value).toBe('8');
  });

  it('typing updates the summary at once and saves when you leave the field', async () => {
    const h = await withWorkout();
    await press(/^Flat Bench Press, Show details/);
    const reps = await screen.findByLabelText('Set 2 reps');
    await fireEvent.changeText(reps, '9');
    expect(screen.getByText(/10, 9 reps/)).toBeOnTheScreen();
    expect(h.outbox.pending(USER)).toEqual([]);
    await fireEvent(reps, 'endEditing');
    await waitFor(() => expect(h.outbox.pending(USER).length).toBeGreaterThan(0));
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_sets').filter((r) => r.entry_id === 'w1').map((r) => r.reps)).toEqual([10, 9]);
  });

  it('adding a set carries the weight forward and leaves the reps blank', async () => {
    const h = await withWorkout();
    await press(/^Flat Bench Press, Show details/);
    await press('+ Add Set');
    expect(await screen.findByText('Set 3')).toBeOnTheScreen();
    expect(screen.getByLabelText('Set 3 kg').props.value).toBe('62.5');
    expect(screen.getByLabelText('Set 3 reps').props.value).toBe('');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_sets').filter((r) => r.entry_id === 'w1')).toHaveLength(3);
  });

  it('removing a set shrinks the list and the server ends up with just the rest', async () => {
    const h = await withWorkout();
    await press(/^Flat Bench Press, Show details/);
    await press('Remove Set 1');
    await waitFor(() => expect(screen.queryByText('Set 2')).toBeNull());
    await act(async () => {
      await h.flush();
    });
    const sets = h.db.rows('workout_sets').filter((r) => r.entry_id === 'w1');
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ position: 0, reps: 8, weight_kg: 62.5 });
  });

  it('completing the last rep count marks the exercise done', async () => {
    await withWorkout();
    await press(/^Pull-Up, Show details/);
    expect(screen.getAllByTestId('complete-check', { hidden: true })).toHaveLength(1);
    await fireEvent.changeText(await screen.findByLabelText('Set 1 reps'), '7');
    await waitFor(() => expect(screen.getAllByTestId('complete-check', { hidden: true })).toHaveLength(2));
  });

  it('a bodyweight exercise has reps only', async () => {
    await withWorkout();
    await press(/^Pull-Up, Show details/);
    await screen.findByLabelText('Set 1 reps');
    expect(screen.queryByLabelText('Set 1 kg')).toBeNull();
  });

  it('an exercise that can be done one side at a time can switch to each side, and nothing typed is lost switching back', async () => {
    const h = dataHarness();
    h.db.seed('workout_entries', [entryRow('d', TODAY, 'Landmine Press')]);
    h.db.seed('workout_sets', [setRow('d', 0, { reps: 10, weight_kg: 14 })]);
    await open(h);
    await press(/^Landmine Press, Show details/);
    const eachSide = await screen.findByRole('radio', { name: 'Each side' });
    await fireEvent.press(eachSide);
    await fireEvent.changeText(await screen.findByLabelText('Set 1 kg L'), '12');
    await fireEvent.changeText(screen.getByLabelText('Set 1 reps L'), '9');
    await fireEvent(screen.getByLabelText('Set 1 reps L'), 'endEditing');
    expect(screen.getByLabelText('Set 1 kg R')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Both sides' }));
    expect(screen.getByLabelText('Set 1 kg').props.value).toBe('14');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_sets')[0]).toMatchObject({ weight_kg: 14, reps: 10, left_kg: 12, left_reps: 9 });
  });

  it('an exercise that only works with both sides has no switch', async () => {
    await withWorkout();
    await press(/^Flat Bench Press, Show details/);
    await screen.findByText('Set 1');
    expect(screen.queryByRole('radio', { name: 'Each side' })).toBeNull();
  });

  it('removing an exercise asks first, then deletes it and its sets', async () => {
    const h = await withWorkout();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await press(/^Flat Bench Press, Show details/);
    await press('Remove exercise');
    expect(alert).toHaveBeenCalledWith('Delete this exercise?', 'Flat Bench Press', expect.any(Array));
    expect(h.outbox.pending(USER)).toEqual([]);
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Remove exercise')?.onPress?.();
    });
    await waitFor(() => expect(screen.queryByText('Flat Bench Press')).toBeNull());
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_entries').map((r) => r.id).sort()).toEqual(['o', 'w2', 'y']);
    expect(h.db.rows('workout_sets').some((r) => r.entry_id === 'w1')).toBe(false);
  });

  it('opening and closing an exercise without changing it queues nothing', async () => {
    const h = await withWorkout();
    await press(/^Flat Bench Press, Show details/);
    await press('Done');
    expect(h.outbox.pending(USER)).toEqual([]);
  });

  it('pounds: weights are shown and typed in pounds and stored in kilograms', async () => {
    const h = dataHarness();
    h.db.seed('user_settings', [{ user_id: USER, units_weight: 'lb' }]);
    h.db.seed('workout_entries', [entryRow('w1', TODAY, 'Flat Bench Press')]);
    h.db.seed('workout_sets', [setRow('w1', 0, { reps: 5, weight_kg: 100 })]);
    await open(h);
    await press(/^Flat Bench Press, Show details/);
    const field = await screen.findByLabelText('Set 1 lb');
    expect(field.props.value).toBe('220.5');
    await fireEvent.changeText(field, '225');
    await fireEvent(field, 'endEditing');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_sets')[0].weight_kg).toBeCloseTo(102.0583, 3);
  });
});

describe('logging an exercise', () => {
  it('search, tap: it is on the screen, open for its sets, and reaches the server when there is signal', async () => {
    const h = await open();
    await press('Log an exercise');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for an exercise...'), 'bench');
    await press(/^Flat Bench Press$/);
    expect(await screen.findByLabelText('Set 1 reps')).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_entries')).toMatchObject([{ exercise: 'Flat Bench Press', log_date: TODAY, user_id: USER }]);
    expect(h.db.rows('workout_sets')).toHaveLength(1);
  });

  it('works with no signal', async () => {
    const h = dataHarness();
    h.goOffline();
    await open(h);
    await press('Log an exercise');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for an exercise...'), 'bench');
    await press(/^Flat Bench Press$/);
    expect(await screen.findByLabelText('Set 1 reps')).toBeOnTheScreen();
    await act(async () => {
      expect((await h.flush()).retryInMs).not.toBeNull();
    });
    expect(h.outbox.pending(USER).length).toBeGreaterThan(0);
  });

  it('says so when nothing matches, and offers to create it', async () => {
    await open();
    await press('Log an exercise');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for an exercise...'), 'zzzzqqqq');
    expect(await screen.findByText('Couldn\'t find "zzzzqqqq"')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Create “zzzzqqqq”' })).toBeOnTheScreen();
  });

  it('with no history it suggests a starter set', async () => {
    await open();
    await press('Log an exercise');
    expect(await screen.findByText('Suggested')).toBeOnTheScreen();
  });

  it('offers what was done lately and favourites, and a star keeps an exercise among the favourites', async () => {
    const h = dataHarness();
    h.db.seed('workout_entries', [entryRow('y', addDays(TODAY, -1), 'Deadlift', 9)]);
    await open(h);
    await press('Log an exercise');
    expect(await screen.findByText('Recent')).toBeOnTheScreen();
    await press(/^Add to favorites: Deadlift$/);
    await waitFor(() => expect(h.outbox.pending(USER).some((q) => q.op.table === 'exercise_favorites')).toBe(true));
    expect(await screen.findByText('Favorites')).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('exercise_favorites')).toEqual([{ user_id: USER, exercise_name: 'Deadlift' }]);
  });

  it('creating an exercise of your own saves it through the server, then logs it', async () => {
    const created: unknown[] = [];
    const h = dataHarness({
      createCustomExercise: async (e) => {
        created.push(e);
        return { id: 4, name: e.name, emoji: e.emoji ?? null, mode: e.mode ?? 'both' };
      },
    });
    await open(h);
    await press('Log an exercise');
    await press('Create a custom exercise');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Odd Sled Drag');
    await press('Create & add');
    await waitFor(() => expect(created).toEqual([{ name: 'Odd Sled Drag', emoji: undefined, mode: 'both' }]));
    expect(await screen.findByRole('button', { name: /^Odd Sled Drag/ })).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_entries')).toMatchObject([{ exercise: 'Odd Sled Drag' }]);
  });

  it('an exercise made "each side" starts in each-side mode', async () => {
    const h = dataHarness({ createCustomExercise: async (e) => ({ id: 4, name: e.name, emoji: null, mode: 'each' }) });
    await open(h);
    await press('Log an exercise');
    await press('Create a custom exercise');
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Odd Row');
    await fireEvent.press(screen.getByRole('radio', { name: 'Each side' }));
    await press('Create & add');
    expect(await screen.findByLabelText('Set 1 kg L')).toBeOnTheScreen();
    expect(screen.getByLabelText('Set 1 kg R')).toBeOnTheScreen();
  });

  it('needs a name, refuses a duplicate, and shows the server’s reason', async () => {
    const h = dataHarness({
      listCustomExercises: async () => [{ id: 1, name: 'Sled Push', emoji: null, mode: 'both' }],
      createCustomExercise: async () => {
        throw Object.assign(new Error('You have reached the limit.'), { status: 429 });
      },
    });
    await open(h);
    await press('Log an exercise');
    await press('Create a custom exercise');
    await press('Create & add');
    expect(await screen.findByText('Enter a name.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'sled push');
    await press('Create & add');
    expect(await screen.findByText('You already have an exercise with that name.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Brand New');
    await press('Create & add');
    expect(await screen.findByText('You have reached the limit.')).toBeOnTheScreen();
    expect(h.outbox.pending(USER)).toEqual([]);
  });
});

describe('today’s plan', () => {
  const planRow = (schedule: Record<string, string>, days: { label: string; exercises: string[] }[]) => ({
    user_id: USER, split_type: 'ppl', days_per_week: 3, goal: null, days, schedule, exercise_prescriptions: {}, extra: {},
  });
  const todayKey = WEEKDAY_KEYS[NOW.getDay()];

  it('lists today’s exercises with sets and reps; a tap logs one', async () => {
    const h = dataHarness();
    h.db.seed('split_plans', [planRow({ [todayKey]: 'Push' }, [{ label: 'Push', exercises: ['Flat Bench Press', 'Overhead Press'] }])]);
    await open(h);
    expect(await screen.findByText(/Push/)).toBeOnTheScreen();
    expect(screen.getAllByText('4 sets • 6-8 reps')).toHaveLength(2);
    await press('Log an exercise: Flat Bench Press');
    expect(await screen.findByLabelText('Set 1 reps')).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_entries')).toMatchObject([{ exercise: 'Flat Bench Press', log_date: TODAY }]);
  });

  it('a rest day says so', async () => {
    const h = dataHarness();
    h.db.seed('split_plans', [planRow({ [todayKey]: 'Rest' }, [{ label: 'Push', exercises: [] }])]);
    await open(h);
    expect(await screen.findByText(/Rest day/)).toBeOnTheScreen();
  });

  it('the plan’s exercises also lead the picker', async () => {
    const h = dataHarness();
    h.db.seed('split_plans', [planRow({ [todayKey]: 'Push' }, [{ label: 'Push', exercises: ['Overhead Press'] }])]);
    await open(h);
    await press('Log an exercise');
    const heading = await screen.findByText("Today's plan · Push");
    expect(heading).toBeOnTheScreen();
    expect(within(screen.getByRole('button', { name: 'Overhead Press' })).getByText('Overhead Press')).toBeOnTheScreen();
  });
});

describe('another day', () => {
  it('shows that day’s exercises and files new ones under it', async () => {
    const h = dataHarness();
    const other = addDays(TODAY, NOW.getDay() === 1 ? 6 : -1);
    h.db.seed('workout_entries', [entryRow('a', TODAY, 'Flat Bench Press'), entryRow('t', other, 'Squat')]);
    await open(h);
    await screen.findByText('Flat Bench Press');
    const label = new Date(`${other}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
    await fireEvent.press(await screen.findByRole('button', { name: new RegExp(label) }));
    expect(await screen.findByText('Squat')).toBeOnTheScreen();
    expect(screen.queryByText('Flat Bench Press')).toBeNull();
    await press('Log an exercise');
    await fireEvent.changeText(await screen.findByPlaceholderText('Search for an exercise...'), 'deadlift');
    await press(/^Deadlift$/);
    await screen.findByLabelText('Set 1 reps');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_entries').find((r) => r.exercise === 'Deadlift')).toMatchObject({ log_date: other });
  });
});

describe('survivors: parsing, closing, wording', () => {
  it('a weight is kg from zero up; blank, text and negatives are no weight', () => {
    const kg = { weight: 'kg', height: 'cm', distance: 'km', clock: '12h' } as const;
    const lb = { ...kg, weight: 'lb' } as const;
    expect(parseWeight('62.5', kg)).toBe(62.5);
    expect(parseWeight('0', kg)).toBe(0);
    expect(parseWeight('-1', kg)).toBeNull();
    expect(parseWeight('', kg)).toBeNull();
    expect(parseWeight('abc', kg)).toBeNull();
    expect(parseWeight('100', lb)).toBeCloseTo(45.359, 3);
  });

  it('reps are whole numbers from zero up', () => {
    expect(parseReps('8')).toBe(8);
    expect(parseReps('7.9')).toBe(7);
    expect(parseReps('0')).toBe(0);
    expect(parseReps('-1')).toBeNull();
    expect(parseReps('')).toBeNull();
    expect(parseReps('x')).toBeNull();
    expect(parseReps('0012')).toBe(12);
  });

  it('the picker Close button closes it', async () => {
    await open();
    await press('Log an exercise');
    await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Search for an exercise...')).toBeNull());
  });
});
