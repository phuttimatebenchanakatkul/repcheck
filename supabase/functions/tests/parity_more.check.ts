/** Answers batches of inputs with the Edge Function code, for tests/test_edge_functions.py to compare with the Python's.
 *  `deno run --allow-read parity_more.check.ts <input.json>` where the JSON is {hashes: [[stored, password]], emails: [raw], images: [base64]}.
 */
import { checkPasswordHash } from "../_shared/passwordHash.ts";
import { cleanEmail } from "../_shared/email.ts";
import { inspectImage, PhotoRejected } from "../_shared/photos.ts";

const input = JSON.parse(Deno.readTextFileSync(Deno.args[0]));

const hashes = (input.hashes ?? []).map(([stored, password]: [string, string]) => checkPasswordHash(stored, password));
const emails = (input.emails ?? []).map((raw: unknown) => cleanEmail(raw));
const images = (input.images ?? []).map((b64: string) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  try {
    return inspectImage(bytes);
  } catch (e) {
    if (!(e instanceof PhotoRejected)) throw e;
    return `ERR:${e.status}:${e.message}`;
  }
});

console.log(JSON.stringify({ hashes, emails, images }));
