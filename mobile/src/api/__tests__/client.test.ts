import { ApiError, createApi, DEFAULT_TIMEOUT_MS } from '../client';

interface Call {
  url: string;
  init: RequestInit;
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function make(responses: (Response | Error)[], extra: Partial<Parameters<typeof createApi>[0]> = {}) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('no more responses queued');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const api = createApi({ baseUrl: 'https://api.test/', getToken: async () => 'tok', fetchImpl, ...extra });
  return { api, calls };
}

describe('requests', () => {
  it('sends the bearer token, JSON bodies and the right URL (no double slash, query encoded, undefined dropped)', async () => {
    const { api, calls } = make([respond(200, { ok: true })]);
    await api.request('/api/x', { method: 'POST', json: { a: 1 }, query: { q: 'a b&c', skip: undefined, n: 3 } });
    expect(calls[0].url).toBe('https://api.test/api/x?q=a%20b%26c&n=3');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{"a":1}');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json', Accept: 'application/json' });
  });

  it('sends no Authorization header when signed out, and no Content-Type for a GET', async () => {
    const { api, calls } = make([respond(200, { ok: true })], { getToken: async () => null });
    await api.get('/api/x');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
  });

  it('lets fetch set the multipart boundary for an upload (no Content-Type by hand)', async () => {
    const { api, calls } = make([respond(200, { ok: true })]);
    const form = new FormData();
    form.append('a', 'b');
    await api.upload('/api/up', form);
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(calls[0].init.body).toBe(form);
  });

  it('GET, POST and DELETE use the right verbs', async () => {
    const { api, calls } = make([respond(200, { ok: true }), respond(200, { ok: true }), respond(200, { ok: true })]);
    await api.get('/a');
    await api.post('/b', {});
    await api.del('/c', { id: 1 });
    expect(calls.map((c) => c.init.method)).toEqual(['GET', 'POST', 'DELETE']);
    expect(calls[2].init.body).toBe('{"id":1}');
  });
});

