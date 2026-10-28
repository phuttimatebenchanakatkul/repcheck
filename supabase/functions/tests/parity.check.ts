/** Answers a list of names with the Edge Function's filter, for tests/test_edge_functions.py to compare with Python's.
 *  `deno run --allow-read parity.check.ts <names.json>` prints a JSON array of [containsBadWord, validateDisplayName, cleanName-or-"ERR:message"].
 */
import { cleanName, NameRejected } from "../_shared/accounts.ts";
import { containsBadWord, validateDisplayName } from "../_shared/nameFilter.ts";

const names: string[] = JSON.parse(Deno.readTextFileSync(Deno.args[0]));
const out = names.map((name) => {
  let cleaned: string;
  try {
    cleaned = cleanName(name);
  } catch (e) {
    if (!(e instanceof NameRejected)) throw e;
    cleaned = "ERR:" + e.message;
  }
  return [containsBadWord(name), validateDisplayName(name), cleaned];
});
console.log(JSON.stringify(out));
