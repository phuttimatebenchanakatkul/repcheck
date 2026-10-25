"""Where the API finds its Supabase project. Read from the environment, then from the repo's gitignored .env."""

import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parent.parent
WANTED = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL")
# Optional, comma-separated. Exempt from the per-account AI usage limits only (they open nothing else).
EXEMPT_VARS = ("ADMIN_EMAILS", "REVIEW_ACCOUNT_EMAILS")


class SettingsError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_key: str            # secret: bypasses RLS. Server only, never sent to a client.
    db_url: str                 # the transaction pooler (port 6543): Render cannot reach the IPv6-only direct host
    jwt_audience: str = "authenticated"
    # Lower-cased addresses of accounts the AI usage limits do not apply to: the owner, and App Review's demo account
    # (a reviewer who is told "come back in 24 hours" on the headline feature cannot test the app). Empty unless set
    # in the environment, so nobody is exempt by accident; the website's equivalent is hard-coded in app.py.
    rate_limit_exempt: frozenset = frozenset()

    @property
    def issuer(self):
        return f"{self.supabase_url}/auth/v1"

    @property
    def jwks_url(self):
        return f"{self.issuer}/.well-known/jwks.json"

    @property
    def project_ref(self):
        return urlparse(self.supabase_url).hostname.split(".")[0]


def _unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    return value


def from_env(env=None, env_file=None):
    """Settings from `env` (default: the process environment), falling back to the .env file for anything missing.
    Fails loudly and early with the NAME of what is wrong, never its value."""
    env = dict(os.environ if env is None else env)
    path = Path(env_file) if env_file else REPO_ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m and m.group(1) in WANTED + EXEMPT_VARS:
                env.setdefault(m.group(1), m.group(2))
    values = {k: _unquote(env.get(k, "")) for k in WANTED}
    missing = [k for k, v in values.items() if not v]
    if missing:
        raise SettingsError(f"missing {', '.join(missing)} (set them in the environment or .env)")
    url = values["SUPABASE_URL"].rstrip("/")
    if not url.startswith("https://") or not urlparse(url).hostname:
        raise SettingsError("SUPABASE_URL must be the project's https:// address")
    if not values["SUPABASE_DB_URL"].startswith(("postgresql://", "postgres://")):
        raise SettingsError("SUPABASE_DB_URL must be a postgresql:// connection string")
    exempt = frozenset(e.strip().lower() for var in EXEMPT_VARS for e in _unquote(env.get(var, "")).split(",") if e.strip())
    return Settings(supabase_url=url, service_key=values["SUPABASE_SERVICE_ROLE_KEY"], db_url=values["SUPABASE_DB_URL"],
                    rate_limit_exempt=exempt)