describe('responses', () => {
  it('returns the body of a success', async () => {
    const { api } = make([respond(200, { ok: true, thing: 5 })]);
    expect(await api.get('/x')).toEqual({ ok: true, thing: 5 });
  });

  it('turns {"ok": false, "error"} into an ApiError carrying the server message, status and body', async () => {
    const { api } = make([respond(400, { ok: false, error: 'Please enter your name.', extra: 1 })]);
    await expect(api.get('/x')).rejects.toMatchObject({ name: 'ApiError', message: 'Please enter your name.', status: 400, body: { extra: 1 } });
  });

  it('treats a 200 that says ok:false as an error too', async () => {
    const { api } = make([respond(200, { ok: false, error: 'No.' })]);
    await expect(api.get('/x')).rejects.toMatchObject({ message: 'No.', status: 200 });
  });

  it('reads Retry-After on a 429', async () => {
    const { api } = make([respond(429, { ok: false, error: 'Slow down' }, { 'Retry-After': '120' })]);
    await expect(api.get('/x')).rejects.toMatchObject({ status: 429, retryAfter: 120 });
  });

  it('ignores a Retry-After that is not a positive number', async () => {
    for (const value of ['abc', '0', '-5']) {
      const { api } = make([respond(429, { ok: false, error: 'x' }, { 'Retry-After': value })]);
      await expect(api.get('/x')).rejects.toMatchObject({ retryAfter: null });
    }
  });

  it('flags the AI-consent refusal', async () => {
    const { api } = make([respond(403, { ok: false, needs_ai_consent: true, error: 'Turn it on' })]);
    const error = await api.get('/x').catch((e: ApiError) => e);
    expect((error as ApiError).needsAiConsent).toBe(true);
  });

  it('the consent flag only counts on a 403', async () => {
    const { api } = make([respond(400, { ok: false, needs_ai_consent: true, error: 'x' })]);
    expect(((await api.get('/x').catch((e: ApiError) => e)) as ApiError).needsAiConsent).toBe(false);
  });

  it('leaves no timer running after a request finishes, success or failure', async () => {
    jest.useFakeTimers();
    try {
      const ok = make([respond(200, { ok: true })]);
      await ok.api.get('/x');
      expect(jest.getTimerCount()).toBe(0);
      const failed = make([respond(500, { ok: false, error: 'x' })]);
      await failed.api.get('/x').catch(() => undefined);
      const down = make([new TypeError('offline')]);
      await down.api.get('/x').catch(() => undefined);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a 403 without the flag is not a consent refusal', async () => {
    const { api } = make([respond(403, { ok: false, error: 'No' })]);
    expect(((await api.get('/x').catch((e: ApiError) => e)) as ApiError).needsAiConsent).toBe(false);
  });

  it.each([
    [401, /sign in again/],
    [403, /can't do that/],
    [404, /Not found/],
    [413, /too large/],
    [429, /Too many/],
    [500, /our side/],
    [502, /our side/],
    [418, /Something went wrong/],
  ])('gives a readable message for a %i with no body, never the raw status', async (status, message) => {
    const { api } = make([respond(status, '<html>proxy error</html>')]);
    await expect(api.get('/x')).rejects.toMatchObject({ status, message: expect.stringMatching(message) });
  });

  it('ignores a body that is not an object', async () => {
    for (const body of ['[1,2]', '"text"', 'null', '']) {
      const { api } = make([respond(500, body)]);
      await expect(api.get('/x')).rejects.toMatchObject({ status: 500, body: {} });
    }
  });

  it('a success whose body is not JSON is an empty object, not a crash', async () => {
    const { api } = make([respond(200, 'not json')]);
    expect(await api.get('/x')).toEqual({});
  });
});

describe('failures before a response', () => {
  it('a network error becomes a friendly ApiError with status 0', async () => {
    const { api } = make([new TypeError('Network request failed')]);
    await expect(api.get('/x')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Could not reach the server/) });
  });

  it('a timeout is reported as one, and aborts the request', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchImpl = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }) as unknown as typeof fetch;
      const api = createApi({ baseUrl: 'https://api.test', getToken: async () => null, fetchImpl });
      const pending = api.get('/x').catch((e: ApiError) => e);
      await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);
      expect(((await pending) as ApiError).message).toMatch(/timed out/);
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a per-request timeout overrides the default', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_r, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as unknown as typeof fetch;
      const api = createApi({ baseUrl: 'https://api.test', getToken: async () => null, fetchImpl });
      const pending = api.request('/x', { timeoutMs: 5 * 60_000 }).catch((e: ApiError) => e);
      await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS * 2);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false); // still waiting: the long timeout applies
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(((await pending) as ApiError).message).toMatch(/timed out/);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('an expired session', () => {
  it('refreshes once and retries with the new token', async () => {
    const refreshToken = jest.fn(async () => 'fresh');
    const { api, calls } = make([respond(401, { ok: false, error: 'Your session has expired.' }), respond(200, { ok: true, v: 1 })], { refreshToken });
    expect(await api.get('/x')).toEqual({ ok: true, v: 1 });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });

  it('gives up after one refresh: a second 401 is an error, not a loop', async () => {
    const refreshToken = jest.fn(async () => 'fresh');
    const { api, calls } = make([respond(401, { ok: false, error: 'a' }), respond(401, { ok: false, error: 'b' })], { refreshToken });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 401, message: 'b' });
    expect(calls).toHaveLength(2);
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it('a refresh that yields no token returns the original 401', async () => {
    const { api, calls } = make([respond(401, { ok: false, error: 'expired' })], { refreshToken: async () => null });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 401, message: 'expired' });
    expect(calls).toHaveLength(1);
  });

  it('does not refresh when no token was sent (a 401 for a signed-out call is just that)', async () => {
    const refreshToken = jest.fn(async () => 'fresh');
    const { api } = make([respond(401, { ok: false, error: 'x' })], { getToken: async () => null, refreshToken });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('only a 401 triggers a refresh', async () => {
    const refreshToken = jest.fn(async () => 'fresh');
    const { api } = make([respond(403, { ok: false, error: 'x' })], { refreshToken });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 403 });
    expect(refreshToken).not.toHaveBeenCalled();
  });
});
