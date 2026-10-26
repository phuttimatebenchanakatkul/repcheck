/**
 * A typed client for the Flask API (api/). Every route answers JSON: `{"ok": true, ...}` or `{"ok": false, "error": "..."}`,
 * with the status in the HTTP code. This turns that into a returned value or a thrown ApiError whose message is safe to
 * show the person (the server writes them for people), and attaches the Supabase access token to each request.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  /** Seconds to wait before retrying, when the server said (Retry-After on a 429). */
  readonly retryAfter: number | null;

  constructor(message: string, status: number, body: Record<string, unknown> = {}, retryAfter: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }

  /** The server refused for lack of AI consent (the response carries `needs_ai_consent`). */
  get needsAiConsent(): boolean {
    return this.status === 403 && this.body.needs_ai_consent === true;
  }
}

export interface ApiOptions {
  baseUrl: string;
  /** The current access token, or null when signed out. May refresh it; called for every request. */
  getToken: () => Promise<string | null>;
  /** Called once when a request that carried a token comes back 401 (an expired session); returns a fresh token or null. */
  refreshToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RequestInitLite {
  method?: 'GET' | 'POST' | 'DELETE';
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  /** Overrides the default timeout (grading a clip takes minutes). */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export type Json = Record<string, unknown>;

export function createApi(options: ApiOptions) {
  const doFetch = options.fetchImpl ?? fetch;

  function url(path: string, query?: RequestInitLite['query']): string {
    const base = options.baseUrl.replace(/\/+$/, '');
    const search = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return `${base}${path}${search ? `?${search}` : ''}`;
  }

  async function once(path: string, init: RequestInitLite, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (init.form) body = init.form; // fetch sets the multipart boundary itself: never set Content-Type by hand
    else if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await doFetch(url(path, init.query), { method: init.method ?? 'GET', headers, body, signal: controller.signal });
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') throw new ApiError('The request timed out. Please try again.', 0);
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(path: string, init: RequestInitLite = {}): Promise<Json> {
    let token = await options.getToken();
    let response = await once(path, init, token);
    if (response.status === 401 && token && options.refreshToken) {
      token = await options.refreshToken();
      if (token) response = await once(path, init, token);
    }
    return parse(response);
  }

  return {
    request,
    get: (path: string, query?: RequestInitLite['query']) => request(path, { query }),
    post: (path: string, json?: unknown) => request(path, { method: 'POST', json }),
    del: (path: string, json?: unknown) => request(path, { method: 'DELETE', json }),
    upload: (path: string, form: FormData, timeoutMs?: number) => request(path, { method: 'POST', form, timeoutMs }),
  };
}

async function parse(response: Response): Promise<Json> {
  let body: Json = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Json;
  } catch {
    // not JSON (a proxy error page, an empty 204): fall through to the status
  }
  if (response.ok && body.ok !== false) return body;
  const retry = Number(response.headers.get('Retry-After'));
  const message = typeof body.error === 'string' && body.error ? body.error : fallbackMessage(response.status);
  throw new ApiError(message, response.status, body, Number.isFinite(retry) && retry > 0 ? retry : null);
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return "You can't do that.";
  if (status === 404) return 'Not found.';
  if (status === 413) return 'That file is too large.';
  if (status === 429) return 'Too many requests. Please try again later.';
  if (status >= 500) return 'Something went wrong on our side. Please try again.';
  return 'Something went wrong. Please try again.';
}

export type Api = ReturnType<typeof createApi>;
