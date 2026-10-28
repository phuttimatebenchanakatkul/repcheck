/** The three AI chats. They share one per-account daily budget ('ai_chat'). See _shared/chats.ts for the input rules. */
import type { Context, Router } from "../../_shared/app.ts";
import { getProfile } from "../../_shared/accounts.ts";
import { askChat, ChatRejected, type ChatKind, cleanRequest, limitedReply } from "../../_shared/chats.ts";
import { hasConsent, refusal } from "../../_shared/consent.ts";
import { fail, json, jsonBody } from "../../_shared/http.ts";
import { release, reserveUse, track } from "../../_shared/limits.ts";

const FEATURE = "ai_chat";

async function chat(ctx: Context, kind: ChatKind, usageEvent: string): Promise<Response> {
  const { services, identity } = ctx;
  const profile = await services.db.transaction((tx) => getProfile(tx, identity.id));
  if (!profile) return fail("No profile yet. Create it first.", 404);
  if (!hasConsent(profile)) return refusal();
  let cleaned: ReturnType<typeof cleanRequest>;
  try {
    cleaned = cleanRequest(await jsonBody(ctx.request), kind !== "coach");
  } catch (e) {
    if (e instanceof ChatRejected) return fail(e.message, 400);
    throw e;
  }
  const [message, history, context] = cleaned;

  const reservation = await reserveUse(services.db, services.settings, identity, FEATURE);
  if (!reservation.allowed) return json(limitedReply(reservation.retryAfter)); // a normal-looking reply, not an error
  let result;
  try {
    result = await askChat(services.gemini, kind, message, history, context);
  } catch (e) {
    await release(services.db, identity.id, FEATURE, reservation);
    throw e;
  }
  if (result.failed) await release(services.db, identity.id, FEATURE, reservation); // the model was unreachable: not a use
  else await track(services.db, identity.id, usageEvent);
  return json({ ok: true, reply: result.reply, sources: result.sources, limited: false, retry_after_seconds: 0 });
}

export function register(router: Router): void {
  router.post("/api/coach-chat", (ctx) => chat(ctx, "coach", "coach_chat_message"));
  router.post("/api/analyze-chat", (ctx) => chat(ctx, "analysis", "analyze_chat_message"));
  router.post("/api/workout-chat", (ctx) => chat(ctx, "workout", "workout_chat_message"));
}
