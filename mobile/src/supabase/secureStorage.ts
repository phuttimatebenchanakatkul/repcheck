/**
 * The auth session in the iOS Keychain (expo-secure-store), not in plain AsyncStorage: a session holds the refresh token.
 * SecureStore refuses values over ~2 KB and a Supabase session is several, so a value is split into chunks:
 *   <key>        -> "chunks:<n>"   (the manifest)
 *   <key>.0 ... <key>.<n-1>        (the pieces)
 * Reads are all-or-nothing: a missing or half-written set reads as "no session" (sign in again) rather than as a
 * corrupt string handed to the Supabase client.
 */
export const CHUNK_SIZE = 1800;
const MANIFEST = /^chunks:(\d+)$/;

export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

export function createChunkedStorage(store: KeyValueStore): AuthStorage {
  /** Deletes the manifest FIRST, then the pieces: a crash partway leaves "no session", never a manifest pointing at a mixed set. */
  async function removeChunks(key: string): Promise<void> {
    const manifest = await store.getItemAsync(key);
    const match = manifest ? MANIFEST.exec(manifest) : null;
    if (manifest !== null) await store.deleteItemAsync(key);
    if (match) {
      for (let i = 0; i < Number(match[1]); i++) await store.deleteItemAsync(chunkKey(key, i));
    }
  }

  return {
    async getItem(key) {
      const manifest = await store.getItemAsync(key);
      if (manifest === null) return null;
      const match = MANIFEST.exec(manifest);
      if (!match) return null; // not ours (or an older format): treat as signed out
      const parts: string[] = [];
      for (let i = 0; i < Number(match[1]); i++) {
        const part = await store.getItemAsync(chunkKey(key, i));
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      await removeChunks(key); // a shorter new value must not leave the old tail behind
      const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
      for (let i = 0; i < count; i++) {
        await store.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      }
      await store.setItemAsync(key, `chunks:${count}`); // the manifest last: a crash before it leaves "signed out", never half a session
    },

    async removeItem(key) {
      await removeChunks(key);
    },
  };
}
