/**
 * What the analyze screens read. Analyses are the server's (Flask API, not the Supabase Data API), so they are plain React Query reads:
 * persisted on the device like everything else, so the last list and any analysis already opened still show with no signal.
 */
import { useQuery } from '@tanstack/react-query';

import { getApi } from '@/api';
import { useAuth } from '@/auth/AuthProvider';

function useUserId(): string {
  const { state } = useAuth();
  return state.status === 'ready' ? state.profile.id : 'signed-out';
}

export const analyzeKeys = {
  all: (userId: string) => ['analyze', userId] as const,
  history: (userId: string) => ['analyze', userId, 'history'] as const,
  detail: (userId: string, id: number) => ['analyze', userId, 'detail', id] as const,
};

export function useAnalysisHistory() {
  const userId = useUserId();
  return useQuery({ queryKey: analyzeKeys.history(userId), queryFn: () => getApi().analysisHistory() });
}

export function useAnalysis(id: number) {
  const userId = useUserId();
  return useQuery({ queryKey: analyzeKeys.detail(userId, id), queryFn: () => getApi().analysis(id), enabled: Number.isInteger(id) && id > 0 });
}

export { useUserId };
