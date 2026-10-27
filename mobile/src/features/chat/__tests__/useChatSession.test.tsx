import { act, renderHook } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import type { ChatReply, ChatTurn } from '@/logic/chat';

import { useChatSession } from '../useChatSession';

const mockApi = { setAiConsent: jest.fn() };
const mockAuth = { state: { status: 'ready', profile: { id: 'u', ai_consent: true } } as { status: string; profile: { id: string; ai_consent: boolean } }, refreshProfile: jest.fn(async () => undefined) };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

const ANSWER: ChatReply = { reply: 'Answer', sources: [], limited: false, retryAfterSeconds: 0 };
const LIMITED: ChatReply = { reply: 'Limit', sources: [], limited: true, retryAfterSeconds: 90 };

function setup(over: { ask?: jest.Mock; save?: jest.Mock; onAnswered?: jest.Mock; turns?: ChatTurn[] } = {}) {
  const ask = over.ask ?? jest.fn(async () => ANSWER);
  const save = over.save ?? jest.fn(async () => undefined);
  const onAnswered = over.onAnswered ?? jest.fn();
  const hook = renderHook(() => useChatSession({ turns: over.turns ?? [], save, ask, onAnswered, errorText: 'Could not reach.' }));
  return { ask, save, onAnswered, hook };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.state = { status: 'ready', profile: { id: 'u', ai_consent: true } };
  mockApi.setAiConsent.mockResolvedValue(true);
});

describe('sending', () => {
  it('asks, then saves the question and the answer in that order, and tells the screen', async () => {
    const { ask, save, onAnswered, hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.send('Hello'));
    expect(ask).toHaveBeenCalledWith('Hello', []);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]).toMatchObject({ role: 'user', text: 'Hello', sources: null });
    expect(save.mock.calls[1][0]).toMatchObject({ role: 'assistant', text: 'Answer', sources: [] });
    expect(onAnswered).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
  });

  it('ignores a second send while one is being answered', async () => {
    let finish: (r: ChatReply) => void = () => undefined;
    const ask = jest.fn(() => new Promise<ChatReply>((resolve) => (finish = resolve)));
    const { hook } = setup({ ask });
    const { result } = await hook;
    await act(async () => void result.current.send('First'));
    expect(result.current.sending).toBe(true);
    await act(async () => result.current.send('Second'));
    expect(ask).toHaveBeenCalledTimes(1);
    await act(async () => finish(ANSWER));
    expect(result.current.sending).toBe(false);
  });

  it('ignores a blank message', async () => {
    const { ask, hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.send('   '));
    await act(async () => result.current.send(''));
    expect(ask).not.toHaveBeenCalled();
  });

  it('sends the text box when no text is given, trimmed and cut at the limit', async () => {
    const { ask, hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.setDraft(`  ${'x'.repeat(1200)}  `));
    await act(async () => result.current.send());
    expect(ask.mock.calls[0][0]).toBe('x'.repeat(1000));
  });
});

describe('while limited', () => {
  it('nothing more is sent until the wait is over, and then it can be', async () => {
    jest.useFakeTimers();
    try {
      const ask = jest.fn().mockResolvedValueOnce(LIMITED).mockResolvedValue(ANSWER);
      const { hook } = setup({ ask });
      const { result } = await hook;
      await act(async () => result.current.send('Hi'));
      expect(result.current.lockSeconds).toBe(90);
      expect(result.current.notice).toBe('Limit');
      expect(result.current.draft).toBe('Hi');
      await act(async () => result.current.send('Again'));
      expect(ask).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(89_000);
      });
      expect(result.current.lockSeconds).not.toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      expect(result.current.lockSeconds).toBeNull();
      await act(async () => result.current.send('Again'));
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a limit notice is not an answer: nothing is saved and the day is not counted', async () => {
    const { save, onAnswered, hook } = setup({ ask: jest.fn(async () => LIMITED) });
    const { result } = await hook;
    await act(async () => result.current.send('Hi'));
    expect(save).not.toHaveBeenCalled();
    expect(onAnswered).not.toHaveBeenCalled();
  });
});

describe('consent', () => {
  it('waits for it, and while it waits nothing else is sent', async () => {
    mockAuth.state = { status: 'ready', profile: { id: 'u', ai_consent: false } };
    const { ask, hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.send('Hello'));
    expect(result.current.askingConsent).toBe(true);
    await act(async () => result.current.send('Something else'));
    expect(ask).not.toHaveBeenCalled();
    await act(async () => result.current.allow());
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('Hello', []);
    expect(result.current.askingConsent).toBe(false);
  });

  it('declining before anything was sent keeps what was typed', async () => {
    mockAuth.state = { status: 'ready', profile: { id: 'u', ai_consent: false } };
    const { hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.send('Hello'));
    await act(async () => result.current.declineConsent());
    expect(result.current.askingConsent).toBe(false);
    expect(result.current.draft).toBe('Hello');
  });

  it('declining after the server asked for it gives the question back', async () => {
    const ask = jest.fn().mockRejectedValueOnce(new ApiError('Allow AI features first.', 403, { needs_ai_consent: true }));
    const { hook } = setup({ ask });
    const { result } = await hook;
    await act(async () => result.current.send('Hello'));
    expect(result.current.askingConsent).toBe(true);
    expect(result.current.draft).toBe('');
    await act(async () => result.current.declineConsent());
    expect(result.current.draft).toBe('Hello');
  });

  it('declining with nothing waiting changes nothing', async () => {
    const { hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.setDraft('typed'));
    await act(async () => result.current.declineConsent());
    expect(result.current.draft).toBe('typed');
  });
});
