import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { toIsoDate } from '@/logic/dates';
import { USER, dataHarness } from '@/testing/dataHarness';

import CoachingWizardScreen from '../CoachingWizardScreen';

const mockApi = { calculateTargets: jest.fn() };
const mockBack = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
const mockAuth = { state: { status: 'ready', profile: { id: USER }, session: { user: { id: USER } } }, refreshProfile: mockRefresh };
const mockProfileUpdate = jest.fn();
const mockSupabase = {
  from: (table: string) => ({
    update: (values: unknown) => ({
      eq: async (...args: unknown[]) => {
        mockProfileUpdate(table, values, ...args);
        return { error: null };
      },
    }),
  }),
};

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/supabase/client', () => ({ getSupabase: () => mockSupabase }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: jest.fn() }) }));

const TODAY = toIsoDate(new Date());
const CALC = { ok: true, targets: { calories: 2100, protein: 165, fat: 65, carbs: 215, bmr: 1750, tdee: 2600 }, distribution: null };

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <CoachingWizardScreen />
    </h.Provider>,
  );
  return h;
}
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const next = () => press('Next');
const back = () => press('Back');
const typeInto = async (label: string, text: string) => {
  await fireEvent.changeText(await screen.findByLabelText(label), text);
};
const settingsRow = (over: Record<string, unknown> = {}) => ({
  user_id: USER, theme: null, language: null, units_weight: 'kg', units_height: 'cm', units_distance: 'km', units_clock: '12h',
  hyrox_leaderboard_gender: null, hyrox_facility_lane_m: null, hyrox_history_backfilled: false, extra: {}, ...over,
});
const storedProfile = (over: Record<string, unknown> = {}) => ({
  user_id: USER, aspiration: 'gain', gender: 'female', weight_kg: 60, body_fat_range_id: 'f2', activity_level: 'cardio_only', protein_preference: 'moderate', diet_preference: 'keto',
  goal_weight_kg: 66, height_cm: 160, distribution_mode: 'weekly', loss_rate_pct: null, gain_rate_pct: 0.5, created_on: '2026-01-05', last_adjustment_on: '2026-10-01',
  last_adjustment_reason: null, last_adjustment_delta: null, last_adjustment_at: null, weekly_distribution: null, goal_achieved_weight_kg: null, goal_achieved_aspiration: null,
  goal_handled_weight_kg: null, goal_handled_aspiration: null, inactivity_notified_on: null, extra: {}, ...over,
});

/** The common first two answers, then on to the next step. */
async function startAs(aspiration: string, weight = '80', gender = 'Male') {
  await press(aspiration);
  await next();
  await typeInto('Current weight (kg)', weight);
  await press(gender);
  await next();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.calculateTargets.mockResolvedValue({ targets: CALC.targets, distribution: null });
  mockAuth.state = { status: 'ready', profile: { id: USER }, session: { user: { id: USER } } };
});

