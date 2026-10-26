import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';

import { keys } from '@/data/keys';

import { clearCachedData, getOutbox, queryClient, watchNetwork } from './index';

/**
 * Keeps the device and the server in step, rendering nothing:
 *  - tells React Query when the OS says there is (no) signal;
 *  - while someone is signed in, sends their queued writes: on start, whenever one is queued, when signal returns, when the
 *    app comes to the foreground, and on the outbox's own backoff after a failure that waiting may fix;
 *  - on sign-out, wipes the queue and the cached data, so the next person on this device sees none of it.
 */
export function SyncManager() {
  const { state } = useAuth();
  const userId = state.status === 'ready' ? state.session.user.id : null;
  const signedOut = state.status === 'signed-out';

  useEffect(() => watchNetwork(), []);

  useEffect(() => {
    if (!signedOut) return;
    void getOutbox().discardAll();
    void clearCachedData();
  }, [signedOut]);

  useEffect(() => {
    if (!userId) return;
    const outbox = getOutbox();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      clearTimeout(timer);
      timer = undefined;
      if (!onlineManager.isOnline()) return; // the online listener below will call back
      const result = await outbox.flush(userId);
      // What was sent is now the server's, and what the database refused is not (the screen showed it as done): either way what the
      // screens hold may differ from the server, so read again.
      if (result.sent > 0 || result.dropped > 0) void queryClient.invalidateQueries({ queryKey: keys.all(userId) });
      if (!stopped && result.retryInMs !== null) {
        clearTimeout(timer); // two callers can join one flush and both get this result: keep one retry, not two
        timer = setTimeout(() => void run(), result.retryInMs);
      }
    };

    void run();
    const unsubscribeOutbox = outbox.subscribe(() => {
      if (!timer) void run(); // something was queued; when a retry is already scheduled let it keep its schedule
    });
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) void run();
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribeOutbox();
      unsubscribeOnline();
      appState.remove();
    };
  }, [userId]);

  return null;
}
