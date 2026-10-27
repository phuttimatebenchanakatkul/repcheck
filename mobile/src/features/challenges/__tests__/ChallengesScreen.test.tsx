import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { dataHarness } from '@/testing/dataHarness';

import ChallengesScreen from '../ChallengesScreen';

const mockApi = { todaysChallenge: jest.fn(), leaderboard: jest.fn(), blockAccount: jest.fn(), reportAccount: jest.fn() };
const mockPush = jest.fn();
const mockSheet: { props: Record<string, any> | null } = { props: null };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ state: { status: 'ready', profile: { id: 'user-1', ai_consent: true } }, refreshProfile: async () => undefined }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../RecordSheet', () => {
  const { Text } = require('react-native');
  return {
    RecordSheet: (props: Record<string, any>) => {
      mockSheet.props = props;
      return props.visible ? <Text testID="record-sheet">{props.title}</Text> : null;
    },
  };
});

const BOARD = {
  me: 'u-2',
  rows: [
    { userId: 'u-1', name: 'Ann', totalReps: 120 },
    { userId: 'u-2', name: 'Me', totalReps: 90 },
    { userId: 'u-3', name: 'Cy', totalReps: 90 },
    { userId: 'u-4', name: 'Di', totalReps: 10 },
  ],
  total: 4,
  mine: { rank: 2, totalReps: 90 },
};

async function open() {
  const h = dataHarness();
  await render(
    <h.Provider>
      <ChallengesScreen />
    </h.Provider>,
  );
  return h;
}
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSheet.props = null;
  mockApi.todaysChallenge.mockResolvedValue({ exercise: 'pushups', attempted: false });
  mockApi.leaderboard.mockResolvedValue(BOARD);
  mockApi.blockAccount.mockResolvedValue(undefined);
});

