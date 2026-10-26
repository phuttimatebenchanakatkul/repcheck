import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import { getConfig } from '@/config';

import type { Database } from './database.types';
import { createChunkedStorage } from './secureStorage';

export type Supabase = SupabaseClient<Database>;

let client: Supabase | null = null;

/**
 * The app's one Supabase client. The session lives in the Keychain (see secureStorage.ts); refreshing it is paused while the
 * app is in the background and resumed on return, as Supabase recommends for React Native.
 */
export function getSupabase(): Supabase {
  if (client) return client;
  const { supabaseUrl, supabaseKey } = getConfig();
  client = createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      storage: createChunkedStorage(SecureStore),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // there is no browser URL to read a session from
      flowType: 'pkce', // OAuth returns a one-time code, never the tokens themselves, in the callback URL
    },
  });
  const created = client;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') created.auth.startAutoRefresh();
    else created.auth.stopAutoRefresh();
  });
  return created;
}
