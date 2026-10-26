import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ResetPassword from '@/app/reset-password';
import { translate } from '@/i18n';

const t = (key: string) => translate('en', key);

const mock = {
  status: 'signed-out' as string,
  code: undefined as string | undefined,
  finishRecovery: jest.fn(),
  exchangeRecoveryCode: jest.fn(),
  requestPasswordReset: jest.fn(),
  updatePassword: jest.fn(),
  replace: jest.fn(),
};

jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ state: { status: mock.status }, finishRecovery: mock.finishRecovery }) }));
jest.mock('@/auth/actions', () => ({
  exchangeRecoveryCode: (...a: unknown[]) => mock.exchangeRecoveryCode(...a),
  requestPasswordReset: (...a: unknown[]) => mock.requestPasswordReset(...a),
  updatePassword: (...a: unknown[]) => mock.updatePassword(...a),
}));
jest.mock('@/supabase/client', () => ({ getSupabase: () => ({}) }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `repcheck://${path}` }));
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mock.replace(...a) },
  useLocalSearchParams: () => ({ code: mock.code }),
}));

async function fill(label: string, value: string) {
  await fireEvent.changeText(screen.getByLabelText(t(label)), value);
}

beforeEach(() => {
  mock.status = 'signed-out';
  mock.code = undefined;
  Object.values(mock).forEach((m) => typeof m === 'function' && (m as jest.Mock).mockReset?.());
});

describe('asking for the link', () => {
  it('asks for an email and sends the link back to the app, never saying whether the address has an account', async () => {
    mock.requestPasswordReset.mockResolvedValue({ ok: true });
    await render(<ResetPassword />);
    expect(screen.getByText(t('app.reset.title'))).toBeTruthy();
    await fill('app.auth.email', ' a@b.co ');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.sendReset') }));
    await waitFor(() => expect(mock.requestPasswordReset).toHaveBeenCalledWith({}, ' a@b.co ', 'repcheck://reset-password'));
    await waitFor(() => expect(screen.getByText(t('app.reset.sent'))).toBeTruthy());
  });

  it('needs an address', async () => {
    await render(<ResetPassword />);
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.sendReset') }));
    expect(screen.getByText(t('app.auth.error.missing'))).toBeTruthy();
    expect(mock.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('shows a rate limit', async () => {
    mock.requestPasswordReset.mockResolvedValue({ ok: false, reason: 'rate-limited' });
    await render(<ResetPassword />);
    await fill('app.auth.email', 'a@b.co');
    await fireEvent.press(screen.getByRole('button', { name: t('app.auth.sendReset') }));
    await waitFor(() => expect(screen.getByText(t('app.auth.error.rate-limited'))).toBeTruthy());
    expect(screen.queryByText(t('app.reset.sent'))).toBeNull();
  });

  it('goes back to log in', async () => {
    await render(<ResetPassword />);
    await fireEvent.press(screen.getByText(t('app.reset.back')));
    expect(mock.replace).toHaveBeenCalledWith('/sign-in');
  });
});

describe('arriving by the link', () => {
  it('swaps the code for a session exactly once, however often it re-renders', async () => {
    mock.code = 'one-time-code';
    mock.exchangeRecoveryCode.mockReturnValue(new Promise(() => undefined)); // still working
    const view = await render(<ResetPassword />);
    expect(screen.getByText(t('app.reset.working'))).toBeTruthy();
    await view.rerender(<ResetPassword />);
    await view.rerender(<ResetPassword />);
    expect(mock.exchangeRecoveryCode).toHaveBeenCalledTimes(1);
    expect(mock.exchangeRecoveryCode).toHaveBeenCalledWith({}, 'one-time-code');
  });

  it('a link that is dead says so and offers a fresh request', async () => {
    mock.code = 'old';
    mock.exchangeRecoveryCode.mockResolvedValue({ ok: false, reason: 'link-invalid' });
    await render(<ResetPassword />);
    await waitFor(() => expect(screen.getByText(t('app.auth.error.link-invalid'))).toBeTruthy());
    expect(screen.getByRole('button', { name: t('app.auth.sendReset') })).toBeTruthy();
  });

  it('does not exchange a code once recovery has started', async () => {
    mock.code = 'code';
    mock.status = 'recovering';
    await render(<ResetPassword />);
    expect(mock.exchangeRecoveryCode).not.toHaveBeenCalled();
  });

  it('never re-exchanges a spent code if recovery ends and the link is still the screen’s', async () => {
    mock.code = 'code';
    mock.status = 'recovering';
    const view = await render(<ResetPassword />);
    mock.status = 'signed-out';                      // e.g. the person signed out of the recovery session
    await view.rerender(<ResetPassword />);
    expect(mock.exchangeRecoveryCode).not.toHaveBeenCalled();
  });
});

describe('choosing the new password', () => {
  beforeEach(() => {
    mock.status = 'recovering';
  });

  it('saves a good password and carries on', async () => {
    mock.updatePassword.mockResolvedValue({ ok: true });
    await render(<ResetPassword />);
    expect(screen.getByText(t('app.reset.newTitle'))).toBeTruthy();
    await fill('app.reset.newPassword', 'brand-new-pw');
    await fill('app.reset.repeat', 'brand-new-pw');
    await fireEvent.press(screen.getByRole('button', { name: t('app.reset.save') }));
    await waitFor(() => expect(mock.updatePassword).toHaveBeenCalledWith({}, 'brand-new-pw'));
    await waitFor(() => expect(mock.finishRecovery).toHaveBeenCalledTimes(1));
  });

  it('refuses a short password and a mismatch without calling the server', async () => {
    await render(<ResetPassword />);
    await fill('app.reset.newPassword', 'short');
    await fill('app.reset.repeat', 'short');
    await fireEvent.press(screen.getByRole('button', { name: t('app.reset.save') }));
    expect(screen.getByText(t('app.auth.error.tooShort'))).toBeTruthy();
    await fill('app.reset.newPassword', 'long-enough-1');
    await fill('app.reset.repeat', 'long-enough-2');
    await fireEvent.press(screen.getByRole('button', { name: t('app.reset.save') }));
    expect(screen.getByText(t('app.reset.mismatch'))).toBeTruthy();
    expect(mock.updatePassword).not.toHaveBeenCalled();
  });

  it('shows the project’s refusal and stays on the step', async () => {
    mock.updatePassword.mockResolvedValue({ ok: false, reason: 'weak-password' });
    await render(<ResetPassword />);
    await fill('app.reset.newPassword', 'long-enough-1');
    await fill('app.reset.repeat', 'long-enough-1');
    await fireEvent.press(screen.getByRole('button', { name: t('app.reset.save') }));
    await waitFor(() => expect(screen.getByText(t('app.auth.error.weak-password'))).toBeTruthy());
    expect(mock.finishRecovery).not.toHaveBeenCalled();
  });
});
