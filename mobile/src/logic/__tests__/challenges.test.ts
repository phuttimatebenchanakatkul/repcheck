import {
  CHALLENGE_EXERCISES,
  CHALLENGE_SECONDS,
  COUNTDOWN_SECONDS,
  DEFAULT_SCOPE,
  LEADERBOARD_LIMIT,
  MIN_RECORDING_MS,
  isChallengeExercise,
  isPodium,
  othersOnBoard,
  parseAttempt,
  repGap,
  type Leaderboard,
} from '../challenges';

const board = (over: Partial<Leaderboard> = {}): Leaderboard => ({
  me: 'u-2',
  rows: [
    { userId: 'u-1', name: 'Ann', totalReps: 120 },
    { userId: 'u-2', name: 'Me', totalReps: 90 },
    { userId: 'u-3', name: 'Cy', totalReps: 90 },
    { userId: 'u-4', name: 'Di', totalReps: 10 },
  ],
  total: 4,
  mine: { rank: 2, totalReps: 90 },
  ...over,
});

describe('the constants', () => {
  it('are the website’s', () => {
    expect([...CHALLENGE_EXERCISES]).toEqual(['pushups', 'situps', 'pullups']);
    expect(CHALLENGE_SECONDS).toBe(25);
    expect(COUNTDOWN_SECONDS).toBe(10);
    expect(MIN_RECORDING_MS).toBe(2000);
    expect(LEADERBOARD_LIMIT).toBe(25);
    expect(DEFAULT_SCOPE).toBe('global');
  });

  it('only the three exercises are exercises', () => {
    expect(CHALLENGE_EXERCISES.every(isChallengeExercise)).toBe(true);
    for (const value of ['squats', '', null, undefined, 5, ['pushups']]) expect(isChallengeExercise(value)).toBe(false);
  });
});

describe('the board without you', () => {
  it('lists everyone else with the rank they hold on the whole board', () => {
    expect(othersOnBoard(board()).map((r) => [r.userId, r.rank])).toEqual([['u-1', 1], ['u-3', 3], ['u-4', 4]]);
  });

  it('with no score of your own, nobody is left out', () => {
    expect(othersOnBoard(board({ me: 'u-9', mine: null })).map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('an empty board is empty', () => {
    expect(othersOnBoard(board({ rows: [], total: 0, mine: null }))).toEqual([]);
  });
});

describe('the gap to you', () => {
  it('is their reps minus yours', () => {
    expect(repGap(120, 90)).toBe(30);
    expect(repGap(10, 90)).toBe(-80);
    expect(repGap(90, 90)).toBe(0);
  });

  it('is nothing to show when you have no score', () => {
    expect(repGap(50, null)).toBeNull();
    expect(repGap(0, 0)).toBe(0);
  });

  it('the top three are the podium', () => {
    expect([1, 2, 3, 4, 25].map(isPodium)).toEqual([true, true, true, false, false]);
  });
});

describe('an attempt', () => {
  it('reads reps, the rest that did not count, and the notes', () => {
    expect(parseAttempt({ ok: true, exercise: 'pushups', reps: 18, rejected: 3, total: 21, notes: 'Good depth' })).toEqual({ exercise: 'pushups', counted: 18, total: 21, rejected: 3, notes: 'Good depth' });
  });

  it('works out the total when the server leaves it out', () => {
    expect(parseAttempt({ exercise: 'situps', reps: 10, rejected: 2 })).toMatchObject({ total: 12, rejected: 2 });
    expect(parseAttempt({ exercise: 'situps', reps: 10 })).toMatchObject({ total: 10, rejected: 0, notes: '' });
  });

  it('never has a negative number rejected', () => {
    expect(parseAttempt({ exercise: 'pullups', reps: 10, total: 4 })).toMatchObject({ total: 4, rejected: 0 });
  });

  it('zero reps is an attempt', () => {
    expect(parseAttempt({ exercise: 'pullups', reps: 0, total: 0 })).toMatchObject({ counted: 0, total: 0 });
  });

  it('whole numbers only', () => {
    expect(parseAttempt({ exercise: 'pullups', reps: 7.9 })?.counted).toBe(7);
  });

  it.each([[null], [undefined], ['x'], [[]], [{}], [{ exercise: 'pushups' }], [{ exercise: 'squats', reps: 3 }], [{ exercise: 'pushups', reps: '3' }], [{ exercise: 'pushups', reps: -1 }], [{ exercise: 'pushups', reps: NaN }]])('not an attempt: %j', (body) => {
    expect(parseAttempt(body)).toBeNull();
  });
});
