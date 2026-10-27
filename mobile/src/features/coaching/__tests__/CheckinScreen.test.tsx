import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { toTimestamp } from '@/data/mappers';
import { addDays, toIsoDate } from '@/logic/dates';
import { USER, dataHarness, nutritionRow } from '@/testing/dataHarness';

import CheckinScreen from '../CheckinScreen';

const mockApi = { weeklyAdjustment: jest.fn(), uploadCheckinPhoto: jest.fn() };
const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
const mockPhotos = { takePhoto: jest.fn(), choosePhoto: jest.fn() };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/ui/photos', () => ({ takePhoto: (...a: unknown[]) => mockPhotos.takePhoto(...a), choosePhoto: (...a: unknown[]) => mockPhotos.choosePhoto(...a) }));

const TODAY = toIsoDate(new Date());
const day = (back: number) => addDays(TODAY, -back);
const PHOTO = { kind: 'photo', image: { uri: 'file:///me.jpg', name: 'me.jpg', mimeType: 'image/jpeg' } };
const ADJUSTMENT = { calories: 1950, protein: 150, fat: 62, carbs: 198, delta: -80, reason: 'Your weight is not moving, so eat a little less.' };

const profileRow = (over: Record<string, unknown> = {}) => ({
  user_id: USER, aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
  goal_weight_kg: 62, height_cm: 165, distribution_mode: 'stable', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: day(30), last_adjustment_on: day(8), last_adjustment_reason: null,
  last_adjustment_delta: null, last_adjustment_at: null, weekly_distribution: null, goal_achieved_weight_kg: null, goal_achieved_aspiration: null, goal_handled_weight_kg: null,
  goal_handled_aspiration: null, inactivity_notified_on: null, extra: {}, ...over,
});
const weightRow = (back: number, kg: number) => ({ user_id: USER, log_date: day(back), kg, logged_at: toTimestamp(new Date().getTime()), extra: {} });
const goalsRow = { user_id: USER, protein: 140, fat: 60, carbs: 190, extra: {} };

function seeded(over: { profile?: Record<string, unknown> | null; weights?: ReturnType<typeof weightRow>[]; food?: boolean } = {}) {
  const h = dataHarness();
  if (over.profile !== null) h.db.seed('coaching_profiles', [profileRow(over.profile)]);
  h.db.seed('nutrition_goals', [goalsRow]);
  h.db.seed('weight_entries', over.weights ?? [weightRow(3, 71)]);
  if (over.food !== false) h.db.seed('nutrition_entries', [nutritionRow('a', day(2), 1), nutritionRow('b', day(1), 2, { base_calories: 250 })]);
  return h;
}

