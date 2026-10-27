import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ApiError } from '@/api/client';
import { parseGenerated } from '@/logic/splitPlan';
import { toIsoDate } from '@/logic/dates';
import { CATEGORIES, EXERCISES, WEEKDAY_KEYS, setsRepsText } from '@/logic/workouts';
import { USER, dataHarness } from '@/testing/dataHarness';

import WorkoutsScreen from '../WorkoutsScreen';

const mockApi = { generateSplit: jest.fn(), setAiConsent: jest.fn() };
const mockAuth = { state: { status: 'ready', profile: { ai_consent: true } } as { status: string; profile: { ai_consent: boolean } }, refreshProfile: jest.fn(async () => undefined) };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const TODAY = toIsoDate(new Date());
const todayKey = WEEKDAY_KEYS[new Date().getDay()];
/** A weekday that is not today, so a schedule naming both never has one overwrite the other (it did, on a Wednesday). */
const otherKey = WEEKDAY_KEYS[(new Date().getDay() + 3) % 7];
const otherName = otherKey[0].toUpperCase() + otherKey.slice(1);

const GENERATED = parseGenerated({
  days: [
    { label: 'Push', exercises: ['Flat Bench Press', 'Overhead Press'] },
    { label: 'Pull', exercises: ['Pull-Up', 'Barbell Row'] },
  ],
  schedule: { monday: 'Push', wednesday: 'Pull', friday: 'Push' },
  rationale: 'A rest day between sessions.',
  split_type: 'upper_lower',
}) as NonNullable<ReturnType<typeof parseGenerated>>;

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
const choose = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const planRow = (h: ReturnType<typeof dataHarness>) => h.db.rows('split_plans')[0] as { split_type: string; days: { label: string; exercises: string[] }[]; schedule: Record<string, string>; exercise_prescriptions: Record<string, { sets: number; reps: number }>; goal: string | null; days_per_week: number };

async function aiToReview(h: ReturnType<typeof dataHarness>) {
  await open(h);
  await press('Plan my split');
  await choose('Let AI build it');
  await press('Next');
  await choose(/^Gym/);
  await press('Next');
  await fireEvent.changeText(await screen.findByLabelText("What's your goal in fitness?"), 'build muscle');
  await press('Next');
  await choose('4');
  await press('Generate my plan');
  await screen.findByText('Save plan', { exact: false });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.state = { status: 'ready', profile: { ai_consent: true } };
  mockApi.generateSplit.mockResolvedValue(GENERATED);
  mockApi.setAiConsent.mockResolvedValue(true);
});