describe("today's challenge", () => {
  it('names the exercise and offers to record', async () => {
    await open();
    expect(await screen.findByTestId('exercise')).toHaveTextContent('Today: Push-ups');
    expect(screen.getByRole('button', { name: 'Record an attempt' }).props.accessibilityState.disabled).toBeFalsy();
  });

  it.each([['situps', 'Today: Sit-ups'], ['pullups', 'Today: Pull-ups']])('%s rotates in', async (exercise, text) => {
    mockApi.todaysChallenge.mockResolvedValue({ exercise, attempted: false });
    await open();
    expect(await screen.findByTestId('exercise')).toHaveTextContent(text);
  });

  it('when the attempt is used, says come back tomorrow and cannot be pressed', async () => {
    mockApi.todaysChallenge.mockResolvedValue({ exercise: 'pushups', attempted: true });
    await open();
    const button = await screen.findByRole('button', { name: 'Recorded today — come back tomorrow' });
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Record an attempt' })).toBeNull();
  });

  it('shows the streak', async () => {
    await open();
    expect(await screen.findByTestId('streak')).toHaveTextContent('0 day streak');
  });

  it('a card that cannot be read offers to try again', async () => {
    mockApi.todaysChallenge.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValue({ exercise: 'pushups', attempted: false });
    await open();
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent("That didn't work. Try again.");
    await fireEvent.press(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(await screen.findByTestId('exercise')).toBeOnTheScreen();
  });

  it('opens the recorder for today’s exercise, and closes it', async () => {
    await open();
    await screen.findByTestId('exercise');
    expect(screen.queryByTestId('record-sheet')).toBeNull();
    await press('Record an attempt');
    expect(await screen.findByTestId('record-sheet')).toHaveTextContent('Push-ups — 25s challenge');
    expect(mockSheet.props?.exercise).toBe('pushups');
    await act(async () => mockSheet.props?.onClose());
    expect(screen.queryByTestId('record-sheet')).toBeNull();
  });

  it('a counted attempt reads the card and the board again', async () => {
    await open();
    await press('Record an attempt');
    mockApi.todaysChallenge.mockResolvedValue({ exercise: 'pushups', attempted: true });
    await act(async () => mockSheet.props?.onCounted());
    expect(await screen.findByRole('button', { name: 'Recorded today — come back tomorrow' })).toBeOnTheScreen();
    expect(mockApi.leaderboard.mock.calls.length).toBeGreaterThan(1);
  });

  it('a spent attempt found at the server reads the card again', async () => {
    await open();
    await press('Record an attempt');
    mockApi.todaysChallenge.mockResolvedValue({ exercise: 'pushups', attempted: true });
    await act(async () => mockSheet.props?.onLimit());
    expect(await screen.findByRole('button', { name: 'Recorded today — come back tomorrow' })).toBeOnTheScreen();
  });
});

describe('the leaderboard', () => {
  it('starts with everybody, 25 at most', async () => {
    await open();
    await screen.findByTestId('my-standing');
    expect(mockApi.leaderboard).toHaveBeenCalledWith('global', 25);
    expect(screen.getByRole('radio', { name: 'Global' }).props.accessibilityState.selected).toBe(true);
  });

  it('pins you, then lists everyone else with their real rank and how far from you', async () => {
    await open();
    const mine = await screen.findByTestId('my-standing');
    expect(within(mine).getByText('#2')).toBeOnTheScreen();
    expect(within(mine).getByText('You')).toBeOnTheScreen();
    expect(within(mine).getByText('90 reps')).toBeOnTheScreen();
    expect(within(mine).getByText('of 4')).toBeOnTheScreen();
    const ann = screen.getByTestId('rank-1');
    expect(within(ann).getByText('Ann')).toBeOnTheScreen();
    expect(within(ann).getByText('+30')).toBeOnTheScreen();
    expect(within(screen.getByTestId('rank-3')).getByText('tied')).toBeOnTheScreen();
    expect(within(screen.getByTestId('rank-4')).getByText('-80')).toBeOnTheScreen();
    expect(screen.queryByTestId('rank-2')).toBeNull();
  });

  it('switching to friends asks for friends', async () => {
    await open();
    await screen.findByTestId('my-standing');
    mockApi.leaderboard.mockResolvedValue({ ...BOARD, rows: [BOARD.rows[1]], total: 1 });
    await fireEvent.press(screen.getByRole('radio', { name: 'Friends' }));
    await waitFor(() => expect(mockApi.leaderboard).toHaveBeenCalledWith('friends', 25));
    expect(await screen.findByTestId('my-standing')).toBeOnTheScreen();
    expect(screen.queryByTestId('rank-1')).toBeNull();
  });

  it('with no score of your own there is no pinned row and nothing to compare to', async () => {
    mockApi.leaderboard.mockResolvedValue({ ...BOARD, mine: null, me: 'u-9' });
    await open();
    expect(await screen.findByTestId('rank-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-standing')).toBeNull();
    expect(within(screen.getByTestId('rank-1')).queryByText(/^[+-]\d+$/)).toBeNull();
  });

  it('an empty board says so', async () => {
    mockApi.leaderboard.mockResolvedValue({ me: 'u-2', rows: [], total: 0, mine: null });
    await open();
    expect(await screen.findByText('No attempts yet')).toBeOnTheScreen();
    expect(screen.getByText('Be the first to set a score.')).toBeOnTheScreen();
  });

  it('alone on the board shows you and no empty message', async () => {
    mockApi.leaderboard.mockResolvedValue({ ...BOARD, rows: [BOARD.rows[1]], total: 1 });
    await open();
    await screen.findByTestId('my-standing');
    expect(screen.queryByText('No attempts yet')).toBeNull();
  });

  it('the whole board shown: says that is everyone, with a way to invite friends', async () => {
    await open();
    expect(await screen.findByTestId('board-foot')).toHaveTextContent("That's everyone so far.");
    await press('Invite friends');
    expect(mockPush).toHaveBeenCalledWith('/friends');
  });

  it('a longer board says how many are shown, and has no invite', async () => {
    mockApi.leaderboard.mockResolvedValue({ ...BOARD, total: 300 });
    await open();
    expect(await screen.findByTestId('board-foot')).toHaveTextContent('Showing top 4 of 300');
    expect(screen.queryByRole('button', { name: 'Invite friends' })).toBeNull();
  });

  it('a board that cannot be read offers to try again', async () => {
    mockApi.leaderboard.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValue(BOARD);
    await open();
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent("That didn't work. Try again.");
    await fireEvent.press(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(await screen.findByTestId('my-standing')).toBeOnTheScreen();
  });
});

describe('report and block', () => {
  it('every name but yours has a way in, named for them; yours has none', async () => {
    await open();
    await screen.findByTestId('my-standing');
    expect(screen.getByRole('button', { name: 'More options: Ann' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'More options: Cy' })).toBeOnTheScreen();
    expect(within(screen.getByTestId('my-standing')).queryByRole('button')).toBeNull();
  });

  it('blocking someone takes them off the board', async () => {
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'More options: Ann' }));
    mockApi.leaderboard.mockResolvedValue({ ...BOARD, rows: BOARD.rows.slice(1), total: 3 });
    await press('Block this account');
    expect(mockApi.blockAccount).toHaveBeenCalledWith('u-1');
    await waitFor(() => expect(screen.queryByTestId('rank-1')).toBeNull());
  });
});
