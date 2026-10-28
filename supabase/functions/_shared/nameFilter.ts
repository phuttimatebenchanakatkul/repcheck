/** Blocks obviously inappropriate display names, checked wherever a person sets the name other people see.
 *
 * A port of name_filter.py: whole word-tokens against a curated list, after undoing common obfuscation (accents, leetspeak,
 * stretched letters, punctuation as spacers). Not a claim of perfect coverage. The word list and the table of combining
 * characters are GENERATED from the Python (scripts/gen_edge_name_filter.py) so the two cannot drift.
 */
import { BAD_WORDS, COMBINING } from "./nameFilterData.ts";

const BAD = new Set(BAD_WORDS);

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "+": "t", "8": "b", "9": "g",
};

/** Python's `unicodedata.combining(ch) != 0`: a binary search over the generated ranges. */
export function isCombining(cp: number): boolean {
  let lo = 0;
  let hi = COMBINING.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = COMBINING[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

function tokens(name: string): string[] {
  // Strip accents first, so "fück" is "fuck"; then map lookalikes BEFORE splitting, so the 1 in "n1gger" is still part of its word.
  const stripped = [...name.normalize("NFKD")].filter((ch) => !isCombining(ch.codePointAt(0)!)).join("");
  const leeted = [...stripped.toLowerCase()].map((ch) => LEET[ch] ?? ch).join("");
  // Runs of three or more of one letter collapse to one: "fuuuuck" -> "fuck".
  return leeted.split(/[^a-zA-Z]+/).filter(Boolean).map((t) => t.replace(/(.)\1{2,}/g, "$1"));
}

/** True if any word in `name` is on the list, or if all its letters run together (spaces and punctuation removed) are:
 *  that catches "f u c k" and "f.u.c.k" without a loose substring search that would flag "classic". */
export function containsBadWord(name: string): boolean {
  const words = tokens(name);
  return words.some((w) => BAD.has(w)) || BAD.has(words.join(""));
}

/** Python's str.strip(): its whitespace set, not JavaScript's (JS trims U+FEFF, Python does not; Python trims U+001C-001F and U+0085, JS does not). */
export const PY_SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");
export const pyStrip = (s: string): string => s.replace(STRIP, "");
const RSTRIP = new RegExp(`[${PY_SPACE}]+$`);
/** Python's str.rstrip(). */
export const pyRstrip = (s: string): string => s.replace(RSTRIP, "");

/** An error string if `name` isn't acceptable as a display name shown to other people, else null. */
export function validateDisplayName(name: string | null | undefined): string | null {
  const trimmed = pyStrip(name ?? "");
  if (!trimmed) return "Please enter your name.";
  if (containsBadWord(trimmed)) return "That name isn't allowed. Please choose a different one.";
  return null;
}
