import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { chooseReminders, remindersAreOn, resetReminderPref, restoreReminderPref, useRemindersOn } from '../remindersPref';

beforeEach(async () => {
  resetReminderPref();
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('the reminders choice', () => {
  it('is off until turned on', async () => {
    expect(remindersAreOn()).toBe(false);
    expect(await restoreReminderPref()).toBe(false);
  });

  it('turning on is kept for next time', async () => {
    await chooseReminders(true);
    expect(remindersAreOn()).toBe(true);
    expect(await AsyncStorage.getItem('repcheck_reminders')).toBe('on');
    resetReminderPref();
    expect(await restoreReminderPref()).toBe(true);
  });

  it('turning off is kept too', async () => {
    await chooseReminders(true);
    await chooseReminders(false);
    expect(await AsyncStorage.getItem('repcheck_reminders')).toBe('off');
    resetReminderPref();
    expect(await restoreReminderPref()).toBe(false);
  });

  it('anything else that was stored is off', async () => {
    await AsyncStorage.setItem('repcheck_reminders', 'yes please');
    expect(await restoreReminderPref()).toBe(false);
  });

  it('storage that cannot be read is off, and one that cannot be written still holds for the session', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('x'));
    expect(await restoreReminderPref()).toBe(false);
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('x'));
    await chooseReminders(true);
    expect(remindersAreOn()).toBe(true);
  });

  it('screens reading it are told when it changes', async () => {
    const hook = await renderHook(() => useRemindersOn());
    expect(hook.result.current).toBe(false);
    await act(async () => {
      await chooseReminders(true);
    });
    expect(hook.result.current).toBe(true);
    await act(async () => {
      await chooseReminders(false);
    });
    expect(hook.result.current).toBe(false);
  });

  it('saying the same thing again changes nothing', async () => {
    const seen: boolean[] = [];
    const hook = await renderHook(() => {
      const value = useRemindersOn();
      seen.push(value);
      return value;
    });
    await act(async () => {
      await chooseReminders(false);
    });
    expect(hook.result.current).toBe(false);
    expect(seen).toEqual([false]);
  });
});
