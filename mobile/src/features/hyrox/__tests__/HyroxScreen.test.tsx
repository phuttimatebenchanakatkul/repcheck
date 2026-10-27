import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Alert } from 'react-native';

import { ApiError } from '@/api/client';

import { STATIONS } from '@/logic/hyrox';
import { USER, dataHarness } from '@/testing/dataHarness';

import HyroxScreen from '../HyroxScreen';

const mockApi = { submitHyroxResult: jest.fn(), hyroxLeaderboard: jest.fn(), analyzeHyroxRace: jest.fn(), setAiConsent: jest.fn(), blockAccount: jest.fn(), reportAccount: jest.fn() };
const mockAuth = { consented: false, refresh: jest.fn(async () => undefined) };

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));
jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'ready', profile: { id: 'user-1', ai_consent: mockAuth.consented } }, refreshProfile: mockAuth.refresh }),
}));

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

const BOARD = {
  rows: [
    { userId: 'u-1', name: 'Ann', bestSeconds: 3700 },
    { userId: 'u-2', name: 'Me', bestSeconds: 4100 },
    { userId: 'u-3', name: 'Cy', bestSeconds: 4500 },
  ],
  total: 3,
  mine: { rank: 2, bestSeconds: 4100, name: 'Me' },
};
const ANALYSIS = {
  overall: 'Strong runs, slow sleds.',
  overallDetail: ['Your runs stayed even.', 'The sled push cost you two minutes.'],
  tips: [
    { key: 'sledPush', tip: 'Drive lower on the sled.', rating: 'focus' as const, detail: ['Keep your hips down.'] },
    { key: 'skierg', tip: 'Great pacing on the ski.', rating: 'strong' as const, detail: [] },
    { key: 'row', tip: 'Fine.', rating: 'solid' as const, detail: [] },
  ],
};

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
  mockAuth.consented = false;
  mockApi.hyroxLeaderboard.mockResolvedValue(BOARD);
  mockApi.analyzeHyroxRace.mockResolvedValue({ analysis: ANALYSIS, limited: false });
  mockApi.setAiConsent.mockResolvedValue(true);
  mockApi.blockAccount.mockResolvedValue(undefined);
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

