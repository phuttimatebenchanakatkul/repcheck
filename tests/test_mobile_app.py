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


# -- the chats agree with the server that answers them ---------------------------------------------------------------------------

def chat_source():
    return text(MOBILE / "src" / "logic" / "chat.ts")


def test_the_report_reasons_and_chats_are_the_servers():
    from api.social import AI_REPORT_FEATURES, AI_REPORT_REASONS
    source = chat_source()
    reasons = re.search(r"REPORT_REASONS = \[(.*?)\] as const", source, re.S).group(1)
    assert tuple(re.findall(r"'(\w+)'", reasons)) == AI_REPORT_REASONS
    feature = re.search(r"type ReportFeature = (.*?);", source).group(1)
    assert tuple(re.findall(r"'(\w+)'", feature)) == AI_REPORT_FEATURES


def test_the_message_limit_and_citation_rules_are_the_servers_and_the_websites():
    from api.chat import MAX_MESSAGE_CHARS
    source = chat_source()
    assert int(re.search(r"MAX_MESSAGE_CHARS = (\d+)", source).group(1)) == MAX_MESSAGE_CHARS
    website = text(ROOT / "static" / "ai_sources.js")
    assert "MAX_SOURCES = 3;" in source and "MAX_SOURCES = 3;" in website
    link_rule = r"/^https:\/\/[^\s" + "\"'" + r"<>]+$/"
    assert link_rule in source and link_rule in website, "a citation link is plain https, by the same pattern"


def test_the_coach_is_sent_its_own_role_name_and_the_others_theirs():
    assert 'turn.get("role") == "coach"' in text(ROOT / "coach_chat.py")
    assert 'turn.get("role") == "assistant"' in text(ROOT / "workout_chat.py")
    assert 'turn.get("role") == "assistant"' in text(ROOT / "analyze_chat.py")
    screen = text(MOBILE / "src" / "features" / "chat" / "CoachScreen.tsx")
    assert "historyForServer(history, 'coach')" in screen


def test_every_ai_reply_is_drawn_with_its_sources_disclaimer_and_report_button():
    """Guidelines 1.4.1 and 4.7.1. The chat view must put the footer under a reply, and the footer must carry all three."""
    assert "<ReplyFooter" in text(MOBILE / "src" / "features" / "chat" / "ChatView.tsx")
    footer = text(MOBILE / "src" / "features" / "chat" / "SourcesFooter.tsx")
    for needed in ("aiSources.label", "aiSources.all", "aiSources.disclaimer", "aiReport.button", "reportReply("):
        assert needed in footer


def test_the_sources_page_the_app_links_to_opens_without_an_account():
    footer = text(MOBILE / "src" / "features" / "chat" / "SourcesFooter.tsx")
    assert "https://repcheck-q0m4.onrender.com/sources" in footer
    assert '"health_sources_page"' in text(ROOT / "app.py")
    assert '@app.route("/sources"' in text(ROOT / "app.py")


def test_the_analysis_chat_is_told_what_the_website_tells_it():
    """The context the model gets about an analysis is the website's, field for field, and the server really sends every field."""
    website = re.search(r"AnalyzeChatWidget\.init\(\{(.*?)\}\);", text(ROOT / "templates" / "index.html"), re.S).group(1)
    sent = set(re.findall(r"^\s*(\w+):", website, re.M))
    source = chat_source()
    ours = set(re.findall(r"^\s+(\w+): analysis\.", re.search(r"function analysisChatContext.*?\n}\n", source, re.S).group(0), re.M))
    assert ours == sent == {"id", "created_at_ms", "exercise_label", "overall_score", "stretch_score", "squeeze_score", "reps", "feedback_text"}
    import datetime
    from api.analyze import result_json
    row = {"id": 1, "exercise_label": "x", "overall_score": 1, "stretch_score": 1, "squeeze_score": 1, "favored": "balanced", "reps": 1,
           "feedback_text": "## Positives\n- ok", "created_at": datetime.datetime(2026, 10, 27, tzinfo=datetime.timezone.utc)}
    assert sent <= set(result_json(row, None))


