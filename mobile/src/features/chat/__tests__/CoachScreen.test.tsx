import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { ApiError } from '@/api/client';
import type { ChatReply } from '@/logic/chat';
import { toIsoDate } from '@/logic/dates';
import { USER, dataHarness } from '@/testing/dataHarness';

import CoachScreen from '../CoachScreen';
import { SOURCES_PAGE_URL } from '../SourcesFooter';

const mockApi = { coachChat: jest.fn(), setAiConsent: jest.fn(), reportReply: jest.fn() };
const mockAuth = { state: { status: 'ready', profile: { id: USER, ai_consent: true } }, refreshProfile: jest.fn(async () => undefined) };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));

const TODAY = toIsoDate(new Date());
const YESTERDAY = toIsoDate(new Date(Date.now() - 36 * 3_600_000));
const SOURCES = [
  { title: 'ISSN position stand on protein', publisher: 'ISSN', url: 'https://example.org/issn' },
  { title: 'ACSM resistance training', publisher: null, url: 'https://example.org/acsm' },
  { title: 'Third', publisher: 'WHO', url: 'https://example.org/who' },
];
const ANSWER: ChatReply = { reply: 'Aim for **1.6 g/kg** of protein.\n- Spread it out\n- Keep it simple', sources: SOURCES, limited: false, retryAfterSeconds: 0 };

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <CoachScreen />
    </h.Provider>,
  );
  return h;
}
const input = () => screen.getByLabelText('Ask your coach anything...');
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const ask = async (text: string) => {
  await fireEvent.changeText(input(), text);
  await press('Send');
};
const coachRow = (seq: number, id: string, role: string, body: string, over: Record<string, unknown> = {}) => ({
  seq, user_id: USER, client_id: id, role, body, msg_date: TODAY, sources: role === 'coach' ? [] : null, extra: {}, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.state = { status: 'ready', profile: { id: USER, ai_consent: true } };
  mockApi.coachChat.mockResolvedValue(ANSWER);
  mockApi.setAiConsent.mockResolvedValue(true);
  mockApi.reportReply.mockResolvedValue(undefined);
});

