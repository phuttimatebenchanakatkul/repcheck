/** Friends, blocks, reports, challenges, leaderboards, HYROX results and activity dates: everything that reads or writes
 * across people. The app never touches these tables directly (they are server-only under row-level security), so every
 * rule that protects one person from another lives here.
 *
 * The rules are the website's, with these differences, all deliberate (the same as in the Flask version this ports):
 *   - a person is identified by a UUID, not an integer, so an id cannot be walked one by one;
 *   - a challenge can be submitted to only if it is the caller's own or a friend's (and not a blocked person's);
 *   - a friend-code guess is counted under a per-person lock, so a burst of simultaneous guesses cannot exceed the
 *     budget, and the 500-row and 200-row ceilings are enforced under a lock too (the website could be raced past them);
 *   - a HYROX time must also be finite and under a day (the website accepted NaN, which sorts and compares as nothing);
 *   - a code that is not text is a clean 400, not a crash.
 */
import type { Tx } from "./db.ts";
import { friendlyWait } from "./limits.ts";
import { pyStrip } from "./nameFilter.ts";
import { lock, overLimitMessage } from "./rows.ts";

export const FRIEND_CODE_GUESS_LIMIT = 30; // wrong codes one person may try ...
export const FRIEND_CODE_GUESS_WINDOW = 60 * 60; // ... per hour
export const MAX_FRIEND_CODE_CHARS = 32; // a real code is 9; anything longer cannot be one
export const CHALLENGE_LIMIT = 200;
export const HYROX_RESULT_LIMIT = 500;
export const CHALLENGE_SECONDS = 25;
export const REPORT_REASONS = ["offensive_name", "impersonation", "spam", "other"];
export const AI_REPORT_FEATURES = ["coach", "workout_chat", "analyze_chat"];
export const AI_REPORT_REASONS = ["harmful", "inaccurate", "offensive", "other"];
export const MAX_AI_REPORT_TEXT = 4000;
export const MAX_OPEN_AI_REPORTS_PER_USER = 20;

export const HYROX_GENDERS = ["men", "women"];
export const HYROX_CATEGORIES = ["open", "pro"];
export const HYROX_FORMATS = ["singles", "doubles"];
/** Per gender and format (a doubles race really is faster), as the website's HYROX_MIN_PLAUSIBLE_SECONDS; a test pins them to it. */
export const HYROX_MIN_PLAUSIBLE_SECONDS: Record<string, number> = {
  "men|singles": 50 * 60,
  "women|singles": 53 * 60,
  "men|doubles": 47 * 60,
  "women|doubles": 51 * 60,
};
export const HYROX_MAX_SECONDS = 24 * 60 * 60;
export const HYROX_LEADERBOARD_ROWS = 50;

/** Challenges rotate through these, one a day for everybody. */
export const CHALLENGE_ROTATION_EPOCH = "2026-01-01";
export const CHALLENGE_EXERCISES: Record<string, string> = { pushups: "Push-ups", situps: "Sit-ups", pullups: "Pull-ups" };
export const CHALLENGE_ORDER = Object.keys(CHALLENGE_EXERCISES);

/** [action, table, column, whether the column is a UTC instant needing the offset] */
const ACTIVITY_SOURCES: [string, string, string, boolean][] = [
  ["challenge", "challenge_submissions", "created_at", true],
  ["analysis", "analyze_results", "created_at", true],
  ["hyrox", "hyrox_results", "created_at", true],
  ["checkin_photo", "progress_photos", "date", false],
];

