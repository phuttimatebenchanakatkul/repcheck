/** What the challenge screen reads: the server's (Flask API), so plain React Query reads that stay on the device like the other server reads. */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getApi } from '@/api';
import { useUserId } from '@/features/analyze/queries';
import { LEADERBOARD_LIMIT, type LeaderboardScope } from '@/logic/challenges';

export const challengeKeys = {
  all: (userId: string) => ['challenges', userId] as const,
  today: (userId: string) => ['challenges', userId, 'today'] as const,
  board: (userId: string, scope: LeaderboardScope) => ['challenges', userId, 'board', scope] as const,
};

export function useTodaysChallenge() {
  const userId = useUserId();
  return useQuery({ queryKey: challengeKeys.today(userId), queryFn: () => getApi().todaysChallenge() });
}

export function useLeaderboard(scope: LeaderboardScope) {
  const userId = useUserId();
  return useQuery({ queryKey: challengeKeys.board(userId, scope), queryFn: () => getApi().leaderboard(scope, LEADERBOARD_LIMIT) });
}

/** Call after an attempt is counted (or the day's attempt turns out to be spent): today's card and both boards are read again. */
export function useChallengeChanged(): () => Promise<void> {
  const userId = useUserId();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: challengeKeys.all(userId) });
}
