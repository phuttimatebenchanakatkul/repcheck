import { getConfig } from '@/config';
import { getSupabase } from '@/supabase/client';

import { createApi } from './client';
import { endpoints } from './endpoints';

let instance: ReturnType<typeof endpoints> | null = null;

/** The app's API, wired to the Supabase session: the access token is current (the SDK refreshes it) and a 401 triggers one forced refresh. */
export function getApi() {
  if (!instance) {
    const supabase = getSupabase();
    instance = endpoints(
      createApi({
        baseUrl: getConfig().apiUrl,
        getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
        refreshToken: async () => (await supabase.auth.refreshSession()).data.session?.access_token ?? null,
      }),
    );
  }
  return instance;
}

export { ApiError } from './client';
export type { Profile } from './endpoints';