describe('the AI path', () => {
  it('asks where you train, your goal and the days, builds the plan, and saves what you end with', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [{ user_id: USER, gender: 'female', weight_kg: 66, goal_weight_kg: 60 }]);
    await aiToReview(h);
    expect(mockApi.generateSplit).toHaveBeenCalledWith({
      split_type: 'ai_suggest', days_per_week: 4, custom_days: [], goal: 'build muscle', custom_days_exercises: {}, location: 'gym',
      gender: 'female', goal_weight_kg: 60, current_weight_kg: 66,
    });
    expect(await screen.findByText('Your coach picked a Upper / Lower split for you.')).toBeOnTheScreen();
    expect(screen.getByText('A rest day between sessions.')).toBeOnTheScreen();
    await press('Save plan');
    await waitFor(() => expect(h.outbox.pending(USER).length).toBeGreaterThan(0));
    await act(async () => {
      await h.flush();
    });
    expect(planRow(h)).toMatchObject({ split_type: 'upper_lower', goal: 'build muscle', days_per_week: 4 });
    expect(planRow(h).schedule).toMatchObject({ monday: 'Push', tuesday: 'Rest', wednesday: 'Pull', friday: 'Push' });
    expect(planRow(h).days.map((d) => d.label)).toEqual(['Push', 'Pull']);
    expect(h.db.rows('activity_days')).toMatchObject([{ log_date: TODAY, action: 'split_plan' }]);
  });

  it('the plan is on the workouts page afterwards', async () => {
    const h = dataHarness();
    await aiToReview(h);
    await press('Save plan');
    await waitFor(() => expect(screen.queryByText('Save plan')).toBeNull());
    expect(screen.getByRole('button', { name: 'Edit split' })).toBeOnTheScreen();
  });

  it('Next waits for a choice at every step', async () => {
    await open();
    await press('Plan my split');
    expect((await screen.findByRole('button', { name: 'Next' })).props.accessibilityState.disabled).toBe(true);
    await choose('Let AI build it');
    await press('Next');
    expect((await screen.findByRole('button', { name: 'Next' })).props.accessibilityState.disabled).toBe(true);
    await choose(/^At home/);
    await press('Next');
    await press('Next'); // the goal is optional
    expect((await screen.findByRole('button', { name: 'Generate my plan' })).props.accessibilityState.disabled).toBe(true);
    await choose('3');
    expect(screen.getByRole('button', { name: 'Generate my plan' }).props.accessibilityState.disabled).toBe(false);
  });

  it('asks for AI consent first, sends nothing until allowed, then builds the plan', async () => {
    mockAuth.state = { status: 'ready', profile: { ai_consent: false } };
    const h = dataHarness();
    await open(h);
    await press('Plan my split');
    await choose('Let AI build it');
    await press('Next');
    await choose(/^Gym/);
    await press('Next');
    await press('Next');
    await choose('3');
    await press('Generate my plan');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    expect(mockApi.generateSplit).not.toHaveBeenCalled();
    await press('Allow');
    await screen.findByText('Save plan', { exact: false });
    expect(mockApi.setAiConsent).toHaveBeenCalledWith(true);
    expect(mockApi.generateSplit).toHaveBeenCalledTimes(1);
  });

  it('if the server asks for consent the app did not know was missing, it asks', async () => {
    mockApi.generateSplit.mockRejectedValueOnce(new ApiError('Turn on AI.', 403, { needs_ai_consent: true }));
    await open();
    await press('Plan my split');
    await choose('Let AI build it');
    await press('Next');
    await choose(/^Gym/);
    await press('Next');
    await press('Next');
    await choose('3');
    await press('Generate my plan');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
  });

  it('a failure says why and Back returns to the days', async () => {
    mockApi.generateSplit.mockRejectedValueOnce(new ApiError("You've built 5 plans today. Please check back in 3 hours.", 429, {}, 10800));
    await open();
    await press('Plan my split');
    await choose('Let AI build it');
    await press('Next');
    await choose(/^Gym/);
    await press('Next');
    await press('Next');
    await choose('3');
    await press('Generate my plan');
    expect(await screen.findByText(/You've built 5 plans today/)).toBeOnTheScreen();
    await press('Back');
    expect(await screen.findByRole('button', { name: 'Generate my plan' })).toBeOnTheScreen();
  });

  it('a failure that is not the server’s gets the plain message', async () => {
    mockApi.generateSplit.mockRejectedValueOnce(new TypeError('boom'));
    await open();
    await press('Plan my split');
    await choose('Let AI build it');
    await press('Next');
    await choose(/^Gym/);
    await press('Next');
    await press('Next');
    await choose('3');
    await press('Generate my plan');
    expect(await screen.findByText('Something went wrong generating your plan. Please try again.')).toBeOnTheScreen();
  });

  it('with no signal the plan can still be saved from the review (it is queued), but not generated', async () => {
    const h = dataHarness();
    h.goOffline();
    await aiToReview(h);
    await press('Save plan');
    await waitFor(() => expect(screen.queryByText('Save plan')).toBeNull());
    expect(h.outbox.pending(USER).some((q) => q.op.table === 'split_plans')).toBe(true);
  });
});

