/** The API's request handler. `createHandler(services)` is what `api/index.ts` serves and what the tests call. */
import { purgeDue } from "./accounts.ts";
import { Verifier, requireIdentity, type Identity } from "./auth.ts";
import type { Db } from "./db.ts";
import type { FoodLookup } from "./foodLookup.ts";
import { fail, json, Stop } from "./http.ts";
import type { Settings } from "./settings.ts";
import type { Gemini } from "./gemini.ts";
import type { AuthAdmin, Storage } from "./supabaseAdmin.ts";

export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface Services {
  settings: Settings;
  db: Db;
  verifier: Verifier;
  storage: Storage;
  authAdmin: AuthAdmin;
  gemini: Gemini;
  /** Open Food Facts and FatSecret: nutrition by barcode and by name. */
  food: FoodLookup;
  /** Keep `work` running after the response has gone (EdgeRuntime.waitUntil); the tests hand in one that collects it. */
  background: (work: Promise<unknown>) => void;
  /** Purge accounts past their grace period on requests, at most hourly. Off in tests, so they can never touch a real account that happens to be due. */
  sweep: boolean;
}

export interface Context {
  request: Request;
  services: Services;
  /** The caller, for a route registered with `auth: true`. */
  identity: Identity;
  /** The values of `<name>` / `<int:name>` in the route's path. */
  params: Record<string, string>;
}

export type Handler = (ctx: Context) => Promise<Response> | Response;

interface Route {
  method: string;
  path: string;
  /** Matches the path; null for a path with nothing variable in it. */
  pattern: RegExp | null;
  names: string[];
  auth: boolean;
  handler: Handler;
}

/** `/api/x/<int:id>` (digits only, like Flask's converter) and `/api/x/<name>` (anything but a slash) become a pattern. */
function compile(path: string): { pattern: RegExp | null; names: string[] } {
  const names: string[] = [];
  if (!path.includes("<")) return { pattern: null, names };
  const source = path.split(/(<[^>]+>)/).map((part) => {
    const m = /^<(?:(int):)?(\w+)>$/.exec(part);
    if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    names.push(m[2]);
    return m[1] ? "(\\d+)" : "([^/]+)";
  }).join("");
  return { pattern: new RegExp(`^${source}$`), names };
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, options: { auth?: boolean } = {}): this {
    this.routes.push({ method, path, ...compile(path), auth: options.auth ?? true, handler });
    return this;
  }

  get(path: string, handler: Handler, options?: { auth?: boolean }) {
    return this.add("GET", path, handler, options);
  }

  post(path: string, handler: Handler, options?: { auth?: boolean }) {
    return this.add("POST", path, handler, options);
  }

  delete(path: string, handler: Handler, options?: { auth?: boolean }) {
    return this.add("DELETE", path, handler, options);
  }

  find(method: string, path: string): { route: Route | null; pathKnown: boolean; params: Record<string, string> } {
    const matches = this.routes.flatMap((route) => {
      if (route.pattern === null) return route.path === path ? [{ route, params: {} }] : [];
      const m = route.pattern.exec(path);
      return m ? [{ route, params: Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) }] : [];
    });
    const hit = matches.find((x) => x.route.method === method);
    return { route: hit?.route ?? null, pathKnown: matches.length > 0, params: hit?.params ?? {} };
  }
}

/** The path the routes are written against. Supabase puts the function's name in front of it, and the API gateway
 *  may put `/functions/v1` there too; both are removed so a route is always written as `/api/...`. */
export function routePath(url: string): string {
  let path = new URL(url).pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/functions/v1")) path = path.slice("/functions/v1".length) || "/";
  return path;
}

export function createHandler(services: Services, router: Router): (request: Request) => Promise<Response> {
  let lastSweep = -Infinity;
  /** There is no scheduler, so a request triggers the purge of accounts past their grace period: the guarantee to the
   *  person is "not before day 30", and a late purge is fine. It runs after the response and can never fail a request. */
  const sweep = () => {
    if (!services.sweep) return;
    const now = Date.now();
    if (now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    services.background(
      purgeDue(services.db, services.storage, services.authAdmin)
        .then(([purged, failed]) => {
          if (purged.length || failed.length) console.log(`account purge: ${purged.length} purged, ${failed.length} to retry`);
        })
        .catch(() => console.error("account purge sweep failed")), // a purge that cannot run is a purge that happens an hour later
    );
  };
  return async (request) => {
    sweep();
    try {
      const { route, pathKnown, params } = router.find(request.method, routePath(request.url));
      if (!route) return pathKnown ? fail("Method not allowed.", 405) : fail("Not found.", 404);
      const identity = route.auth ? await requireIdentity(request, services.verifier) : undefined;
      return await route.handler({ request, services, identity: identity as Identity, params });
    } catch (e) {
      if (e instanceof Stop) return e.response;
      // Never leak a driver message, a query or a path to the client.
      console.error("unhandled error", e instanceof Error ? e.message : "unknown");
      return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
    }
  };
}
