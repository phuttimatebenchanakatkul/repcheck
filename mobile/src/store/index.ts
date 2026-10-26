import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSupabase } from '@/supabase/client';

import { supabaseExecutor } from './executor';
import { Outbox } from './outbox';

let instance: Outbox | null = null;

/** The app's write queue, saved in AsyncStorage and sending through the signed-in Supabase client. */
export function getOutbox(): Outbox {
  if (!instance) instance = new Outbox(AsyncStorage, (op) => supabaseExecutor(getSupabase())(op));
  return instance;
}

export { clearCachedData, persister, queryClient, watchNetwork, CACHE_MAX_AGE_MS } from './queryClient';
export type { Operation } from './outbox';