async function open(h = seeded()) {
  await render(
    <h.Provider>
      <CheckinScreen />
    </h.Provider>,
  );
  return h;
}
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const settle = async (h: ReturnType<typeof dataHarness>) => {
  await act(async () => {
    await h.flush();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.weeklyAdjustment.mockResolvedValue(ADJUSTMENT);
  mockApi.uploadCheckinPhoto.mockImplementation(async (_image: unknown, angle: string) => (angle === 'front' ? 11 : 12));
  mockPhotos.takePhoto.mockResolvedValue(PHOTO);
  mockPhotos.choosePhoto.mockResolvedValue(PHOTO);
});

describe('when it is not time', () => {
  it('says how long to wait, and no check-in can be sent', async () => {
    await open(seeded({ profile: { last_adjustment_on: day(4) } }));
    expect(await screen.findByTestId('come-back')).toHaveTextContent('Come back in 3 days for the check-in');
    expect(screen.queryByRole('button', { name: 'Complete check-in' })).toBeNull();
  });

  it('one day is not plural', async () => {
    await open(seeded({ profile: { last_adjustment_on: day(6) } }));
    expect(await screen.findByTestId('come-back')).toHaveTextContent('Come back in 1 day for the check-in');
  });

  it('without a coaching profile there is nothing to check in on: the questions come first', async () => {
    await open(seeded({ profile: null }));
    await press('Fix my profile');
    expect(mockRouter.replace).toHaveBeenCalledWith('/coaching-wizard');
  });

  it('a reached goal makes it due at once, however recent the last check-in', async () => {
    await open(seeded({ profile: { last_adjustment_on: day(1) }, weights: [weightRow(0, 61.5)] }));
    expect(await screen.findByRole('button', { name: 'Complete check-in' })).toBeOnTheScreen();
  });

  it('...but not once that goal has been acted on', async () => {
    await open(seeded({ profile: { last_adjustment_on: day(1), goal_handled_weight_kg: 62, goal_handled_aspiration: 'lose' }, weights: [weightRow(0, 61.5)] }));
    expect(await screen.findByTestId('come-back')).toBeOnTheScreen();
  });
});

describe('the week', () => {
  it('shows seven days, oldest first, each as logged or not logged', async () => {
    await open();
    expect(await screen.findByTestId(`status-${day(6)}`)).toHaveTextContent('Not logged');
    expect(screen.getByTestId(`status-${day(2)}`)).toHaveTextContent('Logged');
    expect(screen.getByTestId(`status-${day(1)}`)).toHaveTextContent('Logged');
    expect(screen.getByTestId(`status-${TODAY}`)).toHaveTextContent('Not logged');
    expect(screen.queryByTestId(`status-${day(7)}`)).toBeNull();
  });

  it('a day with food cycles between logged and incomplete, and the mark is saved', async () => {
    const h = await open();
    await fireEvent.press(await screen.findByTestId(`status-${day(2)}`));
    expect(screen.getByTestId(`status-${day(2)}`)).toHaveTextContent('Incomplete logging');
    await settle(h);
    expect(h.db.rows('day_status_overrides')).toEqual([expect.objectContaining({ user_id: USER, log_date: day(2), status: 'incomplete' })]);
    await fireEvent.press(screen.getByTestId(`status-${day(2)}`));
    expect(screen.getByTestId(`status-${day(2)}`)).toHaveTextContent('Logged');
    await settle(h);
    expect(h.db.rows('day_status_overrides')).toEqual([]);
  });

  it('a day without food cycles between not logged and fasting', async () => {
    const h = await open();
    await fireEvent.press(await screen.findByTestId(`status-${day(5)}`));
    expect(screen.getByTestId(`status-${day(5)}`)).toHaveTextContent('Fasting');
    await settle(h);
    expect(h.db.rows('day_status_overrides')[0]).toMatchObject({ log_date: day(5), status: 'fasting' });
    await fireEvent.press(screen.getByTestId(`status-${day(5)}`));
    expect(screen.getByTestId(`status-${day(5)}`)).toHaveTextContent('Not logged');
  });
});

describe('completing a check-in', () => {
  it('sends the week, saves the weight, the new macros and the check-in, and shows what changed', async () => {
    const h = await open();
    await fireEvent.changeText(await screen.findByLabelText('Weight (kg)'), '70.4');
    await press('Complete check-in');

    expect(await screen.findByText('Check-in complete')).toBeOnTheScreen();
    expect(mockApi.weeklyAdjustment).toHaveBeenCalledTimes(1);
    expect(mockApi.weeklyAdjustment).toHaveBeenCalledWith({
      aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
      loss_rate_pct: 0.5, gain_rate_pct: null, current_targets: { protein: 140, fat: 60, carbs: 190, calories: Math.round(140 * 4 + 60 * 9 + 190 * 4) },
      week_weight_entries: [{ date: day(3), kg: 71 }, { date: TODAY, kg: 70.4 }], week_calorie_days: [{ date: day(2), calories: 100 }, { date: day(1), calories: 250 }], photo_ids: [],
    });
    expect(screen.getByTestId('new-target')).toHaveTextContent('New daily target: 1950 kcal');
    expect(screen.getByTestId('delta')).toHaveTextContent('-80 kcal');
    expect(screen.getByTestId('reason')).toHaveTextContent('Your weight is not moving, so eat a little less.');
    expect(screen.getByTestId('macro-protein')).toHaveTextContent('150g');
    expect(screen.getByTestId('macro-protein-diff')).toHaveTextContent('+10g');
    expect(screen.getByTestId('macro-fat-diff')).toHaveTextContent('+2g');
    expect(screen.getByTestId('macro-carbs-diff')).toHaveTextContent('+8g');

    await settle(h);
    expect(h.db.rows('weight_entries').find((r) => r.log_date === TODAY)).toMatchObject({ kg: 70.4 });
    expect(h.db.rows('nutrition_goals')[0]).toMatchObject({ protein: 150, fat: 62, carbs: 198 });
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ last_adjustment_on: TODAY, last_adjustment_reason: ADJUSTMENT.reason, last_adjustment_delta: -80 });
    expect(h.db.rows('activity_days')).toEqual([expect.objectContaining({ log_date: TODAY, action: 'checkin' })]);
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ goal_handled_weight_kg: null, goal_handled_aspiration: null });
  });

  it('a macro that did not move says so', async () => {
    mockApi.weeklyAdjustment.mockResolvedValue({ ...ADJUSTMENT, protein: 140 });
    await open();
    await press('Complete check-in');
    expect(await screen.findByTestId('macro-protein-diff')).toHaveTextContent('same');
  });

  it('rounds the new target and the change to whole calories, and a rise is signed', async () => {
    mockApi.weeklyAdjustment.mockResolvedValue({ ...ADJUSTMENT, calories: 2050.6, delta: 79.6 });
    await open();
    await press('Complete check-in');
    expect(await screen.findByTestId('new-target')).toHaveTextContent('New daily target: 2051 kcal');
    expect(screen.getByTestId('delta')).toHaveTextContent('+80 kcal');
  });

  it('a change of one calorie is signed', async () => {
    mockApi.weeklyAdjustment.mockResolvedValue({ ...ADJUSTMENT, calories: 2031, delta: 1 });
    await open();
    await press('Complete check-in');
    expect(await screen.findByTestId('delta')).toHaveTextContent('+1 kcal');
  });

  it('the first day of the week shows a mark it was given', async () => {
    const h = seeded();
    h.db.seed('day_status_overrides', [{ user_id: USER, log_date: day(6), status: 'fasting' }]);
    await open(h);
    expect(await screen.findByTestId(`status-${day(6)}`)).toHaveTextContent('Fasting');
  });

  it('a change of nothing is not signed', async () => {
    mockApi.weeklyAdjustment.mockResolvedValue({ ...ADJUSTMENT, calories: 2030, delta: 0 });
    await open();
    await press('Complete check-in');
    expect(await screen.findByTestId('delta')).toHaveTextContent(/^0 kcal$/);
  });

  it('the first day of the week counts: its food is in the calories', async () => {
    const h = seeded({ food: false });
    h.db.seed('nutrition_entries', [nutritionRow('a', day(2), 1), nutritionRow('f', day(6), 3, { base_calories: 300.6 })]);
    await open(h);
    expect(await screen.findByTestId(`status-${day(6)}`)).toHaveTextContent('Logged');
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.weeklyAdjustment.mock.calls[0][0].week_calorie_days).toEqual([{ date: day(6), calories: 301 }, { date: day(2), calories: 100 }]);
  });

  it('no change needed is "on track", and the targets are left alone', async () => {
    mockApi.weeklyAdjustment.mockResolvedValue(null);
    const h = await open();
    await press('Complete check-in');
    expect(await screen.findByTestId('on-track')).toHaveTextContent("You're right on track! 🎉");
    expect(screen.queryByTestId('new-target')).toBeNull();
    await settle(h);
    expect(h.db.rows('nutrition_goals')[0]).toMatchObject({ protein: 140, fat: 60, carbs: 190 });
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ last_adjustment_on: TODAY });
  });

  it('Done leaves', async () => {
    await open();
    await press('Complete check-in');
    await press('Done');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('a weight already logged today is not asked for again, and is the one sent', async () => {
    await open(seeded({ weights: [weightRow(3, 71), weightRow(0, 70.8)] }));
    expect(await screen.findByTestId('weight-logged')).toHaveTextContent("Today's weight is already logged.");
    expect(screen.queryByLabelText('Weight (kg)')).toBeNull();
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.weeklyAdjustment.mock.calls[0][0].week_weight_entries).toEqual([{ date: day(3), kg: 71 }, { date: TODAY, kg: 70.8 }]);
  });

  it('the week is the seven days ending today: a weigh-in on its first day is in, the day before is out', async () => {
    await open(seeded({ weights: [weightRow(8, 72), weightRow(7, 71.5), weightRow(6, 71.2), weightRow(0, 70.8)] }));
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.weeklyAdjustment.mock.calls[0][0].week_weight_entries).toEqual([{ date: day(6), kg: 71.2 }, { date: TODAY, kg: 70.8 }]);
  });

  it('the button is busy while the check-in is on its way', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockApi.weeklyAdjustment.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await open();
    await press('Complete check-in');
    expect(screen.getByRole('button', { busy: true }).props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await act(async () => finish(ADJUSTMENT));
    expect(await screen.findByText('Check-in complete')).toBeOnTheScreen();
  });

  it('a weight left blank is fine: the check-in goes ahead on the week as it stands', async () => {
    const h = await open();
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.weeklyAdjustment.mock.calls[0][0].week_weight_entries).toEqual([{ date: day(3), kg: 71 }]);
    await settle(h);
    expect(h.db.rows('weight_entries')).toHaveLength(1);
  });

  it('a weight the database would refuse stops the check-in before anything is sent', async () => {
    const h = await open();
    await fireEvent.changeText(await screen.findByLabelText('Weight (kg)'), '900');
    await press('Complete check-in');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid weight.');
    expect(mockApi.weeklyAdjustment).not.toHaveBeenCalled();
    await settle(h);
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ last_adjustment_on: day(8) });
    expect(screen.getByRole('button', { name: 'Complete check-in' }).props.accessibilityState.busy).toBe(false);
  });

  it('counts only the days that are logged: a day marked incomplete is left out of the calories', async () => {
    await open();
    await fireEvent.press(await screen.findByTestId(`status-${day(2)}`));
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.weeklyAdjustment.mock.calls[0][0].week_calorie_days).toEqual([{ date: day(1), calories: 250 }]);
  });

  it('in pounds, the typed weight is converted', async () => {
    const h = seeded();
    h.db.seed('user_settings', [{ user_id: USER, theme: null, language: null, units_weight: 'lb', units_height: 'cm', units_distance: 'km', units_clock: '12h', hyrox_leaderboard_gender: null, hyrox_facility_lane_m: null, hyrox_history_backfilled: false, extra: {} }]);
    await open(h);
    await fireEvent.changeText(await screen.findByLabelText('Weight (lb)'), '155');
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    const sent = mockApi.weeklyAdjustment.mock.calls[0][0].week_weight_entries.find((e: { date: string }) => e.date === TODAY);
    expect(sent.kg).toBeCloseTo(70.3, 1);
  });
});

