/** The owner's side: the pre-launch waitlist, the moderation queue (reports against accounts and AI replies) and a look at who signed up and
 *  what they use. The port of api/admin.py. Every route that uses this answers 404 to anyone who is not in ADMIN_EMAILS (a 403 would admit
 *  the page exists). */
import type { Identity } from "./auth.ts";
import type { Tx } from "./db.ts";
import { isoSql, isoUtc } from "./rows.ts";
import { pyStrip } from "./nameFilter.ts";
import { pyStr } from "./pyText.ts";
import type { Settings } from "./settings.ts";
import { take } from "./throttle.ts";

export const RANGES = ["today", "week", "month", "all"] as const;
export type Range = (typeof RANGES)[number];
export const MODERATED_DISPLAY_NAME = "RepCheck User"; // database.MODERATED_DISPLAY_NAME
export const REPORT_PAGE_LIMIT = 100;
export const WAITLIST_LIMIT = 5; // app.py WAITLIST_LIMIT / WAITLIST_WINDOW: per visitor address per hour
export const WAITLIST_WINDOW = 3600;
export const MAX_SOURCE = 64;
/** The marketing site's two hostnames, echoed one at a time (a wildcard would let any page on the internet submit through the waitlist). */
export const WAITLIST_ORIGINS: ReadonlySet<string> = new Set(["https://repcheck-marketing.onrender.com", "https://repcheckofficials.onrender.com"]);
const THAILAND_OFFSET_MS = 7 * 3600_000; // Thailand has no daylight saving, so a fixed offset needs no timezone database

export const PAGE_LABELS: Readonly<Record<string, string>> = {
  home: "Home", analyze_page: "Analyze", analyze_latest: "Analyze (latest result)",
  workouts: "Workouts", nutrition: "Nutrition", coach: "Coach", hyrox: "HYROX",
  friends: "Friends", settings: "Settings", weight_history: "Weight History",
  logging_history: "Logging History", streaks: "Streaks", onboarding: "Onboarding",
};
export const FEATURE_LABELS: Readonly<Record<string, string>> = {
  workout_analysis: "Workout analyses (AI)", food_scan: "Food photo scans (AI)",
  coach_chat_message: "Coach chat messages", analyze_chat_message: "Analysis chat messages",
  workout_chat_message: "Workout chat messages",
  hyrox_ai_analysis: "HYROX race analyses (AI)", challenge_submission: "Challenge submissions",
  food_logged: "Foods logged", weight_logged: "Weigh-ins logged", barcode_scan: "Barcode scans",
  split_ai_suggested: "Split plans suggested (AI)", checkin_ai_analysis: "Weekly check-ins refined (AI)",
  friend_added: "Friends added", block_user: "Accounts blocked", report_user: "Accounts reported",
  report_ai_reply: "AI replies reported",
};

export const isAdmin = (settings: Settings, identity: Identity): boolean => !!identity.email && settings.adminEmails.has(identity.email.toLowerCase());

// -- the waitlist -------------------------------------------------------------------------------------------------------------

/** The source label cut to 64 characters with control characters dropped, or null for anything that is not text or is empty. */
export function cleanSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return [...raw].filter((c) => c.codePointAt(0)! >= 32 && c.codePointAt(0) !== 127).slice(0, MAX_SOURCE).join("") || null;
}

/** Spend one of the visitor's tries in a single statement; [allowed, seconds until the window resets]. */
export const takeAttempt = (tx: Tx, key: string, now: number): Promise<[boolean, number]> => take(tx, key, WAITLIST_LIMIT, WAITLIST_WINDOW, now);

/** True when the address is new, false when it was already there (the caller must answer both alike). */
export async function addWaitlistEmail(tx: Tx, email: string, source: string | null): Promise<boolean> {
  return await tx.one("insert into public.waitlist (email, source) values ($1, $2) on conflict (email) do nothing returning id", [email, source]) !== null;
}

export interface WaitlistEntry {
  email: string;
  source: string | null;
  created_at: string;
}

export async function waitlistEntries(tx: Tx): Promise<WaitlistEntry[]> {
  const rows = await tx.all<{ email: string; source: string | null; created_text: string }>(
    `select email, source, ${isoSql("created_at")} as created_text from public.waitlist order by created_at desc, id desc`,
  );
  return rows.map((r) => ({ email: r.email, source: r.source, created_at: isoUtc(r.created_text) }));
}

