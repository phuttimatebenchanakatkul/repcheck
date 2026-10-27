import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Alert, Appearance } from 'react-native';

import { ApiError } from '@/api/client';
import { getLanguage, setLanguage } from '@/i18n';
import { remindersAreOn, resetReminderPref } from '@/store/remindersPref';
import { USER, dataHarness } from '@/testing/dataHarness';

import SettingsScreen from '../SettingsScreen';

const mockApi = { rename: jest.fn(), setAiConsent: jest.fn(), scheduleDeletion: jest.fn(), restoreAccount: jest.fn(), blockedAccounts: jest.fn(), unblockAccount: jest.fn() };
const mockSignOut = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
const mockAuth: { state: Record<string, unknown> } = { state: {} };
const profile = (over: Record<string, unknown> = {}) => ({ id: USER, name: 'Sam', friend_code: 'RC-AAAAAA', onboarding_completed: true, ai_consent: true, deleted_at: null, due_at: null, ...over });
const signedIn = (over: Record<string, unknown> = {}, user: Record<string, unknown> = {}) => ({
  status: 'ready',
  profile: profile(over),
  session: { user: { id: USER, email: 'sam@example.com', app_metadata: { provider: 'email' }, ...user } },
});

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ state: mockAuth.state, refreshProfile: mockRefresh }) }));
jest.mock('@/auth/actions', () => ({ signOut: (...args: unknown[]) => mockSignOut(...args) }));
jest.mock('@/supabase/client', () => ({ getSupabase: () => ({ marker: 'supabase' }) }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));
jest.mock('@/i18n/storage', () => ({ chooseLanguage: jest.fn(async (language: 'en' | 'th') => require('@/i18n').setLanguage(language)) }));

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <SettingsScreen />
    </h.Provider>,
  );
  await waitFor(() => expect(mockApi.blockedAccounts).toHaveBeenCalled());
  await act(async () => undefined); // the blocked list settles inside the test, not after it
  return h;
}
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const choose = async (name: string) => {
  await fireEvent.press(await screen.findByRole('radio', { name }));
};

beforeEach(async () => {
  jest.clearAllMocks();
  resetReminderPref();
  await AsyncStorage.clear();
  setLanguage('en');
  mockAuth.state = signedIn();
  mockApi.rename.mockResolvedValue(undefined);
  mockApi.setAiConsent.mockResolvedValue(true);
  mockApi.scheduleDeletion.mockResolvedValue({ deleted_at: '2026-10-27T00:00:00+00:00', due_at: '2026-11-26', grace_days: 30 });
  mockApi.restoreAccount.mockResolvedValue(undefined);
  mockApi.blockedAccounts.mockResolvedValue([]);
  mockApi.unblockAccount.mockResolvedValue(undefined);
  jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
});

