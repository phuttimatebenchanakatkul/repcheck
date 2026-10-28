/** Text the way Python writes it, for the places where the Flask version's output must be reproduced exactly (prompts sent to the model,
 *  numbers printed into them): str() of a JSON value, repr() of a float, format(x, ".1f"), and json.dumps() with its default separators. */

/** repr() of a float: "80.0" for a whole number, the shortest text that reads back the same, and an exponent from 1e16 (or below 1e-4) like "1e+16", "1.5e-05". */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (Object.is(x, -0)) return "-0.0";
  const abs = Math.abs(x);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e16)) {
    const [mantissa, exponent] = x.toExponential().split("e");
    return `${mantissa}e${exponent[0]}${exponent.slice(1).padStart(2, "0")}`;
  }
  const text = String(x);
  return text.includes(".") ? text : `${text}.0`;
}

/** format(x, ".<digits>f"): correctly rounded from the number's exact value, a tie going to the even digit (JavaScript's toFixed takes the larger one). */
export function pyFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const abs = Math.abs(x);
  if (abs >= 1e21) throw new RangeError("pyFixed: too large");
  const exact = abs.toFixed(100); // JavaScript prints a double's exact decimal expansion when asked for enough digits
  const dot = exact.indexOf(".");
  const whole = exact.slice(0, dot);
  const fraction = exact.slice(dot + 1);
  const kept = fraction.slice(0, digits);
  const tail = fraction.slice(digits);
  const lastDigit = Number((whole + kept).slice(-1));
  const roundUp = tail[0] > "5" || (tail[0] === "5" && (/[1-9]/.test(tail.slice(1)) || lastDigit % 2 === 1));
  const scaled = (BigInt(whole + kept) + (roundUp ? 1n : 0n)).toString().padStart(digits + 1, "0");
  const text = digits > 0 ? `${scaled.slice(0, -digits)}.${scaled.slice(-digits)}` : scaled;
  return x < 0 || Object.is(x, -0) ? `-${text}` : text;
}

const reprString = (s: string): string => {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 32 || cp === 127) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out + quote;
};

function repr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return reprString(v);
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${reprString(k)}: ${repr(x)}`).join(", ")}}`;
}

/** str() of a JSON value: text as it is, True/False/None, a number, and a list or dict the way Python prints it. (JSON cannot tell 1.0 from 1; this prints 1.) */
export function pyStr(v: unknown): string {
  return typeof v === "string" ? v : repr(v);
}

const NOT_PRINTABLE_ASCII = new RegExp("[\\x7f-\\uffff]", "g");

/** json.dumps(value) with Python's defaults: ", " and ": " between items, every character outside printable ASCII (DEL too) as a \\uXXXX escape (a pair for one outside the BMP). */
export function pyDumps(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : pyFloatRepr(value);
  if (typeof value === "string") {
    return JSON.stringify(value).replace(NOT_PRINTABLE_ASCII, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  }
  if (Array.isArray(value)) return `[${value.map(pyDumps).join(", ")}]`;
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value as Record<string, unknown>);
  return `{${entries.map(([k, v]) => `${pyDumps(String(k))}: ${pyDumps(v)}`).join(", ")}}`;
}
