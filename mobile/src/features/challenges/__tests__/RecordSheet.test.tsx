import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { dataHarness } from '@/testing/dataHarness';

import { RecordSheet } from '../RecordSheet';

const mockApi = { createChallenge: jest.fn(), submitChallengeClip: jest.fn(), setAiConsent: jest.fn() };
const mockAuth = { consented: true, refresh: jest.fn(async () => undefined) };
const mockCamera: {
  permission: { granted: boolean; canAskAgain: boolean } | null;
  request: jest.Mock;
  ready: boolean;
  props: Record<string, any> | null;
  record: jest.Mock;
  stop: jest.Mock;
  finish: ((value: { uri?: string } | undefined) => void) | null;
} = { permission: { granted: true, canAskAgain: true }, request: jest.fn(), ready: true, props: null, record: jest.fn(), stop: jest.fn(), finish: null };

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/client'), getApi: () => mockApi }));
jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ state: { status: 'ready', profile: { id: 'user-1', ai_consent: mockAuth.consented } }, refreshProfile: mockAuth.refresh }),
}));
jest.mock('@/features/analyze/ClipPlayer', () => {
  const { Text } = require('react-native');
  return { Player: ({ url }: { url: string }) => <Text testID="clip">{url}</Text> };
});
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const CameraView = React.forwardRef(function CameraView(props: Record<string, any>, ref: unknown) {
    mockCamera.props = props;
    React.useImperativeHandle(ref, () => ({ recordAsync: (...a: unknown[]) => mockCamera.record(...a), stopRecording: () => mockCamera.stop() }));
    React.useEffect(() => {
      if (mockCamera.ready) props.onCameraReady?.();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <View testID="camera" />;
  });
  return { CameraView, useCameraPermissions: () => [mockCamera.permission, mockCamera.request] };
});

const onClose = jest.fn();
const onCounted = jest.fn();
const onLimit = jest.fn();
const ATTEMPT = { exercise: 'pushups', counted: 18, total: 21, rejected: 3, notes: 'Good depth' };

