/** One function per kind of case in the owner's-side golden file (scripts/edge_golden.py): used by golden_admin.test.ts against the Python's
 *  answers and by parity_more.check.ts, which runs the same inputs through both languages side by side. */
import { cleanSource, signupCutoff, spreadsheetSafe, usageSplit, waitlistCsv } from "../_shared/admin.ts";

// deno-lint-ignore no-explicit-any
export const ADMIN_RUNNERS: Record<string, (input: any) => unknown> = {
  sources: (v: unknown) => cleanSource(v),
  safe: (v: unknown) => spreadsheetSafe(v),
  csv: (entries: Parameters<typeof waitlistCsv>[0]) => waitlistCsv(entries),
  cutoffs: ([range, now]: [string, string]) => signupCutoff(range, new Date(now))?.getTime() ?? null,
  usage: (events: Parameters<typeof usageSplit>[0]) => usageSplit(events),
};
