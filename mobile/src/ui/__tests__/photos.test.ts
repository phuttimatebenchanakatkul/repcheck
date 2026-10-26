import * as ImagePicker from 'expo-image-picker';

import { choosePhoto, takePhoto } from '../photos';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
const picker = ImagePicker as unknown as Record<'requestCameraPermissionsAsync' | 'launchCameraAsync' | 'launchImageLibraryAsync', jest.Mock>;

const asset = { uri: 'file:///a.heic.jpg', fileName: 'IMG_1.jpg', mimeType: 'image/jpeg' };

beforeEach(() => {
  jest.clearAllMocks();
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
});

describe('takePhoto', () => {
  it('opens the camera for one JPEG at 70%, and returns the photo', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [asset] });
    expect(await takePhoto()).toEqual({ kind: 'photo', image: { uri: 'file:///a.heic.jpg', name: 'IMG_1.jpg', mimeType: 'image/jpeg' } });
    expect(picker.launchCameraAsync).toHaveBeenCalledWith({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
  });

  it('without camera permission it does not open the camera and says denied', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await takePhoto()).toEqual({ kind: 'denied' });
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('a cancelled camera is cancelled, with or without assets', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: [asset] });
    expect(await takePhoto()).toEqual({ kind: 'cancelled' });
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [] });
    expect(await takePhoto()).toEqual({ kind: 'cancelled' });
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: null });
    expect(await takePhoto()).toEqual({ kind: 'cancelled' });
  });

  it('names and types a photo that arrives without them', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x' }] });
    expect(await takePhoto()).toEqual({ kind: 'photo', image: { uri: 'file:///x', name: 'photo.jpg', mimeType: 'image/jpeg' } });
  });
});

describe('choosePhoto', () => {
  it('opens the library without asking for permission', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [asset] });
    expect((await choosePhoto()).kind).toBe('photo');
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
  });

  it('cancelling is cancelled', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    expect(await choosePhoto()).toEqual({ kind: 'cancelled' });
  });
});
