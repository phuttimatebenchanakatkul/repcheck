import * as Crypto from 'expo-crypto';

let counter = 0;

/**
 * A fresh client-made id for a log entry. Entries are keyed by (user, id) and written with upsert, so the id is what makes a retried
 * write idempotent: it is made once, on the device, before anything is sent. Always a non-empty string, even if the platform's
 * generator is missing or answers with nothing: an entry without an id could never be told apart from the next one.
 */
export function newId(): string {
  try {
    const id = Crypto.randomUUID();
    if (typeof id === 'string' && id.length > 0) return id;
  } catch {
    // fall through to the fallback
  }
  return `${Date.now()}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2)}`; // the website's own fallback shape, plus a counter
}
