/**
 * What the friends and safety screens read. Friends and blocks are the server's (Flask API), so these are plain React Query reads, persisted
 * on the device like the other server reads; any change (add, block, report, unblock) refreshes them together.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, getApi } from '@/api';
import { useUserId } from '@/features/analyze/queries';

export const socialKeys = {
  all: (userId: string) => ['social', userId] as const,
  friends: (userId: string) => ['social', userId, 'friends'] as const,
  blocked: (userId: string) => ['social', userId, 'blocked'] as const,
};

export function useFriends() {
  const userId = useUserId();
  return useQuery({ queryKey: socialKeys.friends(userId), queryFn: () => getApi().friends() });
}

export function useBlockedAccounts() {
  const userId = useUserId();
  return useQuery({ queryKey: socialKeys.blocked(userId), queryFn: () => getApi().blockedAccounts() });
}

/** Call after anything that changes who is visible: the friends list and the blocked list are read again. */
export function useSocialChanged(): () => Promise<void> {
  const userId = useUserId();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: socialKeys.all(userId) });
}

/** The server's own words when it refused (a 4xx: no such code, too many tries), the general line for anything else. */
export function shownMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.status !== 0 && error.status < 500 ? error.message : fallback;
}
