/** The daily rep challenge and its leaderboard: templates/challenges.html is the original; the server (api/routes/social.py) decides everything that counts. */

/** The three exercises, in the order the server rotates through them (rep_form_analyzer.CHALLENGE_EXERCISES). */
export const CHALLENGE_EXERCISES = ['pushups', 'situps', 'pullups'] as const;
export type ChallengeExercise = (typeof CHALLENGE_EXERCISES)[number];

export const isChallengeExercise = (value: unknown): value is ChallengeExercise => (CHALLENGE_EXERCISES as readonly unknown[]).includes(value);

/** The server grades the first 25 seconds of a clip (video_trimmer.CHALLENGE_SECONDS), so that is as long as the recording runs. */
export const CHALLENGE_SECONDS = 25;
/** Time to get in position after pressing Start, counted down on screen. */
export const COUNTDOWN_SECONDS = 10;
/** Stopping inside the first couple of seconds hands the server a clip with nothing to trim. */
export const MIN_RECORDING_MS = 2000;
/** How many of the board are listed; your own standing is pinned above them. */
export const LEADERBOARD_LIMIT = 25;

export type LeaderboardScope = 'friends' | 'global';
/** Everyone, not just friends, so a new person sees the real competition at once; Friends is one tap away. */
export const DEFAULT_SCOPE: LeaderboardScope = 'global';

export interface Standing {
  userId: string;
  name: string;
  totalReps: number;
}

export interface Leaderboard {
  me: string;
  /** The top of the board, best first, as many as were asked for. */
  rows: Standing[];
  /** How many people are on the board in all. */
  total: number;
  /** Where you stand, or null when you have no reps yet. */
  mine: { rank: number; totalReps: number } | null;
}

export interface ListedStanding extends Standing {
  rank: number;
}

/** Everyone but you, each with the rank they hold on the whole board: you are shown pinned above, never twice. */
export function othersOnBoard(board: Leaderboard): ListedStanding[] {
  return board.rows.map((row, index) => ({ ...row, rank: index + 1 })).filter((row) => row.userId !== board.me);
}

/** How far a row is from you: null when you have no score to compare to, 0 when tied, else their reps minus yours. */
export function repGap(reps: number, myReps: number | null): number | null {
  return myReps === null ? null : reps - myReps;
}

/** The top three get the bigger numeral. */
export const isPodium = (rank: number): boolean => rank <= 3;

export interface Attempt {
  exercise: ChallengeExercise;
  /** Reps that counted (full range of motion). */
  counted: number;
  /** Reps attempted in all. */
  total: number;
  /** Reps that did not count. */
  rejected: number;
  notes: string;
}

/** The server's answer to a submitted clip, or null when it is not one. `total` is counted plus rejected when the server leaves it out. */
export function parseAttempt(body: unknown): Attempt | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const counted = whole(b.reps);
  if (counted === null || !isChallengeExercise(b.exercise)) return null;
  const total = whole(b.total) ?? counted + (whole(b.rejected) ?? 0);
  return { exercise: b.exercise, counted, total, rejected: Math.max(0, total - counted), notes: typeof b.notes === 'string' ? b.notes : '' };
}
