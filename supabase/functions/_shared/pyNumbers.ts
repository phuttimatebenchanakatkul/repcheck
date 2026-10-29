/** Numbers the way Python reads and rounds them, for the places where the Flask version's results must be reproduced exactly:
 *  round() goes to the nearest EVEN number on a tie (2.5 is 2, 3.5 is 4), JavaScript's Math.round() goes up; float() and
 *  int() accept some spellings and refuse others. */
import { pyStrip } from "./nameFilter.ts";

/** Python's truth value of a JSON value: null, false, 0, "", [] and {} are false; everything else is true. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** Python's round(x) with no digits: the nearest integer, a tie going to the even one. */
export function pyRound(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2); // an exact tie: the even neighbour
  return Math.round(x);
}

/** Python's round(x, digits): correctly rounded from the number's exact value, a tie (only possible for numbers like 0.125, which are
 *  exact in binary) going to the even digit. */
export function pyRoundDigits(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const exact = Math.abs(x).toFixed(60); // JavaScript prints the exact decimal expansion of a double when asked for enough digits
  const dot = exact.indexOf(".");
  const tail = exact.slice(dot + 1 + digits); // everything after the last decimal place that is kept
  const kept = exact.slice(0, dot + 1 + digits);
  const step = Number(`1e-${digits}`);
  const bump = () => Number((Number(kept) + step).toFixed(digits));
  const isTie = tail[0] === "5" && /^50*$/.test(tail);
  let n = Number(kept);
  if (isTie) {
    if (Number(kept[kept.length - 1]) % 2 === 1) n = bump(); // odd: round up to the even one
  } else if (tail[0] >= "5") {
    n = bump();
  }
  return x < 0 ? -n : n;
}

/** Python's round(x, 2). */
export const pyRound2 = (x: number): number => pyRoundDigits(x, 2);

/** A JSON value read by Python's float(): a number, a boolean (True is 1.0), or text like " 3600.5 ", "1e3" or "3_600". NaN otherwise. */
export function pyFloat(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return Number(value);
  if (typeof value !== "string") return NaN;
  const text = asciiDigits(pyStrip(value));
  // digits may be grouped with single underscores ("3_600"), as Python allows; nothing else (no "0x10", no "inf") is a number here
  const digits = "[0-9](?:_?[0-9])*";
  return new RegExp(`^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`).test(text) ? Number(text.replaceAll("_", "")) : NaN;
}

/** A JSON value read by Python's int(): a number (cut toward zero), a boolean, or whole-number text. NaN when Python would raise. */
export function pyInt(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : NaN;
  if (typeof value === "boolean") return Number(value);
  if (typeof value !== "string") return NaN;
  const text = asciiDigits(pyStrip(value));
  return /^[+-]?[0-9](?:_?[0-9])*$/.test(text) ? Number(text.replaceAll("_", "")) : NaN;
}

/** Python reads the decimal digits of any script ("٣٠" is 30): this turns them into 0-9 first. A run of ten digits in a block is
 *  always 0 to 9 in order, so a digit's value is its distance from the start of its run, modulo ten. */
export function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (ch) => {
    let start = ch.codePointAt(0)!;
    const here = start;
    while (/^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
    return String((here - start) % 10);
  });
}
