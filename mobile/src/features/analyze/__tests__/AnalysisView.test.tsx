import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { ApiError } from '@/api/client';
import { parseAnalysis, type Analysis } from '@/logic/analyzeResult';

import { AnalysisView } from '../AnalysisView';

const mockApi = { analysisVideoUrl: jest.fn() };
const mockVideo = { listener: null as null | ((e: { status: string }) => void), players: new Map<string, { loop: boolean; muted: boolean; play: jest.Mock }>() };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: (url: string, setup?: (p: unknown) => void) => {
      let player = mockVideo.players.get(url);
      if (!player) {
        player = { loop: false, muted: false, play: jest.fn(), addListener: jest.fn((_event: string, cb: (e: { status: string }) => void) => ((mockVideo.listener = cb), { remove: jest.fn() })) } as never;
        setup?.(player);
        mockVideo.players.set(url, player as never);
      }
      return player;
    },
    VideoView: (props: Record<string, unknown>) => <View testID="video" {...props} />,
  };
});

const { cases } = require('../../../logic/__tests__/fixtures/feedback.json') as { cases: { sections: unknown[] }[] };

const base = (over: Record<string, unknown> = {}, sections: unknown[] = cases[0].sections) =>
  parseAnalysis({ ok: true, id: 5, exercise_label: 'Flat Bench Press', overall_score: 72, stretch_score: 70, squeeze_score: 80, favored: 'squeeze', reps: 8, sections, created_at: '2026-10-27T10:00:00+00:00', video_url: 'https://files.example/clip.mp4', ...over })!;

const show = async (analysis: Analysis, props: Record<string, unknown> = {}) => render(<AnalysisView analysis={analysis} {...props} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockVideo.players.clear();
  mockVideo.listener = null;
  mockApi.analysisVideoUrl.mockResolvedValue('https://files.example/fresh.mp4');
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});

describe('the score', () => {
  it('shows the exercise, the score, its caption, the reps and a verdict', async () => {
    await show(base());
    expect(screen.getByRole('header', { name: 'Flat Bench Press' })).toBeOnTheScreen();
    expect(screen.getByTestId('overall-score')).toHaveTextContent('72');
    expect(screen.getByLabelText('Overall form score 72 out of 100')).toBeOnTheScreen();
    expect(screen.getByText('Overall Form & Technique')).toBeOnTheScreen();
    expect(screen.getByTestId('reps')).toHaveTextContent('8 Reps Counted');
    expect(screen.getByTestId('verdict')).toHaveTextContent('Mixed set — a few things to tighten up.');
  });

  it.each([[95, 'Strong set — ready to push further.'], [50, 'Mixed set — a few things to tighten up.'], [49, 'Faults outweighed strengths — start with the fixes.']])('a score of %i says "%s"', async (score, verdict) => {
    await show(base({ overall_score: score }));
    expect(screen.getByTestId('verdict')).toHaveTextContent(verdict);
  });

  it('no score shows a dash and no verdict; no reps shows no count', async () => {
    await show(base({ overall_score: null, reps: 0 }));
    expect(screen.getByTestId('overall-score')).toHaveTextContent('—');
    expect(screen.getByLabelText('No score')).toBeOnTheScreen();
    expect(screen.queryByTestId('verdict')).toBeNull();
    expect(screen.queryByTestId('reps')).toBeNull();
  });

  it('names which half the set favoured, or that it was balanced, or says nothing', async () => {
    const view = await show(base({ favored: 'squeeze' }));
    expect(screen.getByTestId('favored-note')).toHaveTextContent('This set favors the Squeeze — the Stretch could use more focus.');
    await view.rerender(<AnalysisView analysis={base({ favored: 'stretch' })} />);
    expect(screen.getByTestId('favored-note')).toHaveTextContent('This set favors the Stretch — the Squeeze could use more focus.');
    await view.rerender(<AnalysisView analysis={base({ favored: 'balanced' })} />);
    expect(screen.getByTestId('favored-note')).toHaveTextContent('Your stretch and squeeze are evenly balanced.');
    await view.rerender(<AnalysisView analysis={base({ favored: null })} />);
    expect(screen.queryByTestId('favored-note')).toBeNull();
  });

  it('always says the numbers are estimates and not medical advice', async () => {
    await show(base());
    expect(screen.getByTestId('estimate-note')).toHaveTextContent(/AI estimates from your video and can be wrong/);
    expect(screen.getByTestId('estimate-note')).toHaveTextContent(/not medical advice/);
  });
});