def test_an_analysis_chat_closes_when_the_website_closes_it():
    widget = text(ROOT / "static" / "analyze_chat_widget.js")
    assert "LOCK_AFTER_MS = 24 * 60 * 60 * 1000" in widget
    assert "ANALYSIS_CHAT_WINDOW_MS = 24 * 60 * 60 * 1000" in chat_source()


def test_the_workout_chat_is_told_the_summary_the_server_reads_in_the_websites_proportions():
    summary = text(MOBILE / "src" / "logic" / "workoutSummary.ts")
    website = text(ROOT / "templates" / "workouts.html")
    for name in ("RECENT_DAYS", "EXERCISE_HISTORY_SESSIONS", "MAX_EXERCISES_IN_HISTORY"):
        ours = re.search(rf"export const {name} = (\d+);", summary).group(1)
        theirs = re.search(rf"const {name} = (\d+);", website).group(1)
        assert ours == theirs, name
    assert "workout_summary" in text(ROOT / "workout_chat.py")
    assert "workout_summary" in text(MOBILE / "src" / "features" / "chat" / "WorkoutChatScreen.tsx")
    assert "workout_summary: buildRecentWorkoutSummary()" in website


def test_the_workout_chat_only_takes_questions_on_today():
    screen = text(MOBILE / "src" / "features" / "chat" / "WorkoutChatScreen.tsx")
    assert "closedText={isToday ? undefined" in screen
    assert "isSelectedDateToday" in text(ROOT / "templates" / "workouts.html")


# -- settings and the account ------------------------------------------------------------------------------------------------

def test_the_deletion_grace_period_the_app_states_is_the_servers():
    from api.accounts import GRACE_DAYS
    assert int(re.search(r"ACCOUNT_GRACE_DAYS = (\d+);", text(MOBILE / "src" / "logic" / "account.ts")).group(1)) == GRACE_DAYS


def test_every_page_settings_links_to_opens_without_an_account():
    """App Review and anyone not signed in must be able to read the policies (App Store Guideline 5.1.1)."""
    links = text(MOBILE / "src" / "links.ts")
    endpoints = {"/support": "support", "/privacy": "privacy", "/terms": "terms", "/cookies": "cookies", "/refunds": "refunds", "/sources": "health_sources_page"}
    app = text(ROOT / "app.py")
    public = app[app.index("_PUBLIC_ENDPOINTS"):app.index("@app.before_request")]
    for path, endpoint in endpoints.items():
        assert f"path: '{path}'" in links, path
        assert f'"{endpoint}"' in public, f"{endpoint} must be public"
    assert 'id="ai"' in text(ROOT / "templates" / "privacy.html"), "the AI switch links to #ai on the privacy page"


def test_the_app_can_delete_withdraw_and_rename_through_the_servers_routes():
    endpoints = text(MOBILE / "src" / "api" / "endpoints.ts")
    for call in ("api.del('/api/account')", "api.post('/api/account/restore')", "api.post('/api/ai-consent'", "api.post('/api/account', { name })"):
        assert call in endpoints, call
    account = text(ROOT / "api" / "routes" / "account.py")
    for route in ('@bp.delete("/api/account")', '@bp.post("/api/account/restore")', '@bp.post("/api/account")'):
        assert route in account, route
    settings = text(MOBILE / "src" / "features" / "settings" / "SettingsScreen.tsx")
    assert "scheduleDeletion" in settings and "restoreAccount" in settings and "setAiConsent(!on)" in settings


# -- the coaching wizard agrees with the engine that does the maths --------------------------------------------------------------

def coaching_source():
    return text(MOBILE / "src" / "logic" / "coachingProfile.ts")