describe('the leaderboard', () => {
  const male = () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    return h;
  };

  it('is on the first screen, for the profile’s gender, starting with Singles · Open', async () => {
    await open(male());
    expect(await screen.findByTestId('board-1')).toHaveTextContent(/Ann/);
    expect(mockApi.hyroxLeaderboard).toHaveBeenCalledWith('men', 'open', 'singles');
    expect(screen.getByRole('button', { name: 'Men' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Singles · Open' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('board-total')).toHaveTextContent('3 athletes worldwide');
  });

  it('marks you, with no way to report yourself, and offers it on everyone else', async () => {
    await open(male());
    const me = await screen.findByTestId('board-me');
    expect(me).toHaveTextContent(/Me\s+You/);
    expect(within(me).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'More options: Ann' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'More options: Cy' })).toBeOnTheScreen();
  });

  it('the other boards are a tap away', async () => {
    await open(male());
    await screen.findByTestId('board-1');
    await press('Doubles · Pro');
    await waitFor(() => expect(mockApi.hyroxLeaderboard).toHaveBeenCalledWith('men', 'pro', 'doubles'));
    expect(screen.getByRole('button', { name: 'Doubles · Pro' }).props.accessibilityState.selected).toBe(true);
    await press('Singles · Pro');
    await waitFor(() => expect(mockApi.hyroxLeaderboard).toHaveBeenCalledWith('men', 'pro', 'singles'));
    await press('Doubles · Open');
    await waitFor(() => expect(mockApi.hyroxLeaderboard).toHaveBeenCalledWith('men', 'open', 'doubles'));
  });

  it('switching to the other gender asks for that board and keeps the choice on the account', async () => {
    const h = male();
    await open(h);
    await screen.findByTestId('board-1');
    await press('Women');
    await waitFor(() => expect(mockApi.hyroxLeaderboard).toHaveBeenCalledWith('women', 'open', 'singles'));
    await settle(h);
    expect(h.db.rows('user_settings')[0]).toMatchObject({ hyrox_leaderboard_gender: 'women' });
  });

  it('a chosen gender wins over the profile’s', async () => {
    const h = male();
    h.db.seed('user_settings', [{ user_id: USER, theme: null, language: null, units_weight: 'kg', units_height: 'cm', units_distance: 'km', units_clock: '12h', hyrox_leaderboard_gender: 'women', hyrox_facility_lane_m: null, hyrox_history_backfilled: false, extra: {} }]);
    await open(h);
    await screen.findByTestId('board-1');
    expect(mockApi.hyroxLeaderboard).toHaveBeenCalledWith('women', 'open', 'singles');
    expect(mockApi.hyroxLeaderboard).not.toHaveBeenCalledWith('men', 'open', 'singles');
  });

  it('with no gender anywhere it asks which board is yours, once', async () => {
    const h = dataHarness();
    await open(h);
    expect(await screen.findByText('Which leaderboard is yours?')).toBeOnTheScreen();
    expect(mockApi.hyroxLeaderboard).not.toHaveBeenCalled();
    await press('Women');
    await waitFor(() => expect(mockApi.hyroxLeaderboard).toHaveBeenCalledWith('women', 'open', 'singles'));
    await settle(h);
    expect(h.db.rows('user_settings')[0]).toMatchObject({ hyrox_leaderboard_gender: 'women' });
  });

  it('you outside the top rows are shown below them', async () => {
    mockApi.hyroxLeaderboard.mockResolvedValue({ ...BOARD, total: 300, mine: { rank: 120, bestSeconds: 5400, name: 'Me' } });
    await open(male());
    expect(await screen.findByTestId('board-me')).toHaveTextContent(/Me\s+You/);
    expect(within(screen.getByTestId('board-me')).getByText('120')).toBeOnTheScreen();
    expect(within(screen.getByTestId('board-me')).getByText('1:30:00')).toBeOnTheScreen();
  });

  it('you at the very end of the listed rows are shown once, not twice', async () => {
    mockApi.hyroxLeaderboard.mockResolvedValue({ ...BOARD, mine: { rank: 3, bestSeconds: 4500, name: 'Me' } });
    await open(male());
    await screen.findByTestId('board-1');
    expect(screen.getAllByTestId('board-me')).toHaveLength(1);
  });

  it('when you have not raced it, says so', async () => {
    mockApi.hyroxLeaderboard.mockResolvedValue({ ...BOARD, mine: null });
    await open(male());
    expect(await screen.findByTestId('board-not-competed')).toHaveTextContent("You haven't completed this race yet — finish one to see your global rank.");
  });

  it('an empty board is an invitation', async () => {
    mockApi.hyroxLeaderboard.mockResolvedValue({ rows: [], total: 0, mine: null });
    await open(male());
    expect(await screen.findByText('No times yet')).toBeOnTheScreen();
    expect(screen.getByText('Be the first to set one.')).toBeOnTheScreen();
  });

  it('one athlete is singular', async () => {
    mockApi.hyroxLeaderboard.mockResolvedValue({ rows: [BOARD.rows[0]], total: 1, mine: null });
    await open(male());
    expect(await screen.findByTestId('board-total')).toHaveTextContent('1 athlete worldwide');
  });

  it('a board that cannot be read offers to try again', async () => {
    mockApi.hyroxLeaderboard.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValue(BOARD);
    await open(male());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the leaderboard. Try again.");
    await press('Try again');
    expect(await screen.findByTestId('board-1')).toBeOnTheScreen();
  });

  it('blocking a name takes it off the board', async () => {
    await open(male());
    await fireEvent.press(await screen.findByRole('button', { name: 'More options: Ann' }));
    mockApi.hyroxLeaderboard.mockResolvedValue({ ...BOARD, rows: BOARD.rows.slice(1), total: 2, mine: { ...BOARD.mine, rank: 1 } });
    await press('Block this account');
    expect(mockApi.blockAccount).toHaveBeenCalledWith('u-1');
    await press('Done');
    await waitFor(() => expect(screen.queryByText('Ann')).toBeNull());
    expect(screen.getByTestId('board-me')).toBeOnTheScreen();
  });

  it('after a race, the leaderboard button opens it with a way back', async () => {
    const h = male();
    await open(h);
    await startOpenSingles();
    await runAll(300);
    await press('Leaderboard');
    expect(await screen.findByTestId('board-1')).toBeOnTheScreen();
    await press('Back to setup');
    expect(await screen.findByTestId('hero-time')).toBeOnTheScreen();
  });
});

