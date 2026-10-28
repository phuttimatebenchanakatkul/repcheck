import type { Router } from "../../_shared/app.ts";
import { setConsent } from "../../_shared/consent.ts";
import { fail, json, jsonBody } from "../../_shared/http.ts";
import { trackUsage } from "../../_shared/limits.ts";

export function register(router: Router): void {
  /** Record or withdraw consent to AI processing. Only a JSON `true` grants; anything else withdraws. */
  router.post("/api/ai-consent", async ({ request, services, identity }) => {
    const granted = (await jsonBody(request)).granted === true;
    const found = await services.db.transaction(async (tx) => {
      const exists = await setConsent(tx, identity.id, granted);
      if (exists) await trackUsage(tx, identity.id, "feature:" + (granted ? "ai_consent_granted" : "ai_consent_withdrawn"));
      return exists;
    });
    if (!found) return fail("No profile yet. Create it first.", 404);
    return json({ ok: true, granted });
  });
}
