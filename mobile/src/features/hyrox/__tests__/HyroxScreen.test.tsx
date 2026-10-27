import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { STATIONS } from '@/logic/hyrox';
import { USER, dataHarness } from '@/testing/dataHarness';

import HyroxScreen from '../HyroxScreen';

const mockApi = { submitHyroxResult: jest.fn() };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));

const profileRow = (gender: string) => ({
  user_id: USER, aspiration: 'lose', gender, weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
  goal_weight_kg: 62, height_cm: 165, distribution_mode: 'stable', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: '2026-01-05', last_adjustment_on: '2026-10-20',
  last_adjustment_reason: null, last_adjustment_delta: null, last_adjustment_at: null, weekly_distribution: null, goal_achieved_weight_kg: null, goal_achieved_aspiration: null,
  goal_handled_weight_kg: null, goal_handled_aspiration: null, inactivity_notified_on: null, extra: {},
});
const raceRow = (id: string, total: number, over: Record<string, unknown> = {}) => ({
  user_id: USER, id, raced_at: '2026-10-20T08:00:00.000Z', category: 'open', format: 'singles', gender: 'men', scale: 'full', total_seconds: total, flagged: false, is_new_pb: false, analysis: null, extra: {}, ...over,
});
const splitRows = (id: string) => [
  { user_id: USER, race_id: id, position: 0, key: 'run1', title: '1km Run', at_seconds: 300, extra: {} },
  { user_id: USER, race_id: id, position: 1, key: 'skierg', title: 'SkiErg', at_seconds: 540, extra: {} },
  { user_id: USER, race_id: id, position: 2, key: 'run2', title: '1km Run', at_seconds: 860, extra: {} },
];

type Harness = ReturnType<typeof dataHarness>;

async function open(h: Harness = dataHarness()) {
  await render(
    <h.Provider>
      <HyroxScreen />
    </h.Provider>,
  );
  return h;
}
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const settle = async (h: Harness) => {
  await act(async () => {
    await h.flush();
  });
};
const tick = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

/** Sets up an Open Singles race for a man and starts it. */
async function startOpenSingles(extra: (() => Promise<void>) | null = null) {
  await press('Start race');
  await press('Open');
  await press('Singles');
  if (extra) await extra();
  await press('Start race');
}
/** Finishes the whole race, each segment taking `seconds`. */
async function runAll(seconds: number) {
  for (let i = 0; i < STATIONS.length; i += 1) {
    await tick(seconds * 1000);
    await press(i === STATIONS.length - 1 ? 'Finish race' : 'Complete');
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-27T08:00:00.000Z'));
  jest.clearAllMocks();
  mockApi.submitHyroxResult.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the first screen', () => {
  it('invites the first race, with the trademark note', async () => {
    await open();
    expect(await screen.findByTestId('hero-title')).toHaveTextContent('Your first race awaits');
    expect(screen.getByTestId('trademark')).toHaveTextContent(/not affiliated with, endorsed or sponsored by HYROX/);
    expect(screen.queryByTestId('race-count')).toBeNull();
  });

  it('with races, shows the fastest time, its combo, and how many races', async () => {
    const h = dataHarness();
    h.db.seed('hyrox_races', [raceRow('a', 4200), raceRow('b', 3900, { raced_at: '2026-10-22T08:00:00.000Z' })]);
    await open(h);
    expect(await screen.findByTestId('hero-time')).toHaveTextContent('1:05:00');
    expect(screen.getByTestId('hero-sub')).toHaveTextContent('Your fastest race · Men Open Singles');
    expect(screen.getByTestId('race-count')).toHaveTextContent('🏁 2 races');
  });

  it('one race is singular', async () => {
    const h = dataHarness();
    h.db.seed('hyrox_races', [raceRow('a', 4200)]);
    await open(h);
    expect(await screen.findByTestId('race-count')).toHaveTextContent('🏁 1 race');
    expect(screen.getByTestId('race-count')).not.toHaveTextContent(/races/);
  });

  it('races that cannot be a best say so', async () => {
    const h = dataHarness();
    h.db.seed('hyrox_races', [raceRow('a', 2000, { flagged: true })]);
    await open(h);
    expect(await screen.findByTestId('hero-title')).toHaveTextContent('No ranked time yet');
  });

  it('waits while the races load', async () => {
    const h = dataHarness();
    jest.spyOn(h.data.fetch, 'hyroxRaces').mockReturnValue(new Promise(() => undefined));
    await open(h);
    expect(screen.queryByRole('button', { name: 'Start race' })).toBeNull();
  });
});