def test_the_wizards_rate_limits_are_the_engines():
    import coaching_engine as engine
    source = coaching_source()

    def number(name):
        return float(re.search(rf"export const {name} = ([0-9.]+);", source).group(1))

    assert number("LOSS_RATE_MIN_PCT") == engine.LOSS_RATE_MIN_PCT
    assert number("LOSS_RATE_MAX_PCT") == engine.LOSS_RATE_MAX_PCT
    assert number("GAIN_RATE_MIN_PCT") == engine.GAIN_RATE_MIN_PCT
    assert number("GAIN_RATE_DEFAULT_PCT") == engine.GAIN_RATE_DEFAULT_PCT
    assert number("RATE_REFERENCE_WEIGHT_KG") == 75
    assert abs(number("LOSS_STANDARD_MIN_KG_PER_WEEK") / 75 * 100 - engine.LOSS_RATE_DEFAULT_PCT) < 1e-9
    assert abs(number("GAIN_STANDARD_MAX_KG_PER_WEEK") / 75 * 100 - engine.GAIN_RATE_MAX_PCT) < 1e-9


def test_the_wizards_choices_are_the_ones_the_server_accepts():
    from api.coaching import validate_profile
    source = coaching_source()

    def choices(name):
        return re.findall(r"'(\w+)'", re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.S).group(1))

    base = {"aspiration": "maintain", "gender": "male", "activity_level": "none", "protein_preference": "moderate", "body_fat_range_id": "m3", "weight_kg": 80}
    for field, name in (("aspiration", "ASPIRATIONS"), ("gender", "GENDERS"), ("activity_level", "ACTIVITY_LEVELS"), ("protein_preference", "PROTEIN_LEVELS"), ("diet_preference", "DIETS")):
        options = choices(name)
        assert options, name
        for option in options:
            payload = {**base, field: option}
            if field == "gender":
                payload["body_fat_range_id"] = "f3" if option == "female" else "m3"
            profile, error = validate_profile(payload)
            assert error is None, (field, option, error)
        assert validate_profile({**base, field: "not-a-choice"})[1], field


def test_the_body_types_and_their_pictures_are_the_engines_and_the_websites():
    import coaching_engine as engine
    ranges = json.loads(text(MOBILE / "src" / "data" / "bodyfat.json"))
    assert [r["id"] for r in ranges["male"]] == [r["id"] for r in engine.MALE_BODY_FAT_RANGES]
    assert [r["id"] for r in ranges["female"]] == [r["id"] for r in engine.FEMALE_BODY_FAT_RANGES]
    assert [r["label"] for r in ranges["male"] + ranges["female"]] == [r["label"] for r in engine.MALE_BODY_FAT_RANGES + engine.FEMALE_BODY_FAT_RANGES]
    pictures = text(MOBILE / "src" / "features" / "coaching" / "bodyImages.ts")
    for entry in ranges["male"] + ranges["female"]:
        mine = MOBILE / "assets" / "bodyfat" / f"{entry['id']}.webp"
        assert mine.read_bytes() == (ROOT / "static" / "bodyfat" / f"{entry['id']}.webp").read_bytes(), entry["id"]
        assert f"assets/bodyfat/{entry['id']}.webp" in pictures, entry["id"]


def test_the_wizards_request_has_every_field_the_server_reads():
    source = coaching_source()
    body = re.search(r"export function calculateBody.*?\n}\n", source, re.S).group(0)
    sent = set(re.findall(r"^\s+(\w+):", body, re.M))
    assert sent == {"aspiration", "gender", "weight_kg", "height_cm", "body_fat_range_id", "activity_level", "protein_preference", "diet_preference", "distribution", "loss_rate_pct", "gain_rate_pct", "training_days"}
    website = text(ROOT / "static" / "coaching.js")
    for field in sent:
        assert f"{field}:" in website, field


