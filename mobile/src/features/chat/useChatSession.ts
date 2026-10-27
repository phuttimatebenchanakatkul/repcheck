import { useCallback, useEffect, useState } from 'react';

import { ApiError, getApi } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { MAX_MESSAGE_CHARS, type ChatReply, type ChatTurn } from '@/logic/chat';
import { toIsoDate } from '@/logic/dates';
import { newId } from '@/logic/ids';
import { success } from '@/ui/haptics';

export interface ChatSessionOptions {
  /** The saved thread, oldest first. */
  turns: readonly ChatTurn[];
  /** Saves one turn to the thread (queued, so it survives no signal). */
  save: (turn: ChatTurn) => Promise<void>;
  /** Asks the server. `history` is the saved thread BEFORE this message: the server adds the message itself. */
  ask: (message: string, history: readonly ChatTurn[]) => Promise<ChatReply>;
  /** Called after an answer was kept (the coach counts toward the streak). */
  onAnswered?: () => void;
  /** The text shown when the server could not be reached. */
  errorText: string;
}

export interface ChatSession {
  draft: string;
  setDraft: (text: string) => void;
  /** The question being answered right now, shown at once; it is kept with the thread only once it has an answer. */
  pending: ChatTurn | null;
  sending: boolean;
  /** Something the app (not the AI) is saying: a failure, or the limit notice. Never saved, never sent back as history. */
  notice: string | null;
  /** Seconds left of the daily limit, or null when not limited. */
  lockSeconds: number | null;
  /** The question waiting for the person to allow AI features. */
  askingConsent: boolean;
  send: (text?: string) => Promise<void>;
  allow: () => Promise<void>;
  declineConsent: () => void;
}

const TICK_MS = 30_000;

/**
 * Sending a question and keeping the answer, for all three chats. A question is shown the moment it is sent but only SAVED with its
 * answer: one that fails (no signal, an error, the daily limit, no consent yet) is handed back to the text box instead of being left in
 * the thread unanswered. The consent question comes first, before anything is sent. The website saved the question before asking and
 * also sent it twice (inside `history` and as `message`); here history is what came before.
 */
export function useChatSession(options: ChatSessionOptions): ChatSession {
  const { t } = useTranslation();
  const { state, refreshProfile } = useAuth();
  const consented = state.status === 'ready' && state.profile.ai_consent;
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<ChatTurn | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [, setClock] = useState(0);
  const [waitingForConsent, setWaitingForConsent] = useState<string | null>(null);
  const { turns, save, ask, onAnswered, errorText } = options;

  // The limit lockout: shown as a countdown, refreshed every 30 s as on the website, and lifted by itself at the end.
  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = setInterval(() => setClock((n) => n + 1), TICK_MS);
    const lift = setTimeout(() => setLockedUntil(null), Math.max(0, lockedUntil - new Date().getTime()));
    return () => {
      clearInterval(timer);
      clearTimeout(lift);
    };
  }, [lockedUntil]);
  // The tick above only re-renders; the time is read here, so the countdown is right even after a long wait in the background.
  const lockSeconds = lockedUntil === null ? null : Math.max(0, Math.ceil((lockedUntil - new Date().getTime()) / 1000));

  const run = useCallback(
    async (message: string) => {
      const today = toIsoDate(new Date());
      const question: ChatTurn = { id: newId(), role: 'user', text: message, sources: null, date: today };
      setNotice(null);
      setPending(question);
      setDraft('');
      try {
        const reply = await ask(message, turns);
        if (reply.limited) {
          setDraft(message);
          setNotice(reply.reply);
          setLockedUntil(new Date().getTime() + reply.retryAfterSeconds * 1000);
          return;
        }
        await save(question);
        await save({ id: newId(), role: 'assistant', text: reply.reply, sources: reply.sources, date: today });
        success();
        onAnswered?.();
      } catch (error) {
        if (error instanceof ApiError && error.needsAiConsent) {
          setWaitingForConsent(message);
          return;
        }
        setDraft(message);
        setNotice(error instanceof ApiError && error.status !== 0 && error.status < 500 ? error.message : errorText);
      } finally {
        setPending(null);
      }
    },
    [ask, errorText, onAnswered, save, turns],
  );

  const send = useCallback(
    async (text?: string) => {
      const message = (text ?? draft).trim().slice(0, MAX_MESSAGE_CHARS);
      if (!message || pending || lockedUntil !== null || waitingForConsent !== null) return;
      // The question comes first, before anything leaves the phone.
      if (!consented) {
        setWaitingForConsent(message);
        return;
      }
      await run(message);
    },
    [consented, draft, lockedUntil, pending, run, waitingForConsent],
  );

  const allow = useCallback(async () => {
    const message = waitingForConsent;
    if (message === null) return;
    try {
      await getApi().setAiConsent(true);
      await refreshProfile();
    } catch (error) {
      setWaitingForConsent(null);
      setDraft(message);
      setNotice(error instanceof ApiError ? error.message : t('app.analyze.failed'));
      return;
    }
    setWaitingForConsent(null);
    await run(message);
  }, [refreshProfile, run, t, waitingForConsent]);

  const declineConsent = useCallback(() => {
    if (waitingForConsent !== null) setDraft(waitingForConsent);
    setWaitingForConsent(null);
  }, [waitingForConsent]);

  return { draft, setDraft, pending, sending: pending !== null, notice, lockSeconds, askingConsent: waitingForConsent !== null, send, allow, declineConsent };
}
