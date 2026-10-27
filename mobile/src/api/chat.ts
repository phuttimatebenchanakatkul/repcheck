/** The chat routes (api/routes/chat.py) and the Report button's route (api/routes/social.py). */
import { parseChatReply, type ChatReply, type ReportFeature, type ReportReason } from '../logic/chat';
import { ApiError, type Api } from './client';

/** A reply is a model call; the default 30 s is too short for a busy one. */
export const CHAT_TIMEOUT_MS = 90_000;

type History = { role: string; text: string }[];

export function chatEndpoints(api: Api) {
  async function ask(path: string, payload: Record<string, unknown>): Promise<ChatReply> {
    const body = await api.request(path, { method: 'POST', json: payload, timeoutMs: CHAT_TIMEOUT_MS });
    const reply = parseChatReply(body);
    if (!reply) throw new ApiError("Couldn't read that reply. Please try again.", 502, body);
    return reply;
  }

  return {
    /**
     * Ask the coach. Throws ApiError: 403 `needsAiConsent`, 400 for a message or history the server refuses (the text is safe to
     * show). Over the daily budget is NOT an error: it is a reply with `limited` set and the wait in `retryAfterSeconds`.
     */
    coachChat: (message: string, history: History) => ask('/api/coach-chat', { message, history }),

    /** Ask about one analysis. `context` is the analysis the question is about (its scores and report). */
    analysisChat: (message: string, history: History, context: Record<string, unknown>) => ask('/api/analyze-chat', { message, history, context }),

    /** Ask about the person's logged workouts. */
    workoutChat: (message: string, history: History, context: Record<string, unknown>) => ask('/api/workout-chat', { message, history, context }),

    /** Report one AI reply for review (Guideline 4.7.1). The same text reported twice before review is one report; 429 when too many wait. */
    async reportReply(feature: ReportFeature, reason: ReportReason, reply: string): Promise<void> {
      await api.post('/api/ai-report', { feature, reason, reply });
    },
  };
}
