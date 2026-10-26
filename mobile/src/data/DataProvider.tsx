import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { getApi } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { getOutbox, queryClient } from '@/store';
import type { QueuedOperation } from '@/store/outbox';
import { getSupabase } from '@/supabase/client';

import { createData, type Reader } from './access';
import { DataContext } from './hooks';

/**
 * Gives the screens the signed-in person's data layer, and keeps the list of their still-waiting writes current. Renders its children
 * always; the context is empty until someone is signed in with a ready profile, and the data hooks are only used by screens that
 * exist only then.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const userId = state.status === 'ready' ? state.session.user.id : null;
  const [queue, setQueue] = useState<readonly QueuedOperation[]>([]);

  const data = useMemo(
    () => (userId ? createData({ userId, reader: getSupabase() as unknown as Reader, outbox: getOutbox(), queryClient, api: getApi() }) : null),
    [userId],
  );

  useEffect(() => {
    if (!userId) return; // the context is empty without a person; the next one's effect replaces whatever queue is held here
    const outbox = getOutbox();
    let alive = true;
    const refresh = () => {
      if (alive) setQueue(outbox.pending(userId));
    };
    void outbox.load().then(refresh);
    const unsubscribe = outbox.subscribe(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [userId]);

  const value = useMemo(() => (data ? { data, queue } : null), [data, queue]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
