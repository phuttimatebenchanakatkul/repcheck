"""Shared test setup, loaded by pytest before any test module is imported.

app.py refuses to boot without FLASK_SECRET_KEY: it signs the session cookie
that carries user identity, and this repo is public, so shipping an in-code
fallback would publish a master key. Tests need *a* key, not a secret one --
set a throwaway here so importing app during collection works.

setdefault, not assignment: if a real key is already exported (CI, a shell
that sourced .env), that one wins and this is a no-op.
"""

import os

os.environ.setdefault("FLASK_SECRET_KEY", "test-only-key-not-a-real-secret")