describe('the report', () => {
  it('leads with what went well and the next step; the rest waits behind Full report', async () => {
    await show(base());
    expect(screen.getByTestId('section-positives')).toBeOnTheScreen();
    expect(screen.getByTestId('section-progress')).toBeOnTheScreen();
    for (const hidden of ['summary', 'negatives', 'improvements', 'injury']) expect(screen.queryByTestId(`section-${hidden}`)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Full report' }));
    for (const shown of ['summary', 'negatives', 'improvements', 'injury']) expect(screen.getByTestId(`section-${shown}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Full report' }));
    expect(screen.queryByTestId('section-negatives')).toBeNull();
  });

  it('a section shows its first point, the rest on request, in the words the server wrote (entities decoded, no markup)', async () => {
    await show(base());
    expect(screen.getByText('Excellent bracing & chest position throughout.')).toBeOnTheScreen();
    expect(screen.queryByText('Consistent tempo: ~2s down, 1s up.')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'What went well: read the full explanation' }));
    expect(screen.getByText('Consistent tempo: ~2s down, 1s up.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText('Consistent tempo: ~2s down, 1s up.')).toBeNull();
  });

  it('a section with only one point has nothing to expand', async () => {
    await show(base());
    // "Stay safe" is one sentence in the sample report.
    await fireEvent.press(screen.getByRole('button', { name: 'Full report' }));
    const injury = screen.getByTestId('section-injury');
    expect(injury).toHaveTextContent('Stay safeStop the set if you feel a pinch in the hip crease.');
    expect(screen.queryByRole('button', { name: 'Stay safe: read the full explanation' })).toBeNull();
  });

  it('no Full report row when there is nothing behind it', async () => {
    await show(base({}, cases[0].sections.filter((s) => ['positives', 'progress'].includes((s as { css_class: string }).css_class))));
    expect(screen.queryByRole('button', { name: 'Full report' })).toBeNull();
  });

  it('markup the model smuggled in is shown as text and nothing runs', async () => {
    const hostile = cases[4].sections; // "<script>alert(1)</script>" in the sample report
    await show(base({}, hostile));
    await fireEvent.press(screen.getByRole('button', { name: 'Full report' }));
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeOnTheScreen();
  });
});

describe('the tutorial', () => {
  it('a library exercise opens its video; anything else searches YouTube', async () => {
    const view = await show(base());
    await fireEvent.press(screen.getByRole('button', { name: 'How to perform this exercise' }));
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://www.youtube.com/watch?v=hWbUlkb5Ms4');
    await view.rerender(<AnalysisView analysis={base({ exercise_label: 'My own lift' })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Watch a form tutorial on YouTube' }));
    expect(Linking.openURL).toHaveBeenLastCalledWith(`https://www.youtube.com/results?search_query=${encodeURIComponent('My own lift proper form tutorial')}`);
  });
});

describe('analyze another', () => {
  it('only when asked for, and it calls back', async () => {
    const onAnother = jest.fn();
    const view = await show(base());
    expect(screen.queryByRole('button', { name: 'Analyze another video' })).toBeNull();
    await view.rerender(<AnalysisView analysis={base()} onAnother={onAnother} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Analyze another video' }));
    expect(onAnother).toHaveBeenCalledTimes(1);
  });
});

describe('the clip', () => {
  it('a result that has just come back plays the link it came with, muted and looping, without asking again', async () => {
    await show(base(), { fresh: true });
    expect(await screen.findByTestId('video')).toBeOnTheScreen();
    expect(mockApi.analysisVideoUrl).not.toHaveBeenCalled();
    const player = mockVideo.players.get('https://files.example/clip.mp4')!;
    expect(player).toMatchObject({ loop: true, muted: true });
    expect(player.play).toHaveBeenCalled();
  });

  it('a stored analysis ignores the saved link (it has expired by now) and asks for a new one', async () => {
    await show(base());
    expect(await screen.findByTestId('video')).toBeOnTheScreen();
    expect(mockApi.analysisVideoUrl).toHaveBeenCalledWith(5);
    expect(mockVideo.players.has('https://files.example/fresh.mp4')).toBe(true);
    expect(mockVideo.players.has('https://files.example/clip.mp4')).toBe(false);
  });

  it('no clip kept, no player and no request', async () => {
    await show(base({ video_url: null }));
    expect(screen.queryByTestId('video')).toBeNull();
    expect(mockApi.analysisVideoUrl).not.toHaveBeenCalled();
  });

  it('with no signal it says to connect, and trying again asks again', async () => {
    mockApi.analysisVideoUrl.mockRejectedValueOnce(new ApiError('Could not reach the server.', 0));
    await show(base());
    expect(await screen.findByText('Connect to the internet to watch your clip.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('video')).toBeOnTheScreen();
    expect(mockApi.analysisVideoUrl).toHaveBeenCalledTimes(2);
  });

  it('a clip that is gone says so instead of showing a black box', async () => {
    mockApi.analysisVideoUrl.mockResolvedValueOnce(null);
    await show(base());
    expect(await screen.findByText("The clip isn't available right now.")).toBeOnTheScreen();
    expect(screen.queryByTestId('video')).toBeNull();
  });

  it('a server error is "not available" too, not a crash', async () => {
    mockApi.analysisVideoUrl.mockRejectedValueOnce(new ApiError('boom', 500));
    await show(base());
    expect(await screen.findByText("The clip isn't available right now.")).toBeOnTheScreen();
  });

  it('a link that stops working mid-play offers a new one', async () => {
    await show(base(), { fresh: true });
    await screen.findByTestId('video');
    expect(mockVideo.listener).not.toBeNull();
    mockVideo.listener!({ status: 'readyToPlay' });
    expect(screen.getByTestId('video')).toBeOnTheScreen();
    mockVideo.listener!({ status: 'error' });
    await waitFor(() => expect(screen.getByText("The clip isn't available right now.")).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('video')).toBeOnTheScreen();
    expect(mockApi.analysisVideoUrl).toHaveBeenCalledTimes(1);
  });
});

describe('asking about the analysis', () => {
  it('offers the chat only where the screen can open it, and opens it', async () => {
    const onAsk = jest.fn();
    const view = await show(base());
    expect(screen.queryByRole('button', { name: 'Ask about this analysis' })).toBeNull();
    await view.rerender(<AnalysisView analysis={base()} onAsk={onAsk} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ask about this analysis' }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});
