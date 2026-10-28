/** Who is calling: verify the Supabase access token the app sends, on every request.
 *
 * The token is an ES256 JWT signed by the project (public key at <project>/auth/v1/.well-known/jwks.json, checked here
 * without a round trip to Supabase). What that does and does not prove:
 *
 *   - it proves the project issued it, for this user, and that it has not expired (an hour);
 *   - it does NOT notice a session revoked or a user banned since: such a token works until it expires.
 *
 * Everything that could make a token the wrong kind of credential is refused explicitly: any algorithm but the
 * asymmetric ones (never HS256, never "none": the classic confusion attack), a service-role token, an anonymous
 * session, a subject that is not a UUID, the wrong audience or issuer.
 */
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey, KeyLike } from "jose";

import { fail, Stop } from "./http.ts";
import { issuer, jwksUrl, type Settings } from "./settings.ts";

export const ALGORITHMS = ["ES256", "RS256"];
const LEEWAY_SECONDS = 10; // clock skew between Supabase and this server
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthFailure extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
  }
}

export interface Identity {
  /** The Supabase user id (a lowercase UUID) = profiles.id. */
  id: string;
  email: string | null;
  claims: JWTPayload;
}

export type KeyFor = KeyLike | Uint8Array | JWTVerifyGetKey;

export class Verifier {
  private readonly key: KeyFor;

  /** `key` is what should have signed the token: injected by tests; by default the project's JWKS, cached, and
   *  refetched when a token names a key id it has not seen (a rotation). */
  constructor(private readonly settings: Settings, key?: KeyFor) {
    this.key = key ?? createRemoteJWKSet(new URL(jwksUrl(settings)), { cacheMaxAge: 600_000, timeoutDuration: 10_000 });
  }

  async verify(token: string): Promise<Identity> {
    let claims: JWTPayload;
    try {
      const options = {
        algorithms: ALGORITHMS,
        audience: this.settings.jwtAudience,
        issuer: issuer(this.settings),
        clockTolerance: LEEWAY_SECONDS,
        requiredClaims: ["exp", "iat", "sub", "aud", "iss"],
      };
      ({ payload: claims } = await jwtVerify(token, this.key as JWTVerifyGetKey, options)); // a key or a getter: jose tells them apart itself
    } catch (e) {
      if (e instanceof errors.JWTExpired) throw new AuthFailure("Your session has expired. Please sign in again.");
      // Not the caller's fault and not a bad token: the keys could not be fetched. Say so, so the app retries.
      if (e instanceof errors.JWKSTimeout) throw new AuthFailure("Sign-in is temporarily unavailable. Please try again.", 503);
      throw new AuthFailure("Invalid session.");
    }
    if (claims.role !== "authenticated") throw new AuthFailure("Invalid session.");
    if (claims.is_anonymous) throw new AuthFailure("Please sign in to continue.");
    if (typeof claims.sub !== "string" || !UUID.test(claims.sub)) throw new AuthFailure("Invalid session.");
    const email = claims.email;
    return { id: claims.sub.toLowerCase(), email: typeof email === "string" ? email : null, claims };
  }
}

const BEARER = /^Bearer ([A-Za-z0-9_\-.]+)$/;

export function bearerToken(request: Request): string | null {
  const match = BEARER.exec((request.headers.get("Authorization") ?? "").trim());
  return match ? match[1] : null;
}

/** The caller, or a `Stop` carrying the 401 (or 503) to send. */
export async function requireIdentity(request: Request, verifier: Verifier): Promise<Identity> {
  const token = bearerToken(request);
  if (token === null) throw new Stop(unauthorized("Not logged in."));
  try {
    return await verifier.verify(token);
  } catch (e) {
    if (e instanceof AuthFailure) throw new Stop(unauthorized(e.message, e.status));
    throw e;
  }
}

function unauthorized(message: string, status = 401): Response {
  const response = fail(message, status);
  if (status === 401) response.headers.set("WWW-Authenticate", "Bearer");
  return response;
}
