import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { dataHarness } from '@/testing/dataHarness';

import AnalyzeScreen from '../AnalyzeScreen';

const mockApi = {
  analyzeVideo: jest.fn(),
  analysisHistory: jest.fn(),
  analysisVideoUrl: jest.fn(),
  setAiConsent: jest.fn(),
};
const mockAuth = { state: { status: 'ready', profile: { id: 'user-1', ai_consent: true } } as { status: string; profile: { id: string; ai_consent: boolean } }, refreshProfile: jest.fn(async () => undefined) };
const mockVideos = { recordVideo: jest.fn(), chooseVideo: jest.fn() };
const mockRouter = { push: jest.fn() };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/ui/videos', () => ({ recordVideo: (...a: unknown[]) => mockVideos.recordVideo(...a), chooseVideo: (...a: unknown[]) => mockVideos.chooseVideo(...a) }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: () => ({ loop: false, muted: false, play: jest.fn(), addListener: () => ({ remove: jest.fn() }) }),
    VideoView: (props: Record<string, unknown>) => <View testID="video" {...props} />,
  };
});

const CLIP = { kind: 'video', video: { uri: 'file:///set.mov', name: 'set.mov', mimeType: 'video/quicktime' } } as const;
const ENTRY = (id: number, label: string, score: number | null, createdAt: string, reps: number | null = 8) => ({ id, exercise_label: label, overall_score: score, reps, created_at: createdAt, has_video: true });
const RESULT = {
  ok: true,
  id: 31,
  exercise_label: 'Front Squat',
  overall_score: 84,
  stretch_score: 80,
  squeeze_score: 88,
  favored: 'balanced',
  reps: 5,
  sections: [{ heading: 'Positives', css_class: 'positives', emphasis: 'featured', title_key: 'analyze.section.positives', summary_html: '<p>Solid brace.</p>', detail_html: null }],
  created_at: new Date().toISOString(),
  video_url: 'https://files.example/c.mp4',
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

async function open() {
  const h = dataHarness();
  await render(
    <h.Provider>
      <AnalyzeScreen />
    </h.Provider>,
  );
  return h;
}
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
const pickExercise = async (name: string) => {
  await press(/Choose an exercise|Change/);
  await fireEvent.changeText(await screen.findByLabelText(/Search for an exercise/), name);
  await press(name);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.state = { status: 'ready', profile: { id: 'user-1', ai_consent: true } };
  mockApi.analysisHistory.mockResolvedValue([]);
  mockApi.analyzeVideo.mockResolvedValue(RESULT);
  mockApi.setAiConsent.mockResolvedValue(true);
  mockApi.analysisVideoUrl.mockResolvedValue('https://files.example/fresh.mp4');
  mockVideos.recordVideo.mockResolvedValue(CLIP);
  mockVideos.chooseVideo.mockResolvedValue(CLIP);
});

