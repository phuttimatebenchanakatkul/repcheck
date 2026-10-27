import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Appearance } from 'react-native';

import { USER, dataHarness } from '@/testing/dataHarness';

import { DeletionBanner } from '../DeletionBanner';
import { SettingsApplier } from '../SettingsApplier';

const mockPush = jest.fn();
const mockChoose = jest.fn(async () => undefined);
const mockAuth: { state: Record<string, unknown> } = { state: {} };

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ state: mockAuth.state }) }));
jest.mock('@/i18n/storage', () => ({ chooseLanguage: (...args: unknown[]) => mockChoose(...(args as [])) }));

const settingsRow = (over: Record<string, unknown> = {}) => ({
  user_id: USER, theme: null, language: null, units_weight: 'kg', units_height: 'cm', units_distance: 'km', units_clock: '12h',
  hyrox_leaderboard_gender: null, hyrox_facility_lane_m: null, hyrox_history_backfilled: false, extra: {}, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
  mockAuth.state = { status: 'ready', profile: { due_at: null }, session: { user: { id: USER } } };
});

describe('putting the saved settings to work', () => {
  async function open(h = dataHarness()) {
    await render(
      <h.Provider>
        <SettingsApplier />
      </h.Provider>,
    );
    return h;
  }

  it('nothing chosen leaves the device’s own appearance and language', async () => {
    await open();
    await act(async () => undefined);
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified');
    expect(mockChoose).not.toHaveBeenCalled();
  });

  it('a saved theme and language are applied as they load', async () => {
    const h = dataHarness();
    h.db.seed('user_settings', [settingsRow({ theme: 'dark', language: 'th' })]);
    await open(h);
    await waitFor(() => expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('dark'));
    expect(mockChoose).toHaveBeenCalledWith('th');
  });

  it('a change to either is applied again', async () => {
    const h = dataHarness();
    h.db.seed('user_settings', [settingsRow({ theme: 'dark', language: 'en' })]);
    await open(h);
    await waitFor(() => expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('dark'));
    await act(async () => {
      await h.data.actions.saveSettings({ units: { weight: 'kg', height: 'cm', distance: 'km', clock: '12h' }, theme: 'light', language: 'th' });
    });
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('light');
    expect(mockChoose).toHaveBeenLastCalledWith('th');
  });
});

describe('the deletion banner', () => {
  it('is nothing unless a deletion is scheduled', async () => {
    await render(<DeletionBanner />);
    expect(screen.queryByTestId('deletion-banner')).toBeNull();
  });

  it('says when, and Keep my account opens Settings', async () => {
    mockAuth.state = { status: 'ready', profile: { due_at: '2026-11-26' }, session: { user: { id: USER } } };
    await render(<DeletionBanner />);
    expect(screen.getByText('Your account is scheduled for deletion on November 26, 2026.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my account' }));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('is nothing while signed out', async () => {
    mockAuth.state = { status: 'signed-out' };
    await render(<DeletionBanner />);
    expect(screen.queryByTestId('deletion-banner')).toBeNull();
  });
});
