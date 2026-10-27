import { fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { dataHarness } from '@/testing/dataHarness';

import AnalysisScreen from '../AnalysisScreen';
import HistoryScreen from '../HistoryScreen';
import { monthHeading, whenLabel } from '../labels';
import { RichText } from '../RichText';

const mockApi = { analysisHistory: jest.fn(), analysis: jest.fn(), analysisVideoUrl: jest.fn() };
const mockAuth = { state: { status: 'ready', profile: { id: 'user-1', ai_consent: true } } };
const mockRouter = { push: jest.fn() };
const mockParams = { id: '7' as string | undefined };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: () => ({ loop: false, muted: false, play: jest.fn(), addListener: () => ({ remove: jest.fn() }) }),
    VideoView: (props: Record<string, unknown>) => <View testID="video" {...props} />,
  };
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ENTRY = (id: number, label: string, score: number | null, createdAt: string) => ({ id, exercise_label: label, overall_score: score, reps: 6, created_at: createdAt, has_video: true });
const DETAIL = {
  ok: true,
  id: 7,
  exercise_label: 'Deadlift',
  overall_score: 66,
  stretch_score: 60,
  squeeze_score: 70,
  favored: 'squeeze',
  reps: 6,
  sections: [{ heading: 'Positives', css_class: 'positives', emphasis: 'featured', title_key: 'analyze.section.positives', summary_html: '<p>Flat back.</p>', detail_html: null }],
  created_at: hoursAgo(50),
  video_url: 'https://files.example/old-link.mp4',
};

async function open(Screen: () => React.JSX.Element) {
  const h = dataHarness();
  await render(
    <h.Provider>
      <Screen />
    </h.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = '7';
  mockApi.analysisHistory.mockResolvedValue([]);
  mockApi.analysis.mockResolvedValue(DETAIL);
  mockApi.analysisVideoUrl.mockResolvedValue('https://files.example/fresh.mp4');
});

describe('the history', () => {
  it('groups by month, newest first, and each row opens that analysis', async () => {
    // Mid-month noon in two different months so no timezone can merge them.
    mockApi.analysisHistory.mockResolvedValue([
      ENTRY(4, 'Deadlift', 80, '2026-10-15T12:00:00+00:00'),
      ENTRY(3, 'Row', 55, '2026-10-03T12:00:00+00:00'),
      ENTRY(2, 'Bench', 40, '2026-08-20T12:00:00+00:00'),
    ]);
    await open(HistoryScreen);
    const headings = await screen.findAllByRole('header');
    expect(headings.map((h) => h.props.children)).toEqual(['October 2026', 'August 2026']);
    await fireEvent.press(screen.getByRole('button', { name: /^Bench,/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/analysis', params: { id: '2' } });
  });

  it('says so when there are none', async () => {
    await open(HistoryScreen);
    expect(await screen.findByText('No analyses yet. Analyze a set to start building your log.')).toBeOnTheScreen();
  });

  it('says so when they could not be loaded, and trying again asks again', async () => {
    mockApi.analysisHistory.mockRejectedValueOnce(new ApiError('boom', 500));
    await open(HistoryScreen);
    expect(await screen.findByText("Couldn't load your analyses. Check your connection and try again.")).toBeOnTheScreen();
    mockApi.analysisHistory.mockResolvedValue([ENTRY(1, 'Curl', 70, hoursAgo(1))]);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^Curl,/ })).toBeOnTheScreen();
  });
});

describe('one analysis', () => {
  it('opens the one in the link, and plays a new link for its clip rather than the saved one', async () => {
    await open(AnalysisScreen);
    expect(await screen.findByRole('header', { name: 'Deadlift' })).toBeOnTheScreen();
    expect(mockApi.analysis).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('overall-score')).toHaveTextContent('66');
    expect(await screen.findByTestId('video')).toBeOnTheScreen();
    expect(mockApi.analysisVideoUrl).toHaveBeenCalledWith(7);
  });

  it('one that is gone (pruned) says so and offers no retry', async () => {
    mockApi.analysis.mockRejectedValue(new ApiError('Not found.', 404));
    await open(AnalysisScreen);
    expect(await screen.findByText('That analysis is gone. Only your latest 20 are kept.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a link with no usable id asks nothing and says it is gone', async () => {
    for (const bad of [undefined, 'abc', '-3', '1.5', '']) {
      mockParams.id = bad;
      mockApi.analysis.mockClear();
      const h = dataHarness();
      const view = await render(
        <h.Provider>
          <AnalysisScreen />
        </h.Provider>,
      );
      expect(await screen.findByText('That analysis is gone. Only your latest 20 are kept.')).toBeOnTheScreen();
      expect(mockApi.analysis).not.toHaveBeenCalled();
      await view.unmount();
    }
  });

  it('a failure to load says so, and trying again loads it', async () => {
    mockApi.analysis.mockRejectedValueOnce(new ApiError('boom', 500));
    await open(AnalysisScreen);
    expect(await screen.findByText("Couldn't load that. Check your connection and try again.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: 'Deadlift' })).toBeOnTheScreen();
  });
});

describe('labels', () => {
  const t = (key: string, vars?: Record<string, string | number>) => (key === 'analyze.daysAgo' ? `${vars?.n} days ago` : key === 'analyze.today' ? 'Today' : key === 'analyze.yesterday' ? 'Yesterday' : key);
  const now = Date.UTC(2026, 9, 27, 12);

  it('names the day relative to now, then the date', () => {
    const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
    expect(whenLabel(at(1), now, 'en-US', t as never)).toBe('Today');
    expect(whenLabel(at(25), now, 'en-US', t as never)).toBe('Yesterday');
    expect(whenLabel(at(24 * 4), now, 'en-US', t as never)).toBe('4 days ago');
    expect(whenLabel(at(24 * 10), now, 'en-US', t as never)).toMatch(/^Oct \d+$/);
    expect(whenLabel('nope', now, 'en-US', t as never)).toBe('');
  });

  it('names a month in the language of the person', () => {
    expect(monthHeading(Date.UTC(2026, 9, 15, 12), 'en-US')).toBe('October 2026');
    expect(monthHeading(Date.UTC(2026, 9, 15, 12), 'th-TH')).toMatch(/ตุลาคม/);
    expect(monthHeading(null, 'en-US')).toBe('');
  });
});

describe('RichText', () => {
  it('draws paragraphs and bullets with bold and italic, and nothing for nothing', async () => {
    await render(<RichText html={'<p>a <strong>b</strong></p><ul><li>c <em>d</em></li></ul>'} />);
    expect(screen.getByText('a')).toBeOnTheScreen();
    expect(screen.getByText('b').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontWeight: '700' })]));
    expect(screen.getByText('d').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontStyle: 'italic' })]));
    expect(screen.getAllByText('•', { includeHiddenElements: true })).toHaveLength(1);
    await render(<RichText html={null} />);
  });
});

describe('asking about a past analysis', () => {
  it('opens the chat for that analysis', async () => {
    await open(AnalysisScreen);
    await fireEvent.press(await screen.findByRole('button', { name: 'Ask about this analysis' }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/analysis-chat', params: { id: '7' } });
  });
});