describe('choosing what to analyze', () => {
  it('starts with nothing chosen and cannot be sent', async () => {
    await open();
    expect(await screen.findByText('Choose an exercise and a video to continue.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Analyze workout' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Prop your phone up so your whole body stays in frame for the full set.')).toBeOnTheScreen();
  });

  it('an exercise alone is not enough, and neither is a video alone', async () => {
    await open();
    await pickExercise('Front Squat');
    expect(screen.getByRole('button', { name: 'Analyze workout' }).props.accessibilityState.disabled).toBe(true);
    await press('Choose a video');
    expect(await screen.findByTestId('video-ready')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Analyze workout' }).props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByText('Choose an exercise and a video to continue.')).toBeNull();
  });

  it('filming a set works like choosing one, and a video can be removed again', async () => {
    await open();
    await pickExercise('Front Squat');
    await press('Film your set');
    expect(mockVideos.recordVideo).toHaveBeenCalledTimes(1);
    expect(mockVideos.chooseVideo).not.toHaveBeenCalled();
    expect(screen.getByText('set.mov')).toBeOnTheScreen();
    await press('Remove video');
    expect(screen.queryByTestId('video-ready')).toBeNull();
    expect(screen.getByRole('button', { name: 'Film your set' })).toBeOnTheScreen();
  });

  it('cancelling the camera changes nothing; denied camera access says how to fix it and does not block choosing a video', async () => {
    mockVideos.recordVideo.mockResolvedValueOnce({ kind: 'cancelled' });
    await open();
    await press('Film your set');
    expect(screen.queryByTestId('video-ready')).toBeNull();
    expect(screen.queryByText(/Camera access is off/)).toBeNull();
    mockVideos.recordVideo.mockResolvedValueOnce({ kind: 'denied' });
    await press('Film your set');
    expect(await screen.findByText('Camera access is off. Turn it on for RepCheck in Settings to film a set.')).toBeOnTheScreen();
    await press('Choose a video');
    await screen.findByTestId('video-ready');
    expect(screen.queryByText(/Camera access is off/)).toBeNull();
  });

  it('the last exercise analyzed is already chosen, and can be changed', async () => {
    mockApi.analysisHistory.mockResolvedValue([ENTRY(2, 'Lat Pulldown', 70, hoursAgo(5)), ENTRY(1, 'Front Squat', 80, hoursAgo(80))]);
    await open();
    expect(await screen.findByRole('button', { name: 'Lat Pulldown, Change' })).toBeOnTheScreen();
    await press('Choose a video');
    await screen.findByTestId('video-ready');
    expect(screen.getByRole('button', { name: 'Analyze workout' }).props.accessibilityState.disabled).toBe(false);
    await press('Lat Pulldown, Change');
    expect(await screen.findByText('Recent')).toBeOnTheScreen();
    await press('Front Squat');
    expect(await screen.findByRole('button', { name: 'Front Squat, Change' })).toBeOnTheScreen();
  });

  it('the picker offers a starter set, searches the library, and says when nothing matches', async () => {
    await open();
    await press('Choose an exercise');
    expect(await screen.findByText('Suggested')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(/Search for an exercise/), 'zzzz');
    expect(await screen.findByText('No exercises match "zzzz".')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(/Search for an exercise/), 'front squat');
    expect(await screen.findByRole('button', { name: 'Front Squat' })).toBeOnTheScreen();
  });
});

describe('sending it', () => {
  it('uploads the chosen clip with the exercise, then shows the result and says it is an estimate', async () => {
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    expect(mockApi.analyzeVideo).toHaveBeenCalledWith(CLIP.video, 'Front Squat');
    expect(await screen.findByTestId('overall-score')).toHaveTextContent('84');
    expect(screen.getByTestId('estimate-note')).toBeOnTheScreen();
    expect(screen.getByText('Solid brace.')).toBeOnTheScreen();
  });

  it('shows the rotating status lines while it waits, and stays on the last one', async () => {
    jest.useFakeTimers();
    const cleared = jest.spyOn(global, 'clearInterval');
    try {
      let finish: (v: unknown) => void = () => undefined;
      mockApi.analyzeVideo.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      await open();
      await pickExercise('Front Squat');
      await press('Choose a video');
      await press('Analyze workout');
      expect(screen.getByTestId('status-line')).toHaveTextContent('Loading video...');
      expect(screen.getByText('This can take a minute. Keep this screen open.')).toBeOnTheScreen();
      await act(async () => {
        jest.advanceTimersByTime(2200);
      });
      expect(screen.getByTestId('status-line')).toHaveTextContent('Tracking joint positions...');
      await act(async () => {
        jest.advanceTimersByTime(2200 * 20);
      });
      expect(screen.getByTestId('status-line')).toHaveTextContent('Drafting your form report...');
      await act(async () => finish(RESULT));
      expect(await screen.findByTestId('overall-score')).toBeOnTheScreen();
      expect(screen.queryByTestId('status-line')).toBeNull();
      expect(cleared).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the list of recent analyses is refreshed once a new one is saved', async () => {
    mockApi.analysisHistory.mockResolvedValueOnce([]).mockResolvedValue([ENTRY(31, 'Front Squat', 84, hoursAgo(0))]);
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    await screen.findByTestId('overall-score');
    await waitFor(() => expect(mockApi.analysisHistory.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('analyze another goes back to the form with the exercise kept and the video cleared', async () => {
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    await press('Analyze another video');
    expect(await screen.findByRole('button', { name: 'Front Squat, Change' })).toBeOnTheScreen();
    expect(screen.queryByTestId('video-ready')).toBeNull();
    expect(screen.getByRole('button', { name: 'Film your set' })).toBeOnTheScreen();
  });

  it.each([
    [new ApiError('You have used all of your analyses for today.', 429, {}, 3600), 'You have used all of your analyses for today.'],
    [new ApiError('Unsupported file type ".gif".', 400), 'Unsupported file type ".gif".'],
    [new ApiError('That file is too large.', 413), 'That file is too large.'],
    [new Error('boom'), "Couldn't analyze that. Check your connection and try again."],
  ])('a failure (%s) is shown in words, keeps the choices, and can be tried again', async (error, message) => {
    mockApi.analyzeVideo.mockRejectedValueOnce(error);
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Front Squat, Change' })).toBeOnTheScreen();
    expect(screen.getByTestId('video-ready')).toBeOnTheScreen();
    await press('Analyze workout');
    expect(await screen.findByTestId('overall-score')).toBeOnTheScreen();
    expect(mockApi.analyzeVideo).toHaveBeenCalledTimes(2);
  });
});

describe('the AI consent gate', () => {
  beforeEach(() => {
    mockAuth.state = { status: 'ready', profile: { id: 'user-1', ai_consent: false } };
  });

  it('without consent nothing is sent: the question comes first, and it names videos', async () => {
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    expect(screen.getByText(/Lift and challenge videos, for form scores and rep counts/)).toBeOnTheScreen();
    expect(mockApi.analyzeVideo).not.toHaveBeenCalled();
  });

  it('allowing records it, then sends the clip that was waiting', async () => {
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    await press('Allow');
    await screen.findByTestId('overall-score');
    expect(mockApi.setAiConsent).toHaveBeenCalledWith(true);
    expect(mockAuth.refreshProfile).toHaveBeenCalled();
    expect(mockApi.analyzeVideo).toHaveBeenCalledWith(CLIP.video, 'Front Squat');
    expect(mockApi.setAiConsent.mock.invocationCallOrder[0]).toBeLessThan(mockApi.analyzeVideo.mock.invocationCallOrder[0]);
  });

  it('declining sends nothing and goes back to the form with the choices kept', async () => {
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    await press('Not now');
    expect(await screen.findByTestId('video-ready')).toBeOnTheScreen();
    expect(mockApi.analyzeVideo).not.toHaveBeenCalled();
    expect(mockApi.setAiConsent).not.toHaveBeenCalled();
  });

  it('if recording the choice fails, nothing is sent and the reason is shown', async () => {
    mockApi.setAiConsent.mockRejectedValueOnce(new ApiError('Could not save that.', 500));
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    await press('Allow');
    expect(await screen.findByText('Could not save that.')).toBeOnTheScreen();
    expect(mockApi.analyzeVideo).not.toHaveBeenCalled();
  });

  it('a server that says consent is missing (turned off on another device) leads to the question too', async () => {
    mockAuth.state = { status: 'ready', profile: { id: 'user-1', ai_consent: true } };
    mockApi.analyzeVideo.mockRejectedValueOnce(new ApiError('Allow AI features first.', 403, { needs_ai_consent: true }));
    await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
  });
});

describe('recent analyses', () => {
  it('lists the newest five with how long ago, the reps and the score; each opens', async () => {
    mockApi.analysisHistory.mockResolvedValue([
      ENTRY(6, 'Front Squat', 91, hoursAgo(2)),
      ENTRY(5, 'Lat Pulldown', 64, hoursAgo(30)),
      ENTRY(4, 'Deadlift', 30, hoursAgo(24 * 3 + 2), 3),
      ENTRY(3, 'Row', null, hoursAgo(24 * 5), null),
      ENTRY(2, 'Bench', 55, hoursAgo(24 * 6)),
      ENTRY(1, 'Curl', 77, hoursAgo(24 * 9)),
    ]);
    await open();
    expect(await screen.findByRole('button', { name: 'Front Squat, Today, score 91' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Lat Pulldown, Yesterday, score 64' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Deadlift, 3 days ago, score 30' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Row, 5 days ago, score —' })).toBeOnTheScreen();
    expect(screen.getByText('3 days ago · 3 reps')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Curl/ })).toBeNull();
    await press('Deadlift, 3 days ago, score 30');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/analysis', params: { id: '4' } });
  });

  it('View full logs opens the history', async () => {
    mockApi.analysisHistory.mockResolvedValue([ENTRY(1, 'Curl', 77, hoursAgo(2))]);
    await open();
    await press('View full logs');
    expect(mockRouter.push).toHaveBeenCalledWith('/analysis-history');
  });

  it('says so when there are none, and offers no logs link', async () => {
    await open();
    expect(await screen.findByText('No analyses yet.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'View full logs' })).toBeNull();
  });

  it('says so when they could not be loaded and nothing is saved', async () => {
    mockApi.analysisHistory.mockRejectedValue(new ApiError('boom', 500));
    await open();
    expect(await screen.findByText("Couldn't load your analyses. Check your connection and try again.")).toBeOnTheScreen();
  });
});

describe('asking about a fresh result', () => {
  it('opens the chat for the new analysis, and its result is already known to the chat screen', async () => {
    const h = await open();
    await pickExercise('Front Squat');
    await press('Choose a video');
    await press('Analyze workout');
    await fireEvent.press(await screen.findByRole('button', { name: 'Ask about this analysis' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/analysis-chat', params: { id: '31' } });
    expect(h.queryClient.getQueryData(['analyze', 'user-1', 'detail', 31])).toMatchObject({ id: 31, exercise_label: 'Front Squat' });
  });
});
