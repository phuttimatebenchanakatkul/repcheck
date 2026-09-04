"""The App Review demo account is exempt from the AI usage limits, and is NOT
an admin.

Why the exemption exists: `workout_analysis` is capped at 1 per account per
day. An App Review tester following the "how to use the main features"
instructions analyses one lift, tries a second, and is told to come back in 24
hours -- on the app's headline feature. Apple requires an app be fully
functional for review, and a reviewer who cannot exercise the feature twice has
no way to tell a cap from a bug.

Why it is a SEPARATE set from ADMIN_EMAILS: that set also opens /admin/users
(every account's email address) and /admin/export-db (a copy of the whole
database). Folding a demo account in there to lift its rate limits would hand
an App Review tester every user's personal data. That is the property this file
exists to keep true.

Run in a subprocess rather than by reloading app.py: importing it calls
init_db() at module scope, and the sets are built from the environment at
import time, so the environment has to be set before the import happens. The
subprocess gets its own DATA_DIR so nothing touches the real database.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PROBE = """
import json, app
print(json.dumps({
    "admin": sorted(app.ADMIN_EMAILS),
    "review": sorted(app.REVIEW_ACCOUNT_EMAILS),
    "exempt": sorted(app.RATE_LIMIT_EXEMPT_EMAILS),
}))
"""


def _probe(tmp_path, review_emails=None):
    env = {
        "PATH": "",
        "SYSTEMROOT": "C:\\\\Windows",  # Windows needs this for sockets/imports
        "DATA_DIR": str(tmp_path),
    }
    import os

    env = {**os.environ, **env}
    env.pop("REVIEW_ACCOUNT_EMAILS", None)
    if review_emails is not None:
        env["REVIEW_ACCOUNT_EMAILS"] = review_emails

    out = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert out.returncode == 0, f"probe failed:\n{out.stderr}"
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_no_review_accounts_configured_by_default(tmp_path):
    """The demo account's address is not committed to this public repo, so an
    unset environment must simply mean 'no exemptions beyond the owner'."""
    result = _probe(tmp_path)
    assert result["review"] == []
    assert result["exempt"] == result["admin"]


def test_review_account_is_exempt_from_the_ai_limits(tmp_path):
    result = _probe(tmp_path, "reviewer@example.com")
    assert "reviewer@example.com" in result["exempt"], (
        "the App Review demo account must not hit the 1-analysis-per-day cap"
    )


def test_review_account_is_not_an_admin(tmp_path):
    """The whole reason this is a separate set. ADMIN_EMAILS gates
    /admin/users and /admin/export-db."""
    result = _probe(tmp_path, "reviewer@example.com")
    assert "reviewer@example.com" not in result["admin"], (
        "a review account in ADMIN_EMAILS would hand App Review every user's "
        "email address and a copy of the whole database"
    )


def test_several_review_accounts_and_untidy_values_are_handled(tmp_path):
    """One per account type, per Apple's own guidance, pasted by hand."""
    result = _probe(tmp_path, " Reviewer@Example.com , second@example.com ,, ")
    assert result["review"] == ["reviewer@example.com", "second@example.com"], (
        "entries are trimmed, lowercased to match the lookup, and blanks dropped"
    )


def test_the_owner_account_stays_exempt(tmp_path):
    result = _probe(tmp_path, "reviewer@example.com")
    for email in result["admin"]:
        assert email in result["exempt"], "adding review accounts must not drop the owner"
