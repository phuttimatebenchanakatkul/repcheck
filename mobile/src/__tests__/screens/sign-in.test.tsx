import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { translate } from '@/i18n';

import SignIn from '@/app/(auth)/sign-in';

const t = (key: string) => translate('en', key);

const mockActions = {
  signInWithMigration: jest.fn(),
  signUpWithEmail: jest.fn(),
  resendConfirmation: jest.fn(),
  requestPasswordReset: jest.fn(),
  push: jest.fn(),
};

jest.mock('@/auth/actions', () => ({
  signUpWithEmail: (...args: unknown[]) => mockActions.signUpWithEmail(...args),
  resendConfirmation: (...args: unknown[]) => mockActions.resendConfirmation(...args),
  requestPasswordReset: (...args: unknown[]) => mockActions.requestPasswordReset(...args),
}));
jest.mock('@/auth/legacy', () => ({ signInWithMigration: (...args: unknown[]) => mockActions.signInWithMigration(...args) }));
jest.mock('@/api', () => ({ getApi: () => ({ marker: 'api' }) }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `repcheck://${path}` }));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockActions.push(...args), replace: jest.fn() } }));
jest.mock('@/auth/apple', () => ({ appleSignInAvailable: async () => false, signInWithApple: jest.fn() }));
jest.mock('@/auth/google', () => ({ GOOGLE_ENABLED: false, signInWithGoogle: jest.fn() }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ rememberNameHint: jest.fn() }) }));
jest.mock('@/supabase/client', () => ({ getSupabase: () => ({}) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 0 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
}));

async function fill(label: string, value: string) {
  await fireEvent.changeText(screen.getByLabelText(t(label)), value);
}

beforeEach(() => {
  Object.values(mockActions).forEach((m) => m.mockReset());
});

describe('sign-in screen', () => {
  it('starts on log in, with the consent notice and both policy links visible', async () => {
    await render(<SignIn />);
    expect(screen.getByText(t('app.auth.welcomeBack'))).toBeTruthy();
    expect(screen.getByText(t('app.auth.consent.terms'))).toBeTruthy();
    expect(screen.getByText(t('app.auth.consent.privacy'))).toBeTruthy();
    expect(screen.getByText(/Google Gemini/)).toBeTruthy(); // the specific third-party AI disclosure Guideline 5.1.2(i) wants named
    expect(screen.queryByLabelText(t('app.auth.name'))).toBeNull(); // no name field when logging in
  });

  it('opens the policy pages in the in-app browser', async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getByText(t('app.auth.consent.terms')));
    await fireEvent.press(screen.getByText(t('app.auth.consent.privacy')));
    expect((WebBrowser.openBrowserAsync as jest.Mock).mock.calls.map((c: string[]) => c[0])).toEqual([
      'https://repcheck-q0m4.onrender.com/terms',
      'https://repcheck-q0m4.onrender.com/privacy',
    ]);
  });

  it('asks for email and password before calling the server', async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.logIn') }));
    expect(screen.getByText(t('app.auth.error.missing'))).toBeTruthy();
    await fill('app.auth.email', 'a@b.co');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.logIn') }));
    expect(screen.getByText(t('app.auth.error.missing'))).toBeTruthy();
    expect(mockActions.signInWithMigration).not.toHaveBeenCalled();
  });

  it('logs in with what was typed', async () => {
    mockActions.signInWithMigration.mockResolvedValue({ ok: true });
    await render(<SignIn />);
    await fill('app.auth.email', 'a@b.co');
    await fill('app.auth.password', 'secret');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.logIn') }));
    await waitFor(() => expect(mockActions.signInWithMigration).toHaveBeenCalledWith({}, { marker: 'api' }, 'a@b.co', 'secret'));
  });

  it.each(['invalid-credentials', 'email-not-confirmed', 'rate-limited', 'unavailable', 'failed'])('shows the message for %s', async (reason) => {
    mockActions.signInWithMigration.mockResolvedValue({ ok: false, reason });
    await render(<SignIn />);
    await fill('app.auth.email', 'a@b.co');
    await fill('app.auth.password', 'x');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.logIn') }));
    await waitFor(() => expect(screen.getByText(t(`app.auth.error.${reason}`))).toBeTruthy());
  });

  it('shows nothing for a cancelled provider sheet', async () => {
    mockActions.signInWithMigration.mockResolvedValue({ ok: false, reason: 'cancelled' });
    await render(<SignIn />);
    await fill('app.auth.email', 'a@b.co');
    await fill('app.auth.password', 'x');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.logIn') }));
    await waitFor(() => expect(mockActions.signInWithMigration).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sign-up asks for a name too, sends it, and says to confirm the email', async () => {
    mockActions.signUpWithEmail.mockResolvedValue({ ok: false, reason: 'confirm-email' });
    await render(<SignIn />);
    await fireEvent.press(screen.getByText(t('app.auth.signUp')));
    expect(screen.getByText(t('app.auth.createAccount'))).toBeTruthy();
    await fill('app.auth.email', 'a@b.co');
    await fill('app.auth.password', 'secret123');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.signUp') }));
    expect(screen.getByText(t('app.auth.error.missingName'))).toBeTruthy();
    expect(mockActions.signUpWithEmail).not.toHaveBeenCalled();
    await fill('app.auth.name', 'Sam');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.signUp') }));
    await waitFor(() => expect(mockActions.signUpWithEmail).toHaveBeenCalledWith({}, 'a@b.co', 'secret123', 'Sam'));
    await waitFor(() => expect(screen.getByText(t('app.auth.confirmEmail'))).toBeTruthy());
    expect(screen.getByText(t('app.auth.welcomeBack'))).toBeTruthy(); // back on log in, ready for the next step
  });

  it('switching between modes clears an old error', async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.logIn') }));
    expect(screen.getByText(t('app.auth.error.missing'))).toBeTruthy();
    await fireEvent.press(screen.getByText(t('app.auth.signUp')));
    expect(screen.queryByText(t('app.auth.error.missing'))).toBeNull();
  });
});