describe('the AI’s read of a race', () => {
  const male = () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    return h;
  };
  const finishRace = async (h: Harness) => {
    await open(h);
    await startOpenSingles();
    await runAll(300);
    await screen.findByTestId('finish-time');
  };

  it('with the AI switch on, is read at once and kept on the race', async () => {
    mockAuth.consented = true;
    const h = male();
    await finishRace(h);
    expect(await screen.findByTestId('analysis-overall')).toHaveTextContent('Strong runs, slow sleds.');
    expect(mockApi.analyzeHyroxRace).toHaveBeenCalledTimes(1);
    const sent = mockApi.analyzeHyroxRace.mock.calls[0][0];
    expect(sent).toMatchObject({ category: 'open', format: 'singles', gender: 'men', totalSeconds: 4800 });
    expect(screen.getByTestId('group-focus')).toHaveTextContent(/Where to gain time/);
    expect(screen.getByTestId('tip-sledPush')).toHaveTextContent(/Sled Push/);
    expect(screen.getByTestId('group-strong')).toHaveTextContent(/Your strengths/);
    expect(screen.getByTestId('group-solid')).toHaveTextContent(/Already solid/);
    await settle(h);
    expect(h.db.rows('hyrox_races')[0].analysis).toEqual({ overall: 'Strong runs, slow sleds.', overallDetail: ANALYSIS.overallDetail, tips: ANALYSIS.tips });
  });

  it('"Read more" opens the fuller bullets, and "Show less" closes them', async () => {
    mockAuth.consented = true;
    await finishRace(male());
    await screen.findByTestId('analysis-overall');
    expect(screen.queryByText('• Your runs stayed even.')).toBeNull();
    expect(screen.queryByText('• Keep your hips down.')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Read more (overall)' }));
    expect(screen.getByText('• Your runs stayed even.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Show less (overall)' }));
    expect(screen.queryByText('• Your runs stayed even.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Read more (strong)' })).toBeNull(); // nothing more to say there
    await fireEvent.press(screen.getByRole('button', { name: 'Read more (focus)' }));
    expect(screen.getByText('• Keep your hips down.')).toBeOnTheScreen();
  });

  it('the bars of the breakdown are tinted by the read: amber to gain, green strong', async () => {
    mockAuth.consented = true;
    await finishRace(male());
    await screen.findByTestId('analysis-overall');
    const colourOf = (id: string) => {
      const style = screen.getByTestId(id).props.style;
      return (Array.isArray(style) ? Object.assign({}, ...style) : style).backgroundColor;
    };
    const focus = colourOf('bar-3'); // Sled Push
    const strong = colourOf('bar-1'); // SkiErg
    const plain = colourOf('bar-5'); // Sled Pull: not rated
    expect([focus, strong, plain]).toEqual(['#b9832a', '#1fa971', '#2f66e8']); // amber to gain, green strong, the plain station colour
  });

  it('without consent nothing is sent: a button offers it, and asks first', async () => {
    mockAuth.consented = false;
    const h = male();
    await finishRace(h);
    expect(mockApi.analyzeHyroxRace).not.toHaveBeenCalled();
    await press('Analyze my race with AI');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    expect(mockApi.analyzeHyroxRace).not.toHaveBeenCalled();
    await press('Allow');
    expect(mockApi.setAiConsent).toHaveBeenCalledWith(true);
    expect(await screen.findByTestId('analysis-overall')).toBeOnTheScreen();
  });

  it('declining the question goes back to the button', async () => {
    await finishRace(male());
    await press('Analyze my race with AI');
    await press('Not now');
    expect(await screen.findByRole('button', { name: 'Analyze my race with AI' })).toBeOnTheScreen();
    expect(mockApi.analyzeHyroxRace).not.toHaveBeenCalled();
  });

  it('a switch that was on but is off at the server asks the question, then reads', async () => {
    mockAuth.consented = true;
    mockApi.analyzeHyroxRace.mockRejectedValueOnce(new ApiError('consent', 403, { needs_ai_consent: true }));
    await finishRace(male());
    await press('Allow');
    expect(await screen.findByTestId('analysis-overall')).toBeOnTheScreen();
    expect(mockApi.analyzeHyroxRace).toHaveBeenCalledTimes(2);
  });

  it('a read that fails can be tried again', async () => {
    mockAuth.consented = true;
    mockApi.analyzeHyroxRace.mockRejectedValueOnce(new ApiError('boom', 500));
    await finishRace(male());
    await press("Couldn't analyze right now — tap to try again");
    expect(await screen.findByTestId('analysis-overall')).toBeOnTheScreen();
  });

  it.each([[500], [503], [0]])('a failure with status %i does not show the server’s words, only the general line', async (status) => {
    mockAuth.consented = true;
    mockApi.analyzeHyroxRace.mockRejectedValueOnce(new ApiError('internal detail', status));
    await finishRace(male());
    await screen.findByRole('alert');
    expect(screen.queryByText('internal detail')).toBeNull();
    expect(screen.getAllByText("Couldn't analyze right now — tap to try again").length).toBeGreaterThan(0);
    expect(screen.queryByText('Personalized tips to finish faster next time')).toBeNull();
  });

  it('a refusal just under 500 does show its reason', async () => {
    mockAuth.consented = true;
    mockApi.analyzeHyroxRace.mockRejectedValueOnce(new ApiError('Not that.', 499));
    await finishRace(male());
    expect(await screen.findByRole('alert')).toHaveTextContent('Not that.');
  });

  it('the button says what it does until something goes wrong', async () => {
    await finishRace(male());
    expect(screen.getByText('Personalized tips to finish faster next time')).toBeOnTheScreen();
  });

  it('a refusal with a reason shows the reason', async () => {
    mockAuth.consented = true;
    mockApi.analyzeHyroxRace.mockRejectedValueOnce(new ApiError('Race has no segments to analyze.', 400));
    await finishRace(male());
    expect(await screen.findByRole('alert')).toHaveTextContent('Race has no segments to analyze.');
  });

  it('at the daily limit the notice is shown and nothing is kept', async () => {
    mockAuth.consented = true;
    mockApi.analyzeHyroxRace.mockResolvedValueOnce({ analysis: { overall: "You've analyzed 5 races today. Please check back in 3 hours.", overallDetail: [], tips: [] }, limited: true });
    const h = male();
    await finishRace(h);
    expect(await screen.findByTestId('analysis-notice')).toHaveTextContent("You've analyzed 5 races today. Please check back in 3 hours.");
    await settle(h);
    expect(h.db.rows('hyrox_races')[0].analysis).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyze my race with AI' })).toBeOnTheScreen();
  });

  it('a flagged time is not coached', async () => {
    mockAuth.consented = true;
    const h = male();
    await open(h);
    await startOpenSingles();
    await runAll(60);
    expect(await screen.findByTestId('analysis-flagged')).toHaveTextContent(/AI analysis isn't available for this race/);
    expect(mockApi.analyzeHyroxRace).not.toHaveBeenCalled();
  });

  it('a race in the history shows the read it was given, and an older one offers it', async () => {
    mockAuth.consented = true;
    const h = dataHarness();
    h.db.seed('hyrox_races', [
      raceRow('a', 4200, { analysis: { overall: 'Kept read.', overallDetail: [], tips: [] } }),
      raceRow('b', 3900, { raced_at: '2026-10-22T08:00:00.000Z' }),
    ]);
    h.db.seed('hyrox_race_splits', [...splitRows('a'), ...splitRows('b')]);
    await open(h);
    await press('Personal bests');
    await fireEvent.press(await screen.findByTestId('pb-row-2')); // a: 1:10:00
    expect(await screen.findByTestId('analysis-overall')).toHaveTextContent('Kept read.');
    expect(mockApi.analyzeHyroxRace).not.toHaveBeenCalled();
    await press('Close');
    await fireEvent.press(await screen.findByTestId('pb-row-1')); // b: 1:05:00, never read
    expect(await screen.findByRole('button', { name: 'Analyze my race with AI' })).toBeOnTheScreen();
    expect(mockApi.analyzeHyroxRace).not.toHaveBeenCalled();
    await press('Analyze my race with AI');
    expect(await screen.findByTestId('analysis-overall')).toHaveTextContent('Strong runs, slow sleds.');
    await settle(h);
    expect(h.db.rows('hyrox_races').find((r) => r.id === 'b')?.analysis).toMatchObject({ overall: 'Strong runs, slow sleds.' });
  });

  it('a hand-built race gets no analysis section', async () => {
    mockAuth.consented = true;
    const h = dataHarness();
    h.db.seed('hyrox_races', [raceRow('c', 3000, { category: 'custom', format: null, gender: null })]);
    h.db.seed('hyrox_race_splits', splitRows('c'));
    await open(h);
    await press('Personal bests');
    await fireEvent.press(await screen.findByRole('button', { name: /^50:00, Custom Race/ }));
    expect(await screen.findByTestId('detail-meta')).toHaveTextContent(/Custom Race/);
    expect(screen.queryByRole('button', { name: 'Analyze my race with AI' })).toBeNull();
    expect(screen.queryByTestId('analysis-flagged')).toBeNull();
  });
});

