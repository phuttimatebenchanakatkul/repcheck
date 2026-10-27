import { ApiError, type Api } from '../client';
import { CHALLENGE_UPLOAD_TIMEOUT_MS, challengeEndpoints, isLimitReached, parseLeaderboard, parseToday } from '../challenges';

const api = (over: Partial<Record<keyof Api, jest.Mock>>) => ({ post: jest.fn(), get: jest.fn(), del: jest.fn(), upload: jest.fn(), request: jest.fn(), ...over }) as unknown as Api;

/** React Native's FormData takes {uri, name, type} for a file; Node's would turn that into text. Record what is appended instead. */
class RecordingFormData {
  parts: { fieldName: string; string?: string; uri?: string; name?: string; type?: string }[] = [];
  append(fieldName: string, value: unknown) {
    this.parts.push(typeof value === 'string' ? { fieldName, string: value } : { fieldName, ...(value as object) });
  }
}
const realFormData = global.FormData;
beforeAll(() => {
  (global as unknown as { FormData: unknown }).FormData = RecordingFormData;
});
afterAll(() => {
  global.FormData = realFormData;
});

describe('parseToday', () => {
  it('reads the exercise and whether today’s attempt is used', () => {
    expect(parseToday({ ok: true, exercise: 'situps', label: 'Sit-ups', attempted: true })).toEqual({ exercise: 'situps', attempted: true });
    expect(parseToday({ exercise: 'pullups', attempted: false })).toEqual({ exercise: 'pullups', attempted: false });
  });

  it('anything but true is not attempted', () => {
    expect(parseToday({ exercise: 'pushups', attempted: 'yes' })?.attempted).toBe(false);
    expect(parseToday({ exercise: 'pushups' })?.attempted).toBe(false);
  });

  it.each([[null], ['x'], [{}], [{ exercise: 'squats' }], [{ exercise: 5 }]])('not today’s challenge: %j', (body) => {
    expect(parseToday(body)).toBeNull();
  });
});

describe('parseLeaderboard', () => {
  const row = { user_id: 'u-1', name: 'Ann', total_reps: 120, last_at: '2026-10-27T00:00:00Z' };

  it('reads the board, my place and how many there are', () => {
    expect(parseLeaderboard({ ok: true, scope: 'global', me: 'u-2', leaderboard: [row], totalEntries: 40, myRank: { rank: 7, total_reps: 50, name: 'Me' } })).toEqual({
      me: 'u-2', rows: [{ userId: 'u-1', name: 'Ann', totalReps: 120 }], total: 40, mine: { rank: 7, totalReps: 50 },
    });
  });

  it('no rank of my own is null; a missing count is the rows listed', () => {
    expect(parseLeaderboard({ me: 'u-2', leaderboard: [row], myRank: null })).toMatchObject({ mine: null, total: 1 });
    expect(parseLeaderboard({ me: 'u-2', leaderboard: [row], myRank: { rank: 'x' } })?.mine).toBeNull();
  });

  it('zero reps is a standing; negative, infinite and unreadable ones are not', () => {
    expect(parseLeaderboard({ me: 'u', leaderboard: [{ user_id: 'a', name: 'A', total_reps: 0 }] })?.rows[0].totalReps).toBe(0);
    for (const reps of [-1, NaN, Infinity, '3', null, undefined]) expect(parseLeaderboard({ me: 'u', leaderboard: [{ user_id: 'a', total_reps: reps }] })).toBeNull();
  });

  it('a row with no id, an empty id, or no body is not a standing', () => {
    expect(parseLeaderboard({ me: 'u', leaderboard: [null] })).toBeNull();
    expect(parseLeaderboard({ me: 'u', leaderboard: [{ user_id: '', total_reps: 1 }] })).toBeNull();
    expect(parseLeaderboard({ me: 'u', leaderboard: [{ user_id: 5, total_reps: 1 }] })).toBeNull();
  });

  it('a count that is not a number is the rows listed', () => {
    expect(parseLeaderboard({ me: 'u', leaderboard: [row], totalEntries: NaN })?.total).toBe(1);
    expect(parseLeaderboard({ me: 'u', leaderboard: [row], totalEntries: 'x' })?.total).toBe(1);
  });

  it('a blank name is kept blank', () => {
    expect(parseLeaderboard({ me: 'u-2', leaderboard: [{ ...row, name: undefined }] })?.rows[0].name).toBe('');
  });

  it.each([[null], ['x'], [{}], [{ me: 'u' }], [{ leaderboard: [] }], [{ me: 'u', leaderboard: 'x' }], [{ me: 'u', leaderboard: [{ name: 'x', total_reps: 1 }] }], [{ me: 'u', leaderboard: [{ user_id: 'a', total_reps: -1 }] }], [{ me: 'u', leaderboard: [{ user_id: 'a', total_reps: '3' }] }]])(
    'not a board: %j',
    (body) => {
      expect(parseLeaderboard(body)).toBeNull();
    },
  );
});

