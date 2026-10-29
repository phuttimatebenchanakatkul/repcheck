/** The native app's API as a Supabase Edge Function.
 *
 * Deploy with `supabase functions deploy api --no-verify-jwt --project-ref <ref>`: the platform's own JWT check is for
 * the legacy HS256 secret, and this function verifies the project's ES256 token itself (see _shared/auth.ts).
 */
import { createHandler } from "../_shared/app.ts";
import { Verifier } from "../_shared/auth.ts";
import { connect } from "../_shared/db.ts";
import { FoodLookup } from "../_shared/foodLookup.ts";
import { fromEnv } from "../_shared/settings.ts";
import { GeminiClient } from "../_shared/gemini.ts";
import { AuthAdmin, Storage } from "../_shared/supabaseAdmin.ts";
import { buildRouter } from "./router.ts";

const settings = fromEnv();
const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("missing SUPABASE_DB_URL");

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!serviceKey) throw new Error("missing SUPABASE_SERVICE_ROLE_KEY");

// deno-lint-ignore no-explicit-any
const runtime = (globalThis as any).EdgeRuntime as { waitUntil(work: Promise<unknown>): void } | undefined;

Deno.serve(createHandler({
  settings,
  db: connect(dbUrl),
  verifier: new Verifier(settings),
  storage: new Storage(settings.supabaseUrl, serviceKey),
  authAdmin: new AuthAdmin(settings.supabaseUrl, serviceKey),
  gemini: new GeminiClient(Deno.env.get("GEMINI_API_KEY"), undefined, undefined, Deno.env.get("GEMINI_MODEL") || undefined),
  food: new FoodLookup((...a) => fetch(...a), settings.fatsecret),
  background: (work) => runtime?.waitUntil(work),
  sweep: true,
}, buildRouter()));
