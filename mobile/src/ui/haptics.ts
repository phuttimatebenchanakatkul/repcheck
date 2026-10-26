import * as Haptics from 'expo-haptics';

/** A light tick for a small choice (a favourite, a tab). Never throws: a device without a haptic engine just does nothing. */
export function tap(): void {
  try {
    void Haptics.selectionAsync().catch(() => undefined);
  } catch {
    // no haptics here
  }
}

/** The "it worked" tap, for logging a food or completing a set. */
export function success(): void {
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  } catch {
    // no haptics here
  }
}