describe('when it goes wrong', () => {
  it('the server’s reason is shown, the week is not spent, and trying again works', async () => {
    mockApi.weeklyAdjustment.mockRejectedValueOnce(new ApiError('Please choose an activity level.', 400));
    const h = await open();
    await press('Complete check-in');
    expect(await screen.findByRole('alert')).toHaveTextContent('Please choose an activity level.');
    expect(screen.queryByText('Check-in complete')).toBeNull();
    await settle(h);
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ last_adjustment_on: day(8) });
    expect(h.db.rows('activity_days')).toEqual([]);

    await press('Complete check-in');
    expect(await screen.findByText('Check-in complete')).toBeOnTheScreen();
    expect(mockApi.weeklyAdjustment).toHaveBeenCalledTimes(2);
  });

  it.each([[new ApiError('Boom', 500)], [new ApiError('offline', 0)], [new Error('x')]])('anything else is the general line: %s', async (failure) => {
    mockApi.weeklyAdjustment.mockRejectedValueOnce(failure);
    await open();
    await press('Complete check-in');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong completing your check-in. Please try again.');
  });
});

describe('progress photos', () => {
  it('are uploaded with their angle and the day, and their ids go with the check-in', async () => {
    await open();
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Take a photo' }))[0]); // the front
    expect(mockPhotos.takePhoto).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Front')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Choose from library' })); // only the back still has its buttons
    expect(mockPhotos.choosePhoto).toHaveBeenCalledTimes(1);
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.uploadCheckinPhoto).toHaveBeenCalledTimes(2);
    expect(mockApi.uploadCheckinPhoto).toHaveBeenCalledWith(PHOTO.image, 'front', TODAY);
    expect(mockApi.uploadCheckinPhoto).toHaveBeenCalledWith(PHOTO.image, 'back', TODAY);
    expect(mockApi.weeklyAdjustment.mock.calls[0][0].photo_ids).toEqual([11, 12]);
  });

  it('a photo that could not be kept does not stop the check-in', async () => {
    mockApi.uploadCheckinPhoto.mockImplementation(async (_image: unknown, angle: string) => (angle === 'front' ? null : 12));
    await open();
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Take a photo' }))[0]);
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Take a photo' }))[0]);
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.weeklyAdjustment.mock.calls[0][0].photo_ids).toEqual([12]);
  });

  it('no photo, no upload', async () => {
    await open();
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.uploadCheckinPhoto).not.toHaveBeenCalled();
  });

  it('one that is removed is not sent', async () => {
    await open();
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Take a photo' }))[0]);
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove' }));
    await press('Complete check-in');
    await screen.findByText('Check-in complete');
    expect(mockApi.uploadCheckinPhoto).not.toHaveBeenCalled();
  });

  it('a camera that is off says so; cancelling says nothing', async () => {
    mockPhotos.takePhoto.mockResolvedValueOnce({ kind: 'denied' }).mockResolvedValueOnce({ kind: 'cancelled' });
    await open();
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Take a photo' }))[0]);
    expect(await screen.findByText(/Couldn't open the camera/)).toBeOnTheScreen();
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Take a photo' }))[0]);
    expect(screen.queryByText(/Couldn't open the camera/)).toBeNull();
  });

  it('a camera that throws is the same as one that is off', async () => {
    mockPhotos.takePhoto.mockRejectedValueOnce(new Error('no camera'));
    await open();
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Take a photo' }))[1]);
    expect(await screen.findByText(/Couldn't open the camera/)).toBeOnTheScreen();
  });
});

describe('reaching the goal', () => {
  const reached = () => seeded({ profile: { last_adjustment_on: day(1) }, weights: [weightRow(2, 63), weightRow(0, 61.8)] });

  it('is celebrated, with no adjustment asked for and no photo sent', async () => {
    const h = await open(reached());
    await fireEvent.press((await screen.findAllByRole('button', { name: 'Take a photo' }))[0]);
    await press('Complete check-in');
    expect(await screen.findByText('You reached your goal! 🎉')).toBeOnTheScreen();
    expect(screen.getByText("You've hit your target weight of 62 kg. Let's set what's next.")).toBeOnTheScreen();
    expect(mockApi.weeklyAdjustment).not.toHaveBeenCalled();
    expect(mockApi.uploadCheckinPhoto).not.toHaveBeenCalled();
    await settle(h);
    expect(h.db.rows('coaching_profiles')[0]).toMatchObject({ last_adjustment_on: TODAY, goal_handled_weight_kg: 62, goal_handled_aspiration: 'lose' });
    expect(h.db.rows('nutrition_goals')[0]).toMatchObject({ protein: 140, fat: 60, carbs: 190 });
    expect(h.db.rows('activity_days')).toEqual([expect.objectContaining({ action: 'checkin' })]);
  });

  it('the weight typed now counts', async () => {
    await open(seeded({ profile: { last_adjustment_on: day(9) }, weights: [weightRow(2, 63)] }));
    await fireEvent.changeText(await screen.findByLabelText('Weight (kg)'), '61.9');
    await press('Complete check-in');
    expect(await screen.findByText('You reached your goal! 🎉')).toBeOnTheScreen();
  });

  it('"Set new goals" goes to the questions; Done just leaves', async () => {
    await open(reached());
    await press('Complete check-in');
    await press('Set new goals');
    expect(mockRouter.replace).toHaveBeenCalledWith('/coaching-wizard');
    await press('Done');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
