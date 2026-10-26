import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Component, useEffect, type ReactNode } from 'react';
import { Text } from 'react-native';

import { ApiError } from '@/api/client';
import type { Profile } from '@/api/endpoints';

import { AuthProvider, useAuth } from '../AuthProvider';

type Listener = (event: string, session: unknown) => void;

const mockAuth = {
  session: null as unknown,
  gate: null as Promise<void> | null,
  listener: null as Listener | null,
  unsubscribed: false,
};
const mockApi = {
  getProfile: jest.fn(),
  ensureProfile: jest.fn(),
};

jest.mock('@/supabase/client', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => {
        if (mockAuth.gate) await mockAuth.gate;
        return { data: { session: mockAuth.session } };
      },
      onAuthStateChange: (cb: Listener) => {
        mockAuth.listener = cb;
        return { data: { subscription: { unsubscribe: () => (mockAuth.unsubscribed = true) } } };
      },
    },
  }),
}));
jest.mock('@/api', () => ({ getApi: () => mockApi }));

const session = (id = 'u1', metadata: Record<string, unknown> = {}) => ({ access_token: `t-${id}`, user: { id, user_metadata: metadata } });
const profile = (name = 'Sam'): Profile => ({ id: 'u1', name, friend_code: 'RC-AAAAAA', onboarding_completed: false, ai_consent: false, deleted_at: null, due_at: null });

let latest: ReturnType<typeof useAuth>;
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    latest = auth; // after commit, so the tests read what the screen last rendered
  });
  return <Text testID="status">{auth.state.status}</Text>;
}

const status = () => screen.getByTestId('status').props.children as string;
const mount = () => render(<AuthProvider><Probe /></AuthProvider>);
const emit = (event: string, s: unknown) => act(async () => mockAuth.listener?.(event, s));

beforeEach(() => {
  mockAuth.session = null;
  mockAuth.gate = null;
  mockAuth.listener = null;
  mockAuth.unsubscribed = false;
  mockApi.getProfile.mockReset();
  mockApi.ensureProfile.mockReset();
});

describe('starting up', () => {
  it('starts loading, then signed out when there is no stored session', async () => {
    let open!: () => void;
    mockAuth.gate = new Promise<void>((resolve) => (open = resolve));
    await mount();
    expect(status()).toBe('loading'); // the stored session has not been read yet
    await act(async () => open());
    await waitFor(() => expect(status()).toBe('signed-out'));
    expect(mockApi.getProfile).not.toHaveBeenCalled();
  });

  it('a stored session with a profile goes straight to ready', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockResolvedValue(profile());
    await mount();
    await waitFor(() => expect(status()).toBe('ready'));
    expect(latest.state).toMatchObject({ status: 'ready', profile: { name: 'Sam' } });
    expect(mockApi.ensureProfile).not.toHaveBeenCalled();
  });

  it('stops listening when it unmounts', async () => {
    const view = await mount();
    await waitFor(() => expect(status()).toBe('signed-out'));
    await view.unmount();
    expect(mockAuth.unsubscribed).toBe(true);
  });
});

describe('a first sign-in', () => {
  it('creates the profile using the name typed at sign-up', async () => {
    mockAuth.session = session('u1', { full_name: 'Typed Name' });
    mockApi.getProfile.mockResolvedValue(null);
    mockApi.ensureProfile.mockImplementation(async (name?: string) => ({ profile: profile(name ?? 'Provider'), created: true }));
    await mount();
    await waitFor(() => expect(status()).toBe('ready'));
    expect(mockApi.ensureProfile).toHaveBeenCalledWith('Typed Name');
  });

  it('uses the name Apple shared, remembered at sign-in', async () => {
    mockApi.getProfile.mockResolvedValue(null);
    mockApi.ensureProfile.mockImplementation(async (name?: string) => ({ profile: profile(name ?? 'Provider'), created: true }));
    await mount();
    await waitFor(() => expect(status()).toBe('signed-out'));
    await act(async () => latest.rememberNameHint('Apple Person'));
    await emit('SIGNED_IN', session('u1'));
    await waitFor(() => expect(status()).toBe('ready'));
    expect(mockApi.ensureProfile).toHaveBeenCalledWith('Apple Person');
  });

  it('asks an email account with no usable name for one, then continues', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockResolvedValue(null);
    mockApi.ensureProfile.mockImplementation(async (name?: string) => {
      if (!name) throw new ApiError('Please enter your name.', 400);
      return { profile: profile(name), created: true };
    });
    await mount();
    await waitFor(() => expect(status()).toBe('needs-name'));
    let result: string | null = 'unset';
    await act(async () => {
      result = await latest.submitName('  Typed  ');
    });
    expect(result).toBeNull();
    expect(status()).toBe('ready');
    expect(mockApi.ensureProfile).toHaveBeenLastCalledWith('Typed');
  });

  it('returns the server’s message when the typed name is refused and stays on the name step', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockResolvedValue(null);
    mockApi.ensureProfile.mockRejectedValue(new ApiError('Please choose a different name.', 400));
    await mount();
    await waitFor(() => expect(status()).toBe('needs-name'));
    let result: string | null = null;
    await act(async () => {
      result = await latest.submitName('Nope');
    });
    expect(result).toBe('Please choose a different name.');
    expect(status()).toBe('needs-name');
  });

  it('submitName does nothing when not on the name step', async () => {
    await mount();
    await waitFor(() => expect(status()).toBe('signed-out'));
    expect(await latest.submitName('x')).toBeNull();
    expect(mockApi.ensureProfile).not.toHaveBeenCalled();
  });
});

