import { ApiError, type Api } from '../client';
import { HYROX_ANALYSIS_TIMEOUT_MS, hyroxEndpoints, parseAnalysisAnswer, parseBoard } from '../hyrox';
import type { Race } from '../../logic/hyrox';

const api = (over: Partial<Record<keyof Api, jest.Mock>>) => ({ post: jest.fn(), get: jest.fn(), del: jest.fn(), upload: jest.fn(), request: jest.fn(), ...over }) as unknown as Api;
const RESULT = { gender: 'men', category: 'open', format: 'singles', total_seconds: 4000 };

describe('submitHyroxResult', () => {
  it('posts the time and says it was taken', async () => {
    const post = jest.fn(async () => ({ ok: true, id: 3 }));
    expect(await hyroxEndpoints(api({ post })).submitHyroxResult(RESULT)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/hyrox/results', RESULT);
  });

  it('is best effort: a refusal or no signal is false and never throws', async () => {
    expect(await hyroxEndpoints(api({ post: jest.fn().mockRejectedValue(new ApiError("That time isn't a plausible race finish.", 400)) })).submitHyroxResult(RESULT)).toBe(false);
    expect(await hyroxEndpoints(api({ post: jest.fn().mockRejectedValue(new ApiError('offline', 0)) })).submitHyroxResult(RESULT)).toBe(false);
    expect(await hyroxEndpoints(api({ post: jest.fn().mockRejectedValue(new Error('x')) })).submitHyroxResult(RESULT)).toBe(false);
  });
});

describe('parseBoard', () => {
  const row = { user_id: 'u-1', name: 'Ann', best_seconds: 3700 };

  it('reads the rows, the total and my place', () => {
    expect(parseBoard({ ok: true, leaderboard: [row], totalEntries: 40, me: { rank: 7, best_seconds: 4100, name: 'Me' } })).toEqual({
      rows: [{ userId: 'u-1', name: 'Ann', bestSeconds: 3700 }], total: 40, mine: { rank: 7, bestSeconds: 4100, name: 'Me' },
    });
  });

  it('no place of my own is null; a missing total is the rows listed; a missing name is blank', () => {
    expect(parseBoard({ leaderboard: [{ ...row, name: undefined }], me: null })).toEqual({ rows: [{ userId: 'u-1', name: '', bestSeconds: 3700 }], total: 1, mine: null });
    expect(parseBoard({ leaderboard: [row], totalEntries: 'x', me: { rank: 'x' } })).toMatchObject({ total: 1, mine: null });
    expect(parseBoard({ leaderboard: [row], totalEntries: NaN })?.total).toBe(1);
    expect(parseBoard({ leaderboard: [row], totalEntries: Infinity })?.total).toBe(1);
    expect(parseBoard({ leaderboard: [row], me: { rank: 3, best_seconds: 1 } })?.mine).toEqual({ rank: 3, bestSeconds: 1, name: '' });
  });

  it('an empty board is a board', () => {
    expect(parseBoard({ leaderboard: [] })).toEqual({ rows: [], total: 0, mine: null });
  });

  it.each([[null], ['x'], [{}], [{ leaderboard: 'x' }], [{ leaderboard: [null] }], [{ leaderboard: [{ best_seconds: 1 }] }], [{ leaderboard: [{ user_id: '', best_seconds: 1 }] }], [{ leaderboard: [{ user_id: 'a', best_seconds: '1' }] }], [{ leaderboard: [{ user_id: 'a', best_seconds: NaN }] }]])(
    'not a board: %j',
    (body) => {
      expect(parseBoard(body)).toBeNull();
    },
  );
});

describe('parseAnalysisAnswer', () => {
  it('reads the server’s snake_case answer into the website’s kept shape', () => {
    expect(parseAnalysisAnswer({ ok: true, overall: 'Fast.', overall_detail: ['a'], tips: [{ key: 'row', tip: 'Fine.', rating: 'solid', detail: [] }], limited: false })).toEqual({
      analysis: { overall: 'Fast.', overallDetail: ['a'], tips: [{ key: 'row', tip: 'Fine.', rating: 'solid', detail: [] }] }, limited: false,
    });
  });

  it('the limit notice is flagged', () => {
    expect(parseAnalysisAnswer({ ok: true, overall: 'Come back later.', overall_detail: [], tips: [], limited: true })?.limited).toBe(true);
    expect(parseAnalysisAnswer({ overall: 'x' })?.limited).toBe(false);
    expect(parseAnalysisAnswer({ overall: 'x', limited: 'yes' })?.limited).toBe(false);
  });

  it.each([[null], ['x'], [{}], [{ overall: 3 }]])('not an answer: %j', (body) => {
    expect(parseAnalysisAnswer(body)).toBeNull();
  });
});

describe('the other endpoints', () => {
  const race: Race = {
    id: 'r1', date: '2026-10-20T08:00:00.000Z', category: 'open', format: 'singles', gender: 'men', scale: 'full', totalSeconds: 4000,
    splits: [{ key: 'run1', title: '1km Run', atSeconds: 300 }, { key: 'skierg', title: 'SkiErg', atSeconds: 540 }], flagged: false, isNewPb: false, analysis: null,
  };

  it('hyroxLeaderboard asks for one exact board', async () => {
    const get = jest.fn(async () => ({ ok: true, leaderboard: [], me: null }));
    expect(await hyroxEndpoints(api({ get })).hyroxLeaderboard('men', 'pro', 'doubles')).toEqual({ rows: [], total: 0, mine: null });
    expect(get).toHaveBeenCalledWith('/api/hyrox/leaderboard', { gender: 'men', category: 'pro', format: 'doubles' });
    await expect(hyroxEndpoints(api({ get: jest.fn(async () => ({ ok: true })) })).hyroxLeaderboard('men', 'pro', 'doubles')).rejects.toMatchObject({ status: 502 });
  });

  it('analyzeHyroxRace sends the race as the server reads it, with time for the model', async () => {
    const request = jest.fn(async () => ({ ok: true, overall: 'Fast.', overall_detail: [], tips: [], limited: false }));
    const answer = await hyroxEndpoints(api({ request })).analyzeHyroxRace(race);
    expect(answer.analysis.overall).toBe('Fast.');
    expect(request).toHaveBeenCalledWith('/api/hyrox/analyze', {
      method: 'POST',
      json: { race: { category: 'open', format: 'singles', gender: 'men', total_seconds: 4000, segments: [{ key: 'run1', title: '1km Run', type: 'run', seconds: 300 }, { key: 'skierg', title: 'SkiErg', type: 'station', seconds: 240 }] } },
      timeoutMs: HYROX_ANALYSIS_TIMEOUT_MS,
    });
    expect(HYROX_ANALYSIS_TIMEOUT_MS).toBe(60_000);
  });

  it('an unreadable answer is a 502 and a refusal passes on', async () => {
    await expect(hyroxEndpoints(api({ request: jest.fn(async () => ({ ok: true })) })).analyzeHyroxRace(race)).rejects.toMatchObject({ status: 502 });
    const needs = new ApiError('consent', 403, { needs_ai_consent: true });
    await expect(hyroxEndpoints(api({ request: jest.fn().mockRejectedValue(needs) })).analyzeHyroxRace(race)).rejects.toBe(needs);
  });
});
