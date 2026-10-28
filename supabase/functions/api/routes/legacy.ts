/** The one door an imported account's old password comes through. Public (there is no session yet); see _shared/legacy.ts. */
import type { Router } from "../../_shared/app.ts";
import { fail, json, jsonBody } from "../../_shared/http.ts";
import { migrate, Outcome } from "../../_shared/legacy.ts";

const MISMATCH = "That email and password don't match.";

/** The address the request came from, as the platform's proxy saw it. The caller can write any `X-Forwarded-For` it likes,
 *  and a proxy ADDS its own entry to the end, so the last entry is the only one nobody but the proxy chose. */
export function callerAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded.split(",").map((e) => e.trim()).filter(Boolean);
    if (entries.length) return entries[entries.length - 1];
  }
  return request.headers.get("x-real-ip");
}

export function register(router: Router): void {
  router.post("/api/auth/legacy-login", async ({ request, services }) => {
    const body = await jsonBody(request);
    const [outcome, wait] = await migrate(
      services.db,
      services.authAdmin,
      body.email,
      body.password,
      callerAddress(request),
      Math.floor(Date.now() / 1000),
    );
    if (outcome === Outcome.MIGRATED) return json({ ok: true });
    if (outcome === Outcome.LIMITED) {
      return json({ ok: false, error: "Too many tries. Please wait a few minutes and try again." }, 429, { "Retry-After": String(wait) });
    }
    if (outcome === Outcome.RESET_REQUIRED) {
      return json({ ok: false, reset_required: true, error: "Your old password can't be carried over. Reset it with the link we'll email you." }, 409);
    }
    return fail(MISMATCH, 401);
  }, { auth: false });
}
