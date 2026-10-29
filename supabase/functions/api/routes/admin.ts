/** The owner's endpoints. Every one answers 404 to anyone who is not in ADMIN_EMAILS (the address comes from the verified token). */
import type { Handler, Router } from "../../_shared/app.ts";
import * as admin from "../../_shared/admin.ts";
import { fail, json, jsonBody } from "../../_shared/http.ts";
import { parseUserId } from "../../_shared/social.ts";

const adminOnly = (handler: Handler): Handler => (ctx) => admin.isAdmin(ctx.services.settings, ctx.identity) ? handler(ctx) : fail("Not found.", 404);

export function register(router: Router): void {
  router.get("/api/admin/reports", adminOnly(async ({ services }) =>
    json({ ok: true, ...await services.db.transaction(async (tx) => ({ reports: await admin.openReports(tx), ai_reports: await admin.openAiReports(tx) })) })));

  router.post("/api/admin/reports/<int:report_id>/reset-name", adminOnly(async ({ services, params }) => {
    const account = await services.db.transaction((tx) => admin.resetReportedName(tx, Number(params.report_id)));
    return account === null ? fail("Report not found.", 404) : json({ ok: true, reset: account });
  }));

  router.post("/api/admin/reports/<int:report_id>/handled", adminOnly(async ({ services, params }) =>
    json({ ok: true, changed: await services.db.transaction((tx) => admin.markReportHandled(tx, Number(params.report_id))) })));

  router.post("/api/admin/ai-reports/<int:report_id>/handled", adminOnly(async ({ services, params }) =>
    json({ ok: true, changed: await services.db.transaction((tx) => admin.markAiReportHandled(tx, Number(params.report_id))) })));

  router.get("/api/admin/waitlist", adminOnly(async ({ request, services }) => {
    const entries = await services.db.transaction((tx) => admin.waitlistEntries(tx));
    if (new URL(request.url).searchParams.get("format") === "csv") {
      return new Response(admin.waitlistCsv(entries), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="repcheck_waitlist.csv"', "Cache-Control": "no-store" },
      });
    }
    return json({ ok: true, total: entries.length, entries });
  }));

  router.post("/api/admin/waitlist/delete", adminOnly(async ({ request, services }) => {
    const payload = await jsonBody(request);
    return json({ ok: true, removed: await services.db.transaction((tx) => admin.deleteWaitlistEmail(tx, payload.email)) });
  }));

  router.get("/api/admin/users", adminOnly(async ({ request, services }) => {
    const asked = new URL(request.url).searchParams.get("range") ?? "today";
    const range = (admin.RANGES as readonly string[]).includes(asked) ? asked : "today";
    const users = await services.db.transaction((tx) => admin.listUsers(tx, admin.signupCutoff(range)));
    return json({ ok: true, range, users });
  }));

  router.get("/api/admin/users/<user_id>", adminOnly(async ({ services, params }) => {
    const target = parseUserId(params.user_id);
    const detail = target ? await services.db.transaction((tx) => admin.userDetail(tx, target)) : null;
    return detail ? json({ ok: true, user: detail }) : fail("Not found.", 404);
  }));
}
