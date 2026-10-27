import { getConfig } from '@/config';
import { getSupabase } from '@/supabase/client';

import { analyzeEndpoints } from './analyze';
import { chatEndpoints } from './chat';
import { createApi } from './client';
import { endpoints } from './endpoints';
import { planEndpoints } from './plan';
import { scanEndpoints } from './scan';

let instance: (ReturnType<typeof endpoints> & ReturnType<typeof scanEndpoints> & ReturnType<typeof planEndpoints> & ReturnType<typeof analyzeEndpoints> & ReturnType<typeof chatEndpoints>) | null = null;

/** The app's API, wired to the Supabase session: the access token is current (the SDK refreshes it) and a 401 triggers one forced refresh. */
export function getApi() {
  if (!instance) {
    const supabase = getSupabase();
    const api = createApi({
      baseUrl: getConfig().apiUrl,
      getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      refreshToken: async () => (await supabase.auth.refreshSession()).data.session?.access_token ?? null,
    });
    instance = { ...endpoints(api), ...scanEndpoints(api), ...planEndpoints(api), ...analyzeEndpoints(api), ...chatEndpoints(api) };
  }
  return instance;
}

export { ApiError } from './client';
export type { Profile } from './endpoints';
