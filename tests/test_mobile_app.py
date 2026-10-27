"""Guards for the native app's source (mobile/): the things that cross the boundary between it and the rest of the repo.
Its own logic is tested by Jest (`cd mobile && npm run check`); these cover what Jest cannot see from inside."""

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "mobile"
SECRET_SHAPES = re.compile(r"sb_secret_[A-Za-z0-9_-]{8,}|service_role|SERVICE_ROLE|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.")


def text(path):
    return Path(path).read_text(encoding="utf-8")


def app_config():
    return json.loads(text(MOBILE / "app.json"))["expo"]


def source_files():
    for folder in (MOBILE / "src", MOBILE / "scripts"):
        for path in folder.rglob("*"):
            if path.is_file() and path.suffix in {".ts", ".tsx", ".js", ".json"}:
                yield path


# -- it is an update to the existing App Store listing ----------------------------------------------------------------------

def test_the_bundle_id_is_the_existing_listings():
    existing = json.loads(text(ROOT / "capacitor.config.json"))["appId"]
    assert app_config()["ios"]["bundleIdentifier"] == existing == "com.benchanakatkul.repcheck"


def test_it_is_universal_and_offers_sign_in_with_apple():
    ios = app_config()["ios"]
    assert ios["supportsTablet"] is True, "the listing ships Universal (IOS_APP_STORE.md)"
    assert ios["usesAppleSignIn"] is True, "Guideline 4.8: a login with Google must also offer Apple"
    assert "expo-apple-authentication" in app_config()["plugins"]


def test_it_declares_no_non_exempt_encryption_like_the_current_app():
    assert app_config()["ios"]["infoPlist"]["ITSAppUsesNonExemptEncryption"] is False


def test_the_version_is_above_every_version_the_store_has_seen():
    store = [int(n) for n in "0.12.10".split(".")]          # IOS_APP_STORE.md: the last approved release
    mine = [int(n) for n in app_config()["version"].split(".")]
    assert mine > store


# -- nothing secret ships inside the app -------------------------------------------------------------------------------------

def test_mobile_env_files_are_ignored_and_the_example_holds_only_placeholders():
    ignored = subprocess.run(["git", "check-ignore", "-q", "mobile/.env"], cwd=ROOT).returncode == 0
    assert ignored, "mobile/.env must be gitignored"
    example = text(MOBILE / ".env.example")
    assert "sb_publishable_..." in example and "<project-ref>" in example
    assert not SECRET_SHAPES.search(example)
    for line in example.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            assert line.split("=", 1)[0].startswith("EXPO_PUBLIC_"), f"{line!r} would not even reach the app, and must not be a secret"


def test_no_secret_key_material_appears_in_the_apps_source():
    allowed = {"config.ts", "config.test.ts"}                # the guard that REFUSES a secret key has to name it
    for path in source_files():
        if path.name in allowed:
            continue
        found = SECRET_SHAPES.search(text(path))
        assert not found, f"{path.relative_to(ROOT)} contains {found.group(0)[:20]!r}"


def test_the_app_never_reads_a_non_public_environment_variable():
    for path in source_files():
        for name in re.findall(r"process\.env\.([A-Z0-9_]+)", text(path)):
            assert name.startswith("EXPO_PUBLIC_") or name == "NODE_ENV", f"{path.name} reads process.env.{name}, which a build would not inline"


def test_neither_image_ships_the_apps_sources():
    ignored = text(ROOT / ".dockerignore").splitlines()
    assert "mobile/" in ignored


# -- the app says what the website says --------------------------------------------------------------------------------------

def normalise(markup):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", markup)).strip()


def test_the_sign_up_consent_notice_is_the_websites_word_for_word():
    """Guideline 5.1.2(i): the specific disclosure that review accepted must not drift when it moves into the app."""
    website = re.search(r'<p class="auth-consent">(.*?)</p>', text(ROOT / "templates" / "signup.html"), re.S).group(1)
    en = json.loads(text(MOBILE / "src" / "i18n" / "app.en.json"))
    ours = "".join(en[f"app.auth.consent.{part}"] for part in ("pre", "terms", "mid", "privacy", "post"))
    assert normalise(ours) == normalise(website)