const endEditing = async (label: string, text: string) => {
  await fireEvent.changeText(screen.getByLabelText(label), text);
  await fireEvent(screen.getByLabelText(label), 'endEditing', { nativeEvent: { text } });
};

describe('practice weights (Pro Singles)', () => {
  const pro = async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    await press('Pro');
    await press('Singles');
    return h;
  };

  it('are offered for the four loaded stations, at the standard, and only in Pro Singles', async () => {
    await pro();
    for (const key of ['sledPush', 'sledPull', 'farmersCarry', 'lunges']) expect(screen.getByTestId(`practice-${key}`)).toBeOnTheScreen();
    expect(screen.getByLabelText('Sled Push weight (kg)').props.value).toBe('202');
    expect(screen.getByLabelText('Farmers Carry weight (kg)').props.value).toBe('32');
    expect(screen.queryByTestId('practice-warning')).toBeNull();
    await press('Open');
    expect(screen.queryByTestId('practice-sledPush')).toBeNull();
    await press('Pro');
    await press('Doubles');
    expect(screen.queryByTestId('practice-sledPush')).toBeNull();
  });

  it('a lighter weight makes the laps longer, and shows the practice-mode warning', async () => {
    await pro();
    await endEditing('Sled Push weight (kg)', '101');
    await waitFor(() => expect(within(screen.getByTestId('agenda-sledPush')).getByText('101 kg weight · 8 laps')).toBeOnTheScreen());
    expect(screen.getByTestId('practice-warning')).toHaveTextContent(/^⚠ Practice mode only/);
    expect(within(screen.getByTestId('agenda-sledPull')).getByText('152 kg weight · 4 laps')).toBeOnTheScreen();
  });

  it('a weight over the standard is held to the standard, and the warning stays away', async () => {
    await pro();
    await endEditing('Sled Push weight (kg)', '300');
    await waitFor(() => expect(screen.getByLabelText('Sled Push weight (kg)').props.value).toBe('202'));
    expect(screen.queryByTestId('practice-warning')).toBeNull();
  });

  it('a weight that is not a number is the standard', async () => {
    await pro();
    await endEditing('Sandbag Lunges weight (kg)', '15');
    await waitFor(() => expect(within(screen.getByTestId('agenda-lunges')).getByText('15 kg weight · 16 laps')).toBeOnTheScreen());
    await endEditing('Sandbag Lunges weight (kg)', 'abc');
    await waitFor(() => expect(within(screen.getByTestId('agenda-lunges')).getByText('30 kg weight · 8 laps')).toBeOnTheScreen());
  });

  it('Reset puts the standard back', async () => {
    await pro();
    await endEditing('Sled Pull weight (kg)', '76');
    await screen.findByTestId('practice-warning');
    await press('Reset to standard');
    await waitFor(() => expect(screen.queryByTestId('practice-warning')).toBeNull());
    expect(screen.getByLabelText('Sled Pull weight (kg)').props.value).toBe('152');
    expect(screen.queryByRole('button', { name: 'Reset to standard' })).toBeNull();
  });

  it('changing the category takes the weights away', async () => {
    await pro();
    await endEditing('Sled Push weight (kg)', '101');
    await screen.findByTestId('practice-warning');
    await press('Open');
    await press('Pro');
    expect(screen.queryByTestId('practice-warning')).toBeNull();
    expect(screen.getByLabelText('Sled Push weight (kg)').props.value).toBe('202');
  });

  it('switching to Doubles and back keeps the weights (they are about the category, not the format)', async () => {
    await pro();
    await endEditing('Sled Push weight (kg)', '101');
    await screen.findByTestId('practice-warning');
    await press('Doubles');
    await press('Singles');
    expect(screen.getByLabelText('Sled Push weight (kg)').props.value).toBe('101');
  });

  it('are used in the race: the lighter weight and its longer lap count', async () => {
    await pro();
    await endEditing('Sled Push weight (kg)', '101');
    await screen.findByTestId('practice-warning');
    await press('Start race');
    await press('Complete');
    await press('Complete');
    await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('Sled Push');
    expect(screen.getByTestId('now-rounds')).toHaveTextContent('8');
    expect(screen.getByTestId('now-weight')).toHaveTextContent('101 kg sled');
  });

  it('are gone for the next race', async () => {
    await pro();
    await endEditing('Sled Push weight (kg)', '101');
    await screen.findByTestId('practice-warning');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await press('Start race');
    await press('Cancel this race');
    await act(async () => (alert.mock.calls[0][2] ?? [])[1].onPress?.());
    await press('Start race');
    await press('Pro');
    await press('Singles');
    expect(screen.getByLabelText('Sled Push weight (kg)').props.value).toBe('202');
    expect(screen.queryByTestId('practice-warning')).toBeNull();
  });
});

