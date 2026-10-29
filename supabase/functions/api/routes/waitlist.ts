/** The pre-launch waitlist the marketing site posts to. The one route that needs no sign-in and the one that answers a cross-origin request, so
 *  it answers only the marketing site's own hostnames, echoed one at a time (a wildcard would let any page on the internet submit through it). */
import type { Router } from "../../_shared/app.ts";
import * as admin from "../../_shared/admin.ts";
import { cleanEmail } from "../../_shared/email.ts";
import { json, jsonBody } from "../../_shared/http.ts";
import { callerAddress } from "./legacy.ts";

function cors(request: Request, response: Response): Response {
  const origin = request.headers.get("Origin") ?? "";
  if (admin.WAITLIST_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin"); // the allowed origin varies by request, so a cache must not mix them up
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type");
    response.headers.set("Access-Control-Max-Age", "86400");
  }
  return response;
}

export function register(router: Router): void {
  router.add("OPTIONS", "/api/waitlist", ({ request }) => cors(request, new Response(null, { status: 204 })), { auth: false });

  router.post("/api/waitlist", async ({ request, services }) => {
    const payload = await jsonBody(request);
    const email = cleanEmail(payload.email);
    if (email === null) return cors(request, json({ error: "invalid-email" }, 400));
    const source = admin.cleanSource(payload.source);
    // The caller's address as the platform's proxy saw it (see callerAddress): never the first X-Forwarded-For entry, which the caller writes.
    const key = "waitlist:" + [...(callerAddress(request) || "unknown")].slice(0, 64).join("");
    const outcome = await services.db.transaction(async (tx) => {
      const [allowed, retry] = await admin.takeAttempt(tx, key, Math.floor(Date.now() / 1000));
      return allowed ? { added: await admin.addWaitlistEmail(tx, email, source) } : { retry };
    });
    if ("retry" in outcome) return cors(request, json({ error: "rate-limited", retry_after_seconds: outcome.retry }, 429));
    // "already" is reported but is not shown differently and does not change the status: a route that answered differently for a known
    // address would let anyone test whether a given person had signed up.
    return cors(request, json({ ok: true, already: !outcome.added }));
  }, { auth: false });
}