def test_the_policy_links_open_the_websites_public_pages():
    screen = text(MOBILE / "src" / "app" / "(auth)" / "sign-in.tsx")
    base = "https://repcheck-q0m4.onrender.com"
    assert f"'{base}/terms'" in screen and f"'{base}/privacy'" in screen
    app = text(ROOT / "app.py")
    assert '"terms"' in app and '"privacy"' in app            # both are in _PUBLIC_ENDPOINTS, so they open without an account


# -- the generated types match the live schema --------------------------------------------------------------------------------

def test_the_generated_database_types_match_the_live_project():
    from test_supabase_rls import needs_api, needs_db            # skip rules shared with the other live suites
    if needs_api.args[0] or needs_db.args[0]:
        pytest.skip("needs the Supabase variables in .env")
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "gen_supabase_types.py"), "--check"], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_the_types_only_cover_tables_the_app_may_read_and_name_no_server_only_table():
    generated = text(MOBILE / "src" / "supabase" / "database.types.ts")
    for server_only in ("rate_limits", "usage_events", "content_reports", "ai_reports", "waitlist", "auth_throttle", "legacy_password_hashes", "friends", "challenges", "challenge_submissions"):
        assert not re.search(rf"^\s+{server_only}: \{{", generated, re.M), f"{server_only} is server-only: the app goes through the API"
    assert re.search(r"^\s+nutrition_entries: \{", generated, re.M)


# -- the analyze screens agree with the server that grades the clip ------------------------------------------------------------

def test_the_feedback_fixtures_are_what_the_servers_splitter_produces_now():
    """The app's report reader is tested against these; if the server's markdown output changes, the reader must be re-checked."""
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "export_feedback_fixtures.py"), "--check"], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_the_app_names_the_extensions_the_server_accepts():
    from api.analyze import ALLOWED_EXTENSIONS, RECORDED_EXTENSIONS
    source = text(MOBILE / "src" / "api" / "analyze.ts")
    listed = re.search(r"const EXTENSIONS = \[(.*?)\] as const", source, re.S).group(1)
    assert {f".{name}" for name in re.findall(r"'(\w+)'", listed)} == ALLOWED_EXTENSIONS | RECORDED_EXTENSIONS


def test_the_app_never_films_longer_than_the_server_will_grade():
    from trim_video import DURATION_SECONDS, START_SECONDS
    source = text(MOBILE / "src" / "ui" / "videos.ts")
    seconds = int(re.search(r"MAX_RECORD_SECONDS = (\d+)", source).group(1))
    assert seconds == START_SECONDS + DURATION_SECONDS


def test_the_app_says_how_many_analyses_the_server_keeps():
    from api.analyze import HISTORY_KEEP
    en = json.loads(text(MOBILE / "src" / "i18n" / "app.en.json"))
    th = json.loads(text(MOBILE / "src" / "i18n" / "app.th.json"))
    assert str(HISTORY_KEEP) in en["app.analyze.notFound"] and str(HISTORY_KEEP) in th["app.analyze.notFound"]


def test_the_camera_and_microphone_are_explained_for_filming_a_set():
    """Guideline 5.1.1: each permission prompt must say what it is for. The picker records sound with a video, so it needs the microphone text."""
    picker = next(p for p in app_config()["plugins"] if isinstance(p, list) and p[0] == "expo-image-picker")[1]
    for key in ("photosPermission", "cameraPermission", "microphonePermission"):
        assert picker.get(key), f"expo-image-picker needs {key}"
    assert "form" in picker["cameraPermission"] and "form" in picker["photosPermission"]
    assert "expo-video" in app_config()["plugins"]


def test_the_consent_question_names_videos_before_a_clip_is_sent():
    """Each kind of thing the app sends to the AI service is listed in the question that gates it (App Review)."""
    question = text(MOBILE / "src" / "ui" / "AiConsent.tsx")
    assert "aiConsent.item2" in question
    screen = text(MOBILE / "src" / "features" / "analyze" / "AnalyzeScreen.tsx")
    assert "if (!consented)" in screen and screen.index("if (!consented)") < screen.index("void run()"), "consent is checked before the upload starts"
