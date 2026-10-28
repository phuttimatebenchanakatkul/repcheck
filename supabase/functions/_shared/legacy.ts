/** Moving an imported account's password across, at its first sign-in on the new system (MOBILE_APP_PLAN.md, "Passwords").
 *
 * Supabase Auth cannot import the website's scrypt hashes, so an imported account has a random password nobody knows and
 * its real hash waits in `legacy_password_hashes`. The app tries Supabase first; when that says the credentials are wrong
 * it asks THIS, once. If the password matches the old hash, Supabase's password is set to it (the database trigger then
 * drops the old hash, so a leaked old password can never be put back) and the app signs in normally.
 *
 * This is an unauthenticated door onto a password check, so:
 *   - every answer that is not a success is the SAME 401, whether the address is unknown, has no old hash, or the password
 *     is wrong, and a hash is computed in all three cases so the time does not say which;
 *   - tries are counted per address and per caller BEFORE any hashing (scrypt is deliberately expensive), atomically, and a
 *     success gives the address's tries back;
 *   - the email is NOT confirmed here. The importer created these accounts unconfirmed because the old site never verified
 *     an address; the app asks for a confirmation email at the next step.
 */
import type { Db } from "./db.ts";
import { cleanEmail } from "./email.ts";
import { checkPasswordHash, dummyHash } from "./passwordHash.ts";
import { type AuthAdmin, WeakPassword } from "./supabaseAdmin.ts";
import { clear, take } from "./throttle.ts";

export const MAX_PASSWORD_CHARS = 1000;
export const EMAIL_ATTEMPTS = 10; // the website's LOGIN_ATTEMPT_LIMIT / WINDOW, per address ...
export const EMAIL_WINDOW = 15 * 60;
export const CALLER_ATTEMPTS = 30; // ... and per calling address, so one machine cannot walk many accounts
export const CALLER_WINDOW = 15 * 60;

export const emailKey = (email: string) => `legacy:${email}`;
export const callerKey = (address: string | null | undefined) => "legacyip:" + (address || "unknown").slice(0, 64);

export const Outcome = { MIGRATED: "migrated", MISMATCH: "mismatch", LIMITED: "limited", RESET_REQUIRED: "reset-required" } as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

/** [user id, scrypt hash] of an imported account that still has one, or null. */
async function oldHash(db: Db, email: string): Promise<[string, string] | null> {
  const row = await db.transaction((tx) =>
    tx.one<{ id: string; password_hash: string }>(
      `select u.id, h.password_hash from auth.users u join public.legacy_password_hashes h on h.user_id = u.id
       where lower(u.email) = $1`,
      [email],
    )
  );
  return row ? [String(row.id), row.password_hash] : null;
}

/** Returns [outcome, retry-after seconds]. Each step that spends a try commits it before the next, so the tries stay
 *  counted whatever happens afterwards. */
export async function migrate(
  db: Db,
  authAdmin: AuthAdmin,
  rawEmail: unknown,
  rawPassword: unknown,
  caller: string | null | undefined,
  now: number,
): Promise<[Outcome, number]> {
  // The caller's budget is spent first and by EVERY try, malformed ones included: a malformed try still costs a hash below.
  const [callerOk, callerWait] = await db.transaction((tx) => take(tx, callerKey(caller), CALLER_ATTEMPTS, CALLER_WINDOW, now));
  if (!callerOk) return [Outcome.LIMITED, callerWait];
  const email = cleanEmail(rawEmail);
  const password = typeof rawPassword === "string" && rawPassword.length > 0 && [...rawPassword].length <= MAX_PASSWORD_CHARS ? rawPassword : null;
  if (email === null || password === null) {
    checkPasswordHash(dummyHash(), "x"); // a malformed try costs the same as a real one
    return [Outcome.MISMATCH, 0];
  }

  const [emailOk, emailWait] = await db.transaction((tx) => take(tx, emailKey(email), EMAIL_ATTEMPTS, EMAIL_WINDOW, now));
  if (!emailOk) return [Outcome.LIMITED, emailWait];

  const found = await oldHash(db, email);
  const matched = checkPasswordHash(found ? found[1] : dummyHash(), password);
  if (!found || !matched) return [Outcome.MISMATCH, 0];

  try {
    await authAdmin.setPassword(found[0], password);
  } catch (e) {
    if (e instanceof WeakPassword) return [Outcome.RESET_REQUIRED, 0];
    throw e;
  }
  await db.transaction(async (tx) => {
    await tx.exec("delete from public.legacy_password_hashes where user_id = $1", [found[0]]); // the trigger does this too
    await clear(tx, emailKey(email));
  });
  return [Outcome.MIGRATED, 0];
}