describe('the Doubles round split', () => {
  const doubles = async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await press('Start race');
    await press('Open');
    await press('Doubles');
    return h;
  };

  it('is offered for the four stations, half and half to begin with', async () => {
    await doubles();
    expect(screen.getByText('Doubles round split')).toBeOnTheScreen();
    expect(screen.getByLabelText('you (rounds) · Sled Push').props.value).toBe('2');
    expect(screen.getByLabelText('partner (rounds) · Sled Push').props.value).toBe('2');
    expect(screen.getByLabelText('you (rounds) · Farmers Carry').props.value).toBe('8');
    expect(within(screen.getByTestId('split-sledPush')).getByText('152 kg')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Reset to standard' })).toBeNull();
  });

  it('is not offered in Singles', async () => {
    await doubles();
    await press('Singles');
    expect(screen.queryByText('Doubles round split')).toBeNull();
  });

  it('your rounds set the partner’s share to the rest, and Reset goes back to half', async () => {
    await doubles();
    await endEditing('you (rounds) · Sled Push', '3');
    await waitFor(() => expect(screen.getByLabelText('partner (rounds) · Sled Push').props.value).toBe('1'));
    expect(screen.getByLabelText('you (rounds) · Sled Push').props.value).toBe('3');
    await press('Reset to standard');
    await waitFor(() => expect(screen.getByLabelText('you (rounds) · Sled Push').props.value).toBe('2'));
    expect(screen.getByLabelText('partner (rounds) · Sled Push').props.value).toBe('2');
  });

  it('the partner’s rounds set yours to what is left', async () => {
    await doubles();
    await endEditing('partner (rounds) · Farmers Carry', '4');
    await waitFor(() => expect(screen.getByLabelText('you (rounds) · Farmers Carry').props.value).toBe('12'));
  });

  it('a number too big is held to the total, a bad one is none', async () => {
    await doubles();
    await endEditing('you (rounds) · Sled Push', '99');
    await waitFor(() => expect(screen.getByLabelText('you (rounds) · Sled Push').props.value).toBe('4'));
    expect(screen.getByLabelText('partner (rounds) · Sled Push').props.value).toBe('0');
    await endEditing('you (rounds) · Sled Push', 'x');
    await waitFor(() => expect(screen.getByLabelText('you (rounds) · Sled Push').props.value).toBe('0'));
  });

  it('is shown in the race as your share of the rounds', async () => {
    await doubles();
    await endEditing('you (rounds) · Sled Push', '3');
    await waitFor(() => expect(screen.getByLabelText('partner (rounds) · Sled Push').props.value).toBe('1'));
    await press('Start race');
    await press('Complete');
    await press('Complete');
    await press('Complete');
    expect(screen.getByTestId('now-rounds')).toHaveTextContent('3');
    expect(screen.getByText('Your share')).toBeOnTheScreen();
  });

  it('the split goes when the format changes', async () => {
    await doubles();
    await endEditing('you (rounds) · Sled Push', '3');
    await waitFor(() => expect(screen.getByLabelText('partner (rounds) · Sled Push').props.value).toBe('1'));
    await press('Singles');
    await press('Doubles');
    expect(screen.getByLabelText('you (rounds) · Sled Push').props.value).toBe('2');
  });

  it('follows the lane', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    h.db.seed('user_settings', [{ user_id: USER, theme: null, language: null, units_weight: 'kg', units_height: 'cm', units_distance: 'km', units_clock: '12h', hyrox_leaderboard_gender: null, hyrox_facility_lane_m: 10, hyrox_history_backfilled: false, extra: {} }]);
    await open(h);
    await press('Start race');
    await press('Open');
    await press('Doubles');
    expect(screen.getByLabelText('you (rounds) · Sled Push').props.value).toBe('3');
    expect(screen.getByLabelText('partner (rounds) · Sled Push').props.value).toBe('2');
  });
});

