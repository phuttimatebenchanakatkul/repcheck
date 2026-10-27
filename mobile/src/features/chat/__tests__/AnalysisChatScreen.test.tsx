import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import type { ChatReply } from '@/logic/chat';
import { toIsoDate } from '@/logic/dates';
import { USER, dataHarness } from '@/testing/dataHarness';

import AnalysisChatScreen from '../AnalysisChatScreen';

const mockApi = { analysis: jest.fn(), analysisChat: jest.fn(), setAiConsent: jest.fn(), reportReply: jest.fn() };
const mockAuth = { state: { status: 'ready', profile: { id: USER, ai_consent: true } }, refreshProfile: jest.fn(async () => undefined) };
const mockParams: { id: string | undefined } = { id: '7' };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));

const TODAY = toIsoDate(new Date());
const hoursAgo = (h: number) => Date.now() - h * 3_600_000;
const analysis = (over: Record<string, unknown> = {}) => ({
  ok: true,
  id: 7,
  exercise_label: 'Deadlift',
  overall_score: 66,
  stretch_score: 60,
  squeeze_score: 70,
  favored: 'squeeze',
  reps: 6,
  sections: [],
  feedback_text: '## Positives\n- Flat back.',
  created_at: new Date(hoursAgo(2)).toISOString(),
  created_at_ms: hoursAgo(2),
  video_url: null,
  ...over,
});
const ANSWER: ChatReply = {
  reply: 'Your squeeze was **higher** because of the lockout.',
  sources: [{ title: 'NSCA deadlift guide', publisher: 'NSCA', url: 'https://example.org/nsca' }],
  limited: false,
  retryAfterSeconds: 0,
};

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <AnalysisChatScreen />
    </h.Provider>,
  );
  return h;
}
const input = () => screen.getByLabelText('Ask a question about your analysis...');
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const ask = async (text: string) => {
  await screen.findByLabelText('Ask a question about your analysis...');
  await fireEvent.changeText(input(), text);
  await press('Send');
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = '7';
  mockAuth.state = { status: 'ready', profile: { id: USER, ai_consent: true } };
  mockApi.analysis.mockResolvedValue(analysis());
  mockApi.analysisChat.mockResolvedValue(ANSWER);
  mockApi.setAiConsent.mockResolvedValue(true);
  mockApi.reportReply.mockResolvedValue(undefined);
});

