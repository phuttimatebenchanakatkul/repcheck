import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { getApi } from '@/api';
import { getSupabase } from '@/supabase/client';

import { loadOrCreateProfile, nameFromMetadata } from './profile';
import type { Profile } from '@/api/endpoints';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  /** Signed in, profile being fetched or created. */
  | { status: 'setting-up'; session: Session }
  /** Signed in, but an email account with no usable name: ask for one. */
  | { status: 'needs-name'; session: Session }
  /** Signed in and the server could not be reached or refused: let the person retry. */
  | { status: 'error'; session: Session; message: string }
  | { status: 'ready'; session: Session; profile: Profile };

interface AuthContextValue {
  state: AuthState;
  /** Create the profile with a name the person just typed (the `needs-name` step). */
  submitName: (name: string) => Promise<string | null>;
  /** Try the profile step again (after an error). */
  retry: () => void;
  /** Remember a name Apple shared at sign-in, used if the profile has to be created. */
  rememberNameHint: (name: string | null) => void;
  /** Re-read the profile (after a rename, consent change, ...). */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const nameHint = useRef<string | null>(null);
  const attempt = useRef(0);
  const current = useRef<AuthState>(state);
  useEffect(() => {
    current.current = state; // read by the auth listener below, which outlives any one render
  }, [state]);

  const setUp = useCallback(async (session: Session) => {
    const mine = ++attempt.current;
    setState({ status: 'setting-up', session });
    try {
      const outcome = await loadOrCreateProfile(getApi(), [nameFromMetadata(session.user.user_metadata), nameHint.current]);
      if (mine !== attempt.current) return; // a newer sign-in or a sign-out superseded this one
      setState(outcome.state === 'ready' ? { status: 'ready', session, profile: outcome.profile } : { status: 'needs-name', session });
    } catch (error) {
      if (mine !== attempt.current) return;
      setState({ status: 'error', session, message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) void setUp(data.session);
      else setState({ status: 'signed-out' });
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        attempt.current++;
        setState({ status: 'signed-out' });
      } else if (event === 'SIGNED_IN') {
        const now = current.current;
        // The SDK re-announces SIGNED_IN when the app returns to the foreground: that is the same person, not a new sign-in,
        // and starting over would flash the setup screen and reset whatever they were looking at.
        if ((now.status === 'ready' || now.status === 'setting-up') && now.session.user.id === session.user.id) {
          setState((s) => (s.status === 'ready' ? { ...s, session } : s));
        } else {
          void setUp(session);
        }
      } else if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Same person, newer token: keep the profile, swap the session (the API client reads it fresh on each call).
        setState((s) => (s.status === 'ready' ? { ...s, session } : s));
      }
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [setUp]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async submitName(name) {
        if (state.status !== 'needs-name') return null;
        try {
          const { profile } = await getApi().ensureProfile(name.trim());
          setState({ status: 'ready', session: state.session, profile });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : 'Something went wrong.';
        }
      },
      retry() {
        if (state.status === 'error') void setUp(state.session);
      },
      rememberNameHint(name) {
        nameHint.current = name;
      },
      async refreshProfile() {
        if (state.status !== 'ready') return;
        const profile = await getApi().getProfile();
        if (profile) setState({ ...state, profile });
      },
    }),
    [state, setUp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
