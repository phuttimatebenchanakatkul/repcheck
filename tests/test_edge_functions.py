"""The Edge Functions (supabase/functions) are the Flask api/ ported, so the facts the two must share are pinned here.

The functions' own behaviour is tested in TypeScript (`cd supabase/functions && npx deno task test`); this file only checks
the seams that cross languages: the numbers, the messages and the routes that have to be the same on both sides.
"""

import json
import re
from pathlib import Path

from api import consent as flask_consent, limits as flask_limits

ROOT = Path(__file__).resolve().parent.parent
FUNCTIONS = ROOT / "supabase" / "functions"


def text(*parts):
    return (FUNCTIONS.joinpath(*parts)).read_text(encoding="utf-8")


def test_the_rate_limits_are_the_flask_apis():
    block = re.search(r"export const RATE_LIMITS = \{(.*?)\} as const", text("_shared", "limits.ts"), re.S).group(1)
    found = {}
    for name, uses, window in re.findall(r"(\w+): \[(\d+), ([^\]]+)\]", block):
        found[name] = (int(uses), eval(window, {"DAY": flask_limits.DAY}))      # noqa: S307 -- a literal like `5 * 60 * 60` from our own file
    assert found == flask_limits.RATE_LIMITS


def test_the_consent_refusal_says_what_flask_says():
    source = text("_shared", "consent.ts")
    assert re.search(r'CONSENT_ERROR = "([^"]+)"', source).group(1) == flask_consent.CONSENT_ERROR
    assert "needs_ai_consent: true" in source and ", 403)" in source


def test_the_limit_messages_are_flasks():
    source = text("_shared", "limits.ts")
    for phrase in ("You've used your ${uses} workout ${plural} for now", "You've reached your limit for now", "try again in ${friendlyWait(retryAfter)}"):
        assert phrase in source
    assert flask_limits.limit_message("ai_chat", 600) == "You've reached your limit for now — try again in about 10 minutes."


def test_every_route_the_functions_serve_is_one_flask_serves_with_the_same_method():
    from api.app import create_app
    from api.settings import Settings
    flask_routes = set()
    settings = Settings(supabase_url="https://abc.supabase.co", service_key="x", db_url="postgresql://offline")
    app = create_app(settings, db=object(), verifier=object(), storage=object(), auth_admin=object(), analyzer=object(), ai=object(), sweep=False)
    for rule in app.url_map.iter_rules():
        for method in rule.methods - {"HEAD", "OPTIONS"}:
            flask_routes.add((method, rule.rule))
    ported = []
    for path in sorted((FUNCTIONS / "api" / "routes").glob("*.ts")):
        ported += re.findall(r'router\.(get|post|delete)\(\s*"(/api/[^"]+)"', path.read_text(encoding="utf-8"))
    assert ported, "no routes found: the pattern in this test no longer matches how routes are written"
    for method, route in ported:
        assert (method.upper(), route) in flask_routes, f"{method.upper()} {route} is not a Flask route"


def test_the_function_checks_the_token_itself_and_pins_its_dependencies():
    config = json.loads((FUNCTIONS / "deno.json").read_text(encoding="utf-8"))
    for name, spec in config["imports"].items():
        assert re.search(r"@\d+\.\d+\.\d+$", spec), f"{name} must be pinned to an exact version: {spec}"
    auth = text("_shared", "auth.ts")
    assert 'ALGORITHMS = ["ES256", "RS256"]' in auth, "never HS256 and never none"
    assert 'role !== "authenticated"' in auth and "is_anonymous" in auth


def test_no_secret_is_written_into_the_functions():
    for path in FUNCTIONS.rglob("*.ts"):
        if "tests" in path.parts:
            continue                                     # the tests hold fake tokens on purpose
        source = path.read_text(encoding="utf-8")
        assert not re.search(r"sb_secret_|eyJhbGciOi|AIza[0-9A-Za-z_-]{20,}|postgres(ql)?://[^\s\"']*:[^\s\"'@]+@", source), path.name
