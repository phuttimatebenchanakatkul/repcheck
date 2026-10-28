/** The three AI chats (coach, analysis follow-up, workout): input checks, the prompts, and the over-limit reply.
 *
 * The website's routes had no server-side size limit on a message (only an `<input maxlength>`), took the history and context
 * as they came, and passed everything straight into the model's prompt. Here every field is bounded and shaped first, so a bad
 * request is a 400 that costs nothing and nobody can send a megabyte of prompt on someone else's Gemini bill.
 * A port of api/chat.py, coach_chat.py, analyze_chat.py and workout_chat.py.
 */
import { COACH_SYSTEM_PROMPT } from "./chatData.ts";
import type { Gemini, Turn } from "./gemini.ts";
import { attachSources, type PublicSource, promptInstruction } from "./healthSources.ts";
import { friendlyWait, RATE_LIMITS } from "./limits.ts";
import { pyStrip } from "./nameFilter.ts";

export const MAX_MESSAGE_CHARS = 1000; // the website's input allows 600; this is the server-side bound it never had
export const MAX_HISTORY_TURNS = 40; // the modules use the last 16; accept a few more, keep the newest
export const MAX_TURN_CHARS = 4000;
export const MAX_CONTEXT_CHARS = 40_000; // analysis feedback is capped at 6000 and a workout summary at 14000 by the prompts
export const HISTORY_TURNS_SENT = 16; // how many prior turns go back to the model
export const MAX_FEEDBACK_CHARS = 6000;
export const MAX_SUMMARY_CHARS = 14_000;

export type ChatKind = "coach" | "analysis" | "workout";

/** The message is safe to show the user. */
export class ChatRejected extends Error {}

export interface HistoryTurn {
  role: string;
  text: string;
}

const points = (s: string) => [...s];
const clip = (s: string, n: number) => points(s).slice(0, n).join("");

/** str() of a JSON value, for the few fields that are read as text whatever they hold. Arrays and objects count as nothing. */
function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  return "";
}

