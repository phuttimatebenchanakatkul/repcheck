import * as ImagePicker from 'expo-image-picker';

import { MAX_RECORD_SECONDS, chooseVideo, recordVideo } from '../videos';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  VideoExportPreset: { H264_1280x720: 6 },
}));
const picker = ImagePicker as unknown as Record<'requestCameraPermissionsAsync' | 'launchCameraAsync' | 'launchImageLibraryAsync', jest.Mock>;

const asset = { uri: 'file:///set.mov', fileName: 'IMG_9.MOV', mimeType: 'video/quicktime' };
const OPTIONS = { mediaTypes: ['videos'], allowsEditing: false, videoMaxDuration: MAX_RECORD_SECONDS, videoExportPreset: 6 };

beforeEach(() => {
  jest.clearAllMocks();
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
});

describe('recordVideo', () => {
  it('opens the camera for a video of at most the length the server grades, and returns it', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [asset] });
    expect(await recordVideo()).toEqual({ kind: 'video', video: { uri: 'file:///set.mov', name: 'IMG_9.MOV', mimeType: 'video/quicktime' } });
    expect(picker.launchCameraAsync).toHaveBeenCalledWith(OPTIONS);
    expect(MAX_RECORD_SECONDS).toBe(65);
  });

  it('without camera permission it does not open the camera and says denied', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await recordVideo()).toEqual({ kind: 'denied' });
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('a cancelled camera is cancelled, with or without assets', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: [asset] });
    expect(await recordVideo()).toEqual({ kind: 'cancelled' });
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [] });
    expect(await recordVideo()).toEqual({ kind: 'cancelled' });
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: null });
    expect(await recordVideo()).toEqual({ kind: 'cancelled' });
  });

  it('a clip that arrives without a name or type has neither', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x', fileName: null, mimeType: undefined }] });
    expect(await recordVideo()).toEqual({ kind: 'video', video: { uri: 'file:///x', name: undefined, mimeType: undefined } });
  });
});

describe('chooseVideo', () => {
  it('opens the library without asking for permission', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [asset] });
    expect((await chooseVideo()).kind).toBe('video');
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(OPTIONS);
  });

  it('cancelling is cancelled', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    expect(await chooseVideo()).toEqual({ kind: 'cancelled' });
  });
});
