/** The Flask routes the app calls, typed. Each feature phase adds its own; the shapes are api/routes/*.py's. */
import type { Api } from './client';

export interface Profile {
  id: string;
  name: string;
  friend_code: string;
  onboarding_completed: boolean;
  ai_consent: boolean;
  /** ISO time the deletion was scheduled, or null. The account keeps working for the grace period. */
  deleted_at: string | null;
  /** The UTC day the deletion becomes final, or null. */
  due_at: string | null;
}

export interface DeletionSchedule {
  deleted_at: string;
  due_at: string;
  grace_days: number;
}

/** What the server said about an imported account's old password. */
export type LegacyLogin = 'migrated' | 'mismatch' | 'reset-required' | 'rate-limited' | 'unavailable';

export function endpoints(api: Api) {
  return {
    /**
     * Asks the server to check an email + password against the OLD website's hash (for an imported account). Needs no session.
     * 'migrated' means the password now works with Supabase, so the caller signs in again.
     */
    async legacyLogin(email: string, password: string): Promise<LegacyLogin> {
      try {
        await api.post('/api/auth/legacy-login', { email, password });
        return 'migrated';
      } catch (error) {
        const e = error as { status?: number; body?: { reset_required?: unknown } };
        if (e.status === 409 && e.body?.reset_required === true) return 'reset-required';
        if (e.status === 401) return 'mismatch';
        if (e.status === 429) return 'rate-limited';
        if (e.status === 0) return 'unavailable';
        throw error;
      }
    },

    health: async (): Promise<boolean> => (await api.get('/api/health')).ok === true,

    /** The caller's profile, or null if they have none yet (a first sign-in). */
    async getProfile(): Promise<Profile | null> {
      try {
        return (await api.get('/api/profile')).profile as Profile;
      } catch (error) {
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      }
    },

    /** Creates the profile on first use (idempotent: an existing one is returned untouched). `name` is required for email accounts. */
    async ensureProfile(name?: string): Promise<{ profile: Profile; created: boolean }> {
      const body = await api.post('/api/profile', name === undefined ? {} : { name });
      return { profile: body.profile as Profile, created: body.created === true };
    },

    async rename(name: string): Promise<void> {
      await api.post('/api/account', { name });
    },

    async setAiConsent(granted: boolean): Promise<boolean> {
      return (await api.post('/api/ai-consent', { granted })).granted === true;
    },

    async scheduleDeletion(): Promise<DeletionSchedule> {
      return (await api.del('/api/account')) as unknown as DeletionSchedule;
    },

    async restoreAccount(): Promise<void> {
      await api.post('/api/account/restore');
    },
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