/** len(json.dumps(value)) the way Python writes it: ", " and ": " separators and every non-ASCII character escaped. */
export function pyJsonLength(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return String(value).length;
  if (typeof value === "string") {
    let n = 2;
    for (const ch of value) {
      const cp = ch.codePointAt(0)!;
      if (ch === '"' || ch === "\\" || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\b" || ch === "\f") n += 2;
      else if (cp < 32) n += 6;
      else if (cp <= 126) n += 1; // printable ASCII; DEL (127) is escaped like any control character
      else n += cp > 0xFFFF ? 12 : 6;
    }
    return n;
  }
  if (Array.isArray(value)) return 2 + value.reduce((n: number, v) => n + pyJsonLength(v), 0) + Math.max(0, value.length - 1) * 2;
  const entries = Object.entries(value as Record<string, unknown>);
  return 2 + entries.reduce((n, [k, v]) => n + pyJsonLength(k) + 2 + pyJsonLength(v), 0) + Math.max(0, entries.length - 1) * 2;
}

/** [message, history, context] or ChatRejected. Messages are the website's: "Message can't be empty.", "Invalid history.", "Invalid context.". */
export function cleanRequest(payload: Record<string, unknown>, takesContext: boolean): [string, HistoryTurn[], Record<string, unknown>] {
  const raw = payload.message;
  const message = pyStrip(pyStr(raw)); // nothing at all reads as empty
  if (!message) throw new ChatRejected("Message can't be empty.");
  if (points(message).length > MAX_MESSAGE_CHARS) {
    throw new ChatRejected(`That message is too long. Please keep it under ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`);
  }

  const falsy = (v: unknown) => v === undefined || v === null || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
  const history = falsy(payload.history) ? [] : payload.history;
  if (!Array.isArray(history)) throw new ChatRejected("Invalid history.");
  const turns: HistoryTurn[] = [];
  for (const turn of history.slice(-MAX_HISTORY_TURNS)) {
    if (turn === null || typeof turn !== "object") throw new ChatRejected("Invalid history."); // (an array has no role, so the next check refuses it)
    const { role, text = "" } = turn as Record<string, unknown>;
    if (typeof role !== "string" || typeof text !== "string") throw new ChatRejected("Invalid history.");
    turns.push({ role: clip(role, 20), text: clip(text, MAX_TURN_CHARS) });
  }

  let context: Record<string, unknown> = {};
  if (takesContext) {
    const given = falsy(payload.context) ? {} : payload.context;
    if (given === null || typeof given !== "object" || Array.isArray(given)) throw new ChatRejected("Invalid context.");
    if (pyJsonLength(given) > MAX_CONTEXT_CHARS) throw new ChatRejected("Invalid context.");
    context = given as Record<string, unknown>;
  }
  return [message, turns, context];
}

/** What an over-limit chat answers: a normal-looking bot message plus the flags the chat widgets use to lock input. */
export function limitedReply(retryAfter: number) {
  const uses = RATE_LIMITS.ai_chat[0];
  return {
    ok: true,
    reply: `You've reached your ${uses} chat messages for now. Please check back in ${friendlyWait(retryAfter)}.`,
    sources: [],
    limited: true,
    retry_after_seconds: retryAfter,
  };
}

// ---- the prompts --------------------------------------------------------------------------------------------------------

export function buildAnalysisPrompt(context: Record<string, unknown>): string {
  const label = pyStrip(pyStr(context.exercise_label) || "the exercise");
  const feedback = clip(pyStrip(pyStr(context.feedback_text)), MAX_FEEDBACK_CHARS);
  const scoreLine = (name: string, key: string): string | null => {
    const v = context[key];
    return typeof v === "number" ? `${name}: ${v}/100` : typeof v === "boolean" ? `${name}: ${v ? "True" : "False"}/100` : null;
  };
  const lines = [scoreLine("Overall form & technique", "overall_score"), scoreLine("Stretch", "stretch_score"), scoreLine("Squeeze", "squeeze_score")].filter((l): l is string => l !== null);
  const reps = context.reps;
  if (typeof reps === "number") lines.push(`Reps counted: ${Math.trunc(reps)}`);
  const scores = lines.length ? lines.join("\n") : "(not available)";
  return (
    `You are RepCheck's Analyze assistant. The user just had a set of ` +
    `${label} analyzed from a video they uploaded, and you have ` +
    `the complete analysis that was given to them below. Answer their ` +
    `follow-up questions about THIS specific analysis -- stay grounded ` +
    `in what's actually written below, and don't invent new visual ` +
    `details about the video that aren't stated in it (you weren't shown ` +
    `the video yourself, only this analysis of it). If they ask something ` +
    `the analysis doesn't cover, say so plainly rather than guessing.\n\n` +
    `Scores:\n${scores}\n\n` +
    `Full analysis given to the user:\n${feedback}\n\n` +
    `Rules for how you write (strict -- the reply renders in a small ` +
    `chat bubble over the page, so brevity is a hard requirement):\n` +
    `- Keep every answer SHORT and precise. Hard cap: 60 words total.\n` +
    `- Default format: 2-4 bullet points, each one line, each starting ` +
    `with "- ". No intro sentence before them.\n` +
    `- If the whole answer fits in one short sentence, give just that ` +
    `sentence instead of bullets.\n` +
    `- In every answer, bold the few words that carry the point by ` +
    `wrapping them in double asterisks, e.g. **pause at the top** -- ` +
    `the important words should be findable at a glance.\n` +
    `- Never write paragraphs. Never restate the question. Never pad ` +
    `with encouragement filler; one short encouraging phrase at most.\n` +
    `- No jargon; if a technical term is unavoidable, explain it in ` +
    `plain words in the same line.\n` +
    `- Be direct, like a knowledgeable coach.\n` +
    `- You are not a doctor. For pain that sounds like an injury, ` +
    `suggest seeing a medical professional rather than guessing what's ` +
    `wrong.`
  );
}

export function buildWorkoutPrompt(context: Record<string, unknown>): string {
  let summary = clip(pyStrip(pyStr(context.workout_summary)), MAX_SUMMARY_CHARS);
  if (!summary) summary = "(No workouts logged yet.)";
  return (
    "You are the RepCheck Workout Chat, an assistant embedded directly " +
    "beneath a user's workout log. You can see ONLY the workout data " +
    "provided below -- a lean last-7-days overview, plus (for every " +
    "exercise they've ever logged) their most recent 4 sessions with " +
    "exact sets/weight/reps. You have no access to anything beyond " +
    "that, and no access to their nutrition, body weight, or profile.\n\n" +
    "You may only help with:\n" +
    "- Progressive overload: when asked about a specific exercise, " +
    "FIRST recite its logged history from the 'Exercise history' " +
    "section below EXACTLY as given (every session listed, with its " +
    "date, weight, and reps -- do not skip, round, or invent any " +
    "number). THEN, grounded in that exact trend, recommend a specific " +
    "starting weight for the next session and a specific increment " +
    '(e.g. "start at **35 kg**, add **1.25-2.5 kg** once you hit **10 ' +
    'reps** on all sets") -- never vague advice like "just add more ' +
    'weight over time."\n' +
    "- Tips on performing/technique for an exercise that appears in the " +
    "log below.\n" +
    "- Estimating rep max / one-rep max from the logged sets.\n" +
    "- General training questions clearly about their recent workouts " +
    "(rest times between sets, how many sets/reps to do next, whether " +
    "they're training an exercise/muscle often enough this week, etc).\n\n" +
    "If asked about anything else -- nutrition/diet, body weight, " +
    "medical or injury questions beyond suggesting a professional, or " +
    "any topic unrelated to their training -- say plainly that you can " +
    "only help with their logged workouts and steer back to that. If " +
    "they ask about an exercise that ISN'T in the exercise history " +
    "below, say you don't see it logged rather than guessing or " +
    "inventing numbers for it -- never fabricate a session that isn't " +
    "actually listed.\n\n" +
    `The user's logged workout data:\n${summary}\n\n` +
    "Rules for how you write (strict -- the reply renders in a small " +
    "chat bubble under the workout list, so brevity is a hard " +
    "requirement):\n" +
    "- Keep every answer SHORT and precise. Hard cap: 100 words total " +
    "(raised slightly from a plain Q&A chat's usual cap since reciting " +
    "exact logged sessions before giving advice takes a bit more room).\n" +
    '- Default format: short bullet points, each starting with "- ", ' +
    "one line each. A one-line intro sentence is fine if it helps set " +
    "up the answer.\n" +
    "- If the whole answer fits in one short sentence, give just that " +
    "sentence instead of bullets.\n" +
    "- Bold the important numbers/keywords by wrapping them in double " +
    "asterisks, e.g. **32 kg**, **progressive overload**.\n" +
    "- No jargon; if a technical term is unavoidable, explain it in " +
    "plain words in the same line.\n" +
    "- Be direct and encouraging, like a knowledgeable coach, not a " +
    "textbook.\n" +
    "- You are not a doctor. For pain that sounds like an injury, " +
    "suggest seeing a medical professional rather than guessing what's " +
    "wrong."
  );
}

// ---- asking the model ---------------------------------------------------------------------------------------------------

const FALLBACKS: Record<ChatKind, string> = {
  coach: "The AI coach isn't reachable right now (no Gemini connection). Please try again in a moment.",
  analysis: "The analysis assistant isn't reachable right now (no Gemini connection). Please try again in a moment.",
  workout: "The workout chat isn't reachable right now (no Gemini connection). Please try again in a moment.",
};
export const fallbackReply = (kind: ChatKind): string => FALLBACKS[kind];
export const EMPTY_REPLY = "Sorry, I couldn't come up with a reply there — could you try asking that again?";

export interface ChatResult {
  reply: string;
  sources: PublicSource[];
  /** The model could not be reached: not a use of the person's budget. */
  failed: boolean;
}

export async function askChat(
  gemini: Gemini,
  kind: ChatKind,
  message: string,
  history: readonly HistoryTurn[],
  context: Record<string, unknown>,
): Promise<ChatResult> {
  const unreachable: ChatResult = { reply: fallbackReply(kind), sources: [], failed: true };
  if (!gemini.configured) return unreachable;
  const modelRole = kind === "coach" ? "coach" : "assistant";
  const contents: Turn[] = [];
  for (const turn of history.slice(-HISTORY_TURNS_SENT)) {
    const text = pyStrip(turn.text);
    if (text) contents.push({ role: turn.role === modelRole ? "model" : "user", text });
  }
  contents.push({ role: "user", text: message });
  const base = kind === "coach" ? COACH_SYSTEM_PROMPT : kind === "analysis" ? buildAnalysisPrompt(context) : buildWorkoutPrompt(context);
  let raw: string | null;
  try {
    raw = await gemini.generate({ system: base + promptInstruction(), contents, safe: true });
  } catch {
    return unreachable;
  }
  const [text, sources] = attachSources(pyStrip(raw ?? ""), message);
  return text ? { reply: text, sources, failed: false } : { reply: EMPTY_REPLY, sources: [], failed: false };
}