describe('setting up a race', () => {
  it('cannot start until the category and format are chosen', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    expect(screen.getByRole('button', { name: 'Start race' }).props.accessibilityState.disabled).toBe(true);
    await press('Open');
    expect(screen.getByRole('button', { name: 'Start race' }).props.accessibilityState.disabled).toBe(true);
    await press('Singles');
    expect(screen.getByRole('button', { name: 'Start race' }).props.accessibilityState.disabled).toBeFalsy();
  });

  it('Back returns to the first screen', async () => {
    await open();
    await press('Start race');
    await press('Back');
    expect(await screen.findByTestId('hero-title')).toBeOnTheScreen();
  });

  it('with no gender on a profile, asks for one; a profile with one is not asked', async () => {
    await open();
    await press('Start race');
    await press('Open');
    await press('Singles');
    expect(screen.getByRole('button', { name: 'Women' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Start race' }).props.accessibilityState.disabled).toBe(true);
    await press('Women');
    expect(screen.getByRole('button', { name: 'Start race' }).props.accessibilityState.disabled).toBeFalsy();
  });

  it('a profile’s gender sets the standard and is not asked', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('female')]);
    await open(h);
    await press('Start race');
    await press('Pro');
    await press('Singles');
    expect(screen.queryByRole('button', { name: 'Women' })).toBeNull();
    // the women's Pro sled push: 152 kg
    expect(within(screen.getByTestId('agenda-sledPush')).getByText(/152 kg weight · 4 laps/)).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-wallBalls')).getByText('75 Reps')).toBeOnTheScreen();
  });

  it('Half is offered for Singles only, and switching to Doubles drops it', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    await press('Open');
    expect(screen.queryByRole('button', { name: 'Half' })).toBeNull();
    await press('Singles');
    await press('Half');
    expect(screen.getByRole('button', { name: 'Half' }).props.accessibilityState.selected).toBe(true);
    expect(within(screen.getByTestId('agenda-skierg')).getByText('500m Distance')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-wallBalls')).getByText('50 Reps')).toBeOnTheScreen();
    await press('Doubles');
    expect(screen.queryByRole('button', { name: 'Half' })).toBeNull();
    expect(within(screen.getByTestId('agenda-skierg')).getByText('1000m Distance')).toBeOnTheScreen();
  });

  it('marks what is chosen', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    expect(screen.getByRole('button', { name: 'Open' }).props.accessibilityState.selected).toBe(false);
    await press('Open');
    await press('Doubles');
    expect(screen.getByRole('button', { name: 'Open' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Pro' }).props.accessibilityState.selected).toBe(false);
    expect(screen.getByRole('button', { name: 'Doubles' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Singles' }).props.accessibilityState.selected).toBe(false);
  });

  it('the gender question marks the answer', async () => {
    await open();
    await press('Start race');
    await press('Open');
    await press('Singles');
    expect(screen.getByRole('button', { name: 'Men' }).props.accessibilityState.selected).toBe(false);
    await press('Men');
    expect(screen.getByRole('button', { name: 'Men' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Women' }).props.accessibilityState.selected).toBe(false);
  });

  it('numbers the segments of the race', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    await press('Open');
    await press('Singles');
    expect(within(screen.getByTestId('agenda-run1')).getByText('1')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-skierg')).getByText('2')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-wallBalls')).getByText('16')).toBeOnTheScreen();
  });

  it('shows the whole race in order, with what each station asks', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    await press('Open');
    await press('Singles');
    expect(screen.getByTestId('agenda-summary')).toHaveTextContent('8km · total running · 8 × 1km · 8 stations');
    expect(within(screen.getByTestId('agenda-run1')).getByText('1km Run')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-sledPush')).getByText('152 kg weight · 4 laps')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-farmersCarry')).getByText('24 kg weight · 16 laps')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-burpeeBroadJump')).getByText('7 laps')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-row')).getByText('1000m Distance')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-wallBalls')).getByText('6 kg · 9ft Target')).toBeOnTheScreen();
  });

  it('weights and distances follow the person’s units', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    h.db.seed('user_settings', [{ user_id: USER, theme: null, language: null, units_weight: 'lb', units_height: 'cm', units_distance: 'm', units_clock: '12h', hyrox_leaderboard_gender: null, hyrox_facility_lane_m: null, hyrox_history_backfilled: false, extra: {} }]);
    await open(h);
    await press('Start race');
    await press('Open');
    await press('Singles');
    expect(within(screen.getByTestId('agenda-sledPush')).getByText(/335\.1 lb weight/)).toBeOnTheScreen();
    expect(within(screen.getByTestId('agenda-run1')).getByText('1000m Run')).toBeOnTheScreen();
  });

  it('the lane length sets the laps, and is kept on the account', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    await press('Open');
    await press('Singles');
    expect(screen.getByLabelText('Your lane (m)').props.value).toBe('12.5');
    await fireEvent.changeText(screen.getByLabelText('Your lane (m)'), '10');
    await fireEvent(screen.getByLabelText('Your lane (m)'), 'endEditing', { nativeEvent: { text: '10' } });
    await waitFor(() => expect(within(screen.getByTestId('agenda-sledPush')).getByText('152 kg weight · 5 laps')).toBeOnTheScreen());
    await settle(h);
    expect(h.db.rows('user_settings')[0]).toMatchObject({ hyrox_facility_lane_m: 10 });
    await press('Reset to standard');
    await waitFor(() => expect(within(screen.getByTestId('agenda-sledPush')).getByText('152 kg weight · 4 laps')).toBeOnTheScreen());
    await settle(h);
    expect(h.db.rows('user_settings')[0].hyrox_facility_lane_m).toBeNull();
  });

  it('a lane that is not a number goes back to the standard', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    await press('Open');
    await press('Singles');
    await fireEvent(screen.getByLabelText('Your lane (m)'), 'endEditing', { nativeEvent: { text: 'abc' } });
    await settle(h);
    expect(h.db.rows('user_settings')[0].hyrox_facility_lane_m).toBeNull();
    expect(within(screen.getByTestId('agenda-sledPush')).getByText('152 kg weight · 4 laps')).toBeOnTheScreen();
  });

  it('your best for this combo is shown before you start', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    h.db.seed('hyrox_races', [raceRow('a', 4200), raceRow('b', 3900), raceRow('c', 3000, { category: 'pro' })]);
    await open(h);
    await press('Start race');
    await press('Open');
    await press('Singles');
    expect(await screen.findByTestId('setup-pb')).toHaveTextContent('1:05:00');
  });
});

