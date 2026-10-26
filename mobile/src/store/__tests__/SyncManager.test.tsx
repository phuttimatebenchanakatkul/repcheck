import { QueryClient } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';

import type { FlushResult } from '../outbox';
import { SyncManager } from '../SyncManager';

const mockAuth = { state: { status: 'loading' } as { status: string; session?: { user: { id: string } } } };
const mockClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
const mockOutbox = {
  flush: jest.fn<Promise<FlushResult>, [string]>(),
  subscribe: jest.fn(() => () => undefined),
  discardAll: jest.fn(async () => undefined),
};

jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('../index', () => ({
  getOutbox: () => mockOutbox,
  get queryClient() {
    return mockClient; // read when used: this factory runs (hoisted) before the const above exists
  },
  clearCachedData: jest.fn(async () => undefined),
  watchNetwork: () => () => undefined,
}));


const ready = (id: string) => ({ status: 'ready', session: { user: { id } } });

beforeEach(() => {
  jest.useFakeTimers();
  mockOutbox.flush.mockReset();
  mockOutbox.discardAll.mockClear();
  mockAuth.state = ready('u1');
});

afterEach(() => {
  jest.useRealTimers();
  mockClient.clear();
});

describe('after a flush', () => {
  const invalidate = () => jest.spyOn(mockClient, 'invalidateQueries');

  it('what was sent makes the person’s cached data stale, so the screens read the server again', async () => {
    mockOutbox.flush.mockResolvedValue({ sent: 2, dropped: 0, retryInMs: null });
    const spy = invalidate();
    await render(<SyncManager />);
    await act(async () => {});
    expect(spy).toHaveBeenCalledWith({ queryKey: ['data', 'u1'] });
    spy.mockRestore();
  });

  it('so does an operation the database refused (the screen had shown it as done)', async () => {
    mockOutbox.flush.mockResolvedValue({ sent: 0, dropped: 1, retryInMs: null });
    const spy = invalidate();
    await render(<SyncManager />);
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a flush that did nothing leaves the cache alone', async () => {
    mockOutbox.flush.mockResolvedValue({ sent: 0, dropped: 0, retryInMs: null });
    const spy = invalidate();
    await render(<SyncManager />);
    await act(async () => {});
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a flush that sent some and then has to wait still refreshes what was sent, and retries later', async () => {
    mockOutbox.flush.mockResolvedValueOnce({ sent: 1, dropped: 0, retryInMs: 2000 }).mockResolvedValue({ sent: 0, dropped: 0, retryInMs: null });
    const spy = invalidate();
    await render(<SyncManager />);
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockOutbox.flush).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('invalidates only the signed-in person’s data', async () => {
    mockOutbox.flush.mockResolvedValue({ sent: 1, dropped: 0, retryInMs: null });
    mockAuth.state = ready('someone-else');
    const spy = invalidate();
    await render(<SyncManager />);
    await act(async () => {});
    expect(spy).toHaveBeenCalledWith({ queryKey: ['data', 'someone-else'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['data', 'u1'] });
    spy.mockRestore();
  });
});

describe('with nobody signed in', () => {
  it('sends nothing; signing out wipes the queue', async () => {
    mockAuth.state = { status: 'signed-out' };
    await render(<SyncManager />);
    await act(async () => {});
    expect(mockOutbox.flush).not.toHaveBeenCalled();
    expect(mockOutbox.discardAll).toHaveBeenCalledTimes(1);
  });
});