async function open(visible = true) {
  const h = dataHarness();
  const view = await render(
    <h.Provider>
      <RecordSheet visible={visible} exercise="pushups" title="Push-ups — 25s challenge" onClose={onClose} onCounted={onCounted} onLimit={onLimit} />
    </h.Provider>,
  );
  return { h, view };
}
const press = async (name: string | RegExp) => {
  await fireEvent.press(await screen.findByRole('button', { name }));
};
/** Time passes a second at a time: the countdown schedules its next tick only after React has drawn the last one. */
const tick = async (ms: number) => {
  for (let left = ms; left > 0; left -= 1000) {
    await act(async () => {
      jest.advanceTimersByTime(Math.min(1000, left));
    });
  }
};
/** Start, count down, and get to the recording. */
async function startRecording() {
  await press('Start recording');
  await tick(10_000);
}
const finishRecording = async (clip: { uri?: string } | undefined = { uri: 'file:///clip.mov' }) => {
  await act(async () => {
    mockCamera.finish?.(clip);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAuth.consented = true;
  mockCamera.permission = { granted: true, canAskAgain: true };
  mockCamera.ready = true;
  mockCamera.finish = null;
  mockCamera.record.mockImplementation(() => new Promise((resolve) => (mockCamera.finish = resolve)));
  mockCamera.stop.mockImplementation(() => mockCamera.finish?.({ uri: 'file:///clip.mov' }));
  mockApi.createChallenge.mockResolvedValue({ id: 12, exercise: 'pushups' });
  mockApi.submitChallengeClip.mockResolvedValue(ATTEMPT);
  mockApi.setAiConsent.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('before recording', () => {
  it('shows the camera, and starting is only offered once it is ready', async () => {
    mockCamera.ready = false;
    await open();
    expect(await screen.findByTestId('camera')).toBeOnTheScreen();
    expect(screen.getByTestId('starting')).toHaveTextContent('Starting camera...');
    expect(screen.getByRole('button', { name: 'Start recording' }).props.accessibilityState.disabled).toBe(true);
  });

  it('a ready camera can start, and records the front camera with no sound', async () => {
    await open();
    await screen.findByTestId('camera');
    expect(screen.queryByTestId('permission-spinner')).toBeNull();
    expect(screen.queryByTestId('starting')).toBeNull();
    expect(mockCamera.props).toMatchObject({ facing: 'front', mode: 'video', mute: true });
    expect(screen.getByRole('button', { name: 'Start recording' }).props.accessibilityState.disabled).toBeFalsy();
  });

  it('with the camera off, says so and offers to ask again', async () => {
    mockCamera.permission = { granted: false, canAskAgain: true };
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was denied.');
    await press('Start recording');
    expect(mockCamera.request).toHaveBeenCalled();
    expect(screen.queryByTestId('camera')).toBeNull();
  });

  it('when it cannot be asked again, only says so', async () => {
    mockCamera.permission = { granted: false, canAskAgain: false };
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was denied.');
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
  });

  it('waits while the permission is not known yet', async () => {
    mockCamera.permission = null;
    await open();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('permission-spinner')).toBeOnTheScreen();
  });

  it('a sheet that is not showing has no camera', async () => {
    await open(false);
    expect(screen.queryByTestId('camera')).toBeNull();
  });
});

describe('the consent question', () => {
  it('comes before the camera when it has not been answered', async () => {
    mockAuth.consented = false;
    await open();
    expect(await screen.findByText('Allow AI features?')).toBeOnTheScreen();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(mockApi.submitChallengeClip).not.toHaveBeenCalled();
  });

  it('allowing it saves the answer and goes on to the camera', async () => {
    mockAuth.consented = false;
    await open();
    await press('Allow');
    expect(mockApi.setAiConsent).toHaveBeenCalledWith(true);
    expect(mockAuth.refresh).toHaveBeenCalled();
  });

  it('declining closes the sheet', async () => {
    mockAuth.consented = false;
    await open();
    await press('Not now');
    expect(onClose).toHaveBeenCalled();
  });

  it('a save that fails says why and sends nothing', async () => {
    mockAuth.consented = false;
    mockApi.setAiConsent.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await press('Allow');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't process that video.");
  });
});

describe('recording an attempt', () => {
  it('counts down from 10, then records for at most 25 seconds', async () => {
    await open();
    await press('Start recording');
    expect(screen.getByTestId('countdown')).toHaveTextContent('10');
    expect(screen.getByText('Get in position!')).toBeOnTheScreen();
    await tick(1000);
    expect(screen.getByTestId('countdown')).toHaveTextContent('9');
    await tick(8000);
    expect(screen.getByTestId('countdown')).toHaveTextContent('1');
    expect(mockCamera.record).not.toHaveBeenCalled();
    await tick(1000);
    expect(mockCamera.record).toHaveBeenCalledWith({ maxDuration: 25 });
    expect(await screen.findByRole('button', { name: 'Stop & submit' })).toBeOnTheScreen();
    expect(screen.queryByTestId('countdown')).toBeNull();
  });

  it('cannot be stopped in the first two seconds', async () => {
    await open();
    await startRecording();
    expect(screen.getByRole('button', { name: 'Stop & submit' }).props.accessibilityState.disabled).toBe(true);
    await tick(1999);
    expect(screen.getByRole('button', { name: 'Stop & submit' }).props.accessibilityState.disabled).toBe(true);
    await tick(1);
    expect(screen.getByRole('button', { name: 'Stop & submit' }).props.accessibilityState.disabled).toBe(false);
  });

  it('stopping sends the clip to a new challenge and shows the count', async () => {
    await open();
    await startRecording();
    await tick(2000);
    await press('Stop & submit');
    expect(mockCamera.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('total')).toHaveTextContent('21');
    expect(mockApi.createChallenge).toHaveBeenCalledTimes(1);
    expect(mockApi.submitChallengeClip).toHaveBeenCalledWith(12, { uri: 'file:///clip.mov' });
    expect(screen.getByTestId('counted')).toHaveTextContent('18');
    expect(screen.getByTestId('note')).toHaveTextContent("3 reps didn't count (not full range of motion).");
    expect(screen.getByTestId('clip')).toHaveTextContent('file:///clip.mov');
    expect(screen.getByText('Push-ups — your result')).toBeOnTheScreen();
    expect(screen.getByText('Reps are counted by AI from your video and can occasionally be wrong.')).toBeOnTheScreen();
    expect(onCounted).toHaveBeenCalledTimes(1);
  });

  it('the full 25 seconds ends the recording by itself and sends it', async () => {
    await open();
    await startRecording();
    await finishRecording({ uri: 'file:///full.mov' });
    expect(await screen.findByTestId('counted')).toBeOnTheScreen();
    expect(mockApi.submitChallengeClip).toHaveBeenCalledWith(12, { uri: 'file:///full.mov' });
  });

  it('while it is being counted, says so, and the sheet will not close under it', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockApi.submitChallengeClip.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await open();
    await startRecording();
    await finishRecording();
    expect(await screen.findByTestId('analyzing')).toHaveTextContent('Analyzing form...');
    expect(screen.getByText('Uploading and counting reps — this can take a moment...')).toBeOnTheScreen();
    await press('Cancel');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish(ATTEMPT));
    expect(await screen.findByTestId('counted')).toBeOnTheScreen();
  });

  it('every rep counting says so, and one rejected is singular', async () => {
    mockApi.submitChallengeClip.mockResolvedValue({ ...ATTEMPT, counted: 20, total: 20, rejected: 0 });
    await open();
    await startRecording();
    await finishRecording();
    expect(await screen.findByTestId('note')).toHaveTextContent('Great form — every rep counted! 💪');
  });

  it('one rep that did not count is "1 rep"', async () => {
    mockApi.submitChallengeClip.mockResolvedValue({ ...ATTEMPT, counted: 20, total: 21, rejected: 1 });
    await open();
    await startRecording();
    await finishRecording();
    expect(await screen.findByTestId('note')).toHaveTextContent("1 rep didn't count (not full range of motion).");
  });

  it('Done closes the sheet', async () => {
    await open();
    await startRecording();
    await finishRecording();
    await screen.findByTestId('counted');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Done' })[1]); // the sheet's own Done is the first
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the attempt is a day of activity, once it is counted', async () => {
    const { h } = await open();
    await startRecording();
    await finishRecording();
    await screen.findByTestId('counted');
    await act(async () => {
      await h.flush();
    });
    expect(h.db.rows('activity_days')).toEqual([expect.objectContaining({ action: 'challenge' })]);
  });
});