/** Erase an address on request (the privacy notice promises it within a month). True when something was removed. */
export async function deleteWaitlistEmail(tx: Tx, raw: unknown): Promise<boolean> {
  const email = pyStrip(typeof raw === "string" ? raw : "").toLowerCase();
  return !!email && await tx.one("delete from public.waitlist where email = $1 returning id", [email]) !== null;
}

/** Text a spreadsheet will not run as a formula: a leading = + - @ tab or CR is defused with an apostrophe. */
export function spreadsheetSafe(value: unknown): string {
  const text = value === null || value === undefined ? "" : pyStr(value);
  return ["=", "+", "-", "@", "\t", "\r"].includes(text.slice(0, 1)) ? "'" + text : text;
}

export function waitlistCsv(entries: readonly WaitlistEntry[]): string {
  const lines = ["email,source,joined_utc"];
  for (const entry of entries) {
    lines.push((["email", "source", "created_at"] as const).map((col) => '"' + spreadsheetSafe(entry[col]).replaceAll('"', '""') + '"').join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// -- moderation ---------------------------------------------------------------------------------------------------------------

/** Unhandled reports against accounts, oldest first: the response time promised to reporters is what matters. */
export async function openReports(tx: Tx, limit = REPORT_PAGE_LIMIT) {
  const rows = await tx.all<{ id: number; reason: string; created_text: string; reporter_id: string; reporter_name: string; reported_id: string; reported_name: string }>(
    `select r.id, r.reason, ${isoSql("r.created_at")} as created_text, r.reporter_id, rep.name as reporter_name, r.reported_id, sub.name as reported_name
     from public.content_reports r join public.profiles rep on rep.id = r.reporter_id join public.profiles sub on sub.id = r.reported_id
     where r.handled_at is null order by r.created_at asc, r.id asc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id, reason: r.reason, created_at: isoUtc(r.created_text), reporter_id: String(r.reporter_id), reporter_name: r.reporter_name,
    reported_id: String(r.reported_id), reported_name: r.reported_name,
  }));
}

export async function openAiReports(tx: Tx, limit = REPORT_PAGE_LIMIT) {
  const rows = await tx.all<{ id: number; feature: string; reason: string; reply_text: string; created_text: string; reporter_name: string }>(
    `select a.id, a.feature, a.reason, a.reply_text, ${isoSql("a.created_at")} as created_text, p.name as reporter_name from public.ai_reports a
     join public.profiles p on p.id = a.user_id where a.handled_at is null order by a.created_at asc, a.id asc limit $1`,
    [limit],
  );
  return rows.map((r) => ({ id: r.id, feature: r.feature, reason: r.reason, reply_text: r.reply_text, created_at: isoUtc(r.created_text), reporter_name: r.reporter_name }));
}

export async function markReportHandled(tx: Tx, reportId: number): Promise<boolean> {
  return await tx.one("update public.content_reports set handled_at = now() where id = $1 and handled_at is null returning id", [reportId]) !== null;
}

export async function markAiReportHandled(tx: Tx, reportId: number): Promise<boolean> {
  return await tx.one("update public.ai_reports set handled_at = now() where id = $1 and handled_at is null returning id", [reportId]) !== null;
}

/** Act on a report: replace the reported account's display name (the one thing a user writes that others see) with a neutral one and close
 *  every open report against that account. Returns the account id, or null if the report is gone. */
export async function resetReportedName(tx: Tx, reportId: number): Promise<string | null> {
  const row = await tx.one<{ reported_id: string }>("select reported_id from public.content_reports where id = $1", [reportId]);
  if (!row) return null;
  const reported = row.reported_id;
  await tx.exec("update public.profiles set name = $1 where id = $2", [MODERATED_DISPLAY_NAME, reported]);
  await tx.exec("update public.content_reports set handled_at = now() where reported_id = $1 and handled_at is null", [reported]);
  return String(reported);
}

// -- who signed up -------------------------------------------------------------------------------------------------------------

/** The instant a signup list starts at (null for all). "Today" is Bangkok's calendar day for the owner. */
export function signupCutoff(range: string, now: Date = new Date()): Date | null {
  if (range === "today") {
    const local = new Date(now.getTime() + THAILAND_OFFSET_MS);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - THAILAND_OFFSET_MS);
  }
  if (range === "week") return new Date(now.getTime() - 7 * 86_400_000);
  if (range === "month") return new Date(now.getTime() - 30 * 86_400_000);
  return null;
}

export async function listUsers(tx: Tx, since: Date | null) {
  const rows = await tx.all<{ id: string; name: string; email: string | null; created_text: string }>(
    `select p.id, p.name, u.email, ${isoSql("p.created_at")} as created_text from public.profiles p left join auth.users u on u.id = p.id
     where $1::timestamptz is null or p.created_at >= $1::timestamptz order by p.created_at desc, p.id`,
    [since ? since.toISOString() : null],
  );
  return rows.map((r) => ({ id: String(r.id), name: r.name, email: r.email, created_at: isoUtc(r.created_text) }));
}

/** (label, table, column): constants of ours, never input. */
const COUNTED_TABLES = [
  ["foods_logged", "nutrition_entries", "user_id"], ["exercises_logged", "workout_entries", "user_id"],
  ["weigh_ins", "weight_entries", "user_id"], ["analyses", "analyze_results", "user_id"],
  ["progress_photos", "progress_photos", "user_id"], ["custom_foods", "custom_foods", "user_id"],
  ["challenge_submissions", "challenge_submissions", "user_id"], ["hyrox_results", "hyrox_results", "user_id"],
  ["friends", "friends", "user_id"],
] as const;

export interface UsageEntry {
  event: string;
  label: string;
  count: number;
  last_at: string;
}

/** Usage events split into page views and feature uses, each with a readable label (an unknown name is its own label). */
export function usageSplit(events: readonly { event: string; count: number; last_text: string }[]): [UsageEntry[], UsageEntry[]] {
  const pages: UsageEntry[] = [];
  const features: UsageEntry[] = [];
  for (const event of events) {
    const at = event.event.indexOf(":");
    const kind = at === -1 ? event.event : event.event.slice(0, at);
    const name = at === -1 ? "" : event.event.slice(at + 1);
    const labels = kind === "page" ? PAGE_LABELS : FEATURE_LABELS;
    (kind === "page" ? pages : features).push({ event: event.event, label: Object.hasOwn(labels, name) ? labels[name] : name, count: event.count, last_at: isoUtc(event.last_text) });
  }
  return [pages, features];
}

export async function userDetail(tx: Tx, userId: string) {
  const profile = await tx.one<{ id: string; name: string; email: string | null; created_text: string; deleted_text: string | null; ai_consent_at: Date | null }>(
    `select p.id, p.name, u.email, ${isoSql("p.created_at")} as created_text, ${isoSql("p.deleted_at")} as deleted_text, p.ai_consent_at from public.profiles p
     left join auth.users u on u.id = p.id where p.id = $1`,
    [userId],
  );
  if (!profile) return null;
  const events = await tx.all<{ event: string; count: number; last_text: string }>(
    `select event, count, ${isoSql("last_at")} as last_text from public.usage_events where user_id = $1 order by count desc, event`,
    [userId],
  );
  const [pages, features] = usageSplit(events);
  const counts: Record<string, number> = {};
  for (const [label, table, column] of COUNTED_TABLES) {
    counts[label] = Number((await tx.one<{ n: number }>(`select count(*) as n from public.${table} where ${column} = $1`, [userId]))!.n);
  }
  const latest = await tx.one<{ day: string; kg: number }>("select to_char(log_date, 'YYYY-MM-DD') as day, kg from public.weight_entries where user_id = $1 order by log_date desc limit 1", [userId]);
  const analyses = await tx.all<{ id: number; exercise_label: string; overall_score: number; created_text: string }>(
    `select id, exercise_label, overall_score, ${isoSql("created_at")} as created_text from public.analyze_results where user_id = $1 order by created_at desc, id desc limit 10`,
    [userId],
  );
  return {
    id: String(profile.id), name: profile.name, email: profile.email,
    created_at: isoUtc(profile.created_text),
    deleted_at: profile.deleted_text ? isoUtc(profile.deleted_text) : null,
    ai_consent: profile.ai_consent_at !== null,
    page_views: pages, feature_uses: features, counts,
    latest_weight: latest ? { date: latest.day, kg: latest.kg } : null,
    analyses: analyses.map((a) => ({ id: a.id, exercise_label: a.exercise_label, overall_score: a.overall_score, created_at: isoUtc(a.created_text) })),
  };
}
