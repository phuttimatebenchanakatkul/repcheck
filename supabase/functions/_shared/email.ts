/** An email address as the website's waitlist and sign-in treat it: trimmed, lower-cased, and one `@` with a dot after it. */
import { PY_SPACE, pyStrip } from "./nameFilter.ts";

export const MAX_EMAIL = 254;
// Python's \s (what the website's pattern means by it), not JavaScript's: they disagree about U+001C-001F, U+0085 and U+FEFF.
const EMAIL = new RegExp(`^[^${PY_SPACE}@]+@[^${PY_SPACE}@]+\\.[^${PY_SPACE}@]+$`);

/** The address lower-cased and trimmed, or null for anything that is not one. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = pyStrip(raw).toLowerCase();
  if ([...email].length > MAX_EMAIL || [...email].some((c) => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127) || !EMAIL.test(email)) return null;
  return email;
}
