import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import type { ChatReply } from '@/logic/chat';
import { addDays, toIsoDate } from '@/logic/dates';
import { USER, dataHarness } from '@/testing/dataHarness';

import WorkoutChatScreen, { dayFromParam } from '../WorkoutChatScreen';

const mockApi = { workoutChat: jest.fn(), setAiConsent: jest.fn(), reportReply: jest.fn() };
const mockAuth = { state: { status: 'ready', profile: { id: USER, ai_consent: true } }, refreshProfile: jest.fn(async () => undefined) };
const mockParams: { day: string | undefined } = { day: undefined };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));

const TODAY = toIsoDate(new Date());
const YESTERDAY = addDays(TODAY, -1);
const ANSWER: ChatReply = {
  reply: 'Try **2.5 kg** more on your squat.',
  sources: [{ title: 'ACSM progression models', publisher: 'ACSM', url: 'https://example.org/acsm' }],
  limited: false,
  retryAfterSeconds: 0,
};
const at = (day: string, hour = 9) => new Date(`${day}T0${hour}:00:00`).toISOString();
const entryRow = (id: string, day: string, exercise: string) => ({ user_id: USER, id, log_date: day, exercise, added_at: at(day), unilateral: false, extra: {} });
const setRow = (entryId: string, position: number, reps: number, kg: number) => ({ user_id: USER, entry_id: entryId, position, reps, weight_kg: kg, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {} });
const chatRow = (seq: number, id: string, role: string, body: string, day: string, over: Record<string, unknown> = {}) => ({
  seq, user_id: USER, client_id: id, role, body, msg_date: day, sources: role === 'assistant' ? [] : null, extra: {}, ...over,
});

async function open(h = dataHarness()) {
  await render(
    <h.Provider>
      <WorkoutChatScreen />
    </h.Provider>,
  );
  return h;
}
const input = () => screen.getByLabelText('Ask about your recent workouts...');
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const ask = async (text: string) => {
  await fireEvent.changeText(input(), text);
  await press('Send');
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.day = undefined;
  mockAuth.state = { status: 'ready', profile: { id: USER, ai_consent: true } };
  mockApi.workoutChat.mockResolvedValue(ANSWER);
  mockApi.setAiConsent.mockResolvedValue(true);
  mockApi.reportReply.mockResolvedValue(undefined);
});

describe('which day', () => {
  it('the link’s day, or today when it names none or nonsense', () => {
    expect(dayFromParam('2026-10-20', TODAY)).toBe('2026-10-20');
    for (const bad of [undefined, '', 'today', '2026-13-45', '20261020', '2026-10-2', '2026-10-20T00:00']) expect(dayFromParam(bad, TODAY)).toBe(TODAY);
  });
});

