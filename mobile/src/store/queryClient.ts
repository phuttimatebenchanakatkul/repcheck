import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data the person sees is kept for a day on the device so the app opens instantly and works offline. */
export const CACHE_MAX_AGE_MS = DAY_MS;
export const CACHE_KEY = 'repcheck-query-cache-v1';

/** Do not retry a request the server refused (4xx): the answer will not change. Retry the rest a few times. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return failureCount < 3;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: CACHE_MAX_AGE_MS, // must be >= the persister's maxAge, or restored entries are dropped at once
        retry: shouldRetry,
        networkMode: 'offlineFirst', // show the cached copy with no signal; fetch when there is one
      },
      mutations: { networkMode: 'offlineFirst' },
    },
  });
}

export const queryClient = createQueryClient();

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: CACHE_KEY, throttleTime: 1_000 });

/** Tells React Query when the device is online, from the OS. Returns the unsubscribe. */
export function watchNetwork(): () => void {
  void Network.getNetworkStateAsync().then((state) => onlineManager.setOnline(state.isConnected !== false));
  const subscription = Network.addNetworkStateListener((state) => onlineManager.setOnline(state.isConnected !== false));
  return () => subscription.remove();
}

/** Sign-out or a different person: nothing cached for the last one may be shown to the next. */
export async function clearCachedData(client: QueryClient = queryClient): Promise<void> {
  client.clear();
  await AsyncStorage.removeItem(CACHE_KEY);
}