describe('a new profile, losing weight', () => {
  it('asks the questions in order, sends the answers, shows the targets, and saves everything', async () => {
    const h = await open();
    expect(await screen.findByText("What's your goal?")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(true);

    await startAs('Lose weight');
    expect(await screen.findByText("What's your goal weight?")).toBeOnTheScreen();
    expect(screen.getByLabelText('Goal weight (kg)').props.value).toBe('79');
    expect(screen.getByTestId('goal-bounds')).toHaveTextContent('35 kg – 79 kg');
    expect(screen.getByTestId('goal-hint')).toHaveTextContent('1 kg to go from 80 kg.');
    await typeInto('Goal weight (kg)', '72');
    await next();

    expect(await screen.findByLabelText('Height —')).toBeOnTheScreen();
    expect(screen.getByLabelText('Height —').props.value).toBe('170');
    await typeInto('Height —', '175');
    await next();

    expect(await screen.findByText('Which body type is closest to yours?')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '7-10%' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(true);
    await press('15-20%');
    await next();
    await press('Weight lifting only');
    await next();
    await press('High');
    await next();
    expect(await screen.findByText('What kind of diet do you want to follow?')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Balanced' }).props.accessibilityState.selected).toBe(true);
    await press('Low carb');
    await next();
    expect(screen.getByRole('button', { name: 'Stable' }).props.accessibilityState.selected).toBe(true);
    await next();

    expect(await screen.findByTestId('target-calories')).toHaveTextContent('2100');
    expect(mockApi.calculateTargets).toHaveBeenCalledTimes(1);
    expect(mockApi.calculateTargets).toHaveBeenCalledWith({
      aspiration: 'lose', gender: 'male', weight_kg: 80, height_cm: 175, body_fat_range_id: 'm3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
      distribution: 'stable', loss_rate_pct: expect.closeTo(0.2667, 3), gain_rate_pct: null, training_days: [],
    });
    expect(screen.getByTestId('target-protein')).toHaveTextContent('165g');
    expect(screen.getByTestId('target-fat')).toHaveTextContent('65g');
    expect(screen.getByTestId('target-carbs')).toHaveTextContent('215g');
    expect(screen.getByTestId('target-detail')).toHaveTextContent('Estimated maintenance (TDEE): 2600 kcal · BMR: 1750 kcal');

    await press('Save & start tracking');
    await act(async () => {
      await h.flush();
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({
      user_id: USER, aspiration: 'lose', gender: 'male', weight_kg: 80, goal_weight_kg: 72, height_cm: 175, body_fat_range_id: 'm3', activity_level: 'lift_only', protein_preference: 'high',
      diet_preference: 'low_carb', distribution_mode: 'stable', gain_rate_pct: null, created_on: TODAY, last_adjustment_on: TODAY, weekly_distribution: null,
    });
    expect(h.db.rows('coaching_profiles')[0].loss_rate_pct).toBeCloseTo(0.2667, 3);
    expect(h.db.rows('nutrition_goals')[0]).toMatchObject({ user_id: USER, protein: 165, fat: 65, carbs: 215 });
    expect(mockProfileUpdate).toHaveBeenCalledWith('profiles', { onboarding_completed: true }, 'id', USER);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('the bar fills a step at a time', async () => {
    await open();
    await screen.findByText("What's your goal?");
    expect(screen.getByRole('progressbar').props.accessibilityValue).toMatchObject({ now: 10 });
    await startAs('Lose weight');
    await screen.findByText("What's your goal weight?");
    expect(screen.getByRole('progressbar').props.accessibilityValue).toMatchObject({ now: 30 });
  });
});

describe('maintaining and gaining', () => {
  it('maintaining is not asked a goal weight or a rate, and sends neither', async () => {
    await open();
    await startAs('Maintain weight');
    expect(await screen.findByLabelText('Height —')).toBeOnTheScreen();
    expect(screen.queryByText("What's your goal weight?")).toBeNull();
    await next();
    await press('15-20%');
    await next();
    await press('None');
    await next();
    await press('Moderate');
    await next();
    await next();
    await next();
    await screen.findByTestId('target-calories');
    expect(mockApi.calculateTargets.mock.calls[0][0]).toMatchObject({ aspiration: 'maintain', loss_rate_pct: null, gain_rate_pct: null });
  });

  it('going back from the height of someone maintaining skips the goal weight', async () => {
    await open();
    await startAs('Maintain weight');
    await screen.findByLabelText('Height —');
    await back();
    expect(await screen.findByText('Your weight and gender')).toBeOnTheScreen();
  });

  it('gaining is asked a goal above the current weight and a gain rate', async () => {
    await open();
    await startAs('Gain weight', '60');
    expect(await screen.findByLabelText('Goal weight (kg)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Goal weight (kg)').props.value).toBe('61');
    expect(screen.getByTestId('goal-bounds')).toHaveTextContent('61 kg – 400 kg');
    expect(screen.getByTestId('rate-header')).toHaveTextContent('Rate of weight gain — 0.35% / week');
    expect(screen.queryByTestId('rate-badge')).toBeNull();
    await fireEvent(screen.getByTestId('rate-slider'), 'valueChange', 0.6);
    expect(screen.getByTestId('rate-header')).toHaveTextContent('Rate of weight gain — 0.60% / week');
    expect(screen.getByTestId('rate-kg')).toHaveTextContent('0.4 kg gained Per Week');
  });

  it('there may be no room to move: the question says so and the answer cannot be given', async () => {
    await open();
    await startAs('Lose weight', '35');
    expect(await screen.findByTestId('goal-no-room')).toHaveTextContent('No room left to move that direction from your current weight — go back and adjust it.');
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(true);
  });
});

describe('the pace of losing weight', () => {
  async function toRate(weight = '100') {
    await open();
    await startAs('Lose weight', weight);
    await screen.findByTestId('rate-slider');
  }

  it('starts at the engine’s default, which is the recommended standard pace for a 75 kg body', async () => {
    await toRate('75');
    expect(screen.getByTestId('rate-header')).toHaveTextContent('Rate of weight loss — 0.27% / week');
    expect(screen.getByTestId('rate-badge')).toHaveTextContent('Standard (Recommended)');
    expect(screen.getByTestId('rate-kg')).toHaveTextContent('0.2 kg lost Per Week');
  });

  it('for a heavier body the same percentage is a standard pace but not the first recommended one', async () => {
    await toRate('100');
    expect(screen.getByTestId('rate-badge')).toHaveTextContent('Standard');
    expect(screen.getByTestId('rate-badge')).not.toHaveTextContent('Recommended');
    expect(screen.getByTestId('rate-kg')).toHaveTextContent('0.3 kg lost Per Week');
  });

  it('says slower, standard and faster, and only the faster pace carries the warning', async () => {
    await toRate();
    expect(screen.queryByTestId('rate-caution')).toBeNull();
    await fireEvent(screen.getByTestId('rate-slider'), 'valueChange', 0.15);
    expect(screen.getByTestId('rate-badge')).toHaveTextContent('Slower');
    expect(screen.queryByTestId('rate-caution')).toBeNull();
    await fireEvent(screen.getByTestId('rate-slider'), 'valueChange', 0.6);
    expect(screen.getByTestId('rate-badge')).toHaveTextContent('Standard');
    expect(screen.getByTestId('rate-badge')).not.toHaveTextContent('Recommended');
    await fireEvent(screen.getByTestId('rate-slider'), 'valueChange', 1.5);
    expect(screen.getByTestId('rate-badge')).toHaveTextContent('Faster');
    expect(screen.getByTestId('rate-caution')).toHaveTextContent(/Losing weight faster than this is harder to sustain/);
  });

  it('is kept inside the engine’s limits whatever the slider reports', async () => {
    await toRate();
    await fireEvent(screen.getByTestId('rate-slider'), 'valueChange', 9);
    expect(screen.getByTestId('rate-header')).toHaveTextContent('Rate of weight loss — 2.00% / week');
    await fireEvent(screen.getByTestId('rate-slider'), 'valueChange', -3);
    expect(screen.getByTestId('rate-header')).toHaveTextContent('Rate of weight loss — 0.10% / week');
  });

  it('projects when the goal would be reached, and the pace chosen is the one sent', async () => {
    await toRate();
    await typeInto('Goal weight (kg)', '90');
    await fireEvent(screen.getByTestId('rate-slider'), 'valueChange', 1);
    expect(screen.getByTestId('goal-eta')).toBeOnTheScreen();
    const eta = new Date();
    eta.setDate(eta.getDate() + 70);
    expect(screen.getByTestId('goal-eta')).toHaveTextContent(`${eta.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}Estimated goal date`);
    await next();
    await next();
    await press('15-20%');
    await next();
    await press('None');
    await next();
    await press('High');
    await next();
    await next();
    await next();
    await screen.findByTestId('target-calories');
    expect(mockApi.calculateTargets.mock.calls[0][0]).toMatchObject({ loss_rate_pct: 1 });
  });
});

describe('the body type belongs to a gender', () => {
  it('shows the gender’s own six, and changing gender after choosing one clears it', async () => {
    await open();
    await startAs('Maintain weight');
    await next();
    await press('15-20%');
    expect(screen.getByRole('button', { name: '15-20%' }).props.accessibilityState.selected).toBe(true);
    await back();
    await back();
    await press('Female');
    await next();
    await next();
    expect(await screen.findByRole('button', { name: '15-18%' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '15-20%' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(true);
    await press('19-22%');
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(false);
  });
});

describe('units', () => {
  it('weight typed in pounds is sent in kilograms, and heights in feet and inches in centimetres', async () => {
    const h = dataHarness();
    h.db.seed('user_settings', [settingsRow({ units_weight: 'lb', units_height: 'ftin' })]);
    await open(h);
    await act(async () => undefined);
    await screen.findByText("What's your goal?");
    await press('Maintain weight');
    await next();
    await typeInto('Current weight (lb)', '176');
    await press('Female');
    await next();
    await typeInto('ft', '5');
    await typeInto('in', '7');
    expect(screen.getByTestId('height-hint')).toHaveTextContent(`5'7"`);
    await next();
    await press('23-28%');
    await next();
    await press('None');
    await next();
    await press('Moderate');
    await next();
    await next();
    await next();
    await screen.findByTestId('target-calories');
    const body = mockApi.calculateTargets.mock.calls[0][0];
    expect(body.weight_kg).toBeCloseTo(79.83, 1);
    expect(body.height_cm).toBeCloseTo(170.18, 1);
  });

  it('a height out of range is shown with the range, and cannot be accepted', async () => {
    await open();
    await startAs('Maintain weight');
    await typeInto('Height —', '90');
    expect(screen.getByTestId('height-hint')).toHaveTextContent('130 cm – 230 cm');
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(true);
    await typeInto('Height —', '231');
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(true);
    await typeInto('Height —', '230');
    expect(screen.getByRole('button', { name: 'Next' }).props.accessibilityState.disabled).toBe(false);
  });
});

describe('the result', () => {
  async function toResult(h = dataHarness()) {
    await open(h);
    await startAs('Maintain weight');
    await next();
    await press('15-20%');
    await next();
    await press('None');
    await next();
    await press('Moderate');
    await next();
    await next();
    await next();
  }

  it('says it is working while the targets are worked out', async () => {
    mockApi.calculateTargets.mockReturnValue(new Promise(() => undefined));
    await toResult();
    expect(await screen.findByText('Calculating your targets...')).toBeOnTheScreen();
  });

  it('a refusal is shown in the server’s words and can be gone back from', async () => {
    mockApi.calculateTargets.mockRejectedValueOnce(new ApiError('Please enter a realistic weight of at least 35 kg.', 400));
    await toResult();
    expect(await screen.findByText('Please enter a realistic weight of at least 35 kg.')).toBeOnTheScreen();
    await back();
    expect(await screen.findByText('Spread calories through the week, or keep it stable?')).toBeOnTheScreen();
  });

  it.each([[new ApiError('Could not reach the server.', 0)], [new ApiError('boom', 500)], [new Error('x')]])('%s is the general line', async (error) => {
    mockApi.calculateTargets.mockRejectedValueOnce(error);
    await toResult();
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeOnTheScreen();
  });

  it('going back and forward asks again with the answers changed', async () => {
    await toResult();
    await screen.findByTestId('target-calories');
    await back();
    await press('Distributed');
    mockApi.calculateTargets.mockResolvedValueOnce({ targets: { ...CALC.targets, calories: 2200 }, distribution: { monday: { calories: 2300 } } });
    await next();
    expect(await screen.findByText('2200')).toBeOnTheScreen();
    expect(mockApi.calculateTargets).toHaveBeenCalledTimes(2);
    expect(mockApi.calculateTargets.mock.calls[1][0]).toMatchObject({ distribution: 'weekly' });
  });

  it('spreading the week saves the week the server worked out', async () => {
    const h = dataHarness();
    await open(h);
    await startAs('Maintain weight');
    await next();
    await press('15-20%');
    await next();
    await press('None');
    await next();
    await press('Moderate');
    await next();
    await next();
    await press('Distributed');
    mockApi.calculateTargets.mockResolvedValueOnce({ targets: CALC.targets, distribution: { monday: { calories: 2300 } } });
    await next();
    await screen.findByTestId('target-calories');
    await press('Save & start tracking');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ distribution_mode: 'weekly', weekly_distribution: { monday: { calories: 2300 } } });
  });

  it('the days a split plan trains on are sent so the week can be spread', async () => {
    const h = dataHarness();
    h.db.seed('split_plans', [{ user_id: USER, split_type: 'ppl', days_per_week: 3, goal: 'x', days: [], schedule: { monday: 'Push', tuesday: 'Rest', wednesday: 'Pull', thursday: '' }, exercise_prescriptions: {}, extra: {} }]);
    await open(h);
    await act(async () => undefined);
    await startAs('Maintain weight');
    await next();
    await press('15-20%');
    await next();
    await press('None');
    await next();
    await press('Moderate');
    await next();
    await next();
    await next();
    await screen.findByTestId('target-calories');
    expect(mockApi.calculateTargets.mock.calls[0][0].training_days).toEqual(['monday', 'wednesday']);
  });

  it('a save that cannot be queued says so and stays', async () => {
    const h = dataHarness();
    jest.spyOn(h.outbox, 'enqueue').mockRejectedValue(new Error('full'));
    await toResult(h);
    await screen.findByTestId('target-calories');
    await press('Save & start tracking');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save & start tracking' }).props.accessibilityState.disabled).toBe(false);
  });
});

describe('editing a profile', () => {
  it('opens on what is saved, keeps the day it was made, and saves the changes', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [storedProfile()]);
    await open(h);
    expect(await screen.findByRole('button', { name: 'Gain weight' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Gain weight' }).props.accessibilityState.selected).toBe(true);
    await next();
    expect(screen.getByLabelText('Current weight (kg)').props.value).toBe('60');
    expect(screen.getByRole('button', { name: 'Female' }).props.accessibilityState.selected).toBe(true);
    await typeInto('Current weight (kg)', '62');
    await next();
    expect(screen.getByLabelText('Goal weight (kg)').props.value).toBe('66');
    expect(screen.getByTestId('rate-header')).toHaveTextContent('Rate of weight gain — 0.50% / week');
    await next();
    expect(screen.getByLabelText('Height —').props.value).toBe('160');
    await next();
    expect(screen.getByRole('button', { name: '19-22%' }).props.accessibilityState.selected).toBe(true);
    await next();
    expect(screen.getByRole('button', { name: 'Cardio only' }).props.accessibilityState.selected).toBe(true);
    await next();
    expect(screen.getByRole('button', { name: 'Moderate' }).props.accessibilityState.selected).toBe(true);
    await next();
    expect(screen.getByRole('button', { name: 'Keto' }).props.accessibilityState.selected).toBe(true);
    await next();
    expect(screen.getByRole('button', { name: 'Distributed' }).props.accessibilityState.selected).toBe(true);
    await next();
    await screen.findByTestId('target-calories');
    await press('Save & start tracking');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('coaching_profiles')).toHaveLength(1);
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ weight_kg: 62, goal_weight_kg: 66, gain_rate_pct: 0.5, created_on: '2026-01-05', last_adjustment_on: TODAY });
  });

  it('a profile that was never finished starts afresh', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [storedProfile({ weight_kg: null })]);
    await open(h);
    await screen.findByText("What's your goal?");
    expect(screen.getByRole('button', { name: 'Gain weight' }).props.accessibilityState.selected).toBe(false);
  });

  it('a goal carried in from before that is on the wrong side is brought inside', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [storedProfile({ aspiration: 'lose', loss_rate_pct: 0.5, gain_rate_pct: null, goal_weight_kg: 70, weight_kg: 60 })]);
    await open(h);
    await screen.findByText("What's your goal?");
    await next();
    await next();
    expect(screen.getByLabelText('Goal weight (kg)').props.value).toBe('59');
  });
});

describe('leaving the wizard', () => {
  it('a profile saved without the flag being written still finishes', async () => {
    const failing = { from: () => ({ update: () => ({ eq: async () => ({ error: { message: 'no' } }) }) }) };
    jest.spyOn(require('@/supabase/client'), 'getSupabase').mockReturnValue(failing as never);
    const h = dataHarness();
    await open(h);
    await startAs('Maintain weight');
    await next();
    await press('15-20%');
    await next();
    await press('None');
    await next();
    await press('Moderate');
    await next();
    await next();
    await next();
    await screen.findByTestId('target-calories');
    await press('Save & start tracking');
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('survivors: progress and saving', () => {
  it('the bar rounds to the nearest percent', async () => {
    await open();
    await startAs('Maintain weight');
    await next();
    await press('15-20%');
    await next();
    await screen.findByText('How active are you?');
    expect(screen.getByRole('progressbar').props.accessibilityValue).toMatchObject({ now: 56 });
  });

  it('saving shows it is working until it is done', async () => {
    const h = dataHarness();
    let release: () => void = () => undefined;
    jest.spyOn(h.outbox, 'enqueue').mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    await open(h);
    await startAs('Maintain weight');
    await next();
    await press('15-20%');
    await next();
    await press('None');
    await next();
    await press('Moderate');
    await next();
    await next();
    await next();
    await screen.findByTestId('target-calories');
    await press('Save & start tracking');
    expect(screen.getAllByRole('button').some((b) => b.props.accessibilityState?.busy === true)).toBe(true);
    expect(mockBack).not.toHaveBeenCalled();
    await act(async () => release());
  });
});