describe("today's chat", () => {
  it('says what it is for, and offers the starter questions', async () => {
    await open();
    expect(await screen.findByRole('header', { name: 'Workout AI Chat' })).toBeOnTheScreen();
    expect(screen.getByText("Ask about progressive overload on anything you've logged")).toBeOnTheScreen();
    expect(screen.getByText(/Ask about progressive overload, form, or rep maxes/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'How should I progressive overload my most recent exercise?' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Am I training each muscle enough this week?' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
  });

  it('tells the server a summary of the workouts, in the person’s units, with the history so far', async () => {
    const h = dataHarness();
    h.db.seed('workout_entries', [entryRow('w1', TODAY, 'Squat'), entryRow('w2', YESTERDAY, 'Flat Bench Press')]);
    h.db.seed('workout_sets', [setRow('w1', 0, 5, 100), setRow('w1', 1, 5, 102.5), setRow('w2', 0, 8, 60)]);
    h.db.seed('workout_chat_messages', [chatRow(1, 'a', 'user', 'Earlier question', TODAY), chatRow(2, 'b', 'assistant', 'Earlier answer', TODAY)]);
    await open(h);
    await screen.findByText('Earlier answer');
    await ask('What next?');
    await screen.findByText('2.5 kg');
    const [message, history, context] = mockApi.workoutChat.mock.calls[0];
    expect(message).toBe('What next?');
    expect(history).toEqual([{ role: 'user', text: 'Earlier question' }, { role: 'assistant', text: 'Earlier answer' }]);
    expect(Object.keys(context)).toEqual(['workout_summary']);
    expect(context.workout_summary).toContain(`Workouts logged in the last 7 days:\n`);
    expect(context.workout_summary).toContain(`Yesterday (${YESTERDAY}): Flat Bench Press\nToday (${TODAY}): Squat`);
    expect(context.workout_summary).toContain(`Squat:\n- Today (${TODAY}): 100kg x 5 reps; 102.5kg x 5 reps`);
    expect(context.workout_summary).toContain(`- Yesterday (${YESTERDAY}): 60kg x 8 reps`);
  });

  it('a person who weighs in pounds is told pounds', async () => {
    const h = dataHarness();
    h.db.seed('user_settings', [{ user_id: USER, theme: null, language: null, units_weight: 'lb', units_height: 'cm', units_distance: 'km', units_clock: '12h', hyrox_leaderboard_gender: null, hyrox_facility_lane_m: null, hyrox_history_backfilled: false, extra: {} }]);
    h.db.seed('workout_entries', [entryRow('w1', TODAY, 'Squat')]);
    h.db.seed('workout_sets', [setRow('w1', 0, 5, 100)]);
    await open(h);
    await act(async () => undefined);
    await ask('Hi');
    await screen.findByText('2.5 kg');
    expect(mockApi.workoutChat.mock.calls[0][2].workout_summary).toContain('220.5lb x 5 reps');
  });

  it('keeps both turns under today, and does not touch the streak (the workout itself counts)', async () => {
    const h = await open();
    await ask('What next?');
    await screen.findByText('2.5 kg');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_chat_messages').map((r) => [r.role, r.body, r.msg_date, r.seq])).toEqual([['user', 'What next?', TODAY, 1], ['assistant', ANSWER.reply, TODAY, 2]]);
    expect(h.db.rows('activity_days')).toEqual([]);
  });

  it('the answer carries its sources, the AI line, and a Report button naming this chat', async () => {
    await open();
    await ask('What next?');
    await screen.findByText('2.5 kg');
    expect(screen.getByRole('link', { name: 'Open source: ACSM progression models' })).toBeOnTheScreen();
    expect(screen.getByTestId('ai-disclaimer')).toBeOnTheScreen();
    await press('Report this reply');
    await press('Inaccurate');
    await screen.findByText(/Thanks — reported/);
    expect(mockApi.reportReply).toHaveBeenCalledWith('workout_chat', 'inaccurate', ANSWER.reply);
  });

  it('a failure shows the workout chat’s own words and gives the question back', async () => {
    mockApi.workoutChat.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await ask('What next?');
    expect(await screen.findByText('Something went wrong reaching the workout chat. Please try again.')).toBeOnTheScreen();
    expect(input().props.value).toBe('What next?');
  });

  it('the limit and the consent question work as in the other chats', async () => {
    mockApi.workoutChat.mockResolvedValueOnce({ reply: 'Later.', sources: [], limited: true, retryAfterSeconds: 3600 });
    await open();
    await ask('What next?');
    expect(await screen.findByTestId('limit-text')).toHaveTextContent('Limit reached — resets in 1h 0m');
  });

  it('asks for consent first', async () => {
    mockAuth.state = { status: 'ready', profile: { id: USER, ai_consent: false } };
    await open();
    await ask('What next?');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    expect(mockApi.workoutChat).not.toHaveBeenCalled();
  });

  it('New chat empties today’s thread only', async () => {
    const h = dataHarness();
    h.db.seed('workout_chat_messages', [chatRow(1, 'a', 'user', 'Today’s question', TODAY), chatRow(2, 'p', 'user', 'Yesterday’s question', YESTERDAY)]);
    await open(h);
    await screen.findByText('Today’s question');
    await press('New chat');
    expect(await screen.findByText(/Ask about progressive overload, form, or rep maxes/)).toBeOnTheScreen();
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('workout_chat_messages').map((r) => r.client_id)).toEqual(['p']);
  });
});

describe('a past day', () => {
  beforeEach(() => {
    mockParams.day = YESTERDAY;
  });

  it('shows that day’s thread, read-only: no box, no starter questions, no New chat', async () => {
    const h = dataHarness();
    h.db.seed('workout_chat_messages', [chatRow(1, 'p', 'user', 'Yesterday’s question', YESTERDAY), chatRow(2, 'q', 'assistant', 'Yesterday’s answer', YESTERDAY), chatRow(3, 't', 'user', 'Today’s question', TODAY)]);
    await open(h);
    expect(await screen.findByText('Yesterday’s answer')).toBeOnTheScreen();
    expect(screen.queryByText('Today’s question')).toBeNull();
    expect(screen.getByTestId('closed-text')).toHaveTextContent("You can only chat on today's log — this conversation is read-only.");
    expect(input().props.editable).toBe(false);
    expect(input().props.placeholder).toBe("Chat only works on today's log");
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
  });

  it('with nothing in it, no starter questions are offered', async () => {
    await open();
    await screen.findByTestId('closed-text');
    expect(screen.queryByRole('button', { name: 'Am I training each muscle enough this week?' })).toBeNull();
  });
});
