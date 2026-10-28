/** Profiles and the life of an account: create, rename, schedule deletion, restore, purge.
 *
 * A profile row is created ONLY here (the app has no INSERT right on `profiles`), and every table a user owns points at
 * it, so a person who signs up straight against Supabase Auth, skipping this API, has an account with nowhere to put
 * data. That is what keeps the display-name filter (App Review 1.2) unbypassable without routing sign-up through here.
 *
 * Deleting an account (App Review 5.1.1(v)): scheduled now, purged after GRACE_DAYS. The purge removes the person's
 * stored files through the Storage API FIRST and only then deletes the Auth user, which cascades through every table.
 * Neither Auth deletion nor SQL removes Storage objects, so that order is the whole guarantee; if a file will not go,
 * the user is left in place and the next sweep tries again.
 */
import type { Identity } from "./auth.ts";
import type { Db, Tx } from "./db.ts";
import { pyStrip, validateDisplayName } from "./nameFilter.ts";
import { type AuthAdmin, type Storage, SupabaseError } from "./supabaseAdmin.ts";

export const GRACE_DAYS = 30; // must equal database.ACCOUNT_DELETION_GRACE_DAYS (a test pins it)
export const BUCKETS = ["progress-photos", "analyze-videos"] as const;
export const MAX_NAME_LENGTH = 60; // the website had no limit; a name is shown to every other user
const FRIEND_CODE_ATTEMPTS = 8;
const BIDI_CONTROLS = new Set([0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]);
export const PROFILE_COLUMNS = "id, name, friend_code, onboarding_completed, ai_consent_at, deleted_at, created_at";

/** The message is safe to show the user. */
export class NameRejected extends Error {}
export class PurgeIncomplete extends Error {}

export interface Profile {
  id: string;
  name: string;
  friend_code: string;
  onboarding_completed: boolean;
  ai_consent_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

/** A display name fit to store and show to everyone, or NameRejected. */
export function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? pyStrip(raw) : "";
  const error = validateDisplayName(name);
  if (error) throw new NameRejected(error);
  const points = [...name];
  if (points.length > MAX_NAME_LENGTH) throw new NameRejected(`Please keep your name to ${MAX_NAME_LENGTH} characters or fewer.`);
  // Control characters break rows and lists (and Postgres cannot store NUL at all); the bidi overrides let a name pose as
  // a different one. Emoji joiners and ordinary punctuation are fine.
  if (points.some((c) => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127 || BIDI_CONTROLS.has(c.codePointAt(0)!))) {
    throw new NameRejected("That name contains characters that aren't allowed.");
  }
  return name;
}

/** The name an OAuth provider sent, or a neutral fallback if it is missing or not allowed. Lenient on purpose: a Google
 *  account with a blocked word in its name still gets in, as 'Google User', where a typed name is refused. */
export function providerName(claims: Record<string, unknown>): string {
  const appMeta = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const provider = typeof appMeta.provider === "string" ? appMeta.provider : null;
  const candidate = meta.full_name || meta.name;
  const label = provider || "App";
  const fallback = `${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()} User`;
  try {
    return typeof candidate === "string" ? cleanName(candidate) : fallback;
  } catch (e) {
    if (e instanceof NameRejected) return fallback;
    throw e;
  }
}

export function getProfile(tx: Tx, uid: string): Promise<Profile | null> {
  return tx.one<Profile>(`select ${PROFILE_COLUMNS} from public.profiles where id = $1`, [uid]);
}