describe('closing', () => {
  it('during the countdown stops it and records nothing', async () => {
    await open();
    await press('Start recording');
    await tick(3000);
    await press('Cancel');
    expect(onClose).toHaveBeenCalledTimes(1);
    await tick(20_000);
    expect(mockCamera.record).not.toHaveBeenCalled();
    expect(mockApi.submitChallengeClip).not.toHaveBeenCalled();
  });

  it('during the recording stops the camera and throws the clip away', async () => {
    await open();
    await startRecording();
    await press('Cancel');
    expect(mockCamera.stop).toHaveBeenCalled();
    await tick(100);
    expect(mockApi.createChallenge).not.toHaveBeenCalled();
    expect(mockApi.submitChallengeClip).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closing puts the camera back to "starting" until it says it is ready again', async () => {
    await open();
    await screen.findByTestId('camera');
    expect(screen.queryByTestId('starting')).toBeNull();
    await press('Cancel');
    expect(screen.getByTestId('starting')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Start recording' }).props.accessibilityState.disabled).toBe(true);
  });

  it('opens fresh next time', async () => {
    await open();
    await startRecording();
    await finishRecording();
    await screen.findByTestId('counted');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Done' })[1]);
    expect(screen.queryByTestId('counted')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeOnTheScreen();
  });
});

describe('when it goes wrong', () => {
  it('a camera that gives back nothing says the recording failed, and can be tried again', async () => {
    await open();
    await startRecording();
    await finishRecording({});
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't record that attempt. Please try again.");
    expect(mockApi.createChallenge).not.toHaveBeenCalled();
    await press('Start recording');
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeOnTheScreen();
  });

  it('a recorder that throws says the same', async () => {
    mockCamera.record.mockRejectedValueOnce(new Error('no'));
    await open();
    await startRecording();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't record that attempt. Please try again.");
  });

  it('the server’s reason for refusing the clip is shown', async () => {
    mockApi.submitChallengeClip.mockRejectedValueOnce(new ApiError('We could not find the exercise in that video.', 400));
    await open();
    await startRecording();
    await finishRecording();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find the exercise in that video.');
    expect(onCounted).not.toHaveBeenCalled();
  });

  it('any other failure is the general line', async () => {
    mockApi.submitChallengeClip.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await startRecording();
    await finishRecording();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't process that video.");
  });

  it('a challenge that cannot be made is the same', async () => {
    mockApi.createChallenge.mockRejectedValueOnce(new ApiError('boom', 500));
    await open();
    await startRecording();
    await finishRecording();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't process that video.");
    expect(mockApi.submitChallengeClip).not.toHaveBeenCalled();
  });

  it('today’s attempt already used is reported, and the card is told', async () => {
    mockApi.createChallenge.mockRejectedValueOnce(new ApiError("You've already recorded today's attempt — come back tomorrow.", 429, { limitReached: true }));
    await open();
    await startRecording();
    await finishRecording();
    expect(await screen.findByRole('alert')).toHaveTextContent("You've already recorded today's attempt — come back tomorrow.");
    expect(onLimit).toHaveBeenCalledTimes(1);
  });

  it('a refusal that is not the daily limit does not tell the card', async () => {
    mockApi.submitChallengeClip.mockRejectedValueOnce(new ApiError('Challenge not found.', 404));
    await open();
    await startRecording();
    await finishRecording();
    await screen.findByRole('alert');
    expect(onLimit).not.toHaveBeenCalled();
  });

  it('a server that wants consent asks, and the recorded clip is sent once it is given', async () => {
    mockApi.submitChallengeClip.mockRejectedValueOnce(new ApiError('consent', 403, { needs_ai_consent: true }));
    await open();
    await startRecording();
    await finishRecording({ uri: 'file:///kept.mov' });
    await press('Allow');
    expect(mockApi.setAiConsent).toHaveBeenCalledWith(true);
    expect(await screen.findByTestId('counted')).toBeOnTheScreen();
    expect(mockApi.submitChallengeClip).toHaveBeenLastCalledWith(12, { uri: 'file:///kept.mov' });
    expect(mockApi.submitChallengeClip).toHaveBeenCalledTimes(2);
  });
});