describe('an empty conversation', () => {
  it('welcomes, says where answers come from, and offers two starter questions', async () => {
    await open();
    expect(await screen.findByText('Ask me anything about training')).toBeOnTheScreen();
    expect(screen.getByText(/Every answer lists the research/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'How do I build muscle without gaining much fat?' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'How can I lose fat without losing muscle?' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
  });

  it('a starter question is asked as it stands', async () => {
    await open();
    await press('How can I lose fat without losing muscle?');
    await screen.findByText('Spread it out');
    expect(mockApi.coachChat).toHaveBeenCalledWith('How can I lose fat without losing muscle?', []);
  });
});

describe('asking', () => {
  it('shows the question and the answer, with bold and bullets, and clears the box', async () => {
    await open();
    await ask('  How much protein?  ');
    expect(await screen.findByText('1.6 g/kg')).toBeOnTheScreen();
    expect(screen.getByText('Spread it out')).toBeOnTheScreen();
    expect(screen.getByText('How much protein?')).toBeOnTheScreen();
    expect(input().props.value).toBe('');
    expect(mockApi.coachChat).toHaveBeenCalledWith('How much protein?', []);
    expect(screen.queryByText('Ask me anything about training')).toBeNull();
  });

  it('the question is shown at once and the box is locked while the answer is awaited, and a second send is ignored', async () => {
    let finish: (r: ChatReply) => void = () => undefined;
    mockApi.coachChat.mockReturnValue(new Promise<ChatReply>((resolve) => (finish = resolve)));
    await open();
    await ask('First');
    expect(screen.getByText('First')).toBeOnTheScreen();
    expect(screen.getByLabelText('Thinking…')).toBeOnTheScreen();
    expect(input().props.editable).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(mockApi.coachChat).toHaveBeenCalledTimes(1);
    await act(async () => finish(ANSWER));
    expect(await screen.findByText('Spread it out')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Thinking…')).toBeNull();
    expect(input().props.editable).toBe(true);
  });

  it('sends nothing for an empty or blank box, and the box takes at most 1000 characters', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(input(), '   ');
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(true);
    expect(input().props.maxLength).toBe(1000);
    expect(mockApi.coachChat).not.toHaveBeenCalled();
  });

  it('what came before is sent as history, the message is not in it, and the coach’s side is named "coach"', async () => {
    const h = dataHarness();
    h.db.seed('coach_messages', [coachRow(1, 'a', 'user', 'Earlier question'), coachRow(2, 'b', 'coach', 'Earlier answer')]);
    await open(h);
    await screen.findByText('Earlier answer');
    await ask('Follow-up');
    await screen.findByText('Spread it out');
    expect(mockApi.coachChat).toHaveBeenCalledWith('Follow-up', [{ role: 'user', text: 'Earlier question' }, { role: 'coach', text: 'Earlier answer' }]);
  });

  it('keeps both turns, in order, with the answer’s sources, and counts the day toward the streak', async () => {
    const h = await open();
    await ask('How much protein?');
    await screen.findByText('Spread it out');
    await act(async () => {
      await h.flush();
    });
    const rows = h.db.rows('coach_messages');
    expect(rows.map((r) => [r.seq, r.role, r.body, r.msg_date])).toEqual([[1, 'user', 'How much protein?', TODAY], [2, 'coach', ANSWER.reply, TODAY]]);
    expect(rows[0].sources).toBeNull();
    expect(rows[1].sources).toEqual(SOURCES);
    expect(h.db.rows('activity_days')).toEqual([{ user_id: USER, log_date: TODAY, action: 'coach_chat' }]);
  });

  it('shows only today’s conversation', async () => {
    const h = dataHarness();
    h.db.seed('coach_messages', [coachRow(1, 'old', 'user', 'Yesterday’s question', { msg_date: YESTERDAY }), coachRow(2, 'new', 'user', 'Today’s question')]);
    await open(h);
    expect(await screen.findByText('Today’s question')).toBeOnTheScreen();
    expect(screen.queryByText('Yesterday’s question')).toBeNull();
  });
});

describe('when asking fails', () => {
  it.each([
    ['no signal', new ApiError('Could not reach the server. Check your connection and try again.', 0), 'Something went wrong reaching the coach. Please try again.'],
    ['a server error', new ApiError('Something went wrong on our side.', 500), 'Something went wrong reaching the coach. Please try again.'],
    ['a message the server refuses', new ApiError('That message is too long. Please keep it under 1,000 characters.', 400), 'That message is too long. Please keep it under 1,000 characters.'],
    ['something unexpected', new Error('boom'), 'Something went wrong reaching the coach. Please try again.'],
  ])('%s: says so, gives the question back, and keeps nothing', async (_name, error, shown) => {
    mockApi.coachChat.mockRejectedValueOnce(error);
    const h = await open();
    await ask('How much protein?');
    expect(await screen.findByText(shown)).toBeOnTheScreen();
    expect(input().props.value).toBe('How much protein?');
    expect(screen.queryByTestId('bubble-user')).toBeNull();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('coach_messages')).toEqual([]);
    expect(h.db.rows('activity_days')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Report this reply' })).toBeNull();
  });

  it('trying again after a failure works, and the notice goes', async () => {
    mockApi.coachChat.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await ask('Hello');
    await screen.findByTestId('notice');
    await press('Send');
    expect(await screen.findByText('Spread it out')).toBeOnTheScreen();
    expect(screen.queryByTestId('notice')).toBeNull();
  });
});

describe('the daily limit', () => {
  const LIMITED: ChatReply = { reply: 'You’ve reached your 3 chat messages for now. Please check back in 5 hours.', sources: [], limited: true, retryAfterSeconds: 5 * 3600 };

  it('shows the notice, counts down, locks the box, keeps the question in it and saves nothing', async () => {
    mockApi.coachChat.mockResolvedValueOnce(LIMITED);
    const h = await open();
    await ask('One more?');
    expect(await screen.findByText(LIMITED.reply)).toBeOnTheScreen();
    expect(screen.getByTestId('limit-text')).toHaveTextContent('Limit reached — resets in 5h 0m');
    expect(input().props.editable).toBe(false);
    expect(input().props.value).toBe('One more?');
    expect(input().props.placeholder).toBe('Message limit reached');
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(true);
    // The notice is the app’s own message: no sources, no AI label, no Report button.
    expect(screen.queryByRole('button', { name: 'Report this reply' })).toBeNull();
    expect(screen.queryByTestId('ai-disclaimer')).toBeNull();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('coach_messages')).toEqual([]);
  });

  it('lifts itself when the wait is over', async () => {
    jest.useFakeTimers();
    try {
      mockApi.coachChat.mockResolvedValueOnce({ ...LIMITED, retryAfterSeconds: 90 });
      await open();
      await ask('One more?');
      await screen.findByTestId('limit-text');
      expect(screen.getByTestId('limit-text')).toHaveTextContent('Limit reached — resets in 1m');
      await act(async () => {
        jest.advanceTimersByTime(91_000);
      });
      expect(screen.queryByTestId('limit-text')).toBeNull();
      expect(input().props.editable).toBe(true);
      expect(input().props.value).toBe('One more?');
    } finally {
      jest.useRealTimers();
    }
  });

  it('refreshes the countdown every thirty seconds', async () => {
    jest.useFakeTimers();
    try {
      mockApi.coachChat.mockResolvedValueOnce({ ...LIMITED, retryAfterSeconds: 3 * 3600 });
      await open();
      await ask('One more?');
      await screen.findByTestId('limit-text');
      expect(screen.getByTestId('limit-text')).toHaveTextContent('Limit reached — resets in 3h 0m');
      await act(async () => {
        jest.advanceTimersByTime(30 * 60_000);
      });
      expect(screen.getByTestId('limit-text')).toHaveTextContent('Limit reached — resets in 2h 30m');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the AI consent gate', () => {
  beforeEach(() => {
    mockAuth.state = { status: 'ready', profile: { id: USER, ai_consent: false } };
  });

  it('asks first, names chat messages, and sends nothing until it is answered', async () => {
    await open();
    await ask('Hello');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    expect(screen.getByText(/Your chat messages, plus your logged workouts/)).toBeOnTheScreen();
    expect(mockApi.coachChat).not.toHaveBeenCalled();
  });

  it('allowing records it, then asks the question that was waiting', async () => {
    await open();
    await ask('Hello');
    await press('Allow');
    expect(await screen.findByText('Spread it out')).toBeOnTheScreen();
    expect(mockApi.setAiConsent).toHaveBeenCalledWith(true);
    expect(mockAuth.refreshProfile).toHaveBeenCalled();
    expect(mockApi.coachChat).toHaveBeenCalledWith('Hello', []);
    expect(mockApi.setAiConsent.mock.invocationCallOrder[0]).toBeLessThan(mockApi.coachChat.mock.invocationCallOrder[0]);
  });

  it('declining sends nothing and gives the question back', async () => {
    await open();
    await ask('Hello');
    await press('Not now');
    expect(await screen.findByLabelText('Ask your coach anything...')).toBeOnTheScreen();
    expect(input().props.value).toBe('Hello');
    expect(mockApi.setAiConsent).not.toHaveBeenCalled();
    expect(mockApi.coachChat).not.toHaveBeenCalled();
  });

  it('a failure to record the choice sends nothing and says why', async () => {
    mockApi.setAiConsent.mockRejectedValueOnce(new ApiError('Could not save that.', 500));
    await open();
    await ask('Hello');
    await press('Allow');
    expect(await screen.findByText('Could not save that.')).toBeOnTheScreen();
    expect(mockApi.coachChat).not.toHaveBeenCalled();
    expect(input().props.value).toBe('Hello');
  });

  it('a server that says consent is missing (withdrawn on another device) asks too', async () => {
    mockAuth.state = { status: 'ready', profile: { id: USER, ai_consent: true } };
    mockApi.coachChat.mockRejectedValueOnce(new ApiError('Allow AI features first.', 403, { needs_ai_consent: true }));
    await open();
    await ask('Hello');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
  });
});

describe('under an answer', () => {
  async function answered() {
    const h = await open();
    await ask('How much protein?');
    await screen.findByText('Spread it out');
    return h;
  }

  it('lists the sources it was given, at most three, the link to all of them, and the AI label', async () => {
    await answered();
    expect(screen.getByText('Sources')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Open source: ISSN position stand on protein' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Open source: ACSM resistance training' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Open source: Third' })).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'All sources & health info' })).toBeOnTheScreen();
    expect(screen.getByTestId('ai-disclaimer')).toHaveTextContent('AI-generated · general fitness info, not medical advice');
  });

  it('opens a source and the full list in the in-app browser', async () => {
    await answered();
    await fireEvent.press(screen.getByRole('link', { name: 'Open source: ISSN position stand on protein' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith('https://example.org/issn');
    await fireEvent.press(screen.getByRole('link', { name: 'All sources & health info' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(SOURCES_PAGE_URL);
    expect(SOURCES_PAGE_URL).toBe('https://repcheck-q0m4.onrender.com/sources');
  });

  it('the person’s own question has no footer', async () => {
    await answered();
    expect(screen.getAllByRole('button', { name: 'Report this reply' })).toHaveLength(1);
    expect(screen.getAllByTestId('ai-disclaimer')).toHaveLength(1);
  });

  it('an answer with no sources still says it is AI and can be reported', async () => {
    mockApi.coachChat.mockResolvedValueOnce({ ...ANSWER, sources: [] });
    await open();
    await ask('hi');
    await screen.findByText('Spread it out');
    expect(screen.queryByText('Sources')).toBeNull();
    expect(screen.getByTestId('ai-disclaimer')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Report this reply' })).toBeOnTheScreen();
  });

  it('reports the reply: four reasons, then the reply’s own text and which chat it came from', async () => {
    await answered();
    await press('Report this reply');
    expect(await screen.findByText("What's wrong with this reply?")).toBeOnTheScreen();
    for (const reason of ['Harmful or unsafe', 'Inaccurate', 'Offensive', 'Something else']) expect(screen.getByRole('button', { name: reason })).toBeOnTheScreen();
    await press('Inaccurate');
    expect(await screen.findByText('Thanks — reported. We review every report within 24 hours.')).toBeOnTheScreen();
    expect(mockApi.reportReply).toHaveBeenCalledWith('coach', 'inaccurate', ANSWER.reply);
    expect(screen.queryByRole('button', { name: 'Report this reply' })).toBeNull();
  });

  it('cancelling a report goes back to the button and sends nothing', async () => {
    await answered();
    await press('Report this reply');
    await press('Cancel');
    expect(screen.getByRole('button', { name: 'Report this reply' })).toBeOnTheScreen();
    expect(mockApi.reportReply).not.toHaveBeenCalled();
  });

  it('a report that could not be sent says so and can be tried again', async () => {
    mockApi.reportReply.mockRejectedValueOnce(new ApiError('boom', 500));
    await answered();
    await press('Report this reply');
    await press('Harmful or unsafe');
    expect(await screen.findByText("Couldn't send that report. Please try again.")).toBeOnTheScreen();
    await press('Report this reply');
    await press('Harmful or unsafe');
    expect(await screen.findByText(/Thanks — reported/)).toBeOnTheScreen();
    expect(mockApi.reportReply).toHaveBeenCalledTimes(2);
  });
});

describe('a saved answer’s sources are checked again when it is shown', () => {
  it('drops a link that is not plain https', async () => {
    const h = dataHarness();
    h.db.seed('coach_messages', [coachRow(1, 'a', 'coach', 'Saved answer', { sources: [{ title: 'Evil', url: 'javascript:alert(1)' }, { title: 'Fine', url: 'https://example.org/fine' }] })]);
    await open(h);
    expect(await screen.findByText('Saved answer')).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: 'Open source: Evil' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open source: Fine' })).toBeOnTheScreen();
  });
});

describe('New chat', () => {
  it('empties the conversation, on the device and on the server', async () => {
    const h = dataHarness();
    h.db.seed('coach_messages', [coachRow(1, 'a', 'user', 'Earlier question'), coachRow(2, 'b', 'coach', 'Earlier answer')]);
    await open(h);
    await screen.findByText('Earlier answer');
    await press('New chat');
    await waitFor(() => expect(screen.queryByText('Earlier answer')).toBeNull());
    expect(await screen.findByText('Ask me anything about training')).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('coach_messages')).toEqual([]);
  });
});

describe('survivors: details of the thread', () => {
  const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, unknown>;

  it('a saved reply with no sources list (the website kept errors this way) has no AI footer', async () => {
    const h = dataHarness();
    h.db.seed('coach_messages', [coachRow(1, 'a', 'coach', 'Something went wrong reaching the coach. Please try again.', { sources: null })]);
    await open(h);
    expect(await screen.findByText(/Something went wrong reaching the coach/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Report this reply' })).toBeNull();
    expect(screen.queryByTestId('ai-disclaimer')).toBeNull();
  });

  it('the welcome is gone as soon as the first question is on screen', async () => {
    mockApi.coachChat.mockReturnValue(new Promise(() => undefined));
    await open();
    await ask('First');
    expect(screen.getByText('First')).toBeOnTheScreen();
    expect(screen.queryByText('Ask me anything about training')).toBeNull();
    expect(screen.queryByRole('button', { name: 'How do I build muscle without gaining much fat?' })).toBeNull();
  });

  it('the send button looks off with nothing to send and on with something', async () => {
    await open();
    expect(flat(screen.getByRole('button', { name: 'Send' })).opacity).toBe(0.4);
    await fireEvent.changeText(input(), 'Hi');
    expect(flat(screen.getByRole('button', { name: 'Send' })).opacity).toBe(1);
  });

  it('sources are numbered from one', async () => {
    await open();
    await ask('hi');
    await screen.findByText('Spread it out');
    expect(screen.getByRole('link', { name: 'Open source: ISSN position stand on protein' })).toHaveTextContent(/^1\. ISSN position stand on protein/);
    expect(screen.getByRole('link', { name: 'Open source: ACSM resistance training' })).toHaveTextContent(/^2\. ACSM resistance training$/);
    expect(screen.getByRole('link', { name: 'Open source: Third' })).toHaveTextContent(/^3\. Third/);
  });

  it('New chat is there with a single turn', async () => {
    const h = dataHarness();
    h.db.seed('coach_messages', [coachRow(1, 'a', 'user', 'Only question')]);
    await open(h);
    await screen.findByText('Only question');
    expect(screen.getByRole('button', { name: 'New chat' })).toBeOnTheScreen();
  });
});