const friendCode = () => "RC-" + [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

/** Postgres's unique_violation (23505), however the driver wraps it. */
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505";

/** The caller's profile, created on first use. Returns [profile, created]. A typed name is held to the filter and
 *  refused if it fails; with none, an OAuth provider's name is used, and an email account must supply one. An existing
 *  profile is returned untouched (a second call can never rename or reset anyone). */
export async function ensureProfile(tx: Tx, identity: Identity, requestedName: unknown = null): Promise<[Profile, boolean]> {
  const existing = await getProfile(tx, identity.id);
  if (existing) return [existing, false];
  let name: string;
  if (requestedName !== null && requestedName !== undefined) {
    name = cleanName(requestedName);
  } else {
    const provider = ((identity.claims.app_metadata ?? {}) as Record<string, unknown>).provider;
    if (provider === undefined || provider === null || provider === "email" || provider === "phone") throw new NameRejected("Please enter your name.");
    name = providerName(identity.claims as Record<string, unknown>);
  }
  for (let i = 0; i < FRIEND_CODE_ATTEMPTS; i++) {
    try {
      const row = await tx.savepoint((sp) =>
        sp.one<Profile>(
          `insert into public.profiles (id, name, friend_code) values ($1, $2, $3)
           on conflict (id) do nothing returning ${PROFILE_COLUMNS}`,
          [identity.id, name, friendCode()],
        )
      );
      if (row) return [row, true];
      return [(await getProfile(tx, identity.id))!, false]; // a concurrent call created it first
    } catch (e) {
      if (isUniqueViolation(e)) continue; // the friend code collided (one in 16 million): draw another
      throw e;
    }
  }
  throw new Error("could not allocate a friend code");
}

export async function rename(tx: Tx, uid: string, rawName: unknown): Promise<boolean> {
  const name = cleanName(rawName);
  return (await tx.one("update public.profiles set name = $1 where id = $2 returning id", [name, uid])) !== null;
}

/** The UTC calendar day a deletion scheduled at `deletedAt` becomes a purge; null if not scheduled. */
export function dueAt(deletedAt: Date | null | undefined): string | null {
  if (!deletedAt) return null;
  return new Date(deletedAt.getTime() + GRACE_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Start the grace period and return when it started. Idempotent: asking again does not push the purge back, so nobody
 *  keeps an account alive by re-clicking. */
export async function scheduleDeletion(tx: Tx, uid: string): Promise<Date | null> {
  await tx.exec("update public.profiles set deleted_at = now() where id = $1 and deleted_at is null", [uid]);
  const row = await tx.one<{ deleted_at: Date | null }>("select deleted_at from public.profiles where id = $1", [uid]);
  return row ? row.deleted_at : null;
}

/** Undo a scheduled deletion (no-op if none was). Impossible once the purge has run: the profile is gone. */
export async function cancelDeletion(tx: Tx, uid: string): Promise<void> {
  await tx.exec("update public.profiles set deleted_at = null where id = $1", [uid]);
}

/** [bucket, key] for every object under this user's folder in either bucket (the database's own list, so a file no row points at is found too). */
export async function storedObjects(tx: Tx, uid: string): Promise<[string, string][]> {
  const rows = await tx.all<{ bucket_id: string; name: string }>(
    "select bucket_id, name from storage.objects where bucket_id = any($1::text[]) and split_part(name, '/', 1) = $2",
    [[...BUCKETS], uid],
  );
  return rows.map((r) => [r.bucket_id, r.name]);
}

/** Remove every stored file of `uid` through the Storage API and prove none is left. Throws PurgeIncomplete. */
export async function deleteStoredFiles(db: Db, store: Storage, uid: string): Promise<number> {
  const objects = await db.transaction((tx) => storedObjects(tx, uid));
  const failed: string[] = [];
  for (const bucket of BUCKETS) {
    failed.push(...await store.remove(bucket, objects.filter(([b]) => b === bucket).map(([, k]) => k)));
  }
  const left = await db.transaction((tx) => storedObjects(tx, uid));
  if (failed.length || left.length) throw new PurgeIncomplete(`${left.length} stored files remain`);
  return objects.length;
}

/** Irreversibly remove one person: their files first, then the Auth user (which cascades through every table). */
export async function purgeUser(db: Db, store: Storage, authAdmin: AuthAdmin, uid: string): Promise<void> {
  await deleteStoredFiles(db, store, uid);
  await authAdmin.deleteUser(uid);
}

/** Purge every account whose grace period has run out. Returns [purged, failed] as lists of ids. Idempotent, so two
 *  sweeps at once only repeat each other. One person's failure never stops the rest. `only` restricts the sweep to those
 *  ids (tests use it so they can never touch a real account that happens to be due). */
export async function purgeDue(
  db: Db,
  store: Storage,
  authAdmin: AuthAdmin,
  options: { graceDays?: number; only?: readonly string[] | null } = {},
): Promise<[string[], string[]]> {
  const only = options.only ?? null;
  const due = await db.transaction((tx) =>
    tx.all<{ id: string }>(
      `select id from public.profiles where deleted_at is not null
       and deleted_at <= now() - make_interval(days => $1::int) and ($2::uuid[] is null or id = any($2::uuid[]))`,
      [Math.trunc(options.graceDays ?? GRACE_DAYS), only === null ? null : [...only]],
    )
  );
  const purged: string[] = [];
  const failed: string[] = [];
  for (const { id } of due) {
    try {
      await purgeUser(db, store, authAdmin, String(id));
      purged.push(String(id));
    } catch (e) {
      if (!(e instanceof PurgeIncomplete || e instanceof SupabaseError)) throw e;
      console.error("could not purge account", id, "; it will be retried");
      failed.push(String(id));
    }
  }
  return [purged, failed];
}