def test_the_wizard_saves_into_columns_that_exist():
    migration = "".join(path.read_text(encoding="utf-8") for path in sorted((ROOT / "supabase" / "migrations").glob("*.sql")))
    block = migration[migration.index("create table public.coaching_profiles"):]
    block = block[:block.index(");")]
    columns = set(re.findall(r"^\s+(\w+)\s", block, re.M))
    mapper = text(MOBILE / "src" / "data" / "mappers.ts")
    written = re.search(r"export function coachingRowFromData.*?\n}\n", mapper, re.S).group(0)
    for column in set(re.findall(r"^\s+(\w+):", written, re.M)) - {"user_id"}:
        assert column in columns, column
    assert "grant update (onboarding_completed) on public.profiles to authenticated" in migration


# -- the weekly check-in agrees with the website and the server ---------------------------------------------------------------------

def checkin_source():
    return text(MOBILE / "src" / "logic" / "checkin.ts")


def test_the_checkins_request_has_every_field_the_server_reads():
    source = checkin_source()
    body = re.search(r"export function checkinRequest.*?\n}\n", source, re.S).group(0)
    body = body[body.index("return {"):]
    sent = set(re.findall(r"^\s+(\w+):", body, re.M))
    assert sent == {"aspiration", "gender", "weight_kg", "body_fat_range_id", "activity_level", "protein_preference", "diet_preference", "loss_rate_pct", "gain_rate_pct",
                    "current_targets", "week_weight_entries", "week_calorie_days", "photo_ids"}
    website = text(ROOT / "static" / "coaching.js")
    route = text(ROOT / "api" / "routes" / "coaching.py")
    for field in sent:
        assert f"{field}:" in website, field
    for field in ("current_targets", "week_weight_entries", "week_calorie_days", "photo_ids"):
        assert f'"{field}"' in route, field
    # the day lists the server averages are { date, kg } / { date, calories }, as the website sends them
    assert "{ date: w.day, kg: w.kg }" in source and "{ date: d.day, calories: d.calories }" in source


def test_the_checkins_cadence_calories_and_streak_are_the_websites():
    source = checkin_source()
    website = text(ROOT / "static" / "coaching.js")
    assert re.search(r"export const CHECKIN_INTERVAL_DAYS = 7;", source) and "Math.max(0, 7 - daysSince(lastCheck))" in website
    assert "Math.round(goals.protein * 4 + goals.fat * 9 + goals.carbs * 4)" in source
    assert "Math.round(currentGoals.protein * 4 + currentGoals.fat * 9 + currentGoals.carbs * 4)" in website
    assert 'RepCheckStreak.mark("checkin")' in website
    assert "'checkin'" in text(MOBILE / "src" / "data" / "access.ts")


def test_the_checkins_photos_are_what_the_server_takes():
    from api import photos
    import checkin_analyzer
    source = text(MOBILE / "src" / "api" / "coaching.ts")
    angles = re.search(r"export type PhotoAngle = (.*?);", source).group(1)
    assert tuple(re.findall(r"'(\w+)'", angles)) == photos.ANGLES
    route = text(ROOT / "api" / "routes" / "photos.py")
    for field in ("photo", "angle", "date"):
        assert f"form.append('{field}'" in source, field
        assert f'"{field}"' in route, field
    assert "/api/checkin/photo" in source and '"/api/checkin/photo"' in route
    # the wait leaves room for the model's own cap plus the upload and the trip
    timeout = int(re.search(r"CHECKIN_TIMEOUT_MS = ([0-9_]+);", source).group(1).replace("_", ""))
    assert timeout >= checkin_analyzer.CHECKIN_ANALYSIS_TIMEOUT_SECONDS * 1000 + 15_000


