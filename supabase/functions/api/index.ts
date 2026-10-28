/** The native app's API as a Supabase Edge Function.
 *
 * Deploy with `supabase functions deploy api --no-verify-jwt --project-ref <ref>`: the platform's own JWT check is for
 * the legacy HS256 secret, and this function verifies the project's ES256 token itself (see _shared/auth.ts).
 */
import { createHandler } from "../_shared/app.ts";
import { Verifier } from "../_shared/auth.ts";
import { connect } from "../_shared/db.ts";
import { fromEnv } from "../_shared/settings.ts";
import { buildRouter } from "./router.ts";

const settings = fromEnv();
const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("missing SUPABASE_DB_URL");

Deno.serve(createHandler({ settings, db: connect(dbUrl), verifier: new Verifier(settings) }, buildRouter()));
