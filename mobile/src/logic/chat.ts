/**
 * The rules the three AI chats share (coach, workout, analysis): what a reply is, how its text and citations are read, how the
 * limit lockout counts down, and what is sent back to the server as history. templates/coach.html, static/analyze_chat_widget.js
 * and static/ai_sources.js are the originals, rule for rule.
 */
import type { Block, Run } from './richText';

export type ChatRole = 'user' | 'assistant';

/** A citation under a reply: picked by the server from a fixed, checked catalog (health_sources.py), never written by the model. */
export interface ChatSource {
  title: string;
  publisher: string | null;
  url: string;
}

export interface ChatTurn {
  /** Made on the device when the turn is made; the row's key, so a retried save is the same save. */
  id: string;
  role: ChatRole;
  text: string;
  /** null for the person's own turns and for anything that did not come from the AI (an error, a notice). */
  sources: ChatSource[] | null;
  /** The local calendar day the turn was made on, "YYYY-MM-DD". */
  date: string;
}

/** What the server answers to a chat message (api/routes/chat.py). */
export interface ChatReply {
  reply: string;
  sources: ChatSource[];
  /** The daily budget is used up: `reply` is a notice, not an answer, and nothing was spent. */
  limited: boolean;
  retryAfterSeconds: number;
}

export const MAX_MESSAGE_CHARS = 1000;
/** Citations shown under one reply. */
export const MAX_SOURCES = 3;
/** Turns kept for the coach, the website's `history.slice(-60)`. */
export const COACH_KEEP = 60;

/** Only plain https links are ever opened: the turns are stored and synced, so what comes back out is not trusted. */
export function safeUrl(url: unknown): string | null {
  return typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

/** At most three citations that have a title and a plain https link. Anything else in the list is dropped. */
export function cleanSources(raw: unknown): ChatSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatSource[] = [];
  for (const item of raw) {
    if (out.length >= MAX_SOURCES) break;
    if (item === null || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const url = safeUrl(source.url);
    if (!url || typeof source.title !== 'string' || !source.title) continue;
    out.push({ title: source.title, publisher: typeof source.publisher === 'string' && source.publisher ? source.publisher : null, url });
  }
  return out;
}

/** Reads the server's answer; null when it is not one. */
export function parseChatReply(body: unknown): ChatReply | null {
  if (body === null || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.reply !== 'string') return null;
  const wait = typeof b.retry_after_seconds === 'number' && Number.isFinite(b.retry_after_seconds) ? Math.max(0, b.retry_after_seconds) : 0;
  return { reply: b.reply, sources: cleanSources(b.sources), limited: b.limited === true, retryAfterSeconds: wait };
}

/**
 * A reply's text as blocks: one paragraph per line, "- " or "* " lines as bullets, **bold** inside a line, and nothing else. Escaping
 * is not needed (it is drawn as text), but the rule that nothing else is interpreted is the website's, so a reply can contain "<b>"
 * and see it as written.
 */
export function chatBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split('\n')) {
    // A browser collapses runs of white space; the app does the same so the two read alike.
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line) continue;
    const bullet = /^[-*]\s+/.test(line);
    blocks.push({ kind: bullet ? 'bullet' : 'paragraph', runs: boldRuns(bullet ? line.replace(/^[-*]\s+/, '') : line) });
  }
  return blocks;
}

function boldRuns(line: string): Run[] {
  const runs: Run[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > last) runs.push({ text: line.slice(last, match.index), bold: false, italic: false, code: false });
    runs.push({ text: match[1], bold: true, italic: false, code: false });
    last = match.index + match[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), bold: false, italic: false, code: false });
  return runs;
}

/** "2h 5m", or "5m" (never "0m": under a minute still reads as a minute). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(seconds, 0);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${Math.max(minutes, 1)}m`;
}

/**
 * The turns to send as history: only real exchanges. A turn that was an error or a notice is never one of these (it is not
 * saved with the thread), and the roles are the ones the server's module expects: the coach calls its side "coach".
 */
export function historyForServer(turns: readonly ChatTurn[], assistantRole: 'assistant' | 'coach'): { role: string; text: string }[] {
  return turns.map((turn) => ({ role: turn.role === 'assistant' ? assistantRole : 'user', text: turn.text }));
}

/** The coach's thread is one calendar day: turns from another day are not shown or sent, and the rest are capped. */
export function todaysCoachTurns(turns: readonly ChatTurn[], today: string): ChatTurn[] {
  return turns.filter((t) => t.date === today).slice(-COACH_KEEP);
}

/** A thread opened more than a day after its analysis was made no longer takes questions (the website's LOCK_AFTER_MS). */
export const ANALYSIS_CHAT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function analysisChatClosed(createdAtMs: number, now: number): boolean {
  return Number.isFinite(createdAtMs) && now - createdAtMs > ANALYSIS_CHAT_WINDOW_MS;
}

/** The fixed reasons offered when reporting a reply (api/social.py AI_REPORT_REASONS). */
export const REPORT_REASONS = ['harmful', 'inaccurate', 'offensive', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Which chat a reply came from, as the report names it (api/social.py AI_REPORT_FEATURES). */
export type ReportFeature = 'coach' | 'workout_chat' | 'analyze_chat';
