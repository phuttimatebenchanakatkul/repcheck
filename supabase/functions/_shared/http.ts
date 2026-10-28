/** Every route answers JSON, `{ok: true, ...}` or `{ok: false, error: "..."}`; nothing here renders a page. */

const HEADERS = {
  "Content-Type": "application/json",
  // Per-user JSON: never cached by a browser, a proxy or the app's HTTP cache.
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

export function fail(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, ...extra, error: message }, status);
}

/** A thrown Response is how a helper stops the request from deep inside a route. */
export class Stop extends Error {
  constructor(readonly response: Response) {
    super("stopped");
  }
}

/** The JSON object the caller sent; anything else (no body, a list, a string, bad JSON) is an empty one. */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  return parseObject(await request.text());
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const body = JSON.parse(text);
    return body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** The form a multipart request carries, refused with a 413 past `limit` bytes: by its declared length before any of it is
 *  read, and again as it streams in (the header can lie, and a chunked body declares nothing). */
export async function readFormBounded(request: Request, limit: number): Promise<FormData> {
  const tooLarge = () => new Stop(fail("That request is too large.", 413));
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  try {
    return await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return new FormData(); // not a form at all: every field is simply missing
  }
}

/** A JSON body, refused past `limit` bytes before it is read whole (the header can lie, so the text is measured too). */
export const DEFAULT_MAX_BODY = 1 * 1024 * 1024;

export async function boundedJsonBody(request: Request, limit = DEFAULT_MAX_BODY): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Stop(fail("That request is too large.", 413));
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limit) throw new Stop(fail("That request is too large.", 413));
  return parseObject(text);
}
