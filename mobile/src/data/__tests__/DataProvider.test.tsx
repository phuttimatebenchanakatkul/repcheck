import { act, render } from '@testing-library/react-native';
import { useContext } from 'react';
import { Text } from 'react-native';

import type { Operation, QueuedOperation } from '../../store/outbox';
import { DataProvider } from '../DataProvider';
import { DataContext } from '../hooks';

const mockAuth = { state: { status: 'loading' } as { status: string; session?: { user: { id: string } } } };
const mockOutbox = {
  queue: [] as QueuedOperation[],
  listener: null as (() => void) | null,
  unsubscribed: 0,
  load: jest.fn(async () => undefined),
  pending(userId: string) {
    return this.queue.filter((q) => q.userId === userId);
  },
  subscribe(listener: () => void) {
    this.listener = listener;
    return () => {
      this.unsubscribed++;
      this.listener = null;
    };
  },
};
const mockCreateData = jest.fn((deps: { userId: string }) => ({ userId: deps.userId, fetch: {}, actions: {} }));

jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/store', () => ({ getOutbox: () => mockOutbox, queryClient: {} }));
jest.mock('@/api', () => ({ getApi: () => ({}) }));
jest.mock('@/supabase/client', () => ({ getSupabase: () => ({}) }));
jest.mock('../access', () => ({ ...jest.requireActual('../access'), createData: (deps: { userId: string }) => mockCreateData(deps) }));


function Probe() {
  const value = useContext(DataContext);
  return <Text testID="probe">{value ? `${value.data.userId}:${value.queue.length}` : 'none'}</Text>;
}

const op = (userId: string, id: string): QueuedOperation => ({
  id,
  userId,
  queuedAt: 1,
  attempts: 0,
  op: { kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date', row: { user_id: userId, log_date: id } } as Operation,
});

const ready = (id: string) => ({ status: 'ready', session: { user: { id } } });

beforeEach(() => {
  mockOutbox.queue = [];
  mockOutbox.listener = null;
  mockOutbox.unsubscribed = 0;
  mockOutbox.load.mockClear();
  mockCreateData.mockClear();
});

it('gives no context until someone is signed in with a ready profile', async () => {
  for (const status of ['loading', 'signed-out', 'setting-up', 'needs-name', 'error', 'recovering']) {
    mockAuth.state = { status, session: { user: { id: 'u1' } } };
    const view = await render(<DataProvider><Probe /></DataProvider>);
    expect(view.getByTestId('probe').props.children).toBe('none');
    await view.unmount();
  }
  expect(mockCreateData).not.toHaveBeenCalled();
});

it('builds the data layer for the signed-in person and shows their waiting writes, kept current', async () => {
  mockAuth.state = ready('u1');
  mockOutbox.queue = [op('u1', 'a'), op('someone-else', 'z')];
  const view = await render(<DataProvider><Probe /></DataProvider>);
  await act(async () => {});
  expect(view.getByTestId('probe').props.children).toBe('u1:1');
  expect(mockCreateData).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));

  mockOutbox.queue = [...mockOutbox.queue, op('u1', 'b')];
  await act(async () => {
    mockOutbox.listener?.();
  });
  expect(view.getByTestId('probe').props.children).toBe('u1:2');
});

it('does not rebuild the data layer when the queue changes', async () => {
  mockAuth.state = ready('u1');
  const view = await render(<DataProvider><Probe /></DataProvider>);
  await act(async () => {});
  mockOutbox.queue = [op('u1', 'a')];
  await act(async () => {
    mockOutbox.listener?.();
  });
  expect(view.getByTestId('probe').props.children).toBe('u1:1');
  expect(mockCreateData).toHaveBeenCalledTimes(1);
});

it('stops listening when it unmounts', async () => {
  mockAuth.state = ready('u1');
  const view = await render(<DataProvider><Probe /></DataProvider>);
  await act(async () => {});
  await view.unmount();
  expect(mockOutbox.unsubscribed).toBe(1);
});