describe('the race', () => {
  const male = () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    return h;
  };

  it('starts at the first run, with the clock going', async () => {
    await open(male());
    await startOpenSingles();
    expect(await screen.findByTestId('now-title')).toHaveTextContent('1km Run');
    expect(screen.getByTestId('count')).toHaveTextContent('1/16');
    expect(screen.getByTestId('timer')).toHaveTextContent('0:00');
    await tick(65_000);
    expect(screen.getByTestId('timer')).toHaveTextContent('1:05');
  });

  it('each tap records the segment and moves on, with the time it took', async () => {
    await open(male());
    await startOpenSingles();
    await tick(300_000);
    await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('SkiErg');
    expect(screen.getByTestId('count')).toHaveTextContent('2/16');
    expect(screen.getByTestId('now-distance')).toHaveTextContent('1000m');
    await tick(240_000);
    await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('1km Run');
    const first = screen.getByTestId('done-0');
    expect(within(first).getByText('05:00')).toBeOnTheScreen();
    const second = screen.getByTestId('done-1');
    expect(within(second).getByText('04:00')).toBeOnTheScreen();
    expect(within(second).getByText('9:00')).toBeOnTheScreen();
    expect(screen.getByText('Completed · 2')).toBeOnTheScreen();
  });

  it('the sled shows the laps and the load; Doubles shows your share', async () => {
    await open(male());
    await startOpenSingles();
    await tick(1000);
    await press('Complete');
    await press('Complete');
    await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('Sled Push');
    expect(screen.getByTestId('now-rounds')).toHaveTextContent('4');
    expect(screen.getByTestId('now-weight')).toHaveTextContent('152 kg sled');
    expect(screen.getByText('Rounds')).toBeOnTheScreen();
  });

  it('in Doubles you see your share of the rounds', async () => {
    await open(male());
    await press('Start race');
    await press('Open');
    await press('Doubles');
    await press('Start race');
    expect(screen.getByText(/Doubles/)).toBeOnTheScreen();
    await press('Complete');
    await press('Complete');
    await press('Complete');
    expect(screen.getByTestId('now-rounds')).toHaveTextContent('2');
    expect(screen.getByText('Your share')).toBeOnTheScreen();
  });

  it('each loaded station names its load: the sled, each hand, the sandbag', async () => {
    await open(male());
    await startOpenSingles();
    for (let i = 0; i < 5; i += 1) await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('Sled Pull');
    expect(screen.getByTestId('now-weight')).toHaveTextContent('103 kg sled');
    for (let i = 0; i < 6; i += 1) await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('Farmers Carry');
    expect(screen.getByTestId('now-weight')).toHaveTextContent('24 kg each hand');
    expect(screen.getByTestId('now-rounds')).toHaveTextContent('16');
    await press('Complete');
    await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('Sandbag Lunges');
    expect(screen.getByTestId('now-weight')).toHaveTextContent('20 kg sandbag');
    expect(screen.getByTestId('now-rounds')).toHaveTextContent('8');
  });

  it('wall balls show the reps, the ball and the target', async () => {
    await open(male());
    await startOpenSingles();
    for (let i = 0; i < 15; i += 1) await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('Wall Balls');
    expect(screen.getByTestId('now-reps')).toHaveTextContent('100');
    expect(screen.getByTestId('now-ball')).toHaveTextContent('6 kg');
    expect(screen.getByTestId('now-target')).toHaveTextContent('9ft');
    expect(screen.getByRole('button', { name: 'Finish race' })).toBeOnTheScreen();
  });

  it('cancelling asks first; keeping going changes nothing, confirming goes back to the start and saves nothing', async () => {
    const h = male();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open(h);
    await startOpenSingles();
    await press('Complete');
    await press('Cancel this race');
    const buttons = alert.mock.calls[0][2] ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Cancel race']);
    expect(screen.getByTestId('now-title')).toHaveTextContent('SkiErg');
    await act(async () => buttons[1].onPress?.());
    expect(await screen.findByTestId('hero-title')).toBeOnTheScreen();
    await settle(h);
    expect(h.db.rows('hyrox_races')).toEqual([]);
  });

  it('the clock is the time since the start, so it is right after the app was away', async () => {
    await open(male());
    await startOpenSingles();
    await tick(125_000);
    expect(screen.getByTestId('timer')).toHaveTextContent('2:05');
  });
});

