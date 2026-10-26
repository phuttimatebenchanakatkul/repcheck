import { CHUNK_SIZE, createChunkedStorage, type KeyValueStore } from '../secureStorage';

/** An in-memory SecureStore that, like the real one, refuses values over 2048 bytes. */
function fakeStore(): KeyValueStore & { data: Map<string, string>; failOn?: (key: string) => boolean } {
  const data = new Map<string, string>();
  const store = {
    data,
    failOn: undefined as ((key: string) => boolean) | undefined,
    async getItemAsync(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    async setItemAsync(key: string, value: string) {
      if (value.length > 2048) throw new Error('Value being stored in SecureStore is larger than 2048 bytes');
      if (store.failOn?.(key)) throw new Error('keychain locked');
      data.set(key, value);
    },
    async deleteItemAsync(key: string) {
      data.delete(key);
    },
  };
  return store;
}

const KEY = 'sb-session';
const session = (n: number) => JSON.stringify({ access_token: 'a'.repeat(n), refresh_token: 'r'.repeat(40) });

describe('chunked secure storage', () => {
  it('round-trips a session far larger than the Keychain limit', async () => {
    const storage = createChunkedStorage(fakeStore());
    const value = session(9000);
    await storage.setItem(KEY, value);
    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('round-trips values at the chunk boundaries and the empty string', async () => {
    const storage = createChunkedStorage(fakeStore());
    for (const length of [0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, CHUNK_SIZE * 3]) {
      const value = 'x'.repeat(length);
      await storage.setItem(KEY, value);
      expect(await storage.getItem(KEY)).toBe(value);
    }
  });

  it('never writes a piece the Keychain would refuse', async () => {
    const store = fakeStore();
    await createChunkedStorage(store).setItem(KEY, session(20000)); // the fake throws over 2048
    expect([...store.data.values()].every((v) => v.length <= 2048)).toBe(true);
  });

  it('is signed out when nothing was stored', async () => {
    expect(await createChunkedStorage(fakeStore()).getItem(KEY)).toBeNull();
  });

  it('a shorter value replaces a longer one without leaving the old tail behind', async () => {
    const store = fakeStore();
    const storage = createChunkedStorage(store);
    await storage.setItem(KEY, session(9000));
    const before = store.data.size;
    await storage.setItem(KEY, session(100));
    expect(await storage.getItem(KEY)).toBe(session(100));
    expect(store.data.size).toBeLessThan(before);
    expect(store.data.size).toBe(2); // one piece plus the manifest
  });

  it('removing deletes the manifest and every piece', async () => {
    const store = fakeStore();
    const storage = createChunkedStorage(store);
    await storage.setItem(KEY, session(9000));
    await storage.removeItem(KEY);
    expect(store.data.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('removing something that is not there is harmless', async () => {
    await expect(createChunkedStorage(fakeStore()).removeItem(KEY)).resolves.toBeUndefined();
  });

  it('a missing piece reads as signed out, never as a corrupt session', async () => {
    const store = fakeStore();
    const storage = createChunkedStorage(store);
    await storage.setItem(KEY, session(9000));
    store.data.delete(`${KEY}.2`);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('a value that is not our manifest reads as signed out', async () => {
    const store = fakeStore();
    store.data.set(KEY, '{"access_token":"legacy"}');
    expect(await createChunkedStorage(store).getItem(KEY)).toBeNull();
  });

  it('writes the manifest last: a failure partway leaves signed out, not half a session', async () => {
    const store = fakeStore();
    const storage = createChunkedStorage(store);
    await storage.setItem(KEY, session(100));
    store.failOn = (key) => key === `${KEY}.2`;
    await expect(storage.setItem(KEY, session(9000))).rejects.toThrow('keychain locked');
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('keeps different keys apart', async () => {
    const storage = createChunkedStorage(fakeStore());
    await storage.setItem('a', 'x'.repeat(5000));
    await storage.setItem('b', 'y'.repeat(5000));
    await storage.removeItem('a');
    expect(await storage.getItem('b')).toBe('y'.repeat(5000));
    expect(await storage.getItem('a')).toBeNull();
  });
});