describe('opening', () => {
  it('names the analysis, and offers the starter questions and a welcome', async () => {
    await open();
    expect(await screen.findByRole('header', { name: 'Deadlift · 66' })).toBeOnTheScreen();
    expect(screen.getByText('Ask a follow-up about your feedback')).toBeOnTheScreen();
    expect(screen.getByText('Have a question about your results?')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Why was my squeeze score lower than my stretch score?' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'What should I focus on next session?' })).toBeOnTheScreen();
    expect(mockApi.analysis).toHaveBeenCalledWith(7);
  });

  it('an analysis with no score shows its name alone', async () => {
    mockApi.analysis.mockResolvedValue(analysis({ overall_score: null }));
    await open();
    expect(await screen.findByRole('header', { name: 'Deadlift' })).toBeOnTheScreen();
  });

  it('a spinner while the analysis loads, and no chat yet', async () => {
    mockApi.analysis.mockReturnValue(new Promise(() => undefined));
    await open();
    expect(screen.getByTestId('loading')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Ask a question about your analysis...')).toBeNull();
  });

  it.each([[undefined], ['abc'], ['-1']])('a link with id %s says it is gone and asks nothing', async (id) => {
    mockParams.id = id;
    await open();
    expect(await screen.findByText('That analysis is gone. Only your latest 20 are kept.')).toBeOnTheScreen();
    expect(mockApi.analysis).not.toHaveBeenCalled();
  });

  it('an analysis that was pruned says so, with no retry', async () => {
    mockApi.analysis.mockRejectedValue(new ApiError('Not found.', 404));
    await open();
    expect(await screen.findByText('That analysis is gone. Only your latest 20 are kept.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('a failure to load says so and can be tried again', async () => {
    mockApi.analysis.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    expect(await screen.findByText("Couldn't load that. Check your connection and try again.")).toBeOnTheScreen();
    await press('Try again');
    expect(await screen.findByRole('header', { name: 'Deadlift · 66' })).toBeOnTheScreen();
  });
});

describe('asking about the analysis', () => {
  it('tells the server which analysis, with its scores and report, and what was said before', async () => {
    const h = dataHarness();
    h.db.seed('analyze_chat_messages', [
      { seq: 1, user_id: USER, analyze_result_id: 7, client_id: 'a', role: 'user', body: 'First question', sources: null, extra: { date: TODAY } },
      { seq: 2, user_id: USER, analyze_result_id: 7, client_id: 'b', role: 'assistant', body: 'First answer', sources: [], extra: { date: TODAY } },
      { seq: 3, user_id: USER, analyze_result_id: 8, client_id: 'z', role: 'user', body: 'Another analysis', sources: null, extra: {} },
    ]);
    const a = analysis();
    mockApi.analysis.mockResolvedValue(a);
    await open(h);
    await screen.findByText('First answer');
    expect(screen.queryByText('Another analysis')).toBeNull();
    await ask('Why?');
    await screen.findByText('higher');
    expect(mockApi.analysisChat).toHaveBeenCalledWith(
      'Why?',
      [{ role: 'user', text: 'First question' }, { role: 'assistant', text: 'First answer' }],
      { id: 7, created_at_ms: a.created_at_ms, exercise_label: 'Deadlift', overall_score: 66, stretch_score: 60, squeeze_score: 70, reps: 6, feedback_text: '## Positives\n- Flat back.' },
    );
  });

  it('keeps both turns on that analysis, and counts the day toward the streak', async () => {
    const h = await open();
    await ask('Why?');
    await screen.findByText('higher');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('analyze_chat_messages').map((r) => [r.analyze_result_id, r.role, r.body, r.seq])).toEqual([
      [7, 'user', 'Why?', 1],
      [7, 'assistant', ANSWER.reply, 2],
    ]);
    expect(h.db.rows('analyze_chat_messages')[1].sources).toEqual(ANSWER.sources);
    expect(h.db.rows('activity_days')).toEqual([{ user_id: USER, log_date: TODAY, action: 'analyze_chat' }]);
  });

  it('the answer carries its sources, the AI label, and a Report button that names this chat', async () => {
    await open();
    await ask('Why?');
    await screen.findByText('higher');
    expect(screen.getByRole('link', { name: 'Open source: NSCA deadlift guide' })).toBeOnTheScreen();
    expect(screen.getByTestId('ai-disclaimer')).toBeOnTheScreen();
    await press('Report this reply');
    await press('Offensive');
    await screen.findByText(/Thanks — reported/);
    expect(mockApi.reportReply).toHaveBeenCalledWith('analyze_chat', 'offensive', ANSWER.reply);
  });

  it('a failure shows the assistant’s own words and gives the question back, saving nothing', async () => {
    mockApi.analysisChat.mockRejectedValueOnce(new ApiError('boom', 500));
    const h = await open();
    await ask('Why?');
    expect(await screen.findByText('Something went wrong reaching the assistant. Please try again.')).toBeOnTheScreen();
    expect(input().props.value).toBe('Why?');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('analyze_chat_messages')).toEqual([]);
  });

  it('the limit shows its own words', async () => {
    mockApi.analysisChat.mockResolvedValueOnce({ reply: 'Come back later.', sources: [], limited: true, retryAfterSeconds: 7200 });
    await open();
    await ask('Why?');
    expect(await screen.findByTestId('limit-text')).toHaveTextContent('Limit reached — resets in 2h 0m');
    expect(input().props.placeholder).toBe('Message limit reached');
  });

  it('asks for consent first', async () => {
    mockAuth.state = { status: 'ready', profile: { id: USER, ai_consent: false } };
    await open();
    await ask('Why?');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    expect(mockApi.analysisChat).not.toHaveBeenCalled();
  });
});

describe('a chat a day after its analysis', () => {
  it('stays readable but takes no more questions', async () => {
    const h = dataHarness();
    h.db.seed('analyze_chat_messages', [{ seq: 1, user_id: USER, analyze_result_id: 7, client_id: 'a', role: 'user', body: 'Old question', sources: null, extra: {} }]);
    mockApi.analysis.mockResolvedValue(analysis({ created_at_ms: hoursAgo(25) }));
    await open(h);
    expect(await screen.findByText('Old question')).toBeOnTheScreen();
    expect(screen.getByTestId('closed-text')).toHaveTextContent('This chat closed 24 hours after the analysis — history is still here to read.');
    expect(input().props.editable).toBe(false);
    expect(input().props.placeholder).toBe('This chat is closed');
  });

  it('with nothing said, no starter questions are offered', async () => {
    mockApi.analysis.mockResolvedValue(analysis({ created_at_ms: hoursAgo(30) }));
    await open();
    await screen.findByTestId('closed-text');
    expect(screen.queryByRole('button', { name: 'What should I focus on next session?' })).toBeNull();
  });

  it('is still open at 23 hours', async () => {
    mockApi.analysis.mockResolvedValue(analysis({ created_at_ms: hoursAgo(23) }));
    await open();
    await screen.findByLabelText('Ask a question about your analysis...');
    expect(screen.queryByTestId('closed-text')).toBeNull();
    expect(input().props.editable).toBe(true);
  });
});
