/** The daily challenge and its leaderboard (api/routes/social.py). */
import { isChallengeExercise, parseAttempt, type Attempt, type ChallengeExercise, type Leaderboard, type LeaderboardScope, type Standing } from '../logic/challenges';
import { uploadNameAndType, type PickedVideo } from './analyze';
import { ApiError, type Api } from './client';

/** The server counts reps with a model that watches the clip, which takes a while on top of the upload. */
export const CHALLENGE_UPLOAD_TIMEOUT_MS = 5 * 60_000;

export interface TodaysChallenge {
  exercise: ChallengeExercise;
  /** The server has already taken an attempt at this exercise today (one a day). */
  attempted: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseToday(body: unknown): TodaysChallenge | null {
  if (!isRecord(body) || !isChallengeExercise(body.exercise)) return null;
  return { exercise: body.exercise, attempted: body.attempted === true };
}

function parseStanding(value: unknown): Standing | null {
  if (!isRecord(value) || typeof value.user_id !== 'string' || !value.user_id) return null;
  const reps = value.total_reps;
  if (typeof reps !== 'number' || !Number.isFinite(reps) || reps < 0) return null;
  return { userId: value.user_id, name: typeof value.name === 'string' ? value.name : '', totalReps: reps };
}

export function parseLeaderboard(body: unknown): Leaderboard | null {
  if (!isRecord(body) || typeof body.me !== 'string' || !Array.isArray(body.leaderboard)) return null;
  const rows = body.leaderboard.map(parseStanding);
  if (!rows.every((row): row is Standing => row !== null)) return null;
  const mine = isRecord(body.myRank) && typeof body.myRank.rank === 'number' && typeof body.myRank.total_reps === 'number' ? { rank: body.myRank.rank, totalReps: body.myRank.total_reps } : null;
  const total = typeof body.totalEntries === 'number' && Number.isFinite(body.totalEntries) ? body.totalEntries : rows.length;
  return { me: body.me, rows, total, mine };
}

const unreadable = (body: Record<string, unknown>) => new ApiError("Couldn't read that result. Please try again.", 502, body);

/** Whether a refusal is the once-a-day limit (the server marks it `limitReached`). */
export const isLimitReached = (error: unknown): boolean => error instanceof ApiError && error.body.limitReached === true;

export function challengeEndpoints(api: Api) {
  return {
    /** Today's exercise (one rotates in each day, for everybody) and whether I have already had my attempt at it. */
    async todaysChallenge(): Promise<TodaysChallenge> {
      const body = await api.get('/api/challenges/today');
      const today = parseToday(body);
      if (!today) throw unreadable(body);
      return today;
    },

    /** A new challenge for today's exercise to submit to. 429 with `limitReached` when today's attempt is already used. */
    async createChallenge(): Promise<{ id: number; exercise: ChallengeExercise }> {
      const body = await api.post('/api/challenges');
      if (typeof body.id !== 'number' || !isChallengeExercise(body.exercise)) throw unreadable(body);
      return { id: body.id, exercise: body.exercise };
    },

    /**
     * Counts the reps in a recorded clip and puts them on the board. Throws ApiError: 403 `needsAiConsent`, 429 `limitReached` (an attempt
     * a day), 400 for a clip the server cannot read. A retake only replaces a lower score, and the attempt is given back if no count came.
     */
    async submitChallengeClip(challengeId: number, video: PickedVideo): Promise<Attempt> {
      const form = new FormData();
      const { name, type } = uploadNameAndType(video);
      // React Native's FormData takes a {uri, name, type} object for a file; the server checks the real bytes, not this label.
      form.append('video', { uri: video.uri, name, type } as unknown as Blob);
      const body = await api.upload(`/api/challenges/${encodeURIComponent(String(challengeId))}/submit`, form, CHALLENGE_UPLOAD_TIMEOUT_MS);
      const attempt = parseAttempt(body);
      if (!attempt) throw unreadable(body);
      return attempt;
    },

    /** Total reps across every challenge, most first: the caller and their friends, or everybody. Blocked people are left out by the server. */
    async leaderboard(scope: LeaderboardScope, limit: number): Promise<Leaderboard> {
      const body = await api.get('/api/leaderboard', { scope, limit });
      const board = parseLeaderboard(body);
      if (!board) throw unreadable(body);
      return board;
    },
  };
}