describe('when the server cannot be reached', () => {
  it('shows an error with its message and retries on request', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0)).mockResolvedValueOnce(profile());
    await mount();
    await waitFor(() => expect(status()).toBe('error'));
    expect(latest.state).toMatchObject({ message: 'Could not reach the server.' });
    await act(async () => latest.retry());
    await waitFor(() => expect(status()).toBe('ready'));
  });

  it('retry does nothing unless there is an error', async () => {
    await mount();
    await waitFor(() => expect(status()).toBe('signed-out'));
    await act(async () => latest.retry());
    expect(mockApi.getProfile).not.toHaveBeenCalled();
  });

  it('retry does nothing once everything is fine (no flash of the setup screen)', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockResolvedValue(profile());
    await mount();
    await waitFor(() => expect(status()).toBe('ready'));
    mockApi.getProfile.mockClear();
    await act(async () => latest.retry());
    expect(status()).toBe('ready');
    expect(mockApi.getProfile).not.toHaveBeenCalled();
  });
});

describe('auth events', () => {
  it('signing out returns to signed-out from anywhere', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockResolvedValue(profile());
    await mount();
    await waitFor(() => expect(status()).toBe('ready'));
    await emit('SIGNED_OUT', null);
    expect(status()).toBe('signed-out');
  });

  it('a sign-out while the profile is still loading is not undone when the load finishes', async () => {
    mockAuth.session = session();
    let finish!: (p: Profile) => void;
    mockApi.getProfile.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await mount();
    await waitFor(() => expect(status()).toBe('setting-up'));
    await emit('SIGNED_OUT', null);
    await act(async () => finish(profile()));
    expect(status()).toBe('signed-out');
  });

  it('the SDK re-announcing SIGNED_IN for the same person does not restart setup', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockResolvedValue(profile());
    await mount();
    await waitFor(() => expect(status()).toBe('ready'));
    mockApi.getProfile.mockClear();
    await emit('SIGNED_IN', session('u1'));
    expect(status()).toBe('ready');
    expect(mockApi.getProfile).not.toHaveBeenCalled();
  });

  it('a different person signing in does restart setup', async () => {
    mockAuth.session = session('u1');
    mockApi.getProfile.mockResolvedValue(profile('First'));
    await mount();
    await waitFor(() => expect(status()).toBe('ready'));
    mockApi.getProfile.mockResolvedValue(profile('Second'));
    await emit('SIGNED_IN', session('u2'));
    await waitFor(() => expect(latest.state).toMatchObject({ status: 'ready', profile: { name: 'Second' } }));
  });

  it('a refreshed token swaps the session and keeps the profile', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockResolvedValue(profile());
    await mount();
    await waitFor(() => expect(status()).toBe('ready'));
    mockApi.getProfile.mockClear();
    await emit('TOKEN_REFRESHED', session('u1'));
    expect(latest.state).toMatchObject({ status: 'ready', session: { access_token: 't-u1' }, profile: { name: 'Sam' } });
    expect(mockApi.getProfile).not.toHaveBeenCalled();
  });

  it('a token refresh while signed out does not sign anyone in', async () => {
    await mount();
    await waitFor(() => expect(status()).toBe('signed-out'));
    await emit('TOKEN_REFRESHED', session());
    expect(status()).toBe('signed-out');
  });

  it('refreshProfile re-reads the profile (after a rename, say)', async () => {
    mockAuth.session = session();
    mockApi.getProfile.mockResolvedValue(profile('Old'));
    await mount();
    await waitFor(() => expect(status()).toBe('ready'));
    mockApi.getProfile.mockResolvedValue(profile('New'));
    await act(async () => latest.refreshProfile());
    expect(latest.state).toMatchObject({ profile: { name: 'New' } });
  });
});

describe('useAuth', () => {
  it("refuses to be used outside the provider", async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const caught: Error[] = [];
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: Error) {
        caught.push(error);
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    await render(<Boundary><Probe /></Boundary>);
    spy.mockRestore();
    expect(caught.map((e) => e.message).join()).toMatch(/AuthProvider/);
  });
});
