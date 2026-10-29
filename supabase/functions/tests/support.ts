/** Test helpers: signed tokens, an in-memory database that records what it was asked, and a ready handler. */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { KeyLike } from "jose";

import { createHandler, Router, type Services } from "../_shared/app.ts";
import { Verifier } from "../_shared/auth.ts";
import { FoodLookup } from "../_shared/foodLookup.ts";
import type { Gemini, GenerateRequest } from "../_shared/gemini.ts";
import { AuthAdmin, Storage, type Transport } from "../_shared/supabaseAdmin.ts";
import type { Db, Params, Row, Tx } from "../_shared/db.ts";
import { fromEnv, issuer, type Settings } from "../_shared/settings.ts";
import { buildRouter } from "../api/router.ts";

export const PROJECT = "https://abcdefgh.supabase.co";
export const USER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

export function settings(env: Record<string, string> = {}): Settings {
  return fromEnv((name) => ({ SUPABASE_URL: PROJECT, ...env })[name]);
}

const pair = await generateKeyPair("ES256");
const other = await generateKeyPair("ES256");

export const publicKey = pair.publicKey;
export { exportJWK };

type Claims = Record<string, unknown>;

/** A token the project would have issued, with `override` merged over the usual claims (a `null` removes one). */
export async function token(override: Claims = {}, options: { key?: KeyLike; alg?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Claims = {
    sub: USER,
    role: "authenticated",
    email: "lifter@example.com",
    aud: "authenticated",
    iss: issuer(settings()),
    iat: now,
    exp: now + 3600,
    ...override,
  };
  for (const [k, v] of Object.entries(claims)) if (v === null) delete claims[k];
  const jwt = new SignJWT(claims as never).setProtectedHeader({ alg: options.alg ?? "ES256", kid: "k1" });
  return await jwt.sign(options.key ?? pair.privateKey);
}

export const strangersKey = other.privateKey;
export const bearer = async (override: Claims = {}) => ({ Authorization: `Bearer ${await token(override)}` });

export interface Call {
  sql: string;
  params: Params;
}

/** A database that answers from `script(sql, params)` (rows, or a number for exec) and remembers every call. */
export class FakeDb implements Db {
  calls: Call[] = [];
  transactions = 0;
  constructor(private readonly script: (sql: string, params: Params) => Row[] | number | Error = () => []) {}

  private answer(sql: string, params: Params): Row[] | number {
    this.calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    const out = this.script(sql, params);
    if (out instanceof Error) throw out;
    return out;
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const tx: Tx = {
      savepoint: (fn) => fn(tx),
      all: (sql, params = []) => {
        const out = this.answer(sql, params);
        return Promise.resolve((Array.isArray(out) ? out : []) as never);
      },
      one: (sql, params = []) => {
        const out = this.answer(sql, params);
        return Promise.resolve((Array.isArray(out) && out.length ? out[0] : null) as never);
      },
      exec: (sql, params = []) => {
        const out = this.answer(sql, params);
        return Promise.resolve(typeof out === "number" ? out : out.length);
      },
    };
    return fn(tx);
  }
}

/** A transport that records every request and answers from `answer(url, init)` (default: 200 with `{}`); it never sleeps. */
export function fakeTransport(answer: (url: string, init: RequestInit) => Response | Promise<Response> | Error = () => new Response("{}")) {
  const requests: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  const transport: Transport = {
    fetch: (input, init = {}) => {
      const url = String(input);
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      let body: unknown = init.body ?? null;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch { /* keep the text */ }
      }
      requests.push({ url, method: String(init.method), body, headers });
      const out = answer(url, init);
      if (out instanceof Error) return Promise.reject(out);
      return Promise.resolve(out);
    },
    sleep: () => Promise.resolve(),
  };
  return { transport, requests };
}

/** A model that answers from `answer(request)` (a string, null for "gave nothing", or an Error to throw) and remembers what it was asked. */
export class FakeGemini implements Gemini {
  requests: GenerateRequest[] = [];
  constructor(private readonly answer: (request: GenerateRequest) => string | null | Error = () => "Sure.\nSOURCES: none", readonly configured = true) {}
  generate(request: GenerateRequest): Promise<string | null> {
    this.requests.push(request);
    const out = this.answer(request);
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  }
}

export function services(db: Db = new FakeDb(), env: Record<string, string> = {}, transport: Transport = fakeTransport().transport, gemini: Gemini = new FakeGemini(), food?: FoodLookup): Services & { collected: Promise<unknown>[] } {
  const s = settings(env);
  const collected: Promise<unknown>[] = [];
  return {
    settings: s,
    db,
    verifier: new Verifier(s, publicKey),
    storage: new Storage(PROJECT, "service-key", transport),
    authAdmin: new AuthAdmin(PROJECT, "service-key", transport),
    gemini,
    food: food ?? new FoodLookup(() => Promise.reject(new Error("no network in tests")), s.fatsecret),
    background: (work) => void collected.push(work),
    sweep: false,
    collected,
  };
}

export function app(db: Db = new FakeDb(), env: Record<string, string> = {}, router: Router = buildRouter(), transport?: Transport, gemini?: Gemini, food?: FoodLookup) {
  const handler = createHandler(services(db, env, transport, gemini, food), router);
  return (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers.set("Content-Type", "application/json");
    }
    return handler(new Request(`${PROJECT}/functions/v1${path}`, { ...init, headers, body }));
  };
}