describe('the account', () => {
  it('shows the name and the email, and an email account manages its own', async () => {
    await open();
    expect(screen.getByLabelText('Name').props.value).toBe('Sam');
    expect(screen.getByTestId('account-email')).toHaveTextContent('sam@example.com');
    expect(screen.queryByText(/email is managed there/)).toBeNull();
  });

  it.each([['apple', 'Apple'], ['google', 'Google']])('with %s the email is managed there', async (provider, shown) => {
    mockAuth.state = signedIn({}, { app_metadata: { provider } });
    await open();
    expect(screen.getByText(`Signed in with ${shown} — email is managed there.`)).toBeOnTheScreen();
  });

  it('saves a new name, trimmed, and reloads the profile', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Save changes' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Sam Lee  ');
    await press('Save changes');
    expect(await screen.findByText('Saved ✓')).toBeOnTheScreen();
    expect(mockApi.rename).toHaveBeenCalledWith('Sam Lee');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('cannot save an empty name or the same one', async () => {
    await open();
    await fireEvent.changeText(screen.getByLabelText('Name'), '   ');
    expect(screen.getByRole('button', { name: 'Save changes' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Sam');
    expect(screen.getByRole('button', { name: 'Save changes' }).props.accessibilityState.disabled).toBe(true);
  });

  it.each([
    ['a name the server refuses', new ApiError('That name isn’t allowed.', 400), 'That name isn’t allowed.'],
    ['no signal', new ApiError('Could not reach the server.', 0), 'Couldn\'t save.'],
    ['a server error', new ApiError('boom', 500), 'Couldn\'t save.'],
  ])('%s: shows why, and the saved mark goes when the name is edited again', async (_name, error, shown) => {
    mockApi.rename.mockRejectedValueOnce(error);
    await open();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Other');
    await press('Save changes');
    expect(await screen.findByText(shown)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Other 2');
    expect(screen.queryByText(shown)).toBeNull();
  });
});

describe('appearance, language and units', () => {
  it('the theme: system, light or dark, applied at once and saved to the account', async () => {
    const h = await open();
    expect(screen.getByRole('radio', { name: 'System' }).props.accessibilityState.selected).toBe(true);
    await choose('🌙 Dark');
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('dark');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('user_settings')[0]).toMatchObject({ user_id: USER, theme: 'dark' });
    await choose('System');
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified');
    await choose('☀️ Light');
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('light');
  });

  it('the language switches at once and is saved to the account', async () => {
    const h = await open();
    await choose('TH ไทย');
    expect(getLanguage()).toBe('th');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('user_settings')[0]).toMatchObject({ language: 'th' });
  });

  it.each([
    ['Weight', 'lb', 'units_weight', 'lb'],
    ['Height', 'ft / in', 'units_height', 'ftin'],
    ['Distance', 'm', 'units_distance', 'm'],
    ['Clock', '24-hour', 'units_clock', '24h'],
  ])('%s: choosing %s is saved as %s=%s and the other three are kept', async (group, label, column, value) => {
    const h = dataHarness();
    h.db.seed('user_settings', [{ user_id: USER, theme: null, language: null, units_weight: 'kg', units_height: 'cm', units_distance: 'km', units_clock: '12h', hyrox_leaderboard_gender: null, hyrox_facility_lane_m: null, hyrox_history_backfilled: false, extra: {} }]);
    await open(h);
    await act(async () => undefined);
    expect(screen.getByLabelText(group)).toBeOnTheScreen();
    await choose(label);
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('user_settings')[0]).toMatchObject({ units_weight: 'kg', units_height: 'cm', units_distance: 'km', units_clock: '12h', [column]: value });
  });

  it('a change that cannot be queued says so', async () => {
    const h = dataHarness();
    jest.spyOn(h.outbox, 'enqueue').mockRejectedValue(new Error('full'));
    await open(h);
    await choose('lb');
    expect(await screen.findByText("Couldn't save.")).toBeOnTheScreen();
  });
});

describe('AI features', () => {
  it('on: says so, and turning it off withdraws consent', async () => {
    await open();
    expect(screen.getByTestId('ai-state')).toHaveTextContent('On — you agreed to send content to Google Gemini.');
    await press('Turn off');
    await waitFor(() => expect(mockApi.setAiConsent).toHaveBeenCalledWith(false));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('off: says so, and turning it on grants consent', async () => {
    mockAuth.state = signedIn({ ai_consent: false });
    await open();
    expect(screen.getByTestId('ai-state')).toHaveTextContent('Off — nothing is sent to an AI provider.');
    await press('Turn on');
    await waitFor(() => expect(mockApi.setAiConsent).toHaveBeenCalledWith(true));
  });

  it('a failure is shown', async () => {
    mockApi.setAiConsent.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await press('Turn off');
    expect(await screen.findByText("Couldn't save.")).toBeOnTheScreen();
  });

  it('links to what is sent and how it is handled', async () => {
    await open();
    await fireEvent.press(screen.getByRole('link', { name: "What is sent, and how it's handled" }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith('https://repcheck-q0m4.onrender.com/privacy#ai');
  });
});

describe('legal pages and log out', () => {
  it.each([
    ['Contact us', '/support'],
    ['Privacy Policy', '/privacy'],
    ['Terms of Service', '/terms'],
    ['Cookie Policy', '/cookies'],
    ['Refund Policy', '/refunds'],
    ['Sources & health information', '/sources'],
  ])('%s opens %s in the in-app browser', async (name, path) => {
    await open();
    await press(name);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(`https://repcheck-q0m4.onrender.com${path}`);
  });

  it('log out signs out', async () => {
    await open();
    await press('Log out');
    expect(mockSignOut).toHaveBeenCalledWith({ marker: 'supabase' });
  });
});

describe('deleting the account', () => {
  const confirm = () => (Alert.alert as jest.Mock).mock.calls[0];

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('says what happens and what is erased, and asks before doing anything', async () => {
    await open();
    expect(screen.getByText(/permanently erased after 30 days/)).toBeOnTheScreen();
    expect(screen.getByText(/Erased: your workouts, nutrition logs/)).toBeOnTheScreen();
    await press('Delete my account');
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(confirm()[1]).toBe('Delete your account? It will be permanently erased after 30 days. You can cancel by logging back in before then.');
    expect(mockApi.scheduleDeletion).not.toHaveBeenCalled();
  });

  it('cancelling the question deletes nothing', async () => {
    await open();
    await press('Delete my account');
    const [, , buttons] = confirm();
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Cancel', 'Delete my account']);
    expect(buttons[0].style).toBe('cancel');
    expect(buttons[0].onPress).toBeUndefined();
    expect(mockApi.scheduleDeletion).not.toHaveBeenCalled();
  });

  it('confirming schedules the deletion and reloads the profile', async () => {
    await open();
    await press('Delete my account');
    const [, , buttons] = confirm();
    expect(buttons[1].style).toBe('destructive');
    await act(async () => buttons[1].onPress());
    expect(mockApi.scheduleDeletion).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('a failure to schedule says so', async () => {
    mockApi.scheduleDeletion.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await press('Delete my account');
    const [, , buttons] = confirm();
    await act(async () => buttons[1].onPress());
    expect(await screen.findByText('Could not delete your account. Please try again.')).toBeOnTheScreen();
  });

  it('once scheduled it shows the date and offers to keep the account instead of deleting', async () => {
    mockAuth.state = signedIn({ deleted_at: '2026-10-27T00:00:00+00:00', due_at: '2026-11-26' });
    await open();
    expect(screen.getByTestId('deletion-scheduled')).toHaveTextContent('Scheduled for deletion on November 26, 2026.');
    expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull();
    await press('Keep my account');
    await waitFor(() => expect(mockApi.restoreAccount).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your account is no longer scheduled for deletion.')).toBeOnTheScreen();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('a failure to restore says so', async () => {
    mockAuth.state = signedIn({ deleted_at: '2026-10-27T00:00:00+00:00', due_at: '2026-11-26' });
    mockApi.restoreAccount.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await press('Keep my account');
    expect(await screen.findByText('Could not delete your account. Please try again.')).toBeOnTheScreen();
  });
});

describe('survivors: busy buttons and who says what', () => {
  /** A button that is working shows a spinner in place of its words, so it is found by its state. */
  const busyButtons = () => screen.getAllByRole('button').filter((b) => b.props.accessibilityState?.busy === true).length;

  it('the AI switch shows it is working while the change is sent, then is ready again', async () => {
    let finish: (v: boolean) => void = () => undefined;
    mockApi.setAiConsent.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
    await open();
    await press('Turn off');
    expect(busyButtons()).toBe(1);
    await act(async () => finish(false));
    expect(screen.getByRole('button', { name: 'Turn off' }).props.accessibilityState).toMatchObject({ busy: false, disabled: false });
  });

  it('a refusal from the server is shown in its own words; no signal or a server error is the general line', async () => {
    mockApi.setAiConsent.mockRejectedValueOnce(new ApiError('No profile yet. Create it first.', 404));
    await open();
    await press('Turn off');
    expect(await screen.findByText('No profile yet. Create it first.')).toBeOnTheScreen();
    mockApi.setAiConsent.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await press('Turn off');
    expect(await screen.findByText("Couldn't save.")).toBeOnTheScreen();
    expect(screen.queryByText('Could not reach the server.')).toBeNull();
  });

  it('deleting shows it is working, and keeping the account does too', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    let finish: (v: unknown) => void = () => undefined;
    mockApi.scheduleDeletion.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await open();
    await press('Delete my account');
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    await act(async () => void buttons[1].onPress());
    expect(screen.getByRole('button', { name: 'Delete my account' }).props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await act(async () => finish({ deleted_at: 'x', due_at: '2026-11-26', grace_days: 30 }));
    expect(screen.getByRole('button', { name: 'Delete my account' }).props.accessibilityState).toMatchObject({ busy: false, disabled: false });
  });

  it('keep my account shows it is working, then is ready', async () => {
    mockAuth.state = signedIn({ deleted_at: '2026-10-27T00:00:00+00:00', due_at: '2026-11-26' });
    let finish: (v?: unknown) => void = () => undefined;
    mockApi.restoreAccount.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await open();
    await press('Keep my account');
    expect(busyButtons()).toBe(1);
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Keep my account' }).props.accessibilityState).toMatchObject({ busy: false });
  });

  it('good news is not announced as an alert, and bad news is', async () => {
    mockAuth.state = signedIn({ deleted_at: '2026-10-27T00:00:00+00:00', due_at: '2026-11-26' });
    await open();
    await press('Keep my account');
    await screen.findByText('Your account is no longer scheduled for deletion.');
    expect(screen.queryByRole('alert')).toBeNull();
    mockApi.restoreAccount.mockRejectedValueOnce(new ApiError('boom', 500));
    await press('Keep my account');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete your account. Please try again.');
  });
});

describe('the coaching questions', () => {
  const profile = {
  user_id: USER, aspiration: 'lose', gender: 'female', weight_kg: 70, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high', diet_preference: 'low_carb',
  goal_weight_kg: 62, height_cm: 165, distribution_mode: 'weekly', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: '2026-01-05', last_adjustment_on: '2026-10-20',
  last_adjustment_reason: null, last_adjustment_delta: null, last_adjustment_at: null, weekly_distribution: null, goal_achieved_weight_kg: null, goal_achieved_aspiration: null,
  goal_handled_weight_kg: null, goal_handled_aspiration: null, inactivity_notified_on: null, extra: {},
};

  it('are offered to set up when there is no profile', async () => {
    await open();
    expect(await screen.findByText('Get a calorie and macro target built for you.')).toBeOnTheScreen();
    await press('Set up personalized coaching');
    expect(mockPush).toHaveBeenCalledWith('/coaching-wizard');
  });

  it('can be gone through again once there is one', async () => {
    const h = dataHarness();
    h.db.seed('coaching_profiles', [profile]);
    await open(h);
    await press('Edit profile');
    expect(mockPush).toHaveBeenCalledWith('/coaching-wizard');
    expect(screen.queryByText('Get a calorie and macro target built for you.')).toBeNull();
  });
});

describe('blocked accounts', () => {
  const PEOPLE = [{ id: 'u-2', name: 'Alex' }, { id: 'u-3', name: 'Bo' }];
  const unblockIn = async (id: string) => fireEvent.press(await within(await screen.findByTestId(`blocked-${id}`)).findByRole('button', { name: 'Unblock' }));

  it('says so when nobody is blocked', async () => {
    await open();
    expect(await screen.findByTestId('blocked-empty')).toHaveTextContent("You haven't blocked anyone.");
  });

  it('lists who is blocked, newest first as the server sends them', async () => {
    mockApi.blockedAccounts.mockResolvedValue(PEOPLE);
    await open();
    expect(within(await screen.findByTestId('blocked-u-2')).getByText('Alex')).toBeOnTheScreen();
    expect(within(screen.getByTestId('blocked-u-3')).getByText('Bo')).toBeOnTheScreen();
    expect(screen.queryByTestId('blocked-empty')).toBeNull();
  });

  it('unblocking asks the server, then the list is read again without them', async () => {
    mockApi.blockedAccounts.mockResolvedValueOnce(PEOPLE).mockResolvedValue([PEOPLE[1]]);
    await open();
    await unblockIn('u-2');
    await waitFor(() => expect(screen.queryByTestId('blocked-u-2')).toBeNull());
    expect(mockApi.unblockAccount).toHaveBeenCalledWith('u-2');
    expect(screen.getByTestId('blocked-u-3')).toBeOnTheScreen();
  });

  it('a failed unblock says so and leaves the list alone', async () => {
    mockApi.blockedAccounts.mockResolvedValue(PEOPLE);
    mockApi.unblockAccount.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await unblockIn('u-2');
    expect(await screen.findByRole('alert')).toHaveTextContent("That didn't work. Try again.");
    expect(screen.getByTestId('blocked-u-2')).toBeOnTheScreen();
  });

  it('the server’s own words are shown for a refusal', async () => {
    mockApi.blockedAccounts.mockResolvedValue(PEOPLE);
    mockApi.unblockAccount.mockRejectedValueOnce(new ApiError('Which account?', 400));
    await open();
    await unblockIn('u-3');
    expect(await screen.findByRole('alert')).toHaveTextContent('Which account?');
  });

  it('a list that cannot be read offers to try again', async () => {
    mockApi.blockedAccounts.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValue(PEOPLE);
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent("That didn't work. Try again.");
    await press('Try again');
    expect(await screen.findByTestId('blocked-u-2')).toBeOnTheScreen();
  });
});

describe('reminders', () => {
  const notifications = Notifications as unknown as { getPermissionsAsync: jest.Mock; requestPermissionsAsync: jest.Mock };

  beforeEach(() => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  });

  it('are off until turned on, and say what they are', async () => {
    await open();
    expect(screen.getByTestId('reminders-state')).toHaveTextContent('Off');
    expect(screen.getByText(/A notification when your weekly check-in is due/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Turn on reminders' })).toBeOnTheScreen();
  });

  it('turning them on asks permission, then they are on and kept for next time', async () => {
    await open();
    await press('Turn on reminders');
    await waitFor(() => expect(screen.getByTestId('reminders-state')).toHaveTextContent('On'));
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(remindersAreOn()).toBe(true);
    expect(await AsyncStorage.getItem('repcheck_reminders')).toBe('on');
    expect(screen.getByRole('button', { name: 'Turn off reminders' })).toBeOnTheScreen();
  });

  it('already allowed: no question, they are simply on', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    await open();
    await press('Turn on reminders');
    await waitFor(() => expect(screen.getByTestId('reminders-state')).toHaveTextContent('On'));
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('if the phone says no, they stay off and the person is told how to change that', async () => {
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await open();
    await press('Turn on reminders');
    expect(await screen.findByText("Notifications are off for RepCheck. Turn them on in your phone's Settings to get reminders.")).toBeOnTheScreen();
    expect(screen.getByTestId('reminders-state')).toHaveTextContent('Off');
    expect(remindersAreOn()).toBe(false);
    expect(await AsyncStorage.getItem('repcheck_reminders')).toBeNull();
  });

  it('refused for good before: says so without asking again', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await open();
    await press('Turn on reminders');
    expect(await screen.findByText(/Notifications are off for RepCheck/)).toBeOnTheScreen();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('trying again after a no clears the message when it works', async () => {
    notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true }).mockResolvedValueOnce({ granted: true, canAskAgain: true });
    await open();
    await press('Turn on reminders');
    await screen.findByText(/Notifications are off for RepCheck/);
    await press('Turn on reminders');
    await waitFor(() => expect(screen.queryByText(/Notifications are off for RepCheck/)).toBeNull());
    expect(screen.getByTestId('reminders-state')).toHaveTextContent('On');
  });

  it('the button is busy while the phone is being asked', async () => {
    let answer: (value: { granted: boolean; canAskAgain: boolean }) => void = () => undefined;
    notifications.requestPermissionsAsync.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await open();
    await press('Turn on reminders');
    expect(screen.getByRole('button', { busy: true }).props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await act(async () => answer({ granted: true, canAskAgain: true }));
    await waitFor(() => expect(screen.queryByRole('button', { busy: true })).toBeNull());
  });

  it('turning them off is one tap and kept', async () => {
    await open();
    await press('Turn on reminders');
    await press('Turn off reminders');
    await waitFor(() => expect(screen.getByTestId('reminders-state')).toHaveTextContent('Off'));
    expect(remindersAreOn()).toBe(false);
    expect(await AsyncStorage.getItem('repcheck_reminders')).toBe('off');
  });
});
