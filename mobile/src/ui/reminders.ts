/** The phone's side of reminders: permission, and the local notifications themselves (expo-notifications). */
import * as Notifications from 'expo-notifications';

import type { PlannedReminder, ReminderId } from '../logic/reminders';

/** The identifiers our notifications carry, so only ours are ever cancelled. */
const IDS: readonly ReminderId[] = ['inactivity', 'checkin'];

export type Permission = 'granted' | 'denied';

/** Whether the person has already allowed notifications (no question asked). */
export async function hasPermission(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Asks for permission to send notifications (iOS shows its own question the first time). */
export async function askPermission(): Promise<Permission> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain) return 'denied';
    return (await Notifications.requestPermissionsAsync()).granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function cancelReminders(): Promise<void> {
  await Promise.all(IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

/** Replaces our waiting notifications with these (each is for one moment; the same id is never scheduled twice). */
export async function scheduleReminders(reminders: readonly PlannedReminder[], content: Record<ReminderId, { title: string; body: string }>): Promise<void> {
  await cancelReminders();
  for (const reminder of reminders) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: content[reminder.id],
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at },
      });
    } catch {
      // a notification that cannot be scheduled (the system said no) is just not there; the cards in the app still say so
    }
  }
}
