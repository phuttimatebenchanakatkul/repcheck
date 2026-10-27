import * as ImagePicker from 'expo-image-picker';

import type { PickedVideo } from '../api/analyze';

export type VideoResult = { kind: 'video'; video: PickedVideo } | { kind: 'cancelled' } | { kind: 'denied' };

/**
 * The server skips the first 5 seconds of a clip (time to get in position) and grades the next 60 (trim_video.py), so there is nothing
 * to gain by filming longer, and the upload is the slow part: a 65 s limit and a 720p H.264 export keep it in the tens of megabytes
 * (the server refuses more than 300 MB) while leaving a body in frame large enough to read.
 */
export const MAX_RECORD_SECONDS = 65;
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['videos'],
  allowsEditing: false,
  videoMaxDuration: MAX_RECORD_SECONDS,
  videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
};

function result(picked: ImagePicker.ImagePickerResult): VideoResult {
  const asset = picked.canceled ? undefined : picked.assets?.[0];
  if (!asset?.uri) return { kind: 'cancelled' };
  return { kind: 'video', video: { uri: asset.uri, name: asset.fileName ?? undefined, mimeType: asset.mimeType ?? undefined } };
}

/** Opens the camera to film a set. `denied` when camera access is off (the person must turn it on in Settings). */
export async function recordVideo(): Promise<VideoResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { kind: 'denied' };
  return result(await ImagePicker.launchCameraAsync(OPTIONS));
}

/** Opens the library to choose a clip (the system picker needs no permission to read the one file chosen). */
export async function chooseVideo(): Promise<VideoResult> {
  return result(await ImagePicker.launchImageLibraryAsync(OPTIONS));
}
