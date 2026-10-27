import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { parseAnalysis } from '@/logic/analyzeResult';
import { EXERCISES, defaultSuggestions } from '@/logic/workouts';
import { USER, dataHarness } from '@/testing/dataHarness';
import { palette } from '@/ui/tokens';

import { AnalysisRow } from '../AnalysisRow';
import { AnalysisView } from '../AnalysisView';
import AnalysisScreen from '../AnalysisScreen';
import AnalyzeScreen from '../AnalyzeScreen';
import { analyzeKeys } from '../queries';
import HistoryScreen from '../HistoryScreen';

const mockApi = { analysisHistory: jest.fn(), analysis: jest.fn(), analysisVideoUrl: jest.fn(), analyzeVideo: jest.fn(), setAiConsent: jest.fn() };
const mockAuth = { state: { status: 'ready', profile: { id: USER, ai_consent: true } }, refreshProfile: jest.fn() };
const mockRouter = { push: jest.fn() };
const mockVideo = { listener: null as null | ((e: { status: string }) => void) };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: '7' }) }));
jest.mock('@/ui/videos', () => ({ recordVideo: jest.fn(), chooseVideo: jest.fn() }));
jest.mock('expo-video', () => {
  const { View } = require('react-native');
  const player = { loop: false, muted: false, play: jest.fn(), addListener: (_e: string, cb: (e: { status: string }) => void) => ((mockVideo.listener = cb), { remove: jest.fn() }) };
  return { useVideoPlayer: () => player, VideoView: (props: Record<string, unknown>) => <View testID="video" {...props} /> };
});

const entry = (id: number, score: number | null) => ({ id, exercise_label: `Lift ${id}`, overall_score: score, reps: 5, created_at: new Date().toISOString(), has_video: false });
const detail = (over: Record<string, unknown> = {}) => ({ ok: true, id: 7, exercise_label: 'Deadlift', overall_score: 66, stretch_score: 1, squeeze_score: 2, favored: null, reps: 6, sections: [], created_at: new Date().toISOString(), video_url: null, ...over });
const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, unknown>;
const spinner = () => screen.queryByTestId('loading');
const never = () => new Promise<never>(() => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.analysisHistory.mockResolvedValue([]);
  mockApi.analysisVideoUrl.mockResolvedValue('https://files.example/c.mp4');
});

describe('score colours', () => {
  const tones: [number | null, string][] = [
    [90, palette.light.ink.green],
    [60, palette.light.ink.amber],
    [20, palette.light.ink.red],
    [null, palette.light.textSecondary],
  ];

  it.each(tones)('a score of %s on the result is %s', async (score, color) => {
    await render(<AnalysisView analysis={parseAnalysis(detail({ overall_score: score }))!} />);
    expect(flat(screen.getByTestId('overall-score')).color).toBe(color);
  });

  it.each(tones.filter(([s]) => s !== null))('a score of %s in a row is %s', async (score, color) => {
    await render(<AnalysisRow entry={{ ...entry(1, score), has_video: false }} now={Date.now()} onPress={jest.fn()} />);
    expect(flat(screen.getByText(String(score))).color).toBe(color);
  });

  it('a row with no score shows none', async () => {
    await render(<AnalysisRow entry={entry(1, null)} now={Date.now()} onPress={jest.fn()} />);
    expect(screen.queryByText('5 reps')).toBeNull();
    expect(screen.getByRole('button', { name: /score —$/ })).toBeOnTheScreen();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });
});

describe('the exercise sheet', () => {
  async function open(h = dataHarness()) {
    mockApi.analysisHistory.mockResolvedValue([entry(1, 70)]);
    await render(
      <h.Provider>
        <AnalyzeScreen />
      </h.Provider>,
    );
    return h;
  }

  it('closes when an exercise is picked and when it is dismissed', async () => {
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: /^Lift 1, Change/ }));
    expect(await screen.findByLabelText(/Search for an exercise/)).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Squat' }));
    expect(screen.queryByLabelText(/Search for an exercise/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /^Squat, Change/ }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText(/Search for an exercise/)).toBeNull();
  });

  it('shows eight recent and eight favourite names at most, and only favourites it knows', async () => {
    const h = dataHarness({ listCustomExercises: async () => [{ id: 1, name: 'Sled Drag', emoji: '🛷', mode: 'both' }] });
    const starters = new Set(defaultSuggestions(6));
    const pool = EXERCISES.map((e) => e.name).filter((n) => !starters.has(n)).slice(0, 10);
    h.db.seed('exercise_favorites', [...pool.map((exercise_name) => ({ user_id: USER, exercise_name })), { user_id: USER, exercise_name: 'Ghost Lift' }]);
    mockApi.analysisHistory.mockResolvedValue(Array.from({ length: 10 }, (_, i) => entry(i + 1, 70)));
    await render(
      <h.Provider>
        <AnalyzeScreen />
      </h.Provider>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: /Change/ }));
    await screen.findByText('Favorites');
    for (let i = 1; i <= 8; i++) expect(screen.getAllByRole('button', { name: `Lift ${i}` }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Lift 9' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ghost Lift' })).toBeNull();
    expect(pool.filter((n) => screen.queryByRole('button', { name: n }) !== null)).toHaveLength(8);
  });

  it('a favourite that is one of your own exercises is listed', async () => {
    const h = dataHarness({ listCustomExercises: async () => [{ id: 1, name: 'Sled Drag', emoji: '🛷', mode: 'both' }] });
    h.db.seed('exercise_favorites', [{ user_id: USER, exercise_name: 'Sled Drag' }]);
    await open(h);
    await fireEvent.press(await screen.findByRole('button', { name: /Change/ }));
    expect(await screen.findByRole('button', { name: 'Sled Drag' })).toBeOnTheScreen();
  });

  it('offers exactly six suggestions, and no heading for a list with nothing in it', async () => {
    mockApi.analysisHistory.mockResolvedValue([]);
    const h = dataHarness();
    await render(
      <h.Provider>
        <AnalyzeScreen />
      </h.Provider>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Choose an exercise' }));
    await screen.findByText('Suggested');
    expect(screen.queryByText('Recent')).toBeNull();
    expect(screen.queryByText('Favorites')).toBeNull();
    const seven = defaultSuggestions(7);
    expect(seven).toHaveLength(7);
    for (const name of seven.slice(0, 6)) expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: seven[6] })).toBeNull();
  });

  it('the search box does not autocorrect an exercise name', async () => {
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: /Change/ }));
    expect((await screen.findByLabelText(/Search for an exercise/)).props.autoCorrect).toBe(false);
  });
});

