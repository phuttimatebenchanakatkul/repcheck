"""Where the API finds its Supabase project. Read from the environment, then from the repo's gitignored .env."""

import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parent.parent
WANTED = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL")


class SettingsError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_key: str            # secret: bypasses RLS. Server only, never sent to a client.
    db_url: str                 # the transaction pooler (port 6543): Render cannot reach the IPv6-only direct host
    jwt_audience: str = "authenticated"

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
            if m and m.group(1) in WANTED:
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
    return Settings(supabase_url=url, service_key=values["SUPABASE_SERVICE_ROLE_KEY"], db_url=values["SUPABASE_DB_URL"])