describe('the endpoints', () => {
  it('todaysChallenge reads /api/challenges/today; an unreadable answer is a 502', async () => {
    const get = jest.fn(async () => ({ ok: true, exercise: 'pushups', attempted: false }));
    expect(await challengeEndpoints(api({ get })).todaysChallenge()).toEqual({ exercise: 'pushups', attempted: false });
    expect(get).toHaveBeenCalledWith('/api/challenges/today');
    await expect(challengeEndpoints(api({ get: jest.fn(async () => ({ ok: true })) })).todaysChallenge()).rejects.toMatchObject({ status: 502 });
  });

  it('createChallenge posts and returns the id', async () => {
    const post = jest.fn(async () => ({ ok: true, id: 12, exercise: 'situps' }));
    expect(await challengeEndpoints(api({ post })).createChallenge()).toEqual({ id: 12, exercise: 'situps' });
    expect(post).toHaveBeenCalledWith('/api/challenges');
    await expect(challengeEndpoints(api({ post: jest.fn(async () => ({ ok: true, id: '12', exercise: 'situps' })) })).createChallenge()).rejects.toMatchObject({ status: 502 });
    await expect(challengeEndpoints(api({ post: jest.fn(async () => ({ ok: true, id: 1, exercise: 'x' })) })).createChallenge()).rejects.toMatchObject({ status: 502 });
  });

  it('createChallenge passes the daily limit on', async () => {
    const post = jest.fn().mockRejectedValue(new ApiError("You've already recorded today's attempt — come back tomorrow.", 429, { limitReached: true }));
    const error = await challengeEndpoints(api({ post })).createChallenge().catch((e: unknown) => e);
    expect(isLimitReached(error)).toBe(true);
  });

  it('submitChallengeClip sends the clip as "video" to the challenge, with time for the count', async () => {
    const upload = jest.fn(async () => ({ ok: true, exercise: 'pushups', reps: 18, rejected: 2, total: 20, notes: 'n' }));
    const attempt = await challengeEndpoints(api({ upload })).submitChallengeClip(12, { uri: 'file:///clip.mov' });
    expect(attempt).toEqual({ exercise: 'pushups', counted: 18, total: 20, rejected: 2, notes: 'n' });
    const [path, form, timeout] = upload.mock.calls[0] as unknown as [string, RecordingFormData, number];
    expect(path).toBe('/api/challenges/12/submit');
    expect(timeout).toBe(CHALLENGE_UPLOAD_TIMEOUT_MS);
    expect(CHALLENGE_UPLOAD_TIMEOUT_MS).toBe(300_000);
    expect(form.parts).toEqual([{ fieldName: 'video', uri: 'file:///clip.mov', name: 'set.mov', type: 'video/quicktime' }]);
  });

  it('an answer that is not an attempt is a 502, and refusals pass on', async () => {
    await expect(challengeEndpoints(api({ upload: jest.fn(async () => ({ ok: true })) })).submitChallengeClip(1, { uri: 'file:///c.mp4' })).rejects.toMatchObject({ status: 502 });
    const needs = new ApiError('consent', 403, { needs_ai_consent: true });
    await expect(challengeEndpoints(api({ upload: jest.fn().mockRejectedValue(needs) })).submitChallengeClip(1, { uri: 'file:///c.mp4' })).rejects.toBe(needs);
  });

  it('leaderboard asks for the scope and how many, and reads it', async () => {
    const get = jest.fn(async () => ({ ok: true, me: 'u-2', leaderboard: [], totalEntries: 0, myRank: null }));
    expect(await challengeEndpoints(api({ get })).leaderboard('friends', 25)).toEqual({ me: 'u-2', rows: [], total: 0, mine: null });
    expect(get).toHaveBeenCalledWith('/api/leaderboard', { scope: 'friends', limit: 25 });
    await expect(challengeEndpoints(api({ get: jest.fn(async () => ({ ok: true })) })).leaderboard('global', 25)).rejects.toMatchObject({ status: 502 });
  });

  it('isLimitReached is only the daily limit', () => {
    expect(isLimitReached(new ApiError('x', 429, { limitReached: true }))).toBe(true);
    expect(isLimitReached(new ApiError('x', 429))).toBe(false);
    expect(isLimitReached(new Error('x'))).toBe(false);
  });
});
