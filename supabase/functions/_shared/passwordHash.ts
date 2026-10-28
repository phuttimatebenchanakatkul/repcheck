/** Checking a password against a hash the website wrote with Werkzeug's `generate_password_hash`.
 *
 * Supabase Auth cannot import those hashes, so an imported account's real hash waits in `legacy_password_hashes` and is
 * checked here once, at its first sign-in on the new system (see legacy.ts). Two methods exist in the wild:
 *
 *   scrypt:<n>:<r>:<p>$<salt>$<hex>      Werkzeug 2.3 and later (the default since)
 *   pbkdf2:<digest>:<iterations>$<salt>$<hex>   Werkzeug before that
 *
 * The salt is the text between the dollar signs, used as its UTF-8 bytes (it is not decoded from anything).
 */
import { pbkdf2Sync, scryptSync, timingSafeEqual } from "node:crypto";

const enc = new TextEncoder();
const MAX_SCRYPT_BYTES = 1 << 30; // refuse a stored hash that asks for more than 1 GiB of memory: it is not ours
const PBKDF2_DIGESTS = new Set(["sha1", "sha224", "sha256", "sha384", "sha512"]);
const POSITIVE_INT = /^[1-9]\d{0,9}$/;

/** The hex hash of `password` under the method and salt of a stored hash, or null for a method this does not know. */
function derive(method: string, salt: string, password: string): string | null {
  const [name, ...args] = method.split(":");
  if (name === "scrypt") {
    if (args.length !== 3 || !args.every((a) => POSITIVE_INT.test(a))) return null;
    const [n, r, p] = args.map(Number);
    if (128 * n * r > MAX_SCRYPT_BYTES) return null;
    return scryptSync(enc.encode(password), enc.encode(salt), 64, { N: n, r, p, maxmem: 132 * n * r * p }).toString("hex");
  }
  if (name === "pbkdf2") {
    if (args.length !== 2 || !PBKDF2_DIGESTS.has(args[0]) || !POSITIVE_INT.test(args[1])) return null;
    const digest = args[0];
    const length = { sha1: 20, sha224: 28, sha256: 32, sha384: 48, sha512: 64 }[digest]!;
    return pbkdf2Sync(enc.encode(password), enc.encode(salt), Number(args[1]), length, digest).toString("hex");
  }
  return null;
}

/** Werkzeug's `check_password_hash`: true only if `password` hashes to the stored value. A hash this cannot read is
 *  simply not a match (Werkzeug raises; here nothing about a stored value may turn a sign-in into a crash). */
export function checkPasswordHash(stored: string, password: string): boolean {
  const first = stored.indexOf("$");
  const second = first < 0 ? -1 : stored.indexOf("$", first + 1);
  if (second < 0) return false;
  const derived = derive(stored.slice(0, first), stored.slice(first + 1, second), password);
  if (derived === null) return false;
  const a = enc.encode(derived);
  const b = enc.encode(stored.slice(second + 1));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A real scrypt hash to check against when there is nothing to check, so a miss costs what a hit does. */
let dummy: string | null = null;
export function dummyHash(): string {
  if (dummy === null) {
    const salt = "legacy-login-dummy";
    dummy = `scrypt:32768:8:1$${salt}$${derive("scrypt:32768:8:1", salt, "a password nobody has")}`;
  }
  return dummy;
}
