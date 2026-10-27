import * as Notifications from 'expo-notifications';

import { askPermission, cancelReminders, hasPermission, scheduleReminders } from '../reminders';

const mock = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
  cancelScheduledNotificationAsync: jest.Mock;
};

const CONTENT = { inactivity: { title: 'RepCheck', body: 'away' }, checkin: { title: 'Weekly check-in', body: 'due' } };

beforeEach(() => {
  jest.clearAllMocks();
  mock.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mock.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mock.scheduleNotificationAsync.mockResolvedValue('id');
  mock.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
});

describe('permission', () => {
  it('hasPermission reads it without asking', async () => {
    expect(await hasPermission()).toBe(true);
    mock.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await hasPermission()).toBe(false);
    expect(mock.requestPermissionsAsync).not.toHaveBeenCalled();
    mock.getPermissionsAsync.mockRejectedValue(new Error('x'));
    expect(await hasPermission()).toBe(false);
  });

  it('already allowed: granted, with no question', async () => {
    expect(await askPermission()).toBe('granted');
    expect(mock.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('not yet decided: asks, and is told the answer', async () => {
    mock.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await askPermission()).toBe('granted');
    expect(mock.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    mock.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await askPermission()).toBe('denied');
  });

  it('refused for good: denied, and not asked again (iOS would not show it)', async () => {
    mock.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await askPermission()).toBe('denied');
    expect(mock.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('a system that cannot say is denied', async () => {
    mock.getPermissionsAsync.mockRejectedValue(new Error('x'));
    expect(await askPermission()).toBe('denied');
  });
});

describe('the waiting notifications', () => {
  it('cancelling clears only ours, and an id that is not there is fine', async () => {
    mock.cancelScheduledNotificationAsync.mockRejectedValueOnce(new Error('none'));
    await cancelReminders();
    expect(mock.cancelScheduledNotificationAsync.mock.calls.map((c) => c[0]).sort()).toEqual(['checkin', 'inactivity']);
  });

  it('scheduling replaces ours: cancels first, then one notification each at its moment', async () => {
    const at = new Date(2026, 9, 30, 18);
    const when = new Date(2026, 10, 1, 9);
    await scheduleReminders([{ id: 'inactivity', at }, { id: 'checkin', at: when }], CONTENT);
    expect(mock.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mock.scheduleNotificationAsync).toHaveBeenNthCalledWith(1, { identifier: 'inactivity', content: CONTENT.inactivity, trigger: { type: 'date', date: at } });
    expect(mock.scheduleNotificationAsync).toHaveBeenNthCalledWith(2, { identifier: 'checkin', content: CONTENT.checkin, trigger: { type: 'date', date: when } });
    expect(mock.cancelScheduledNotificationAsync.mock.invocationCallOrder[0]).toBeLessThan(mock.scheduleNotificationAsync.mock.invocationCallOrder[0]);
  });

  it('nothing planned clears them', async () => {
    await scheduleReminders([], CONTENT);
    expect(mock.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mock.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('one the system refuses does not stop the next', async () => {
    mock.scheduleNotificationAsync.mockRejectedValueOnce(new Error('no'));
    await scheduleReminders([{ id: 'inactivity', at: new Date(2026, 9, 30, 18) }, { id: 'checkin', at: new Date(2026, 10, 1, 9) }], CONTENT);
    expect(mock.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});
