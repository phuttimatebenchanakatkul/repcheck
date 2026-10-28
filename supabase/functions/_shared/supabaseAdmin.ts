/** Clients for the two Supabase services the function drives with the service-role key: Auth (admin) and Storage.
 *
 * The service key bypasses every policy, so these are only ever called with an id or key the caller has already proved
 * belongs to the person asking. A 429, a 5xx, a dropped connection and a timeout are retried with a backoff (they are
 * the service having a bad moment, not an answer); anything else is returned for the caller to judge.
 *
 * Storage reports most refusals as HTTP 400 with the real status in the body, so that is unpacked here once.
 */
export class SupabaseError extends Error {}

/** The bucket's size or type rule refused the file: the caller's input is wrong, not the service. */
export class Refused extends SupabaseError {}

/** The project's password policy refused the password (too short, or one that has leaked). */
export class WeakPassword extends SupabaseError {}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const DELETE_BATCH = 100;
const REFUSED_BY_BUCKET = new Set(["413", "415"]); // the status inside a 400 body that means "the bucket's own rule turned the file away"
const NOT_FOUND = "404";
const ATTEMPTS = 4;

export interface Transport {
  fetch: typeof fetch;
  /** Wait `ms` (a test hands in one that returns at once). */
  sleep: (ms: number) => Promise<void>;
}

export const realTransport: Transport = { fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

type Body = Record<string, unknown>;

async function bodyOf(response: Response): Promise<Body> {
  try {
    const body = await response.clone().json();
    return typeof body === "object" && body !== null ? body as Body : {}; // an array or a string has none of the fields read from it
  } catch {
    return {};
  }
}

class Client {
  constructor(
    protected readonly base: string,
    private readonly headers: Record<string, string>,
    private readonly transport: Transport,
    private readonly timeoutMs: number,
  ) {}

  protected async call(method: string, url: string, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers = { ...this.headers, ...init.headers };
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers["Content-Type"] ??= "application/json";
    }
    let last: string | number = "";
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const response = await this.transport.fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
        if (!RETRY_STATUSES.has(response.status)) return response;
        last = response.status;
      } catch (e) {
        last = e instanceof Error ? e.name : "error"; // a connection error or a timeout
      }
      if (attempt < ATTEMPTS - 1) await this.transport.sleep(2 ** attempt * 1000);
    }
    throw new SupabaseError(`${method} ${new URL(url).pathname.split("/").pop()} kept failing: ${last}`);
  }
}

export class AuthAdmin extends Client {
  constructor(supabaseUrl: string, serviceKey: string, transport: Transport = realTransport) {
    super(`${supabaseUrl}/auth/v1/admin/users`, { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, transport, 30_000);
  }

  /** Set an existing user's password. Their email confirmation is NOT touched. Throws WeakPassword when the project's
   *  policy refuses it, SupabaseError for anything else. */
  async setPassword(uid: string, password: string): Promise<void> {
    const response = await this.call("PUT", `${this.base}/${uid}`, { json: { password } });
    if (response.status === 200) return;
    if (response.status === 422 && (await bodyOf(response)).error_code === "weak_password") {
      throw new WeakPassword("the password does not meet the project's policy");
    }
    throw new SupabaseError(`setting a password answered ${response.status}`);
  }

  /** Delete the Auth user (which cascades to the profile and everything it owns). True if it is gone, including when it already was. */
  async deleteUser(uid: string): Promise<boolean> {
    const status = (await this.call("DELETE", `${this.base}/${uid}`)).status;
    if (status === 200 || status === 404) return true;
    throw new SupabaseError(`deleting an Auth user answered ${status}`);
  }
}

/** Percent-encode a key like Python's quote(key, safe="/"): everything but letters, digits and _.-~ (encodeURIComponent also leaves !'()*). */
const encodeKey = (key: string) =>
  key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("/");

export class Storage extends Client {
  constructor(supabaseUrl: string, serviceKey: string, transport: Transport = realTransport) {
    // a 50 MiB clip on a slow link
    super(`${supabaseUrl}/storage/v1`, { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, transport, 300_000);
  }

  private path(bucket: string, key: string): string {
    return `${bucket}/${encodeKey(key)}`;
  }

  /** Store `data`. Throws Refused when the bucket's rules turn it away. */
  async upload(bucket: string, key: string, data: BodyInit, contentType: string, upsert = true): Promise<void> {
    const response = await this.call("POST", `${this.base}/object/${this.path(bucket, key)}`, {
      body: data,
      headers: { "Content-Type": contentType, "x-upsert": upsert ? "true" : "false" },
    });
    if (response.status === 200) return;
    const body = await bodyOf(response);
    if (response.status === 400 && REFUSED_BY_BUCKET.has(String(body.statusCode))) {
      throw new Refused(String(body.message || body.error || "file refused"));
    }
    throw new SupabaseError(`uploading to ${bucket} answered ${response.status}`);
  }

  /** The object's bytes, or null if there is no such object. */
  async download(bucket: string, key: string): Promise<Uint8Array | null> {
    const response = await this.call("GET", `${this.base}/object/authenticated/${this.path(bucket, key)}`);
    if (response.status === 200) return new Uint8Array(await response.arrayBuffer());
    if (String((await bodyOf(response)).statusCode) === NOT_FOUND || response.status === 404) return null;
    throw new SupabaseError(`downloading from ${bucket} answered ${response.status}`);
  }

  /** A time-limited URL that serves the object to whoever holds it, or null if there is no such object. */
  async sign(bucket: string, key: string, expires = 300): Promise<string | null> {
    const response = await this.call("POST", `${this.base}/object/sign/${this.path(bucket, key)}`, { json: { expiresIn: Math.trunc(expires) } });
    const body = await bodyOf(response);
    if (response.status === 200 && body.signedURL) return this.base + String(body.signedURL);
    if (String(body.statusCode) === NOT_FOUND || response.status === 404) return null;
    throw new SupabaseError(`signing a ${bucket} object answered ${response.status}`);
  }

  /** Delete objects through the API (SQL cannot: Storage refuses it). Returns the keys that would not go; a key that
   *  does not exist is not a failure. */
  async remove(bucket: string, keys: readonly string[]): Promise<string[]> {
    const failed: string[] = [];
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      let ok = false;
      try {
        ok = (await this.call("DELETE", `${this.base}/object/${bucket}`, { json: { prefixes: batch } })).status === 200;
      } catch (e) {
        if (!(e instanceof SupabaseError)) throw e;
      }
      if (!ok) failed.push(...batch);
    }
    return failed;
  }
}