describe('finishing', () => {
  const male = () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    return h;
  };

  it('shows the time and where it went, saves the race and its splits, and puts the time on the board', async () => {
    const h = male();
    await open(h);
    await startOpenSingles();
    await runAll(300); // 16 segments of 5 minutes: 80:00
    expect(await screen.findByTestId('finish-time')).toHaveTextContent('1:20:00');
    expect(screen.getByTestId('finish-combo')).toHaveTextContent('Men Open Singles');
    expect(screen.getByTestId('finish-banner')).toHaveTextContent('🏆 New personal best for Men Open Singles — saved to your history.');
    expect(screen.getByTestId('total-running')).toHaveTextContent('40:00');
    expect(screen.getByTestId('total-stations')).toHaveTextContent('40:00');
    expect(screen.getByTestId('segment-0')).toHaveTextContent(/1km Run/);
    expect(screen.getByTestId('segment-15')).toHaveTextContent(/Wall Balls/);
    await settle(h);
    expect(h.db.rows('hyrox_races')).toEqual([expect.objectContaining({ user_id: USER, category: 'open', format: 'singles', gender: 'men', scale: 'full', total_seconds: 4800, flagged: false, is_new_pb: true })]);
    const splits = h.db.rows('hyrox_race_splits');
    expect(splits).toHaveLength(16);
    expect(splits[15]).toMatchObject({ position: 15, key: 'wallBalls', title: 'Wall Balls', at_seconds: 4800 });
    expect(mockApi.submitHyroxResult).toHaveBeenCalledWith({ gender: 'men', category: 'open', format: 'singles', total_seconds: 4800 });
    expect(h.db.rows('user_settings')[0]).toMatchObject({ hyrox_leaderboard_gender: 'men' });
  });

  it('a slower race than your best is just saved', async () => {
    const h = male();
    h.db.seed('hyrox_races', [raceRow('old', 4000)]);
    await open(h);
    await screen.findByTestId('hero-time');
    await startOpenSingles();
    await runAll(300);
    expect(await screen.findByTestId('finish-banner')).toHaveTextContent('Saved to your history.');
  });

  it('a time nobody could do is saved but flagged, and is not sent to the board', async () => {
    const h = male();
    await open(h);
    await startOpenSingles();
    await runAll(60); // 16 minutes
    expect(await screen.findByTestId('finish-banner')).toHaveTextContent(/faster than the fastest realistic Men Open Singles finish on record/);
    expect(screen.getByTestId('finish-banner')).not.toHaveTextContent('<strong>');
    await settle(h);
    expect(h.db.rows('hyrox_races')[0]).toMatchObject({ flagged: true, is_new_pb: false });
    expect(mockApi.submitHyroxResult).not.toHaveBeenCalled();
  });

  it('a Half race is saved but does not go on the board', async () => {
    const h = male();
    await open(h);
    await startOpenSingles(async () => press('Half'));
    await runAll(300);
    await screen.findByTestId('finish-time');
    await settle(h);
    expect(h.db.rows('hyrox_races')[0]).toMatchObject({ scale: 'half' });
    expect(mockApi.submitHyroxResult).not.toHaveBeenCalled();
  });

  it('a board that cannot be reached does not matter: the race is saved', async () => {
    mockApi.submitHyroxResult.mockResolvedValue(false);
    const h = male();
    await open(h);
    await startOpenSingles();
    await runAll(300);
    await screen.findByTestId('finish-time');
    await settle(h);
    expect(h.db.rows('hyrox_races')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a race that cannot be saved says so', async () => {
    const h = male();
    await open(h);
    jest.spyOn(h.outbox, 'replace').mockRejectedValue(new Error('full'));
    await startOpenSingles();
    await runAll(300);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that race to your account — check your connection and try again.");
  });

  it('Log another race starts again; Personal bests opens the history', async () => {
    const h = male();
    await open(h);
    await startOpenSingles();
    await runAll(300);
    await press('Log another race');
    expect(await screen.findByTestId('hero-time')).toHaveTextContent('1:20:00');
    await press('Start race');
    await press('Open');
    await press('Singles');
    await press('Start race');
    await runAll(310);
    await press('Personal bests');
    expect(await screen.findByTestId('pb-row-1')).toHaveTextContent(/1:20:00/);
    expect(screen.getByTestId('pb-row-2')).toHaveTextContent(/1:22:40/);
    expect(screen.getByTestId('pb-row-2')).toHaveTextContent(/\+02:40/);
  });
});

