"""The native app carries its own copy of the policy pages (mobile/src/legal), generated from the website's templates while they exist.

The copy must never drift from the pages App Review and the law look at: this renders the real pages and fails if the generated file is stale.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERATED = ROOT / "mobile" / "src" / "legal" / "pages.generated.json"


def test_the_apps_copy_of_the_policy_pages_is_fresh():
    result = subprocess.run([sys.executable, "-W", "ignore", str(ROOT / "scripts" / "gen_mobile_legal.py"), "--check"], capture_output=True, text=True, cwd=ROOT)
    assert result.returncode == 0, "mobile/src/legal/pages.generated.json is stale: run `python scripts/gen_mobile_legal.py` and commit it"


def test_the_generated_pages_quote_the_live_numbers():
    """The website passes these into the templates from its config; the app's copy was rendered with them."""
    import app as website
    pages = json.loads(GENERATED.read_text(encoding="utf-8"))["pages"]

    def text(page):
        out = []
        for block in pages[page]["blocks"]:
            if block["type"] == "ul":
                out += ["".join(r["t"] for r in item["runs"]) for item in block["items"]]
            else:
                out.append("".join(r["t"] for r in block["runs"]))
        return "\n".join(out)

    assert f"{website.ACCOUNT_DELETION_GRACE_DAYS} days" in text("privacy")
    assert f"{website.app.config['PERMANENT_SESSION_LIFETIME'].days} days" in text("cookies")
    assert f"{website.APPLE_STATE_MAX_AGE // 60} minutes" in text("cookies")


def test_every_source_the_chats_can_cite_is_on_the_apps_sources_page():
    import health_sources
    pages = json.loads(GENERATED.read_text(encoding="utf-8"))["pages"]
    titles = {"".join(r["t"] for r in item["runs"]) for b in pages["sources"]["blocks"] if b["type"] == "ul" for item in b["items"]}
    missing = [s["title"] for s in health_sources.SOURCES if s["title"] not in titles]
    assert not missing, f"cited by the chats but missing from the sources page: {missing}"