describe('how a station is done', () => {
  it('a station on the first screen opens how to do it, with the three steps and the tip', async () => {
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sled Push' }));
    expect(await screen.findByTestId('howto-summary')).toHaveTextContent(/50m pushing a heavy sled/);
    expect(screen.getByText('Sled Push')).toBeOnTheScreen(); // the sheet is named for the station
    expect(screen.getByTestId('howto-step-0')).toHaveTextContent(/^1\. Set your hands low on the posts/);
    expect(screen.getByTestId('howto-step-2')).toHaveTextContent(/^3\. Push in a straight line/);
    expect(screen.getByTestId('howto-tip')).toHaveTextContent(/Pro tip: It's a leg day, not an arm day/);
    await press('Close');
    expect(screen.queryByTestId('howto-summary')).toBeNull();
  });

  it('every one of the eight stations has one', async () => {
    await open();
    for (const name of ['SkiErg', 'Sled Push', 'Sled Pull', 'Burpee Broad Jumps', 'Rowing', 'Farmers Carry', 'Sandbag Lunges', 'Wall Balls']) {
      await fireEvent.press(await screen.findByRole('button', { name }));
      expect(await screen.findByTestId('howto-summary')).toBeOnTheScreen();
      await press('Close');
    }
  });

  it('the demo video opens in the in-app browser', async () => {
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'SkiErg' }));
    await press('▶ Watch a demo');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://www.youtube.com/watch?v=9RJiSvgaiJU');
  });

  it('in the race, the station being done has a how-to; a run does not', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    await open(h);
    await startOpenSingles();
    expect(screen.queryByRole('button', { name: 'How to do it' })).toBeNull();
    await press('Complete');
    await press('How to do it');
    expect(await screen.findByTestId('howto-summary')).toHaveTextContent(/1000m on the SkiErg/);
  });
});

