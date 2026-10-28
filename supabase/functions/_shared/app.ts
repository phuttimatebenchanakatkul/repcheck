/** The API's request handler. `createHandler(services)` is what `api/index.ts` serves and what the tests call. */
import { Verifier, requireIdentity, type Identity } from "./auth.ts";
import type { Db } from "./db.ts";
import { fail, json, Stop } from "./http.ts";
import type { Settings } from "./settings.ts";

export interface Services {
  settings: Settings;
  db: Db;
  verifier: Verifier;
}

export interface Context {
  request: Request;
  services: Services;
  /** The caller, for a route registered with `auth: true`. */
  identity: Identity;
}

export type Handler = (ctx: Context) => Promise<Response> | Response;

interface Route {
  method: string;
  path: string;
  auth: boolean;
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, options: { auth?: boolean } = {}): this {
    this.routes.push({ method, path, auth: options.auth ?? true, handler });
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

  find(method: string, path: string): { route: Route | null; pathKnown: boolean } {
    const onPath = this.routes.filter((r) => r.path === path);
    return { route: onPath.find((r) => r.method === method) ?? null, pathKnown: onPath.length > 0 };
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
  return async (request) => {
    try {
      const { route, pathKnown } = router.find(request.method, routePath(request.url));
      if (!route) return pathKnown ? fail("Method not allowed.", 405) : fail("Not found.", 404);
      const identity = route.auth ? await requireIdentity(request, services.verifier) : undefined;
      return await route.handler({ request, services, identity: identity as Identity });
    } catch (e) {
      if (e instanceof Stop) return e.response;
      // Never leak a driver message, a query or a path to the client.
      console.error("unhandled error", e instanceof Error ? e.message : "unknown");
      return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
    }
  };
}