describe('the history', () => {
  const withRaces = () => {
    const h = dataHarness();
    h.db.seed('hyrox_races', [
      raceRow('a', 4200),
      raceRow('b', 3900, { raced_at: '2026-10-22T08:00:00.000Z' }),
      raceRow('c', 3500, { flagged: true, raced_at: '2026-10-23T08:00:00.000Z' }),
      raceRow('d', 5000, { category: 'pro', raced_at: '2026-10-24T08:00:00.000Z' }),
    ]);
    h.db.seed('hyrox_race_splits', [...splitRows('a'), ...splitRows('b')]);
    return h;
  };
  const openHistory = async (h: Harness) => {
    await open(h);
    await press('Personal bests');
  };

  it('with no races: the empty states', async () => {
    await open();
    await press('Personal bests');
    expect(await screen.findByTestId('pb-empty')).toHaveTextContent('No personal bests yet');
    expect(screen.getByText('Nothing here yet.')).toBeOnTheScreen();
  });

  it('ranks your times for the combo with most races, fastest first, with the gap to the best', async () => {
    await openHistory(withRaces());
    expect(await screen.findByTestId('pb-row-1')).toHaveTextContent(/1:05:00/);
    expect(screen.getByTestId('pb-row-1')).toHaveTextContent(/PB/);
    expect(screen.getByTestId('pb-row-2')).toHaveTextContent(/1:10:00/);
    expect(screen.getByTestId('pb-row-2')).toHaveTextContent(/\+05:00/);
  });

  it('the first three are numbered with a #, the rest are not', async () => {
    const h = dataHarness();
    h.db.seed('hyrox_races', Array.from({ length: 4 }, (_, i) => raceRow(`r${i}`, 4000 + i * 100, { raced_at: `2026-10-0${i + 1}T08:00:00.000Z` })));
    await openHistory(h);
    expect(await screen.findByTestId('pb-row-3')).toHaveTextContent(/^#3/);
    expect(screen.getByTestId('pb-row-4')).toHaveTextContent(/^4/);
    expect(screen.getByTestId('pb-row-4')).not.toHaveTextContent(/^#/);
  });

  it('exactly five on a board is all of them: no "top five" line', async () => {
    const h = dataHarness();
    h.db.seed('hyrox_races', Array.from({ length: 5 }, (_, i) => raceRow(`r${i}`, 4000 + i * 100, { raced_at: `2026-10-0${i + 1}T08:00:00.000Z` })));
    await openHistory(h);
    await screen.findByTestId('pb-row-5');
    expect(screen.queryByTestId('pb-foot')).toBeNull();
  });

  it('the chosen combo’s tab is marked', async () => {
    await openHistory(withRaces());
    expect(await screen.findByRole('button', { name: 'Men Open Singles' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Men Open Singles' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Men Pro Singles' }).props.accessibilityState.selected).toBe(false);
    await press('Men Pro Singles');
    expect(screen.getByRole('button', { name: 'Men Pro Singles' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Men Open Singles' }).props.accessibilityState.selected).toBe(false);
  });

  it('another combo is a tap away; a flagged race is on no board', async () => {
    await openHistory(withRaces());
    await press('Men Pro Singles');
    expect(await screen.findByTestId('pb-row-1')).toHaveTextContent(/1:23:20/);
    expect(screen.queryByTestId('pb-row-2')).toBeNull();
    await press('Men Open Singles');
    expect(screen.getByTestId('pb-row-2')).toBeOnTheScreen();
    expect(screen.queryByTestId('pb-row-3')).toBeNull(); // the flagged 3500 s is in the list below, but on no board
  });

  it('a single combo is named, not tabbed', async () => {
    const h = dataHarness();
    h.db.seed('hyrox_races', [raceRow('a', 4200)]);
    await openHistory(h);
    expect(await screen.findByTestId('pb-solo')).toHaveTextContent('Men Open Singles');
  });

  it('lists every race, newest first, with flagged ones marked', async () => {
    await openHistory(withRaces());
    const row = await screen.findByTestId('history-c');
    expect(within(row).getByText(/Not counted/)).toBeOnTheScreen();
    expect(within(screen.getByTestId('history-a')).queryByText(/Not counted/)).toBeNull();
  });

  it('only five of a combo are on its board, and it says so', async () => {
    const h = dataHarness();
    h.db.seed('hyrox_races', Array.from({ length: 7 }, (_, i) => raceRow(`r${i}`, 4000 + i * 100, { raced_at: `2026-10-0${i + 1}T08:00:00.000Z` })));
    await openHistory(h);
    expect(await screen.findByTestId('pb-row-5')).toBeOnTheScreen();
    expect(screen.queryByTestId('pb-row-6')).toBeNull();
    expect(screen.getByTestId('pb-foot')).toHaveTextContent('Top 5 of your 7 races in this category');
  });

  it('a race opens to where its time went', async () => {
    await openHistory(withRaces());
    await fireEvent.press(await screen.findByTestId('pb-row-1'));
    expect(await screen.findByTestId('detail-meta')).toHaveTextContent('Men Open Singles · Oct 22, 2026');
    expect(screen.getByTestId('total-running')).toBeOnTheScreen();
    expect(screen.getByTestId('segment-1')).toHaveTextContent(/SkiErg/);
    await press('Close');
    expect(screen.queryByTestId('detail-meta')).toBeNull();
  });

  it('removing asks first; confirming takes it away from the list and the server', async () => {
    const h = withRaces();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await openHistory(h);
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove: 1:10:00' }));
    const buttons = alert.mock.calls[0][2] ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Remove']);
    expect(screen.getByTestId('history-b')).toBeOnTheScreen();
    await act(async () => buttons[1].onPress?.());
    await waitFor(() => expect(screen.queryByTestId('history-a')).toBeNull());
    await settle(h);
    expect(h.db.rows('hyrox_races').map((r) => r.id).sort()).toEqual(['b', 'c', 'd']);
  });

  it('a removal that fails says so', async () => {
    const h = withRaces();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await openHistory(h);
    jest.spyOn(h.outbox, 'replace').mockRejectedValue(new Error('full'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove: 1:10:00' }));
    await act(async () => (alert.mock.calls[0][2] ?? [])[1].onPress?.());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't remove that race — check your connection and try again.");
  });

  it('Back to setup returns to the first screen', async () => {
    await openHistory(withRaces());
    await press('Back to setup');
    expect(await screen.findByTestId('hero-time')).toBeOnTheScreen();
  });
});