/** The message is safe to show the user; `status` is the HTTP status to answer with. */
export class Rejected extends Error {
  constructor(message: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const HEX32 = /^[0-9a-f]{32}$/;

/** A UUID as its canonical lowercase text, or null for anything else (a number, a list, text that is not one). Accepts what Python's uuid.UUID does for ordinary spellings: braces, a urn:uuid: prefix, hyphens anywhere, any case. */
export function parseUserId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hex = pyStrip(raw).replaceAll("urn:", "").replaceAll("uuid:", "").replace(/^[{}]+|[{}]+$/g, "").replaceAll("-", "").toLowerCase();
  if (!HEX32.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// -- who is hidden from whom -------------------------------------------------------------------------------------------

/** Every account `userId` must not see, and that must not see them: a block is read in both directions, so the blocked
 *  person cannot go on watching the blocker climb a leaderboard. The row itself stays the blocker's alone. */
export async function hiddenIds(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx.all<{ other: string }>(
    `select blocked_id as other from public.blocked_users where user_id = $1
     union select user_id as other from public.blocked_users where blocked_id = $1`,
    [userId],
  );
  return new Set(rows.map((r) => String(r.other)));
}

/** Only the caller's own blocks, newest first: being blocked by someone is not theirs to see or undo. */
export async function blockedAccounts(tx: Tx, userId: string) {
  const rows = await tx.all<{ id: string; name: string }>(
    `select p.id, p.name from public.blocked_users b join public.profiles p on p.id = b.blocked_id
     where b.user_id = $1 order by b.created_at desc, p.id`,
    [userId],
  );
  return rows.map((r) => ({ id: String(r.id), name: r.name }));
}

export async function block(tx: Tx, userId: string, otherId: string): Promise<void> {
  await tx.exec("insert into public.blocked_users (user_id, blocked_id) values ($1, $2) on conflict do nothing", [userId, otherId]);
}

export async function unblock(tx: Tx, userId: string, otherId: string): Promise<void> {
  await tx.exec("delete from public.blocked_users where user_id = $1 and blocked_id = $2", [userId, otherId]);
}

export async function profileExists(tx: Tx, userId: string): Promise<boolean> {
  return (await tx.one("select 1 as one from public.profiles where id = $1", [userId])) !== null;
}

// -- friends ---------------------------------------------------------------------------------------------------------------

export async function friendCode(tx: Tx, userId: string): Promise<string | null> {
  const row = await tx.one<{ friend_code: string }>("select friend_code from public.profiles where id = $1", [userId]);
  return row ? row.friend_code : null;
}

/** The caller's friends by name, blocked accounts left out in both directions. */
export async function friends(tx: Tx, userId: string) {
  const hidden = await hiddenIds(tx, userId);
  const rows = await tx.all<{ id: string; name: string }>(
    `select p.id, p.name from public.friends f join public.profiles p on p.id = f.friend_id
     where f.user_id = $1 order by p.name, p.id`,
    [userId],
  );
  return rows.filter((r) => !hidden.has(String(r.id))).map((r) => ({ id: String(r.id), name: r.name }));
}

export async function friendIds(tx: Tx, userId: string): Promise<string[]> {
  return (await tx.all<{ friend_id: string }>("select friend_id from public.friends where user_id = $1", [userId])).map((r) => String(r.friend_id));
}

/** The code as the profile stores it (upper case), or a Rejected for something that cannot be a code. */
export function cleanCode(raw: unknown): string {
  if (raw !== null && raw !== undefined && typeof raw !== "string") throw new Rejected("Enter a friend code.");
  const code = pyStrip(raw ?? "");
  if (!code) throw new Rejected("Enter a friend code.");
  return code.toUpperCase();
}

/** Seconds until another wrong code may be tried, or 0 when the budget has room. */
export async function guessWait(tx: Tx, userId: string, now: number): Promise<number> {
  const row = await tx.one<{ window_start: number; count: number }>("select window_start, count from public.auth_throttle where key = $1", [`friendcode:${userId}`]);
  if (row === null || now - Number(row.window_start) >= FRIEND_CODE_GUESS_WINDOW || Number(row.count) < FRIEND_CODE_GUESS_LIMIT) return 0;
  return Math.max(1, Math.trunc(FRIEND_CODE_GUESS_WINDOW - (now - Number(row.window_start))));
}

export async function recordMiss(tx: Tx, userId: string, now: number): Promise<void> {
  await tx.exec(
    `insert into public.auth_throttle (key, window_start, count) values ($1, $2::bigint, 1)
     on conflict (key) do update set
         window_start = case when $2::bigint - auth_throttle.window_start >= $3::bigint then $2::bigint else auth_throttle.window_start end,
         count        = case when $2::bigint - auth_throttle.window_start >= $3::bigint then 1 else auth_throttle.count + 1 end`,
    [`friendcode:${userId}`, now, FRIEND_CODE_GUESS_WINDOW],
  );
}

export type AddByCode = { friend: { id: string; name: string } } | { rejected: Rejected };

/** Make the caller and the owner of `rawCode` friends (both directions). Only a code that matches nobody counts against
 *  the guess budget, and a blocked person is answered exactly like an unknown code (saying 'you are blocked' would be a
 *  channel back to the person who blocked you). Returns the outcome instead of throwing, so that a miss is COMMITTED
 *  (it must outlive the refusal that follows) while every other refusal changes nothing. */
export async function addByCode(tx: Tx, userId: string, rawCode: unknown, now: number): Promise<AddByCode> {
  let code: string;
  try {
    code = cleanCode(rawCode);
  } catch (e) {
    if (e instanceof Rejected) return { rejected: e };
    throw e;
  }
  await lock(tx, "friendcode", userId); // one person's guesses are counted one at a time
  const wait = await guessWait(tx, userId, now);
  if (wait) {
    return { rejected: new Rejected(`Too many friend codes tried. Please wait ${friendlyWait(wait)} and try again.`, 429, { retry_after: wait }) };
  }
  let other: { id: string; name: string } | null = null;
  if ([...code].length <= MAX_FRIEND_CODE_CHARS) other = await tx.one<{ id: string; name: string }>("select id, name from public.profiles where friend_code = $1", [code]);
  if (other === null) {
    await recordMiss(tx, userId, now);
    return { rejected: new Rejected("No user found with that code.", 404) };
  }
  const otherId = String(other.id);
  if (otherId === String(userId)) return { rejected: new Rejected("That's your own code.", 400) };
  if ((await hiddenIds(tx, userId)).has(otherId)) return { rejected: new Rejected("No user found with that code.", 404) };
  for (const [a, b] of [[userId, otherId], [otherId, userId]]) {
    await tx.exec("insert into public.friends (user_id, friend_id) values ($1, $2) on conflict do nothing", [a, b]);
  }
  return { friend: { id: otherId, name: other.name } };
}

// -- reports -----------------------------------------------------------------------------------------------------------------

/** File a report and block the reported account in the same step. One OPEN report per (reporter, reported): the same
 *  complaint twice before anyone looked is one complaint, and a new one after it was handled is allowed. */
export async function reportUser(tx: Tx, reporterId: string, reportedId: string, reason: unknown): Promise<void> {
  const trimmed = typeof reason === "string" ? pyStrip(reason) : "";
  const why = REPORT_REASONS.includes(trimmed) ? trimmed : "other";
  const existing = await tx.one(
    "select id from public.content_reports where reporter_id = $1 and reported_id = $2 and handled_at is null",
    [reporterId, reportedId],
  );
  if (!existing) {
    await tx.exec("insert into public.content_reports (reporter_id, reported_id, reason) values ($1, $2, $3)", [reporterId, reportedId, why]);
  }
  await block(tx, reporterId, reportedId);
}

/** Record a report against one AI reply. Returns false when the reporter is over their open-report cap. The reply text is
 *  clipped to MAX_AI_REPORT_TEXT, and the same text reported twice before review is one report. */
export async function reportAiReply(tx: Tx, userId: string, feature: unknown, reason: unknown, replyText: unknown): Promise<boolean> {
  const reply = [...pyStrip(typeof replyText === "string" ? replyText : "")].slice(0, MAX_AI_REPORT_TEXT).join("");
  const f = typeof feature === "string" && AI_REPORT_FEATURES.includes(pyStrip(feature)) ? pyStrip(feature) : "coach";
  const r = typeof reason === "string" && AI_REPORT_REASONS.includes(pyStrip(reason)) ? pyStrip(reason) : "other";
  await lock(tx, "ai_reports", userId);
  if (await tx.one("select 1 as one from public.ai_reports where user_id = $1 and reply_text = $2 and handled_at is null", [userId, reply])) return true;
  const open = await tx.one<{ n: number }>("select count(*) as n from public.ai_reports where user_id = $1 and handled_at is null", [userId]);
  if (Number(open!.n) >= MAX_OPEN_AI_REPORTS_PER_USER) return false;
  await tx.exec("insert into public.ai_reports (user_id, feature, reason, reply_text) values ($1, $2, $3, $4)", [userId, f, r, reply]);
  return true;
}

// -- activity dates ------------------------------------------------------------------------------------------------------------

/** The caller's UTC offset in minutes (UTC+7 is +420), clamped to real timezones; a bad value means UTC. */
export function offsetMinutes(raw: unknown): number {
  const text = pyStrip(typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "");
  // ASCII digits only: Python's int() also reads other scripts' digits and underscores, which no client sends
  if (!/^[+-]?[0-9]+$/.test(text)) return 0;
  return Math.max(-14 * 60, Math.min(14 * 60, Number.parseInt(text, 10)));
}

/** Every local calendar day the caller did something only the server records, as {"YYYY-MM-DD": ["challenge", ...]}. Instants
 *  are shifted into the caller's day before being cut to a date; a progress photo's date already is one. */
export async function activityDates(tx: Tx, userId: string, rawOffset: unknown): Promise<Record<string, string[]>> {
  const offset = offsetMinutes(rawOffset);
  const days: Record<string, string[]> = {};
  for (const [action, table, column, instant] of ACTIVITY_SOURCES) { // table and column are constants of ours, never input
    const rows = instant
      ? await tx.all<{ day: Date | null }>(
        `select distinct (((${column} at time zone 'UTC') + make_interval(mins => $1::int))::date) as day from public.${table} where user_id = $2`,
        [offset, userId],
      )
      : await tx.all<{ day: Date | null }>(`select distinct ${column} as day from public.${table} where user_id = $1`, [userId]);
    for (const row of rows) {
      if (row.day) (days[row.day.toISOString().slice(0, 10)] ??= []).push(action);
    }
  }
  return Object.fromEntries(Object.keys(days).sort().map((day) => [day, days[day].sort()]));
}

// -- challenges --------------------------------------------------------------------------------------------------------------

/** The one exercise everybody is challenged on today: a pure function of the UTC calendar date. */
export function todaysExercise(order: readonly string[] = CHALLENGE_ORDER, today: Date = new Date()): string {
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = (day - Date.parse(CHALLENGE_ROTATION_EPOCH + "T00:00:00Z")) / 86_400_000; // both are UTC midnights, so a whole number
  return order[((days % order.length) + order.length) % order.length];
}

/** Whether the caller already recorded an attempt for this exercise today (UTC), on any challenge. */
export async function hasSubmittedToday(tx: Tx, userId: string, exercise: string): Promise<boolean> {
  return (await tx.one(
    `select 1 as one from public.challenge_submissions s join public.challenges c on c.id = s.challenge_id
     where s.user_id = $1 and c.exercise = $2 and (s.created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date limit 1`,
    [userId, exercise],
  )) !== null;
}

/** A new challenge for today's exercise, or a Rejected: at the ceiling, or already attempted today. */
export async function createChallenge(tx: Tx, userId: string, exercise: string): Promise<number> {
  await lock(tx, "challenges", userId);
  const count = await tx.one<{ n: number }>("select count(*) as n from public.challenges where creator_id = $1", [userId]);
  if (Number(count!.n) >= CHALLENGE_LIMIT) throw new Rejected(overLimitMessage(CHALLENGE_LIMIT), 429);
  if (await hasSubmittedToday(tx, userId, exercise)) throw new Rejected("You've already recorded today's attempt — come back tomorrow.", 429, { limitReached: true });
  const row = await tx.one<{ id: number }>("insert into public.challenges (creator_id, exercise, duration_seconds) values ($1, $2, $3) returning id", [userId, exercise, CHALLENGE_SECONDS]);
  return row!.id;
}

export interface ChallengeRow {
  id: number;
  creator_id: string;
  exercise: string;
  duration_seconds: number;
  created_at: Date;
}

/** The challenge if it is the caller's own or a friend's and its creator is not hidden from them, else null. */
export async function visibleChallenge(tx: Tx, userId: string, challengeId: number): Promise<ChallengeRow | null> {
  const row = await tx.one<ChallengeRow>("select * from public.challenges where id = $1", [challengeId]);
  if (!row) return null;
  const creator = String(row.creator_id);
  if (creator === String(userId)) return row;
  if ((await hiddenIds(tx, userId)).has(creator)) return null;
  const mine = await tx.one("select 1 as one from public.friends where user_id = $1 and friend_id = $2", [userId, creator]);
  return mine ? row : null;
}

/** Challenges the caller or one of their friends created, newest first, each with its board (most reps first, the earlier
 *  attempt first on a tie). Blocked accounts are left out of both halves: submissions carry free-text notes another account
 *  wrote, which is more exposed than a display name. */
export async function visibleChallenges(tx: Tx, userId: string) {
  const hidden = await hiddenIds(tx, userId);
  const all = await tx.all<ChallengeRow & { creator_name: string }>(
    `select c.*, p.name as creator_name from public.challenges c join public.profiles p on p.id = c.creator_id
     where c.creator_id = $1 or c.creator_id in (select friend_id from public.friends where user_id = $1)
     order by c.created_at desc, c.id desc`,
    [userId],
  );
  const rows = all.filter((r) => !hidden.has(String(r.creator_id)));
  const boards = new Map<number, unknown[]>(rows.map((r) => [Number(r.id), []]));
  if (rows.length) {
    const subs = await tx.all<{ challenge_id: number; user_id: string; reps: number; notes: string; created_at: Date; name: string }>(
      `select s.challenge_id, s.user_id, s.reps, s.notes, s.created_at, p.name from public.challenge_submissions s
       join public.profiles p on p.id = s.user_id where s.challenge_id = any($1::bigint[])
       order by s.reps desc, s.created_at asc, s.user_id`,
      [rows.map((r) => r.id)],
    );
    for (const s of subs) {
      if (!hidden.has(String(s.user_id))) {
        boards.get(Number(s.challenge_id))!.push({ user_id: String(s.user_id), reps: s.reps, notes: s.notes, created_at: s.created_at.toISOString(), name: s.name });
      }
    }
  }
  return rows.map((r) => ({
    id: r.id,
    creator_id: String(r.creator_id),
    exercise: r.exercise,
    duration_seconds: r.duration_seconds,
    created_at: r.created_at.toISOString(),
    creator_name: r.creator_name,
    leaderboard: boards.get(Number(r.id)),
  }));
}

/** Insert, or improve: a retake keeps only a HIGHER rep count, so a bad second try cannot wipe a better first one. */
export async function saveSubmission(tx: Tx, challengeId: number, userId: string, reps: number, notes: string): Promise<void> {
  await tx.exec(
    `insert into public.challenge_submissions (challenge_id, user_id, reps, notes) values ($1, $2, $3, $4)
     on conflict (challenge_id, user_id) do update set reps = excluded.reps, notes = excluded.notes, created_at = now()
     where excluded.reps > challenge_submissions.reps`,
    [challengeId, userId, reps, notes],
  );
}

// -- leaderboards --------------------------------------------------------------------------------------------------------------

/** Everyone's total reps across every challenge, most first (the earlier last attempt first on a tie). The scope is the
 *  caller plus their friends, or everybody. Blocked accounts are left out IN THE QUERY so the ranks the caller computes from
 *  this list are the ranks they are shown; filtering afterwards would leave gaps at every hidden position. */
export async function repsBoard(tx: Tx, userId: string, scope: string) {
  const hidden = [...await hiddenIds(tx, userId)];
  const params: unknown[] = [hidden];
  let scopeSql = "";
  if (scope !== "global") {
    params.push([String(userId), ...await friendIds(tx, userId)]);
    scopeSql = " and s.user_id = any($2::uuid[])";
  }
  const rows = await tx.all<{ user_id: string; name: string; total_reps: number; last_at: Date }>(
    `select s.user_id, p.name, sum(s.reps)::bigint as total_reps, max(s.created_at) as last_at
     from public.challenge_submissions s join public.profiles p on p.id = s.user_id
     where not (s.user_id = any($1::uuid[]))${scopeSql}
     group by s.user_id, p.name order by total_reps desc, last_at asc, s.user_id`,
    params,
  );
  return rows.map((r) => ({ user_id: String(r.user_id), name: r.name, total_reps: Number(r.total_reps), last_at: r.last_at.toISOString() }));
}

export function myRank<T extends { user_id: string; name: string }>(rows: readonly T[], userId: string, key: Exclude<keyof T, "user_id" | "name"> & string) {
  const at = rows.findIndex((r) => r.user_id === String(userId));
  return at < 0 ? null : { rank: at + 1, [key]: rows[at][key], name: rows[at].name };
}

// -- HYROX results ---------------------------------------------------------------------------------------------------------------

/** True when all three are known values. */
export const hyroxCombo = (gender: string, category: string, format: string): boolean =>
  HYROX_GENDERS.includes(gender) && HYROX_CATEGORIES.includes(category) && HYROX_FORMATS.includes(format);

/** A number the way Python's float() reads it (a number, or text like " 3600.5 " or "1e3"); NaN for anything else. */
function pyFloat(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const text = pyStrip(value);
  // digits may be grouped with single underscores ("3_600"), as Python allows; nothing else (no "0x10", no "inf") is a number here
  const digits = "[0-9](?:_?[0-9])*";
  return new RegExp(`^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`).test(text) ? Number(text.replaceAll("_", "")) : NaN;
}

/** [gender, category, format, totalSeconds] from a posted result, or a Rejected. */
export function cleanHyroxResult(payload: Record<string, unknown>): [string, string, string, number] {
  const read = (k: string) => pyStrip(String(payload[k] || ""));
  const [gender, category, format] = [read("gender"), read("category"), read("format")];
  const seconds = pyFloat(payload.total_seconds);
  if (!Number.isFinite(seconds)) throw new Rejected("Invalid time.");
  if (!hyroxCombo(gender, category, format)) throw new Rejected("Invalid gender, category, or format.");
  if (seconds < HYROX_MIN_PLAUSIBLE_SECONDS[`${gender}|${format}`] || seconds > HYROX_MAX_SECONDS) throw new Rejected("That time isn't a plausible race finish.");
  return [gender, category, format, seconds];
}

export async function createHyroxResult(tx: Tx, userId: string, gender: string, category: string, format: string, seconds: number): Promise<number> {
  await lock(tx, "hyrox_results", userId);
  const count = await tx.one<{ n: number }>("select count(*) as n from public.hyrox_results where user_id = $1", [userId]);
  if (Number(count!.n) >= HYROX_RESULT_LIMIT) throw new Rejected(overLimitMessage(HYROX_RESULT_LIMIT), 429);
  const row = await tx.one<{ id: number }>(
    "insert into public.hyrox_results (user_id, gender, category, format, total_seconds) values ($1, $2, $3, $4, $5) returning id",
    [userId, gender, category, format, seconds],
  );
  return row!.id;
}

/** Everyone's fastest time for one exact gender/category/format, fastest first. The plausibility floor applies on the way OUT
 *  as well, before the MIN(), so a person with one impossible time and one real one ranks on the real one, and rows stored
 *  before the floor was raised cannot sit at the top for good. Hidden accounts are excluded in the query. */
export async function hyroxBoard(tx: Tx, userId: string, gender: string, category: string, format: string) {
  const rows = await tx.all<{ user_id: string; name: string; best_seconds: number }>(
    `select r.user_id, p.name, min(r.total_seconds) as best_seconds from public.hyrox_results r
     join public.profiles p on p.id = r.user_id
     where r.gender = $1 and r.category = $2 and r.format = $3 and r.total_seconds >= $4
     and r.total_seconds <= $5 and not (r.user_id = any($6::uuid[]))
     group by r.user_id, p.name order by best_seconds asc, r.user_id`,
    [gender, category, format, HYROX_MIN_PLAUSIBLE_SECONDS[`${gender}|${format}`], HYROX_MAX_SECONDS, [...await hiddenIds(tx, userId)]],
  );
  return rows.map((r) => ({ user_id: String(r.user_id), name: r.name, best_seconds: Number(r.best_seconds) }));
}
