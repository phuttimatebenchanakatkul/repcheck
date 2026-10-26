"""Clients for the two Supabase services Flask drives with the service-role key: Auth (admin) and Storage.

The service key bypasses every policy, so these are only ever called with an id or key the caller has already
proved belongs to the person asking. A 429, a 5xx, a dropped connection and a timeout are retried with a backoff
(they are the service having a bad moment, not an answer); anything else is returned for the caller to judge.

Storage reports most refusals as HTTP 400 with the real status in the body, so that is unpacked here once.
"""

import time
from urllib.parse import quote

import requests

RETRY_STATUSES = (429, 500, 502, 503, 504)
DELETE_BATCH = 100
# The status inside a 400 body that means "the bucket's own size/type rule turned the file away".
REFUSED_BY_BUCKET = ("413", "415")
NOT_FOUND = "404"


class SupabaseError(RuntimeError):
    pass


class Refused(SupabaseError):
    """The bucket's size or type rule refused the file. The caller's input is wrong, not the service."""


class WeakPassword(SupabaseError):
    """The project's password policy refused the password (too short, or one that has leaked). The person's input, not the service."""


class _Client:
    timeout = 30

    def __init__(self, settings, path, headers, sleep=time.sleep, session=None):
        self.base = settings.supabase_url + path
        self.headers, self.sleep = headers, sleep
        self.session = session or requests.Session()

    def _call(self, verb, url, **kwargs):
        headers = dict(self.headers, **kwargs.pop("headers", {}))
        last = None
        for attempt in range(4):
            try:
                response = getattr(self.session, verb)(url, headers=headers, timeout=self.timeout, **kwargs)
            except OSError as exc:                  # requests' connection errors and timeouts are OSErrors
                last = exc
            else:
                if response.status_code not in RETRY_STATUSES:
                    return response
                last = response.status_code
            self.sleep(2 ** attempt)
        raise SupabaseError(f"{verb} {url.rsplit('/', 1)[-1].split('?')[0]} kept failing: {last}")


def _body(response):
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


class AuthAdmin(_Client):
    def __init__(self, settings, **kw):
        super().__init__(settings, "/auth/v1/admin/users",
                         {"apikey": settings.service_key, "Content-Type": "application/json"}, **kw)

    def set_password(self, uid, password):
        """Set an existing user's password. Their email confirmation is NOT touched. Raises WeakPassword when the project's policy
        refuses it, SupabaseError for anything else."""
        response = self._call("put", f"{self.base}/{uid}", json={"password": password})
        if response.status_code == 200:
            return
        if response.status_code == 422 and _body(response).get("error_code") == "weak_password":
            raise WeakPassword("the password does not meet the project's policy")
        raise SupabaseError(f"setting a password answered {response.status_code}")

    def delete_user(self, uid):
        """Delete the Auth user (which cascades to the profile and everything it owns). True if it is gone,
        including when it already was."""
        status = self._call("delete", f"{self.base}/{uid}").status_code
        if status in (200, 404):
            return True
        raise SupabaseError(f"deleting an Auth user answered {status}")


class Storage(_Client):
    timeout = 300                   # a 50 MiB clip on a slow link

    def __init__(self, settings, **kw):
        super().__init__(settings, "/storage/v1",
                         {"apikey": settings.service_key, "Authorization": "Bearer " + settings.service_key}, **kw)

    @staticmethod
    def _path(bucket, key):
        return f"{bucket}/{quote(key, safe='/')}"

    def upload(self, bucket, key, data, content_type, upsert=True):
        """Store `data` (bytes or a binary file object). Raises Refused when the bucket's rules turn it away."""
        response = self._call("post", f"{self.base}/object/{self._path(bucket, key)}", data=data,
                              headers={"Content-Type": content_type, "x-upsert": "true" if upsert else "false"})
        if response.status_code == 200:
            return
        body = _body(response)
        if response.status_code == 400 and str(body.get("statusCode")) in REFUSED_BY_BUCKET:
            raise Refused(str(body.get("message") or body.get("error") or "file refused"))
        raise SupabaseError(f"uploading to {bucket} answered {response.status_code}")

    def download(self, bucket, key):
        """The object's bytes, or None if there is no such object."""
        response = self._call("get", f"{self.base}/object/authenticated/{self._path(bucket, key)}")
        if response.status_code == 200:
            return response.content
        if str(_body(response).get("statusCode")) == NOT_FOUND or response.status_code == 404:
            return None
        raise SupabaseError(f"downloading from {bucket} answered {response.status_code}")

    def sign(self, bucket, key, expires=300):
        """A time-limited URL that serves the object to whoever holds it, or None if there is no such object."""
        response = self._call("post", f"{self.base}/object/sign/{self._path(bucket, key)}",
                              json={"expiresIn": int(expires)}, headers={"Content-Type": "application/json"})
        if response.status_code == 200 and _body(response).get("signedURL"):
            return self.base + _body(response)["signedURL"]
        if str(_body(response).get("statusCode")) == NOT_FOUND or response.status_code == 404:
            return None
        raise SupabaseError(f"signing a {bucket} object answered {response.status_code}")

    def remove(self, bucket, keys):
        """Delete objects through the API (SQL cannot: Storage refuses it). Returns the keys that would not go;
        a key that does not exist is not a failure."""
        keys, failed = list(keys), []
        for i in range(0, len(keys), DELETE_BATCH):
            batch = keys[i:i + DELETE_BATCH]
            try:
                response = self._call("delete", f"{self.base}/object/{bucket}", json={"prefixes": batch},
                                      headers={"Content-Type": "application/json"})
                ok = response.status_code == 200
            except SupabaseError:
                ok = False
            if not ok:
                failed += batch
        return failed
