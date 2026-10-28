import type { Router } from "../../_shared/app.ts";
import { fail, json } from "../../_shared/http.ts";

export function register(router: Router): void {
  /** For the app to tell 'server down' from 'signed out'. Public, answers nothing about the project beyond whether
   *  the database answers. */
  router.get("/api/health", async ({ services }) => {
    try {
      await services.db.transaction((tx) => tx.one("select 1"));
    } catch {
      return fail("Database unavailable.", 503);
    }
    return json({ ok: true });
  }, { auth: false });
}
