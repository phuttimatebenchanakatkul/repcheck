/**
 * Whether this phone should remind the person: a choice about THIS device (the permission is the device's), kept on the device, off until
 * they turn it on. A small store the settings switch and the scheduler both read.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

const KEY = 'repcheck_reminders';

let on = false;
const listeners = new Set<() => void>();

function set(value: boolean): void {
  if (on === value) return;
  on = value;
  listeners.forEach((listener) => listener());
}

/** Reads the saved choice once (start-up); unreadable storage is the same as "off". */
export async function restoreReminderPref(): Promise<boolean> {
  try {
    set((await AsyncStorage.getItem(KEY)) === 'on');
  } catch {
    // off
  }
  return on;
}

export async function chooseReminders(value: boolean): Promise<void> {
  set(value);
  try {
    await AsyncStorage.setItem(KEY, value ? 'on' : 'off');
  } catch {
    // the choice holds for this session even if it could not be saved
  }
}

export const remindersAreOn = (): boolean => on;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useRemindersOn(): boolean {
  return useSyncExternalStore(subscribe, () => on, () => on);
}

/** For tests: back to the start. */
export function resetReminderPref(): void {
  on = false;
}
