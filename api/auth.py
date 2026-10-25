"""Who is calling: verify the Supabase access token the app sends, on every request.

The token is an ES256 JWT signed by the project (public key at <project>/auth/v1/.well-known/jwks.json, checked
here without a round trip to Supabase). What that does and does not prove:

  * it proves the project issued it, for this user, and that it has not expired (an hour);
  * it does NOT notice a session revoked or a user banned since: such a token works until it expires.
    Anything destructive or sensitive that must honour a revocation immediately should say so here first.

Everything that could make a token the wrong kind of credential is refused explicitly: any algorithm but the
asymmetric ones (never HS256, never "none": that is the classic confusion attack), a service-role token, an
anonymous session, a subject that is not a UUID, the wrong audience or issuer.
"""

import functools
import re
import uuid
from dataclasses import dataclass

import jwt
from flask import current_app, g, jsonify, request

ALGORITHMS = ("ES256", "RS256")      # what Supabase signs with; both asymmetric
LEEWAY_SECONDS = 10                  # clock skew between Supabase and this server


class AuthFailure(Exception):
    def __init__(self, message, status=401):
        super().__init__(message)
        self.message, self.status = message, status


@dataclass(frozen=True)
class Identity:
    id: str                          # the Supabase user id (a lowercase UUID) = profiles.id
    email: str | None
    claims: dict


class Verifier:
    def __init__(self, settings, key_for=None):
        """`key_for(token)` returns the public key that should have signed it. Injected by tests; by default the
        project's JWKS, cached, and refreshed once when a token names a key id it has not seen (a rotation)."""
        self.audience, self.issuer = settings.jwt_audience, settings.issuer
        if key_for is None:
            client = jwt.PyJWKClient(settings.jwks_url, cache_keys=True, lifespan=600, timeout=10)
            key_for = lambda token: client.get_signing_key_from_jwt(token).key   # noqa: E731
        self._key_for = key_for

    def verify(self, token):
        try:
            key = self._key_for(token)
            claims = jwt.decode(
                token, key, algorithms=list(ALGORITHMS), audience=self.audience, issuer=self.issuer,
                leeway=LEEWAY_SECONDS, options={"require": ["exp", "iat", "sub", "aud", "iss"]})
        except jwt.ExpiredSignatureError:
            raise AuthFailure("Your session has expired. Please sign in again.") from None
        except jwt.PyJWKClientConnectionError:
            # Not the caller's fault and not a bad token: we could not fetch the keys. Say so, so the app retries.
            raise AuthFailure("Sign-in is temporarily unavailable. Please try again.", status=503) from None
        except jwt.PyJWTError:
            raise AuthFailure("Invalid session.") from None
        if claims.get("role") != "authenticated":
            raise AuthFailure("Invalid session.")
        if claims.get("is_anonymous"):
            raise AuthFailure("Please sign in to continue.")
        try:
            subject = uuid.UUID(str(claims["sub"]))
        except ValueError:
            raise AuthFailure("Invalid session.") from None
        email = claims.get("email")
        return Identity(id=str(subject), email=email if isinstance(email, str) else None, claims=claims)


_BEARER = re.compile(r"Bearer ([A-Za-z0-9_\-.]+)")


def bearer_token():
    match = _BEARER.fullmatch((request.headers.get("Authorization") or "").strip())
    return match.group(1) if match else None


def unauthorized(message, status=401):
    response = jsonify({"ok": False, "error": message})
    response.status_code = status
    if status == 401:
        response.headers["WWW-Authenticate"] = "Bearer"
    return response


def login_required(view):
    """Verify the bearer token and expose the caller as `g.identity`."""
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        token = bearer_token()
        if token is None:
            return unauthorized("Not logged in.")
        try:
            g.identity = current_app.extensions["api"].verifier.verify(token)
        except AuthFailure as failure:
            return unauthorized(failure.message, failure.status)
        return view(*args, **kwargs)
    return wrapped


def current_identity():
    return g.identity
