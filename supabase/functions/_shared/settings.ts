/** Where the API finds its Supabase project. Supabase hands every function SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 *  SUPABASE_DB_URL itself; the rest are secrets set with `supabase secrets set`. */

export interface Settings {
  supabaseUrl: string;
  /** The audience a signed-in person's token must carry. */
  jwtAudience: string;
  /** Lower-cased addresses the AI usage limits do not apply to: the owner, and App Review's demo account. Empty unless set. */
  rateLimitExempt: ReadonlySet<string>;
  /** Lower-cased addresses of the owner(s) who may use the admin routes. ADMIN_EMAILS only: the review account must never be one. */
  adminEmails: ReadonlySet<string>;
  /** FatSecret's keys, the second barcode source (Thai and other products Open Food Facts lacks); null unless both are set. */
  fatsecret: { clientId: string; clientSecret: string; region: string } | null;
}

export class SettingsError extends Error {}

const list = (value: string | undefined): string[] =>
  (value ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

function fatsecret(get: (name: string) => string | undefined): Settings["fatsecret"] {
  const clientId = (get("FATSECRET_CLIENT_ID") ?? "").trim();
  const clientSecret = (get("FATSECRET_CLIENT_SECRET") ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, region: (get("FATSECRET_REGION") ?? "").trim() || "TH" };
}

/** Settings from `get` (the environment). Fails early with the NAME of what is wrong, never its value. */
export function fromEnv(get: (name: string) => string | undefined = (n) => Deno.env.get(n)): Settings {
  const url = (get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  if (!url) throw new SettingsError("missing SUPABASE_URL");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (!url.startsWith("https://") || !host) throw new SettingsError("SUPABASE_URL must be the project's https:// address");
  return {
    supabaseUrl: url,
    jwtAudience: "authenticated",
    rateLimitExempt: new Set([...list(get("ADMIN_EMAILS")), ...list(get("REVIEW_ACCOUNT_EMAILS"))]),
    adminEmails: new Set(list(get("ADMIN_EMAILS"))),
    fatsecret: fatsecret(get),
  };
}

export const issuer = (s: Settings) => `${s.supabaseUrl}/auth/v1`;
export const jwksUrl = (s: Settings) => `${issuer(s)}/.well-known/jwks.json`;