describe('sign-in screen: the ways back in', () => {
  async function typeAndLogIn() {
    await render(<SignIn />);
    await fill('app.auth.email', 'a@b.co');
    await fill('app.auth.password', 'secret-pw');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.logIn') }));
  }

  it('Forgot password opens the reset screen, and only when logging in', async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getByText(t('app.auth.forgot')));
    expect(mockActions.push).toHaveBeenCalledWith('/reset-password');
    await fireEvent.press(screen.getByText(t('app.auth.signUp')));
    expect(screen.queryByText(t('app.auth.forgot'))).toBeNull();
  });

  it('an unconfirmed address offers to resend the confirmation, and says it did', async () => {
    mockActions.signInWithMigration.mockResolvedValue({ ok: false, reason: 'email-not-confirmed' });
    mockActions.resendConfirmation.mockResolvedValue({ ok: true });
    await typeAndLogIn();
    await waitFor(() => expect(screen.getByText(t('app.auth.resend'))).toBeTruthy());
    await fireEvent.press(screen.getByText(t('app.auth.resend')));
    await waitFor(() => expect(mockActions.resendConfirmation).toHaveBeenCalledWith({}, 'a@b.co'));
    await waitFor(() => expect(screen.getByText(t('app.auth.resent'))).toBeTruthy());
    expect(screen.queryByText(t('app.auth.resend'))).toBeNull();
  });

  it('an old password the project refuses offers a reset link instead, sent to the typed address', async () => {
    mockActions.signInWithMigration.mockResolvedValue({ ok: false, reason: 'reset-required' });
    mockActions.requestPasswordReset.mockResolvedValue({ ok: true });
    await typeAndLogIn();
    await waitFor(() => expect(screen.getByText(t('app.auth.error.reset-required'))).toBeTruthy());
    await fireEvent.press(screen.getByText(t('app.auth.sendReset')));
    await waitFor(() => expect(mockActions.requestPasswordReset).toHaveBeenCalledWith({}, 'a@b.co', 'repcheck://reset-password'));
    await waitFor(() => expect(screen.getByText(t('app.reset.sent'))).toBeTruthy());
  });

  it('a failed follow-up shows its reason', async () => {
    mockActions.signInWithMigration.mockResolvedValue({ ok: false, reason: 'email-not-confirmed' });
    mockActions.resendConfirmation.mockResolvedValue({ ok: false, reason: 'rate-limited' });
    await typeAndLogIn();
    await fireEvent.press(await screen.findByText(t('app.auth.resend')));
    await waitFor(() => expect(screen.getByText(t('app.auth.error.rate-limited'))).toBeTruthy());
  });

  it('the follow-up button goes away on the next attempt', async () => {
    mockActions.signInWithMigration.mockResolvedValueOnce({ ok: false, reason: 'email-not-confirmed' }).mockResolvedValueOnce({ ok: false, reason: 'cancelled' });
    await typeAndLogIn();
    await screen.findByText(t('app.auth.resend'));
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.logIn') }));
    await waitFor(() => expect(screen.queryByText(t('app.auth.resend'))).toBeNull());
  });

  it('sign-up refuses a password under 8 characters before calling the server', async () => {
    await render(<SignIn />);
    await fireEvent.press(screen.getByText(t('app.auth.signUp')));
    await fill('app.auth.name', 'Sam');
    await fill('app.auth.email', 'a@b.co');
    await fill('app.auth.password', '1234567');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.signUp') }));
    expect(screen.getByText(t('app.auth.error.tooShort'))).toBeTruthy();
    expect(mockActions.signUpWithEmail).not.toHaveBeenCalled();
  });
});
