import type { Supabase } from '@/supabase/client';

/**
 * Records that the person has been through the profile questions. `profiles.onboarding_completed` is one of the few columns the app may
 * write directly (the table grants update on that column only). A failure is not worth stopping for: the wizard's own result is already
 * saved, and the flag is set again the next time a profile is saved. Returns whether it was written.
 */
export async function markOnboardingDone(supabase: Supabase, userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', userId);
    return !error;
  } catch {
    return false;
  }
}
