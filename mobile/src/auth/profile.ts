import { ApiError } from '@/api/client';
import type { Endpoints, Profile } from '@/api/endpoints';

/**
 * What the app does with a freshly signed-in person.
 *  - They have a profile: use it.
 *  - They do not (a first sign-in): create it. The server accepts a typed name only if it passes its display-name filter,
 *    and an OAuth account with no usable name gets the provider's own (or "Apple User"). An email account must supply one.
 *  - The name hints are tried best first (what the person typed at sign-up, then what Apple shared), and a hint the filter
 *    refuses is dropped silently rather than blocking sign-in.
 */
export type ProfileOutcome = { state: 'ready'; profile: Profile } | { state: 'needs-name' };

function usable(name: string | null | undefined): name is string {
  return typeof name === 'string' && name.trim().length > 0;
}

export async function loadOrCreateProfile(api: Endpoints, nameHints: readonly (string | null | undefined)[] = []): Promise<ProfileOutcome> {
  const existing = await api.getProfile();
  if (existing) return { state: 'ready', profile: existing };

  for (const hint of nameHints.filter(usable)) {
    try {
      return { state: 'ready', profile: (await api.ensureProfile(hint.trim())).profile };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 400) throw error; // only "that name is not allowed" is skipped
    }
  }
  try {
    return { state: 'ready', profile: (await api.ensureProfile()).profile };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) return { state: 'needs-name' };
    throw error;
  }
}

/** The name a person typed at sign-up (or a provider supplied), from the session's user metadata. */
export function nameFromMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata?.full_name ?? metadata?.name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