describe('a race built by hand', () => {
  const male = () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profileRow('male')]);
    return h;
  };
  const custom = async (h: Harness = male()) => {
    await open(h);
    await press('Start race');
    await press('Custom');
    return h;
  };

  it('starts as the whole standard race, nothing asked but the blocks and the lane', async () => {
    await custom();
    expect(await screen.findByTestId('block-0')).toHaveTextContent(/Run/);
    expect(screen.getByTestId('block-15')).toHaveTextContent(/Wall Balls/);
    expect(screen.queryByTestId('block-16')).toBeNull();
    expect(screen.getByLabelText('Wall Balls Reps (Reps)').props.value).toBe('75');
    expect(screen.getByLabelText('Sled Push distance (m)').props.value).toBe('50');
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByLabelText('Your lane (m)')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Custom' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Standard' }).props.accessibilityState.selected).toBe(false);
  });

  it('a block can be added from the picker, in any of four groups', async () => {
    await custom();
    await press('Add a station');
    expect(await screen.findByRole('button', { name: 'Run' })).toBeOnTheScreen();
    await press('Sled Work');
    await press('Sled Pull');
    const last = await screen.findByTestId('block-16');
    expect(last).toHaveTextContent(/Sled Pull/);
    expect(screen.getAllByLabelText('Sled Pull distance (m)').length).toBeGreaterThan(0);
    await press('Add a station');
    await press('Explosive');
    await press('Burpee Broad Jumps');
    expect(await screen.findByTestId('block-17')).toHaveTextContent(/Burpee Broad Jumps/);
    await press('Add a station');
    await press('Carry & Lunge');
    await press('Farmers Carry');
    expect(await screen.findByTestId('block-18')).toHaveTextContent(/Farmers Carry/);
  });

  it('a block moves up and down, and the ends cannot go further', async () => {
    await custom();
    await screen.findByTestId('block-0');
    expect(screen.getAllByRole('button', { name: 'Move up: Run' })[0].props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Move down: Run' })[0]);
    expect(screen.getByTestId('block-0')).toHaveTextContent(/SkiErg/);
    expect(screen.getByTestId('block-1')).toHaveTextContent(/Run/);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Move up: Run' })[0]);
    expect(screen.getByTestId('block-0')).toHaveTextContent(/Run/);
    expect(screen.getByRole('button', { name: 'Move down: Wall Balls' }).props.accessibilityState.disabled).toBe(true);
  });

  it('a block is removed, and an empty race cannot start', async () => {
    await custom();
    for (let i = 0; i < 16; i += 1) await fireEvent.press((await screen.findAllByRole('button', { name: /^Remove: / }))[0]);
    expect(await screen.findByTestId('custom-empty')).toHaveTextContent('Add a station below to build your race.');
    expect(screen.getByRole('button', { name: 'Start race' }).props.accessibilityState.disabled).toBe(true);
    await press('Reset to standard');
    expect(await screen.findByTestId('block-15')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Start race' })[0].props.accessibilityState.disabled).toBeFalsy();
  });

  it('an amount is changed, and an unreadable one is the default', async () => {
    await custom();
    await endEditing('Sled Push distance (m)', '75');
    await waitFor(() => expect(screen.getByLabelText('Sled Push distance (m)').props.value).toBe('75'));
    await endEditing('Sled Push distance (m)', 'abc');
    await waitFor(() => expect(screen.getByLabelText('Sled Push distance (m)').props.value).toBe('50'));
  });

  it('what was built is kept when going to Standard and back', async () => {
    await custom();
    await fireEvent.press(screen.getAllByRole('button', { name: /^Remove: / })[0]);
    await press('Standard');
    await press('Custom');
    expect(screen.queryByTestId('block-15')).toBeNull();
    expect(await screen.findByTestId('block-14')).toBeOnTheScreen();
  });

  it('is run block by block: laps for the distances, reps, and a plain distance', async () => {
    await custom();
    await endEditing('Sled Push distance (m)', '100');
    await endEditing('Sled Pull distance (m)', '60');
    await press('Start race');
    expect(await screen.findByTestId('now-title')).toHaveTextContent('Run');
    expect(screen.getByTestId('now-amount')).toHaveTextContent('1000m');
    expect(screen.getByTestId('count')).toHaveTextContent('1/16');
    await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('SkiErg');
    expect(screen.getByTestId('now-amount')).toHaveTextContent('1000m');
    await press('Complete');
    await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('Sled Push');
    expect(screen.getByTestId('now-rounds')).toHaveTextContent('8');
    expect(screen.getByTestId('now-amount')).toHaveTextContent('100m');
    for (let i = 0; i < 12; i += 1) await press('Complete');
    expect(screen.getByTestId('now-title')).toHaveTextContent('Wall Balls');
    expect(screen.getByTestId('now-amount')).toHaveTextContent('75');
    expect(screen.getByText('Reps')).toBeOnTheScreen();
  });

  it('follows the lane', async () => {
    const h = male();
    h.db.seed('user_settings', [{ user_id: USER, theme: null, language: null, units_weight: 'kg', units_height: 'cm', units_distance: 'km', units_clock: '12h', hyrox_leaderboard_gender: null, hyrox_facility_lane_m: 10, hyrox_history_backfilled: false, extra: {} }]);
    await custom(h);
    await press('Start race');
    await press('Complete');
    await press('Complete');
    await press('Complete');
    expect(screen.getByTestId('now-rounds')).toHaveTextContent('5');
  });

  it('finishing keeps it as a Custom Race: never flagged or a best, not on the board, and not coached', async () => {
    mockAuth.consented = true;
    const h = await custom();
    await press('Start race');
    await runAll(60);
    expect(await screen.findByTestId('finish-time')).toHaveTextContent('16:00');
    expect(screen.getByTestId('finish-combo')).toHaveTextContent('Custom Race');
    expect(screen.getByTestId('finish-banner')).toHaveTextContent('Saved to your history.');
    expect(screen.queryByTestId('analysis-flagged')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Analyze my race with AI' })).toBeNull();
    await settle(h);
    expect(h.db.rows('hyrox_races')).toEqual([expect.objectContaining({ category: 'custom', format: null, gender: null, scale: 'full', total_seconds: 960, flagged: false, is_new_pb: false })]);
    expect(h.db.rows('hyrox_race_splits')).toHaveLength(16);
    expect(mockApi.submitHyroxResult).not.toHaveBeenCalled();
    expect(mockApi.analyzeHyroxRace).not.toHaveBeenCalled();
    expect(h.db.rows('user_settings')).toEqual([]);
  });

  it('cancelling goes back to the standard setup, with the build kept for next time', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await custom();
    await fireEvent.press(screen.getAllByRole('button', { name: /^Remove: / })[0]);
    await press('Start race');
    await press('Cancel this race');
    await act(async () => (alert.mock.calls[0][2] ?? [])[1].onPress?.());
    expect(await screen.findByTestId('hero-title')).toBeOnTheScreen();
    await press('Start race');
    expect(screen.getByRole('button', { name: 'Standard' }).props.accessibilityState.selected).toBe(true);
    await press('Custom');
    expect(screen.queryByTestId('block-15')).toBeNull();
    expect(await screen.findByTestId('block-14')).toBeOnTheScreen();
  });

  it('numbers the blocks from one', async () => {
    await custom();
    expect(await screen.findByTestId('block-0')).toHaveTextContent(/^1\D/);
    expect(screen.getByTestId('block-1')).toHaveTextContent(/^2\D/);
    expect(screen.getByTestId('block-15')).toHaveTextContent(/^16\D/);
  });

  it('the picker is shut until asked for, shows the first group, and shuts again after a pick or Close', async () => {
    await custom();
    expect(screen.queryByText('Cardio')).toBeNull();
    await press('Add a station');
    expect(screen.getByRole('button', { name: 'Cardio' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Sled Work' }).props.accessibilityState.selected).toBe(false);
    await press('Sled Work');
    expect(screen.getByRole('button', { name: 'Sled Work' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Cardio' }).props.accessibilityState.selected).toBe(false);
    await press('Sled Pull');
    expect(screen.queryByText('Cardio')).toBeNull();
    await press('Add a station');
    expect(screen.getByText('Cardio')).toBeOnTheScreen();
    await press('Close');
    expect(screen.queryByText('Cardio')).toBeNull();
    expect(screen.queryByTestId('block-17')).toBeNull();
  });

  it('a Doubles standard setup does not leak into a hand-made race', async () => {
    await open(male());
    await press('Start race');
    await press('Open');
    await press('Doubles');
    await press('Custom');
    await press('Start race');
    expect(await screen.findByTestId('count')).toHaveTextContent('1/16');
    expect(screen.queryByText(/Doubles/)).toBeNull();
  });

  it('is in the history as a Custom Race and on no personal-best board', async () => {
    const h = male();
    h.db.seed('hyrox_races', [raceRow('c', 3000, { category: 'custom', format: null, gender: null })]);
    h.db.seed('hyrox_race_splits', splitRows('c'));
    await open(h);
    await press('Personal bests');
    expect(await screen.findByTestId('pb-empty')).toBeOnTheScreen();
    expect(within(screen.getByTestId('history-c')).getByText('Custom Race')).toBeOnTheScreen();
  });
});
