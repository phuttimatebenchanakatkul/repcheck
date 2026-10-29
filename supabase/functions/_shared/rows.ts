/** Small helpers every table-writing module shares: the per-person write lock and the "you have too many rows" message. */
import type { Tx } from "./db.ts";
import { pyStrip } from "./nameFilter.ts";
import { pyStr } from "./pyText.ts";

/** Serialise one person's writes of one kind (released at the end of the transaction, the only kind the pooler allows). */
export async function lock(tx: Tx, kind: string, userId: string): Promise<void> {
  await tx.exec("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [`${kind}:${userId}`]);
}

export const overLimitMessage = (limit: number): string => `You've reached the maximum of ${limit.toLocaleString("en-US")} saved items here. Delete some to add more.`;

/** SQL that writes a timestamptz column as UTC text with microseconds, for isoUtc() to finish (a driver's Date only has milliseconds). */
export const isoSql = (column: string): string => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/** Python's datetime.isoformat() for a UTC time written by isoSql(): the microseconds only when there are some, and +00:00. */
export const isoUtc = (text: string): string => `${text.endsWith(".000000") ? text.slice(0, -7) : text}+00:00`;

/** `value` as text with control characters removed, trimmed and clipped to `limit` characters. */
export function cleanText(value: unknown, limit: number): string {
  const text = value === null || value === undefined ? "" : pyStr(value); // str(): True, not true; a list as Python prints it
  const visible = [...text].filter((c) => c.codePointAt(0)! >= 32 && c.codePointAt(0) !== 127).join("");
  return [...pyStrip(visible)].slice(0, limit).join("");
}
