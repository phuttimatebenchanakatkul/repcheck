/** A multipart/form-data body read in place.
 *
 * `Request.formData()` copies a body several times over, which a function with 256 MB of memory cannot afford for a video of tens of
 * megabytes. This finds the parts inside the one buffer the body was read into and hands them out as views of it: no copy at all.
 * Only what an upload form needs: named fields and files, in any order (tests/multipart.test.ts checks it against the platform's own parser).
 */
export interface Part {
  name: string;
  /** Present for a file. */
  filename?: string;
  contentType?: string;
  /** A view into the request body, not a copy. */
  data: Uint8Array;
}

const CRLF = [13, 10];
const utf8 = new TextDecoder("utf-8");

function boundaryOf(contentType: string): string | null {
  const m = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2]) : null;
}

/** Where `needle` first occurs in `haystack` at or after `from`, or -1. */
function find(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0];
  const last = haystack.length - needle.length;
  for (let at = haystack.indexOf(first, from); at !== -1 && at <= last; at = haystack.indexOf(first, at + 1)) {
    let k = 1;
    while (k < needle.length && haystack[at + k] === needle[k]) k++;
    if (k === needle.length) return at;
  }
  return -1;
}

/** Parse "Content-Disposition: form-data; name=...; filename=..." (and the part's Content-Type). Browsers write `"` inside a name as %22. */
function readHead(head: string): { name: string; filename?: string; contentType?: string } | null {
  let name: string | null = null;
  let filename: string | undefined;
  let contentType: string | undefined;
  for (const line of head.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "content-type") contentType = value;
    if (key !== "content-disposition") continue;
    const param = (p: string) => {
      // as the HTML spec writes it: a quote inside a name is %22 and a backslash is just a backslash
      const m = new RegExp(`(?:^|;)\\s*${p}=(?:"([^"]*)"|([^;]*))`, "i").exec(value);
      return m ? (m[1] !== undefined ? m[1] : m[2].trim()) : undefined;
    };
    name = param("name") ?? null;
    filename = param("filename");
  }
  return name === null ? null : { name, filename, contentType };
}

/** The parts of a body, or an empty list when it is not multipart at all. */
export function parseMultipart(body: Uint8Array, contentType: string): Part[] {
  const boundary = boundaryOf(contentType);
  if (!boundary) return [];
  const enc = new TextEncoder();
  const opening = enc.encode(`--${boundary}`);
  const between = enc.encode(`\r\n--${boundary}`);
  const head = enc.encode("\r\n\r\n");
  const parts: Part[] = [];
  // the first delimiter sits at the very start, or after a preamble
  let at = find(body, opening, 0);
  while (at !== -1) {
    at += opening.length;
    if (body[at] === 45 && body[at + 1] === 45) break; // "--" after a delimiter closes the body
    if (body[at] !== CRLF[0] || body[at + 1] !== CRLF[1]) {
      // trailing whitespace after the boundary is allowed; anything else is not a delimiter
      let w = at;
      while (body[w] === 32 || body[w] === 9) w++;
      if (body[w] !== CRLF[0] || body[w + 1] !== CRLF[1]) break;
      at = w;
    }
    const start = at + 2;
    const blank = body[start] === CRLF[0] && body[start + 1] === CRLF[1]; // a part with no headers begins with a bare CRLF
    const headEnd = blank ? start : find(body, head, start);
    if (headEnd === -1) break;
    const dataStart = blank ? start + 2 : headEnd + 4;
    const end = find(body, between, dataStart);
    if (end === -1) break;
    const info = readHead(blank ? "" : utf8.decode(body.subarray(start, headEnd)));
    if (info) parts.push({ name: info.name, filename: info.filename, contentType: info.contentType, data: body.subarray(dataStart, end) });
    at = end + 2; // onto the next "--boundary"
  }
  return parts;
}

/** The first field with this name. */
export const partNamed = (parts: readonly Part[], name: string): Part | undefined => parts.find((p) => p.name === name);

/** A text field's value (UTF-8), or null when it is absent or is a file. */
export function textOf(part: Part | undefined): string | null {
  return part && part.filename === undefined ? utf8.decode(part.data) : null;
}