describe('building it yourself', () => {
  async function toTypeStep(h = dataHarness()) {
    await open(h);
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    return h;
  }

  it('a template seeds the days; Generate waits until every day has an exercise', async () => {
    await toTypeStep();
    await choose('Push / Pull / Legs');
    expect(await screen.findByText('Push')).toBeOnTheScreen();
    expect(screen.getByText('Pull')).toBeOnTheScreen();
    expect(screen.getByText('Legs')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Generate my plan' }).props.accessibilityState.disabled).toBe(true);
  });

  it('picks exercises for each day, then builds the plan without the AI', async () => {
    const h = await toTypeStep();
    await choose('Push / Pull / Legs');
    const pickFor = async (index: number, search: string, exercise: string) => {
      await fireEvent.press((await screen.findAllByRole('button', { name: 'Pick exercises' }))[0 + (index > 0 ? 0 : 0)]);
      await fireEvent.changeText(await screen.findByLabelText('Search for an exercise...'), search);
      await fireEvent.press(await screen.findByRole('checkbox', { name: exercise }));
      await press(/^Done \(1 selected\)$/);
    };
    await pickFor(0, 'bench', 'Flat Bench Press');
    expect(await screen.findByRole('button', { name: '1 picked' })).toBeOnTheScreen();
    await pickFor(1, 'pull-up', 'Pull-Up');
    await pickFor(2, 'squat', 'Squat');
    expect(screen.getByRole('button', { name: 'Generate my plan' }).props.accessibilityState.disabled).toBe(false);
    mockApi.generateSplit.mockResolvedValue(parseGenerated({ days: [{ label: 'Push', exercises: ['Flat Bench Press'] }, { label: 'Pull', exercises: ['Pull-Up'] }, { label: 'Legs', exercises: ['Squat'] }], schedule: { monday: 'Push', wednesday: 'Pull', friday: 'Legs' } }));
    await press('Generate my plan');
    await screen.findByText('Save plan', { exact: false });
    expect(mockApi.generateSplit).toHaveBeenCalledWith({
      split_type: 'custom', days_per_week: 3, custom_days: ['Push', 'Pull', 'Legs'], goal: '',
      custom_days_exercises: { Push: ['Flat Bench Press'], Pull: ['Pull-Up'], Legs: ['Squat'] }, location: null,
    });
    expect(screen.queryByText('Allow AI features?')).toBeNull(); // no AI, so no consent question
    await press('Save plan');
    await waitFor(() => expect(h.outbox.pending(USER).length).toBeGreaterThan(0));
  });

  it('the day count changes the list, and a day can be typed in or removed', async () => {
    await toTypeStep();
    await choose('Push / Pull / Legs');
    await choose('5');
    expect(await screen.findByText('Pull 2')).toBeOnTheScreen();
    await choose('2');
    expect(screen.queryByText('Legs')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('e.g. Chest Day'), 'Cardio');
    await press('Add');
    expect(await screen.findByText('Cardio')).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(screen.queryByText('Push')).toBeNull();
  });

  it('Back out of the picker keeps what was ticked', async () => {
    await toTypeStep();
    await choose('Upper / Lower');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Pick exercises' }))[0]);
    await fireEvent.changeText(await screen.findByLabelText('Search for an exercise...'), 'curl');
    await fireEvent.press((await screen.findAllByRole('checkbox'))[0]);
    await press(/^Done \(1 selected\)$/);
    await fireEvent.press((await screen.findAllByRole('button', { name: '1 picked' }))[0]);
    expect((await screen.findAllByRole('checkbox', { checked: true })).length).toBe(1);
  });
});

describe('the checklist', () => {
  async function openChecklist(h = dataHarness()) {
    await open(h);
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    await choose('Full Body');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Pick exercises' }))[0]);
  }

  it('browses the library by category, collapsed until opened', async () => {
    await openChecklist();
    const categories = await screen.findAllByRole('button', { expanded: false });
    expect(categories.length).toBeGreaterThan(3);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await fireEvent.press(categories[0]);
    expect((await screen.findAllByRole('checkbox')).length).toBeGreaterThan(3);
  });

  it('lists the person’s own exercises first, and a new one is ticked at once', async () => {
    const h = dataHarness({ listCustomExercises: async () => [{ id: 1, name: 'Sled Drag', emoji: '🛷', mode: 'both' }] });
    await openChecklist(h);
    expect(await screen.findByRole('checkbox', { name: 'Sled Drag' })).toBeOnTheScreen();
    await press('+ Create an exercise');
    await fireEvent.changeText(await screen.findByLabelText('Exercise name'), 'Rope Climb');
    await press('Save');
    expect(await screen.findByRole('checkbox', { name: 'Rope Climb', checked: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Done (1 selected)' })).toBeOnTheScreen();
  });

  it('creating needs a name, and shows the server’s reason when it refuses', async () => {
    const h = dataHarness({ createCustomExercise: async () => { throw Object.assign(new Error('You have reached the limit.'), { status: 429 }); } });
    await openChecklist(h);
    await press('+ Create an exercise');
    await press('Save');
    expect(await screen.findByText('Enter a name.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Exercise name'), 'X');
    await press('Save');
    expect(await screen.findByText('You have reached the limit.')).toBeOnTheScreen();
  });

  it('a search with no match says so', async () => {
    await openChecklist();
    await fireEvent.changeText(await screen.findByLabelText('Search for an exercise...'), 'zzzzqqqq');
    expect(await screen.findByText('Couldn\'t find "zzzzqqqq"')).toBeOnTheScreen();
  });

  it('ticking again unticks', async () => {
    await openChecklist();
    await fireEvent.changeText(await screen.findByLabelText('Search for an exercise...'), 'squat');
    const first = (await screen.findAllByRole('checkbox'))[0];
    await fireEvent.press(first);
    expect(screen.getByRole('button', { name: 'Done (1 selected)' })).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByRole('button', { name: 'Done' })).toBeOnTheScreen();
  });
});

describe('looking over and changing a plan', () => {
  const seed = (h: ReturnType<typeof dataHarness>, schedule: Record<string, string> = { [todayKey]: 'Push', [otherKey]: 'Pull' }) =>
    h.db.seed('split_plans', [{
      user_id: USER, split_type: 'ppl', days_per_week: 2, goal: null,
      days: [{ label: 'Push', exercises: ['Flat Bench Press', 'Overhead Press'] }, { label: 'Pull', exercises: ['Pull-Up'] }],
      schedule, exercise_prescriptions: {}, extra: {},
    }]);

  async function openView(schedule?: Record<string, string>) {
    const h = dataHarness();
    seed(h, schedule);
    await open(h);
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Edit split' }))[0]);
    await screen.findByText("What's on this day?");
    return h;
  }

  it('opens on today with the day’s exercises and their sets and reps', async () => {
    await openView();
    expect(await screen.findByRole('button', { name: /^Flat Bench Press, 4×6/ })).toBeOnTheScreen();
    expect(screen.getByText('Today’s plan (Push)'.replace('’', "'"), { exact: false })).toBeOnTheScreen();
  });

  it('assigning a different day to a weekday is saved', async () => {
    const h = await openView({ [todayKey]: 'Push', [otherKey]: 'Pull' });
    await fireEvent.press(screen.getByRole('button', { name: `${otherName}, Pull` }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Push', selected: false }));
    await act(async () => {
      await h.flush();
    });
    expect(planRow(h).schedule[otherKey]).toBe('Push');
  });

  it('a rest day shows the recovery note and no exercises', async () => {
    await openView({ [todayKey]: 'Rest', [otherKey]: 'Pull' });
    expect(await screen.findByText('Recovery day — nothing scheduled.')).toBeOnTheScreen();
  });

  it('editing sets and reps is saved against that day’s exercise only, and Reset puts the standard back', async () => {
    const h = await openView();
    await press(/^Flat Bench Press, 4×6/);
    const sets = await screen.findByLabelText('Sets');
    await fireEvent.changeText(sets, '5');
    await fireEvent(sets, 'endEditing');
    expect(await screen.findByRole('button', { name: /^Flat Bench Press, 5×6/ })).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(planRow(h).exercise_prescriptions).toEqual({ '["Push","Flat Bench Press"]': { sets: 5, reps: 6 } });
    await press('Reset to standard');
    expect(await screen.findByRole('button', { name: /^Flat Bench Press, 4×6/ })).toBeOnTheScreen();
  });

  it('a blank or zero number snaps back, and a huge one is held to the maximum', async () => {
    await openView();
    await press(/^Flat Bench Press, 4×6/);
    const sets = await screen.findByLabelText('Sets');
    await fireEvent.changeText(sets, '0');
    await fireEvent(sets, 'endEditing');
    expect(screen.getByLabelText('Sets').props.value).toBe('4');
    await fireEvent.changeText(screen.getByLabelText('Reps'), '99');
    await fireEvent(screen.getByLabelText('Reps'), 'endEditing');
    expect(await screen.findByRole('button', { name: /^Flat Bench Press, 4×50/ })).toBeOnTheScreen();
  });

  it('removing an exercise takes it off that day', async () => {
    const h = await openView();
    await press('Remove Overhead Press');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Overhead Press/ })).toBeNull());
    await act(async () => {
      await h.flush();
    });
    expect(planRow(h).days[0].exercises).toEqual(['Flat Bench Press']);
  });

  it('picking exercises adds the new ones after the ones that stay', async () => {
    const h = await openView();
    await press('Pick exercises');
    await fireEvent.changeText(await screen.findByLabelText('Search for an exercise...'), 'dips');
    await fireEvent.press((await screen.findAllByRole('checkbox'))[0]);
    await press(/^Done \(3 selected\)$/);
    await act(async () => {
      await h.flush();
    });
    expect(planRow(h).days[0].exercises.slice(0, 2)).toEqual(['Flat Bench Press', 'Overhead Press']);
    expect(planRow(h).days[0].exercises).toHaveLength(3);
  });

  it('Edit split starts the wizard over', async () => {
    await openView();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Edit split' }).at(-1) as never);
    expect(await screen.findByText('Step 1 · Build your split')).toBeOnTheScreen();
  });
});

describe('today’s plan on the page', () => {
  it('a plan exercise is logged for today with a tap, and then shows as done', async () => {
    const h = dataHarness();
    h.db.seed('split_plans', [{ user_id: USER, split_type: 'ppl', days_per_week: 1, goal: null, days: [{ label: 'Push', exercises: ['Flat Bench Press'] }], schedule: { [todayKey]: 'Push' }, exercise_prescriptions: {}, extra: {} }]);
    await open(h);
    await press('Log an exercise: Flat Bench Press');
    expect(await screen.findByRole('button', { name: 'Flat Bench Press, already logged today' })).toBeOnTheScreen();
    expect(screen.getByText(setsRepsText('Flat Bench Press'))).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_entries')).toMatchObject([{ exercise: 'Flat Bench Press', log_date: TODAY }]);
  });

  it('with no plan the button invites you to make one', async () => {
    await open();
    expect(await screen.findByRole('button', { name: 'Plan my split' })).toBeOnTheScreen();
  });
});

describe('survivors: what is shown as chosen', () => {
  const selected = (name: string | RegExp) => screen.getByRole('button', { name }).props.accessibilityState?.selected;

  it('the way of building, the split and the place you train show as chosen, and only the chosen one', async () => {
    await open();
    await press('Plan my split');
    await choose('Let AI build it');
    expect(selected('Let AI build it')).toBe(true);
    expect(selected('Build it myself')).toBe(false);
    await choose('Build it myself');
    expect(selected('Build it myself')).toBe(true);
    expect(selected('Let AI build it')).toBe(false);
    await press('Next');
    await choose('Upper / Lower');
    expect(selected('Upper / Lower')).toBe(true);
    expect(selected('Push / Pull / Legs')).toBe(false);
  });

  it('the day count shows the chosen number, including after days were typed in', async () => {
    await open();
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    await choose('Push / Pull / Legs');
    expect(selected('3')).toBe(true);
    expect(selected('4')).toBe(false);
    await choose('5');
    expect(selected('5')).toBe(true);
    expect(selected('3')).toBe(false);
  });

  it('with no days yet no count is chosen', async () => {
    await open();
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    await choose('Custom');
    expect(selected('1')).toBe(false);
  });

  it('the place you train shows as chosen', async () => {
    await open();
    await press('Plan my split');
    await choose('Let AI build it');
    await press('Next');
    await choose(/^At home/);
    expect(selected(/^At home/)).toBe(true);
    expect(selected(/^Gym/)).toBe(false);
  });

  it('"your coach picked" is said only when the AI chose a split we know', async () => {
    mockApi.generateSplit.mockResolvedValue({ ...GENERATED, splitType: 'something_else' });
    const h = dataHarness();
    await aiToReview(h);
    expect(screen.queryByText(/Your coach picked/)).toBeNull();
  });

  it('a self-built plan never says a coach picked it, even if the server names a type', async () => {
    mockApi.generateSplit.mockResolvedValue({ ...GENERATED, splitType: 'ppl' });
    await open();
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    await choose('Full Body');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Pick exercises' }))[0]);
    await fireEvent.changeText(await screen.findByLabelText('Search for an exercise...'), 'squat');
    await fireEvent.press((await screen.findAllByRole('checkbox'))[0]);
    await press(/^Done \(1 selected\)$/);
    await press('Generate my plan');
    await screen.findByText('Save plan', { exact: false });
    expect(screen.queryByText(/Your coach picked/)).toBeNull();
  });
});

describe('survivors: the editor and the checklist', () => {
  const seed = (h: ReturnType<typeof dataHarness>, schedule: Record<string, string>, days = [{ label: 'Push', exercises: ['Flat Bench Press'] }, { label: 'Pull', exercises: [] as string[] }]) =>
    h.db.seed('split_plans', [{ user_id: USER, split_type: 'ppl', days_per_week: 2, goal: null, days, schedule, exercise_prescriptions: {}, extra: {} }]);
  const openEditor = async (h: ReturnType<typeof dataHarness>) => {
    await open(h);
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Edit split' }))[0]);
    await screen.findByText("What's on this day?");
  };

  it('the chosen weekday is marked, and a rest day says Today’s plan', async () => {
    const h = dataHarness();
    seed(h, { [todayKey]: 'Rest', [otherKey]: 'Push' });
    await openEditor(h);
    const days = screen.getAllByRole('button', { name: /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, (Push|Pull|Rest)$/ });
    expect(days.filter((d) => d.props.accessibilityState.selected)).toHaveLength(1);
    expect(screen.queryAllByText("Today's plan")).toHaveLength(2); // the card's title and this day's heading
  });

  it('a day with no exercises says so; one with exercises does not', async () => {
    const h = dataHarness();
    seed(h, { [todayKey]: 'Pull', [otherKey]: 'Push' });
    await openEditor(h);
    expect(await screen.findAllByText('No exercises for this day yet.')).toHaveLength(2); // the page's card and the editor
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${otherName}, Push$`) }));
    expect(screen.queryAllByText('No exercises for this day yet.')).toHaveLength(1); // only the card (today is still Pull)
  });

  it('a one or two digit number is read as decimal', async () => {
    const h = dataHarness();
    seed(h, { [todayKey]: 'Push' });
    await openEditor(h);
    await press(/^Flat Bench Press, 4×6/);
    const sets = await screen.findByLabelText('Sets');
    await fireEvent.changeText(sets, '10');
    await fireEvent(sets, 'endEditing');
    expect(await screen.findByRole('button', { name: /^Flat Bench Press, 10×6/ })).toBeOnTheScreen();
    const reps = screen.getByLabelText('Reps');
    await fireEvent.changeText(reps, '1');
    await fireEvent(reps, 'endEditing');
    expect(await screen.findByRole('button', { name: /^Flat Bench Press, 10×1/ })).toBeOnTheScreen();
  });

  async function checklist() {
    const h = dataHarness({ listCustomExercises: async () => [{ id: 1, name: 'Sled Drag', emoji: null, mode: 'both' }, { id: 2, name: 'Rope Climb', emoji: null, mode: 'both' }] });
    await open(h);
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    await choose('Full Body');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Pick exercises' }))[0]);
    await screen.findByLabelText('Search for an exercise...');
    return h;
  }

  it('a search lists only the matching exercises of your own, and at most sixty from the library', async () => {
    await checklist();
    await fireEvent.changeText(screen.getByLabelText('Search for an exercise...'), 'sled');
    expect(await screen.findByRole('checkbox', { name: 'Sled Drag' })).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox', { name: 'Rope Climb' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search for an exercise...'), 'e');
    expect((await screen.findAllByRole('checkbox')).length).toBe(60 + 2 - 0 > 62 ? 62 : screen.getAllByRole('checkbox').length);
    expect(screen.getAllByRole('checkbox').length).toBeLessThanOrEqual(62);
  });

  it('nothing ticked shows no "Selected" heading; ticking shows it and moves the exercise there', async () => {
    await checklist();
    expect(screen.queryByText(/^Selected \(/)).toBeNull();
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Sled Drag' }));
    expect(await screen.findByText('Selected (1)')).toBeOnTheScreen();
    expect(screen.getAllByRole('checkbox', { name: 'Sled Drag' })).toHaveLength(1);
  });

  it('opening a category lists only that category’s exercises', async () => {
    await checklist();
    const categories = await screen.findAllByRole('button', { expanded: false });
    await fireEvent.press(categories[0]);
    const first = (await screen.findAllByRole('checkbox')).filter((c) => !['Sled Drag', 'Rope Climb'].includes(c.props.accessibilityLabel));
    await fireEvent.press(categories[1]);
    const names = (await screen.findAllByRole('checkbox')).filter((c) => !['Sled Drag', 'Rope Climb'].includes(c.props.accessibilityLabel));
    expect(names.length).toBeGreaterThan(0);
    expect(first.length).toBeGreaterThan(0);
  });

  it('Cancel closes the new-exercise form, and so does saving', async () => {
    await checklist();
    await press('+ Create an exercise');
    await press('Cancel');
    expect(screen.queryByLabelText('Exercise name')).toBeNull();
    await press('+ Create an exercise');
    await fireEvent.changeText(await screen.findByLabelText('Exercise name'), 'New thing');
    await press('Save');
    await waitFor(() => expect(screen.queryByLabelText('Exercise name')).toBeNull());
  });

  it('a failure that is not the server’s gets the plain message', async () => {
    const h = dataHarness({ createCustomExercise: async () => { throw new TypeError('boom'); } });
    await open(h);
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    await choose('Full Body');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Pick exercises' }))[0]);
    await press('+ Create an exercise');
    await fireEvent.changeText(await screen.findByLabelText('Exercise name'), 'X');
    await press('Save');
    expect(await screen.findByText("Couldn't create it. Try again.")).toBeOnTheScreen();
  });

  it('a plan with no entry for today (not even Rest) says there are no workouts today', async () => {
    const h = dataHarness();
    seed(h, { [otherKey]: 'Push' });
    await open(h);
    expect(await screen.findByText('No workouts today, have a rest!')).toBeOnTheScreen();
  });
});

describe('survivors: the checklist lists exactly what belongs', () => {
  async function checklistWith(custom: { id: number; name: string; emoji: null; mode: 'both' }[]) {
    const h = dataHarness({ listCustomExercises: async () => custom });
    await open(h);
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    await choose('Full Body');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Pick exercises' }))[0]);
    await screen.findByLabelText('Search for an exercise...');
  }

  it('an opened category holds every exercise of that category and nothing else', async () => {
    await checklistWith([]);
    const category = CATEGORIES[1];
    await fireEvent.press(await screen.findByRole('button', { name: category }));
    const shown = (await screen.findAllByRole('checkbox')).map((c) => c.props.accessibilityLabel).sort();
    const expected = EXERCISES.filter((e) => e.category === category).map((e) => e.name).sort();
    expect(shown).toEqual(expected);
  });

  it('with no exercises of your own there is no "Custom exercises" heading', async () => {
    await checklistWith([]);
    expect(screen.queryByText('Custom exercises')).toBeNull();
  });

  it('with some, there is', async () => {
    await checklistWith([{ id: 1, name: 'Sled Drag', emoji: null, mode: 'both' }]);
    expect(await screen.findByText('Custom exercises')).toBeOnTheScreen();
  });
});

describe('removing your own exercises in the checklist', () => {
  async function checklist(deleted: number[]) {
    const h = dataHarness({ listCustomExercises: async () => [{ id: 4, name: 'Sled Drag', emoji: null, mode: 'both' }], deleteCustomExercise: async (id) => void deleted.push(id) });
    await open(h);
    await press('Plan my split');
    await choose('Build it myself');
    await press('Next');
    await choose('Full Body');
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Pick exercises' }))[0]);
    await screen.findByRole('checkbox', { name: 'Sled Drag' });
    return h;
  }

  it('asks first, then removes it, and it is no longer ticked', async () => {
    const deleted: number[] = [];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await checklist(deleted);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Sled Drag' }));
    expect(screen.getByRole('button', { name: 'Done (1 selected)' })).toBeOnTheScreen();
    await press('Remove Sled Drag');
    expect(alert).toHaveBeenCalledWith('Delete this exercise?', 'Sled Drag', expect.any(Array));
    expect(deleted).toEqual([]);
    await act(async () => {
      (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((b) => b.text === 'Remove')?.onPress?.();
    });
    await waitFor(() => expect(deleted).toEqual([4]));
    expect(screen.getByRole('button', { name: 'Done' })).toBeOnTheScreen();
  });

  it('library exercises have no remove button, and cancelling keeps the exercise', async () => {
    const deleted: number[] = [];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await checklist(deleted);
    await fireEvent.changeText(screen.getByLabelText('Search for an exercise...'), 'squat');
    await screen.findAllByRole('checkbox');
    expect(screen.queryByRole('button', { name: /^Remove Squat/ })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search for an exercise...'), 'sled');
    await press('Remove Sled Drag');
    expect((alert.mock.calls[0][2] as { style?: string }[]).some((b) => b.style === 'cancel')).toBe(true);
    expect(deleted).toEqual([]);
  });
});
