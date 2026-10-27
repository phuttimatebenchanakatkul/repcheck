/** The HYROX routes that are the server's (api/routes/social.py, planning.py): the leaderboard and the AI's read of a race. Races themselves are the person's own data. */
import { analysisFromJson, segmentDurations, type HyroxBoard, type Race, type RaceAnalysis } from '../logic/hyrox';
import { ApiError, type Api } from './client';

export interface LeaderboardResult {
  gender: string;
  category: string;
  format: string;
  total_seconds: number;
}

/** A model reads the splits, which takes a while (the server gives it 30 seconds). */
export const HYROX_ANALYSIS_TIMEOUT_MS = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseBoard(body: unknown): HyroxBoard | null {
  if (!isRecord(body) || !Array.isArray(body.leaderboard)) return null;
  const rows: HyroxBoard['rows'] = [];
  for (const row of body.leaderboard) {
    if (!isRecord(row) || typeof row.user_id !== 'string' || !row.user_id || typeof row.best_seconds !== 'number' || !Number.isFinite(row.best_seconds)) return null;
    rows.push({ userId: row.user_id, name: typeof row.name === 'string' ? row.name : '', bestSeconds: row.best_seconds });
  }
  const me = body.me;
  const mine =
    isRecord(me) && typeof me.rank === 'number' && typeof me.best_seconds === 'number' ? { rank: me.rank, bestSeconds: me.best_seconds, name: typeof me.name === 'string' ? me.name : '' } : null;
  const total = typeof body.totalEntries === 'number' && Number.isFinite(body.totalEntries) ? body.totalEntries : rows.length;
  return { rows, total, mine };
}

export interface AnalysisAnswer {
  analysis: RaceAnalysis;
  /** The day's allowance of analyses is used: `analysis.overall` says when to come back and there are no tips. Not a real analysis, so it is not kept. */
  limited: boolean;
}

export function parseAnalysisAnswer(body: unknown): AnalysisAnswer | null {
  if (!isRecord(body)) return null;
  const analysis = analysisFromJson({ overall: body.overall, overallDetail: body.overall_detail, tips: body.tips });
  return analysis ? { analysis, limited: body.limited === true } : null;
}

const unreadable = (body: Record<string, unknown>) => new ApiError("Couldn't read that result. Please try again.", 502, body);

export function hyroxEndpoints(api: Api) {
  return {
    /**
     * Puts a finished race's time on the global leaderboard (the server keeps each person's fastest per gender, category and format).
     * Best effort: the race is already saved to the history, so a refusal or no signal just means it does not count there yet. True if taken.
     */
    async submitHyroxResult(result: LeaderboardResult): Promise<boolean> {
      try {
        await api.post('/api/hyrox/results', result);
        return true;
      } catch {
        return false;
      }
    },

    /** One board: everyone's fastest time at an exact gender, category and format, best first. Blocked people are left out by the server. */
    async hyroxLeaderboard(gender: string, category: string, format: string): Promise<HyroxBoard> {
      const body = await api.get('/api/hyrox/leaderboard', { gender, category, format });
      const board = parseBoard(body);
      if (!board) throw unreadable(body);
      return board;
    },

    /**
     * The AI's read of a race: where it was won and lost, station by station. Throws ApiError: 403 `needsAiConsent`, 400 for a race it
     * cannot read. A use is only spent when it answers; at the daily limit the answer is a notice (`limited`) rather than an error.
     */
    async analyzeHyroxRace(race: Race): Promise<AnalysisAnswer> {
      const body = await api.request('/api/hyrox/analyze', {
        method: 'POST',
        json: { race: { category: race.category, format: race.format, gender: race.gender, total_seconds: race.totalSeconds, segments: segmentDurations(race) } },
        timeoutMs: HYROX_ANALYSIS_TIMEOUT_MS,
      });
      const answer = parseAnalysisAnswer(body);
      if (!answer) throw unreadable(body);
      return answer;
    },
  };
}
