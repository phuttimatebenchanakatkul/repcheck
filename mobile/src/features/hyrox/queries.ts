/** What the HYROX leaderboard reads: the server's (Flask API), so a plain React Query read that stays on the device like the other server reads. */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getApi } from '@/api';
import { useUserId } from '@/features/analyze/queries';
import type { Category, Format } from '@/logic/hyrox';

export const hyroxKeys = {
  all: (userId: string) => ['hyrox', userId] as const,
  board: (userId: string, gender: string, category: Category, format: Format) => ['hyrox', userId, 'board', gender, category, format] as const,
};

/** One board; not asked for at all until there is a gender to ask about. */
export function useHyroxBoard(gender: string | null, category: Category, format: Format) {
  const userId = useUserId();
  return useQuery({
    queryKey: hyroxKeys.board(userId, gender ?? '', category, format),
    queryFn: () => getApi().hyroxLeaderboard(gender as string, category, format),
    enabled: gender !== null,
  });
}

/** Call after anything that changes a board (a block, a report, a new time): every board is read again. */
export function useBoardChanged(): () => Promise<void> {
  const userId = useUserId();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: hyroxKeys.all(userId) });
}