def test_the_checkin_saves_into_columns_that_exist():
    migration = "".join(path.read_text(encoding="utf-8") for path in sorted((ROOT / "supabase" / "migrations").glob("*.sql")))
    block = migration[migration.index("create table public.coaching_profiles"):]
    block = block[:block.index(");")]
    columns = set(re.findall(r"^\s+(\w+)\s", block, re.M))
    mapper = text(MOBILE / "src" / "data" / "mappers.ts")
    written = re.search(r"export function coachingRowAfterCheckin.*?\n}\n", mapper, re.S).group(0)
    used = set(re.findall(r"\b(last_adjustment_\w+|goal_\w+_(?:weight_kg|aspiration)|[a-z_]+_on)\b", written)) - {"checkin_on"}
    assert used >= {"last_adjustment_on", "last_adjustment_reason", "last_adjustment_delta", "last_adjustment_at", "goal_handled_weight_kg", "goal_handled_aspiration", "goal_achieved_weight_kg", "goal_achieved_aspiration"}
    for column in used:
        assert column in columns, column


# -- friends, blocking and reporting agree with the server and the website ------------------------------------------------------------

def test_the_report_reasons_and_endpoints_are_the_servers():
    from api import social
    source = text(MOBILE / "src" / "api" / "social.ts")
    reasons = re.search(r"export const REPORT_REASONS = \[(.*?)\] as const;", source, re.S).group(1)
    assert tuple(re.findall(r"'(\w+)'", reasons)) == social.REPORT_REASONS
    route = text(ROOT / "api" / "routes" / "social.py")
    for path in re.findall(r"'(/api/(?:friends|safety)[^']*)'", source):
        assert f'"{path}"' in route, path
    for field in ("user_id", "reason", "code"):
        assert f"{field}" in source
    sheet = text(MOBILE / "src" / "features" / "social" / "SafetySheet.tsx")
    website = text(ROOT / "static" / "safety.js")
    for key in re.findall(r"'(safety\.reason\.\w+)'", sheet):
        assert f'"{key}"' in website, key


def test_the_friend_qr_is_the_websites_link_and_the_code_limit_is_the_servers():
    from api import social
    logic = text(MOBILE / "src" / "logic" / "social.ts")
    assert f"MAX_FRIEND_CODE_CHARS = {social.MAX_FRIEND_CODE_CHARS};" in logic
    assert "/friends?add=${encodeURIComponent(code)}" in logic
    assert 'friends?add={' in text(ROOT / "app.py")        # the website's own QR encodes the same page


def test_the_app_never_reads_contacts():
    """The website dropped 'suggest from contacts' (it read them and did nothing: Guideline 5.1.2); the app must not bring it back."""
    package = text(MOBILE / "package.json")
    assert "expo-contacts" not in package
    assert "NSContactsUsageDescription" not in text(MOBILE / "app.json")
    assert "suggestFromContacts" not in "".join(p.read_text(encoding="utf-8") for p in (MOBILE / "src" / "features").rglob("*.tsx"))


def test_every_place_another_persons_name_is_shown_can_report_and_block_them():
    """Guideline 1.2: the friends list is the one place another account's name shows so far; it must open the report / block sheet."""
    screen = text(MOBILE / "src" / "features" / "social" / "FriendsScreen.tsx")
    assert "<SafetySheet" in screen and "safety.moreActions" in screen
    assert "BlockedSection" in text(MOBILE / "src" / "features" / "settings" / "SettingsScreen.tsx")


def test_the_consent_question_names_chat_messages():
    assert "aiConsent.item3" in text(MOBILE / "src" / "ui" / "AiConsent.tsx")


def test_every_chat_checks_consent_before_it_sends():
    session = text(MOBILE / "src" / "features" / "chat" / "useChatSession.ts")
    assert "if (!consented)" in session and session.index("if (!consented)") < session.index("await run(message)")


def test_the_consent_question_names_videos_before_a_clip_is_sent():
    """Each kind of thing the app sends to the AI service is listed in the question that gates it (App Review)."""
    question = text(MOBILE / "src" / "ui" / "AiConsent.tsx")
    assert "aiConsent.item2" in question
    screen = text(MOBILE / "src" / "features" / "analyze" / "AnalyzeScreen.tsx")
    assert "if (!consented)" in screen and screen.index("if (!consented)") < screen.index("void run()"), "consent is checked before the upload starts"