describe('loading, failing and empty', () => {
  it('the history page shows a spinner while it loads, and neither the empty line nor an error', async () => {
    mockApi.analysisHistory.mockReturnValue(never());
    const h = dataHarness();
    await render(
      <h.Provider>
        <HistoryScreen />
      </h.Provider>,
    );
    expect(spinner()).not.toBeNull();
    expect(screen.queryByText(/No analyses yet/)).toBeNull();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it('with saved entries it shows them, not a spinner, while it refreshes; and not an error if the refresh fails', async () => {
    const h = dataHarness();
    h.queryClient.setQueryData(analyzeKeys.history(USER), [entry(1, 80), entry(2, 70)]);
    mockApi.analysisHistory.mockReturnValue(never());
    await render(
      <h.Provider>
        <HistoryScreen />
      </h.Provider>,
    );
    expect(await screen.findByRole('button', { name: /^Lift 1,/ })).toBeOnTheScreen();
    expect(spinner()).toBeNull();
    await act(async () => undefined);
    mockApi.analysisHistory.mockRejectedValue(new ApiError('boom', 500));
    await act(async () => {
      await h.queryClient.refetchQueries({ queryKey: analyzeKeys.history(USER) }).catch(() => undefined);
    });
    expect(screen.getByRole('button', { name: /^Lift 2,/ })).toBeOnTheScreen();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    expect(screen.queryByText(/No analyses yet/)).toBeNull();
  });

  it('a failed load with nothing saved says so and is not also "empty"', async () => {
    mockApi.analysisHistory.mockRejectedValue(new ApiError('boom', 500));
    const h = dataHarness();
    await render(
      <h.Provider>
        <HistoryScreen />
      </h.Provider>,
    );
    expect(await screen.findByText("Couldn't load your analyses. Check your connection and try again.")).toBeOnTheScreen();
    expect(screen.queryByText(/No analyses yet/)).toBeNull();
    expect(spinner()).toBeNull();
  });

  it('one analysis: a spinner while it loads, and no "gone" line', async () => {
    mockApi.analysis.mockReturnValue(never());
    const h = dataHarness();
    await render(
      <h.Provider>
        <AnalysisScreen />
      </h.Provider>,
    );
    expect(spinner()).not.toBeNull();
    expect(screen.queryByText(/is gone/)).toBeNull();
  });

  it('one analysis that is gone shows no spinner', async () => {
    mockApi.analysis.mockRejectedValue(new ApiError('Not found.', 404));
    const h = dataHarness();
    await render(
      <h.Provider>
        <AnalysisScreen />
      </h.Provider>,
    );
    expect(await screen.findByText(/is gone/)).toBeOnTheScreen();
    expect(spinner()).toBeNull();
  });

  it('a saved analysis stays on screen when the refresh says it is gone', async () => {
    const h = dataHarness();
    h.queryClient.setQueryData(analyzeKeys.detail(USER, 7), parseAnalysis(detail())!);
    mockApi.analysis.mockRejectedValue(new ApiError('Not found.', 404));
    await render(
      <h.Provider>
        <AnalysisScreen />
      </h.Provider>,
    );
    expect(await screen.findByRole('header', { name: 'Deadlift' })).toBeOnTheScreen();
    await waitFor(() => expect(mockApi.analysis).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByText(/is gone/)).toBeNull();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });
});

describe('the clip player', () => {
  it('only an error stops the clip, not other status changes', async () => {
    mockApi.analysisVideoUrl.mockResolvedValue('https://files.example/c.mp4');
    await render(<AnalysisView analysis={parseAnalysis(detail({ video_url: 'https://files.example/c.mp4' }))!} fresh />);
    await screen.findByTestId('video');
    await act(async () => mockVideo.listener!({ status: 'readyToPlay' }));
    await act(async () => mockVideo.listener!({ status: 'loading' }));
    expect(screen.getByTestId('video')).toBeOnTheScreen();
    expect(screen.queryByText("The clip isn't available right now.")).toBeNull();
  });
});
