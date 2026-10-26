import * as ImagePicker from 'expo-image-picker';

import type { PickedImage } from '../api/scan';

export type PhotoResult = { kind: 'photo'; image: PickedImage } | { kind: 'cancelled' } | { kind: 'denied' };

/** A JPEG at 70% is plenty for the AI to see a meal and keeps the upload far under the server's 12 MB limit. */
const OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: false };

function result(picked: ImagePicker.ImagePickerResult): PhotoResult {
  const asset = picked.canceled ? undefined : picked.assets?.[0];
  if (!asset?.uri) return { kind: 'cancelled' };
  return { kind: 'photo', image: { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', mimeType: asset.mimeType ?? 'image/jpeg' } };
}

/** Opens the camera for one photo. `denied` when camera access is off (the person must turn it on in Settings). */
export async function takePhoto(): Promise<PhotoResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { kind: 'denied' };
  return result(await ImagePicker.launchCameraAsync(OPTIONS));
}

/** Opens the photo library for one photo (the system picker needs no permission to read the one photo chosen). */
export async function choosePhoto(): Promise<PhotoResult> {
  return result(await ImagePicker.launchImageLibraryAsync(OPTIONS));
}
