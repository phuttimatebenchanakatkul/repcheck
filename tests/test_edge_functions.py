"""The Edge Functions (supabase/functions) are the Flask api/ ported, so the facts the two must share are pinned here.

The functions' own behaviour is tested in TypeScript (`cd supabase/functions && npx deno task test`); this file only checks
the seams that cross languages: the numbers, the messages and the routes that have to be the same on both sides.
"""

import json
import random
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

import pytest

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


def test_the_generated_name_filter_data_is_fresh():
    """nameFilterData.ts is written from name_filter.py by scripts/gen_edge_name_filter.py; a word added to one and not the other fails here."""
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "gen_edge_name_filter.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, "run `python scripts/gen_edge_name_filter.py` to regenerate supabase/functions/_shared/nameFilterData.ts"


def _name_corpus():
    import name_filter
    rng = random.Random(20261028)
    words = sorted(name_filter._BAD_WORDS)
    innocents = ["classic", "assassin", "Scunthorpe", "Sam Lifter", "Dickens", "Hancock", "cocktail", "Essex", "Bassist", "Mary-Jane", "O'Brien", "José", "Zoë", "Ægir",
                 "สมชาย ลิฟเตอร์", "山田 太郎", "Максим", "\U0001f3cb️ Sam", "", " ", "   ", "\t", "a", "Z" * 60, "Z" * 61, "\U0001f3cb" * 60, "\U0001f3cb" * 61]
    leet = {"o": "0", "i": "1", "e": "3", "a": "4", "s": "5", "t": "7", "b": "8", "g": "9"}
    marks = ["́", "̈", "̣", "ͅ", "ั", "่", "ً", "़", "‍", "️"]
    spacers = [" ", ".", "-", "_", "*", "  ", " ", "　", "​"]
    weird = ["\x00", "\x07", "\x1c", "\x1f", "\x7f", "\x85", "﻿", "‮", "⁦", " ", "\n", "\t", "᠎", "‌"]
    corpus = list(innocents)
    for _ in range(900):
        word = rng.choice(words)
        kind = rng.randrange(8)
        if kind == 0:
            word = "".join(leet.get(c, c) if rng.random() < .5 else c for c in word)
        elif kind == 1:
            word = "".join(c + (rng.choice(marks) if rng.random() < .3 else "") for c in word)
        elif kind == 2:
            word = "".join(c * rng.randint(1, 4) for c in word)
        elif kind == 3:
            word = rng.choice(spacers).join(word)
        elif kind == 4:
            word = "".join(c.upper() if rng.random() < .5 else c for c in word)
        elif kind == 5:
            word = unicodedata.normalize("NFKD", word + "é" * rng.randint(0, 2))
        elif kind == 6:
            word = rng.choice(innocents[:10]) + rng.choice(spacers) + word + rng.choice(spacers) + rng.choice(innocents[:10])
        else:
            word = "".join(c + (rng.choice(weird) if rng.random() < .15 else "") for c in word)
        corpus.append(word)
    for _ in range(500):
        alphabet = [chr(rng.choice([rng.randint(32, 126), rng.randint(0xA0, 0x24F), rng.randint(0x300, 0x36F), rng.randint(0xE00, 0xE7F), rng.randint(0x2000, 0x206F), rng.randint(0x1F300, 0x1F64F)])) for _ in range(rng.randint(1, 12))]
        corpus.append("".join(alphabet + [rng.choice(weird) for _ in range(rng.randint(0, 2))]))
    for _ in range(100):
        corpus.append(rng.choice(weird) + "Sam" + rng.choice(weird) + " ")
        corpus.append(" ".join(rng.choice(words) for _ in range(rng.randint(2, 4))))
    return corpus


def test_the_name_filter_answers_exactly_as_python_does_over_a_seeded_corpus(tmp_path):
    """Runs the TypeScript filter over ~1,600 names (bad words dressed up every way the filter claims to see through, accents and marks in every script, whitespace and control characters, emoji) and demands Python's answer for each."""
    if shutil.which("npx") is None:
        pytest.skip("npx is not installed (Deno comes from npm)")
    from api import accounts
    import name_filter
    corpus = _name_corpus()
    path = tmp_path / "names.json"
    path.write_text(json.dumps(corpus), encoding="utf-8")
    run = subprocess.run(["npx", "--yes", "deno", "run", "--allow-read", "--config", str(FUNCTIONS / "deno.json"), str(FUNCTIONS / "tests" / "parity.check.ts"), str(path)],
                         capture_output=True, text=True, encoding="utf-8", shell=sys.platform == "win32", timeout=300)
    assert run.returncode == 0, run.stderr[-2000:]
    answers = json.loads(run.stdout)
    assert len(answers) == len(corpus)
    wrong = []
    for name, (bad, validated, cleaned) in zip(corpus, answers):
        try:
            expect_clean = accounts.clean_name(name)
        except accounts.NameRejected as rejected:
            expect_clean = "ERR:" + str(rejected)
        expected = [name_filter.contains_bad_word(name), name_filter.validate_display_name(name), expect_clean]
        if [bad, validated, cleaned] != expected:
            wrong.append((name, [bad, validated, cleaned], expected))
    assert not wrong, f"{len(wrong)} of {len(corpus)} differ, first: {wrong[:3]!r}"
    assert sum(1 for n in corpus if name_filter.contains_bad_word(n)) > 300, "the corpus must contain plenty of names the filter actually blocks"


def test_the_account_constants_are_the_flask_apis():
    from api import accounts
    source = text("_shared", "accounts.ts")
    assert int(re.search(r"GRACE_DAYS = (\d+)", source).group(1)) == accounts.GRACE_DAYS
    assert int(re.search(r"MAX_NAME_LENGTH = (\d+)", source).group(1)) == accounts.MAX_NAME_LENGTH
    assert int(re.search(r"FRIEND_CODE_ATTEMPTS = (\d+)", source).group(1)) == accounts.FRIEND_CODE_ATTEMPTS
    assert re.findall(r'"([a-z-]+)"', re.search(r"BUCKETS = \[(.*?)\] as const", source).group(1)) == list(accounts.BUCKETS)
    assert re.search(r'PROFILE_COLUMNS = "([^"]+)"', source).group(1) == accounts.PROFILE_COLUMNS
    bidi = {int(h, 16) for h in re.findall(r"0x([0-9A-F]{4})", re.search(r"BIDI_CONTROLS = new Set\(\[(.*?)\]\)", source).group(1))}
    assert bidi == {ord(c) for c in accounts.BIDI_CONTROLS}


def test_the_retry_and_batch_numbers_of_the_supabase_clients_are_flasks():
    from api import supabase_admin
    source = text("_shared", "supabaseAdmin.ts")
    assert {int(n) for n in re.findall(r"\d+", re.search(r"RETRY_STATUSES = new Set\(\[(.*?)\]\)", source).group(1))} == set(supabase_admin.RETRY_STATUSES)
    assert int(re.search(r"DELETE_BATCH = (\d+)", source).group(1)) == supabase_admin.DELETE_BATCH
    assert set(re.findall(r'"(\d+)"', re.search(r"REFUSED_BY_BUCKET = new Set\(\[(.*?)\]\)", source).group(1))) == set(supabase_admin.REFUSED_BY_BUCKET)
    assert int(re.search(r"ATTEMPTS = (\d+)", source).group(1)) == 4, "Flask tries four times"


def _run_edge_parity(tmp_path, payload):
    if shutil.which("npx") is None:
        pytest.skip("npx is not installed (Deno comes from npm)")
    path = tmp_path / "input.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    run = subprocess.run(["npx", "--yes", "deno", "run", "--allow-read", "--config", str(FUNCTIONS / "deno.json"), str(FUNCTIONS / "tests" / "parity_more.check.ts"), str(path)],
                         capture_output=True, text=True, encoding="utf-8", shell=sys.platform == "win32", timeout=600)
    assert run.returncode == 0, run.stderr[-2000:]
    return json.loads(run.stdout)


def test_werkzeug_password_hashes_verify_in_typescript_exactly_as_in_python(tmp_path):
    """Every hash method Werkzeug can have written (scrypt of several costs, pbkdf2 of every digest), unicode passwords, wrong passwords and
    stored values of every wrong shape: TypeScript must say what Python's check_password_hash says (where Python raises, 'no match')."""
    from werkzeug.security import check_password_hash, generate_password_hash
    rng = random.Random(7)
    passwords = ["old-password-1", "x", "pässwörd-☃", "\U0001f3cb" * 5, "a" * 200, "with space and \t tab", "สวัสดี", "ñ", "café", "café", "\u0000nul"[1:]]
    methods = ["scrypt:1024:8:1", "scrypt:2048:8:2", "scrypt:16384:4:1", "pbkdf2:sha256:1000", "pbkdf2:sha1:500", "pbkdf2:sha224:300", "pbkdf2:sha384:300", "pbkdf2:sha512:300", "pbkdf2:sha256:1"]
    pairs, expected = [], []
    for method in methods:
        for pw in rng.sample(passwords, 4):
            stored = generate_password_hash(pw, method=method)
            for attempt in (pw, pw + "x", pw[:-1], pw.upper(), ""):
                pairs.append([stored, attempt])
                expected.append(check_password_hash(stored, attempt))
    good = generate_password_hash("x", method="scrypt:1024:8:1")
    method, salt, digest = good.split("$")
    malformed = ["", "plain", "$$", "x$y", f"{method}${salt}", f"md5${salt}${digest}", f"scrypt${salt}${digest}", f"scrypt:1024:8${salt}${digest}", f"{method}${salt}${digest[:-2]}",
                 f"{method}${salt}${digest}00", f"{method}${salt}${digest.upper()}", f"{method}${salt}x${digest}", f"{method}${salt}$", f"{method}$${digest}", f"pbkdf2:md5:10${salt}${digest}"]
    for stored in malformed:
        pairs.append([stored, "x"])
        try:
            expected.append(check_password_hash(stored, "x"))
        except ValueError:
            expected.append(False)
    answers = _run_edge_parity(tmp_path, {"hashes": pairs})["hashes"]
    assert answers == expected
    assert sum(expected) >= 36, "the corpus must contain plenty of real matches"


def test_email_cleaning_answers_exactly_as_python_does_over_a_seeded_corpus(tmp_path):
    from api import admin
    rng = random.Random(11)
    pieces = ["sam", "SAM", "a.b", "o'brien", "üser", "ส", "x", "", " ", " ", "　", "﻿", "\x85", "\x1c", "\x07", "\x7f", "\n", "\t", "@", ".", "..", "-", "_", "+tag", "‮", "example", "COM", "co.uk"]
    corpus = ["sam@example.com", "  Sam@Example.COM  ", "a@b.c", "a@b", "@b.c", "a@.c", "a@b.", "a b@c.d", "a@b c.d", "a@@b.c", "a@b@c.d", "a@b.c\n", "\ta@b.c", "a" * 250 + "@b.co", "a" * 249 + "@b.co", None, 5, [], {}, True]
    for _ in range(1500):
        corpus.append("".join(rng.choice(pieces) for _ in range(rng.randint(1, 7))))
    for _ in range(300):
        corpus.append(rng.choice(["", " ", " "]) + "u" + rng.choice(["", "x"]) + "@" + rng.choice(["d", "dd", "d.e", "d.e.f"]) + rng.choice(["", ".c", ".co", " ", "\n"]))
    expected = [admin.clean_email(raw) for raw in corpus]
    assert _run_edge_parity(tmp_path, {"emails": corpus})["emails"] == expected
    assert sum(1 for e in expected if e) > 150 and sum(1 for e in expected if e is None) > 300


def _images():
    """Pictures Pillow makes, in every format and mode the app might meet, and damaged versions of them."""
    import base64
    import io
    from PIL import Image
    rng = random.Random(3)
    out = {}
    for fmt, kwargs in (("PNG", {}), ("PNG", {"optimize": True}), ("JPEG", {"quality": 90}), ("JPEG", {"progressive": True}), ("JPEG", {"subsampling": 0}), ("WEBP", {"lossless": True}),
                        ("WEBP", {"quality": 60}), ("GIF", {}), ("BMP", {}), ("TIFF", {})):
        for mode in ("RGB", "L", "RGBA", "P"):
            if fmt == "JPEG" and mode in ("RGBA", "P"):
                continue
            if fmt == "GIF" and mode == "RGBA":
                continue
            for size in ((1, 1), (5, 3), (64, 48), (300, 200)):
                image = Image.effect_noise(size, 40).convert(mode if mode != "P" else "RGB")
                if mode == "P":
                    image = image.convert("P")
                buffer = io.BytesIO()
                image.save(buffer, fmt, **kwargs)
                out[f"{fmt}-{mode}-{size}-{sorted(kwargs)}"] = buffer.getvalue()
    return out


def test_images_are_judged_in_typescript_as_pillow_judges_them(tmp_path):
    """Real pictures in the three formats the app takes are accepted with the right extension and type; GIF, BMP and TIFF are 'unsupported'; and the ways a
    PNG can be damaged (a flipped byte, a cut-off file) are refused, as Pillow's verify() refuses them. (JPEG and WebP damage is not compared byte by byte:
    Pillow's own checks there are weaker or stronger in places, and what matters is that cut-off files are not taken.)"""
    import base64
    import io
    from PIL import Image
    samples = _images()
    rng = random.Random(5)
    cases, expected = [], []

    def pillow(data):
        try:
            probe = Image.open(io.BytesIO(data))
            fmt = probe.format
            probe.verify()
        except Exception:                    # noqa: BLE001
            return "ERR:400:That file isn't a readable image."
        if fmt not in ("JPEG", "PNG", "WEBP"):
            return "ERR:400:Unsupported image format."
        return {"JPEG": [".jpg", "image/jpeg"], "PNG": [".png", "image/png"], "WEBP": [".webp", "image/webp"]}[fmt]

    for name, data in samples.items():
        cases.append(base64.b64encode(data).decode())
        expected.append(pillow(data))
        if name.startswith("PNG") and len(data) > 40:
            for _ in range(3):
                damaged = bytearray(data)
                damaged[rng.randrange(8, len(damaged))] ^= 1 << rng.randrange(8)
                cases.append(base64.b64encode(bytes(damaged)).decode())
                expected.append(pillow(bytes(damaged)))
            cut = data[: rng.randrange(8, len(data) - 1)]
            cases.append(base64.b64encode(cut).decode())
            expected.append(pillow(cut))
    answers = _run_edge_parity(tmp_path, {"images": cases})["images"]
    mismatches = [(i, a, e) for i, (a, e) in enumerate(zip(answers, expected)) if a != e]
    assert not mismatches, f"{len(mismatches)} of {len(cases)} differ, first: {mismatches[:3]!r}"
    assert sum(1 for e in expected if isinstance(e, list)) > 60 and sum(1 for e in expected if isinstance(e, str)) > 60


def test_images_cut_off_before_their_end_are_refused_whatever_the_format(tmp_path):
    import base64
    samples = {k: v for k, v in _images().items() if k.split("-")[0] in ("PNG", "JPEG", "WEBP") and len(v) > 200}
    rng = random.Random(9)
    cases = []
    for data in list(samples.values())[:60]:
        cases.append(base64.b64encode(data[: rng.randrange(1, 12)]).decode())       # only a few bytes of it
    answers = _run_edge_parity(tmp_path, {"images": cases})["images"]
    assert all(isinstance(a, str) and a.startswith("ERR:") for a in answers), answers


def test_the_photo_and_legacy_login_constants_are_the_flask_apis():
    from api import legacy, photos
    source = text("_shared", "photos.ts")
    assert int(re.search(r"PHOTO_LIMIT = (\d+)", source).group(1)) == photos.PHOTO_LIMIT
    assert eval(re.search(r"MAX_PHOTO_BYTES = ([\d* ]+)", source).group(1)) == photos.MAX_PHOTO_BYTES     # noqa: S307 -- a literal like `12 * 1024 * 1024` from our own file
    assert re.search(r'BUCKET = "([^"]+)"', source).group(1) == photos.BUCKET
    assert tuple(re.findall(r'"(\w+)"', re.search(r"ANGLES = \[(.*?)\] as const", source).group(1))) == photos.ANGLES
    assert photos.over_limit_message() == "You've reached the maximum of 500 saved items here. Delete some to add more."
    assert "You've reached the maximum of ${PHOTO_LIMIT.toLocaleString(\"en-US\")} saved items here. Delete some to add more." in source
    route = text("api", "routes", "photos.ts")
    assert int(re.search(r"SIGNED_URL_SECONDS = (\d+)", route).group(1)) == 300
    assert "MAX_PHOTO_BYTES + 64 * 1024" in route
    login = text("_shared", "legacy.ts")
    for name in ("MAX_PASSWORD_CHARS", "EMAIL_ATTEMPTS", "CALLER_ATTEMPTS"):
        assert int(re.search(rf"{name} = (\d+)", login).group(1)) == getattr(legacy, name), name
    for name in ("EMAIL_WINDOW", "CALLER_WINDOW"):
        assert eval(re.search(rf"{name} = ([\d* ]+)", login).group(1)) == getattr(legacy, name), name    # noqa: S307


def test_the_legacy_login_messages_are_flasks():
    from api.routes import legacy as flask_route
    route = text("api", "routes", "legacy.ts")
    assert re.search(r'MISMATCH = "([^"]+)"', route).group(1) == flask_route.MISMATCH
    for phrase in ("Too many tries. Please wait a few minutes and try again.", "Your old password can't be carried over. Reset it with the link we'll email you."):
        assert phrase in route and phrase in (ROOT / "api" / "routes" / "legacy.py").read_text(encoding="utf-8")


def test_the_social_numbers_words_and_routes_are_the_flask_apis():
    from api import social as flask
    source = text("_shared", "social.ts")

    def number(name):
        return eval(re.search(rf"{name} = ([\d* ]+);", source).group(1))                     # noqa: S307 -- a literal like `60 * 60` from our own file

    for name in ("FRIEND_CODE_GUESS_LIMIT", "FRIEND_CODE_GUESS_WINDOW", "MAX_FRIEND_CODE_CHARS", "CHALLENGE_LIMIT", "HYROX_RESULT_LIMIT", "CHALLENGE_SECONDS",
                 "MAX_AI_REPORT_TEXT", "MAX_OPEN_AI_REPORTS_PER_USER", "HYROX_MAX_SECONDS", "HYROX_LEADERBOARD_ROWS"):
        assert number(name) == getattr(flask, name), name

    def words(name):
        return tuple(re.findall(r'"([\w ]+)"', re.search(rf"{name} = \[(.*?)\];", source, re.S).group(1)))

    for name in ("REPORT_REASONS", "AI_REPORT_FEATURES", "AI_REPORT_REASONS", "HYROX_GENDERS", "HYROX_CATEGORIES", "HYROX_FORMATS"):
        assert words(name) == getattr(flask, name), name
    floors = {k: int(a) * 60 for k, a in re.findall(r'"([a-z]+\|[a-z]+)": (\d+) \* 60', source)}
    assert floors == flask.HYROX_MIN_PLAUSIBLE_SECONDS
    assert re.search(r'CHALLENGE_ROTATION_EPOCH = "([\d-]+)"', source).group(1) == flask.CHALLENGE_ROTATION_EPOCH.isoformat()
    from api.routes import social as flask_route
    assert dict(re.findall(r'(\w+): "([^"]+)"', re.search(r"CHALLENGE_EXERCISES: Record<string, string> = \{(.*?)\};", source).group(1))) == flask_route.CHALLENGE_EXERCISES
    sources = re.findall(r'\["(\w+)", "(\w+)", "(\w+)", (true|false)\]', source)
    assert [(a, t, c, i == "true") for a, t, c, i in sources] == list(flask.ACTIVITY_SOURCES)


def test_the_challenge_exercises_are_the_graders_in_the_graders_order():
    import rep_form_analyzer
    from api.routes import social as flask_route
    assert list(flask_route.CHALLENGE_EXERCISES) == list(rep_form_analyzer.CHALLENGE_EXERCISES)


def test_the_social_helpers_answer_in_typescript_exactly_as_in_python(tmp_path):
    """User ids, friend codes, UTC offsets, HYROX results, the day's exercise and cleaned text: the same answer from both languages over seeded corpora."""
    import datetime as dt
    import uuid
    from api import foods, social
    rng = random.Random(21)
    canon = [str(uuid.UUID(int=rng.getrandbits(128))) for _ in range(40)]
    user_ids = []
    for c in canon:
        user_ids += [c, c.upper(), f" {c} ", "{" + c + "}", "urn:uuid:" + c, c.replace("-", ""), c[:-1], c + "0", "g" + c[1:], c.replace("-", " ")]
    user_ids += [None, 5, [], {}, True, "", "abc", "x" * 36]
    codes = ["rc-ab12cd", "  RC-AB12CD  ", "", "   ", None, 5, [], {}, True, "éà", "i̇", "straße", "ı", "a" * 40, " RC-1　"]
    offsets = ["420", "+420", " -300 ", "900", "-900", "840", "841", "x", "", "4.5", None, 420, "1e3", " 420", "420", "--5", "+-5", "0", "-0", "007"]
    hyrox = []
    for _ in range(300):
        hyrox.append({"gender": rng.choice(["men", "women", " men ", "x", None, 5]), "category": rng.choice(["open", "pro", "elite", ""]), "format": rng.choice(["singles", "doubles", "relay"]),
                      "total_seconds": rng.choice([3600, 3000, 2999.9, 3180, 3179.99, 2820, 3060, 86400, 86400.1, "3600.5", " 3600 ", "1e4", "abc", "", None, True, [], "nan", "inf", "0x10", "1_000", -5, 0])})
    for _ in range(200):               # and plenty with a combination that is valid, so the time itself is what is judged
        hyrox.append({"gender": rng.choice(["men", "women"]), "category": rng.choice(["open", "pro"]), "format": rng.choice(["singles", "doubles"]),
                      "total_seconds": rng.choice([rng.uniform(2700, 4000), 2820, 2999.99, 3000, 3060, 3180, 3179.5, 86400, 86400.5, "3_600.5", " 3700 ", "5e3", "abc", None, True, "inf", "", "0x10"])})
    days = [(dt.date(2025, 1, 1) + dt.timedelta(days=n)).isoformat() for n in range(0, 800, 3)]
    texts = [["  a\x00b\x7fc\td  ", 10], ["abcdef", 3], [None, 5], [42, 5], ["\U0001f3cb" * 5, 3], ["　 x 　", 5], ["\x85 y \x1c", 4], ["a" * 50, 20]]
    answers = _run_edge_parity(tmp_path, {"userIds": user_ids, "codes": codes, "offsets": offsets, "hyrox": hyrox, "days": days, "texts": texts})

    assert answers["userIds"] == [social.parse_user_id(u) for u in user_ids]
    expected_codes = []
    for raw in codes:
        try:
            expected_codes.append(social.clean_code(raw))
        except social.Rejected as rejected:
            expected_codes.append(f"ERR:{rejected.status}:{rejected}")
    assert answers["codes"] == expected_codes
    assert answers["offsets"] == [social.offset_minutes(o) for o in offsets]
    expected_hyrox = []
    for payload in hyrox:
        try:
            expected_hyrox.append(list(social.clean_hyrox_result(payload)))
        except social.Rejected as rejected:
            expected_hyrox.append(f"ERR:{rejected.status}:{rejected}")
    assert answers["hyrox"] == expected_hyrox
    from api.routes import social as flask_route
    assert answers["days"] == [social.todays_exercise(flask_route.CHALLENGE_ORDER, dt.date.fromisoformat(d)) for d in days]
    assert answers["texts"] == [foods.clean_text(raw, limit) for raw, limit in texts]
    assert sum(1 for a in answers["userIds"] if a) >= 200 and sum(1 for h in expected_hyrox if isinstance(h, list)) >= 30


def test_the_generated_chat_data_is_fresh():
    """chatData.ts (the Coach's prompt and the health-source catalog) is written from coach_chat.py and health_sources.py."""
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "gen_edge_chat_data.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, "run `python scripts/gen_edge_chat_data.py` to regenerate supabase/functions/_shared/chatData.ts"


def test_the_chat_numbers_model_and_messages_are_the_flask_apis():
    import analyze_chat
    import coach_chat
    import workout_chat
    from api import chat
    source = text("_shared", "chats.ts")
    for name in ("MAX_MESSAGE_CHARS", "MAX_HISTORY_TURNS", "MAX_TURN_CHARS"):
        assert int(re.search(rf"{name} = (\d+)", source).group(1)) == getattr(chat, name), name
    assert int(re.search(r"MAX_CONTEXT_CHARS = ([\d_]+)", source).group(1).replace("_", "")) == chat.MAX_CONTEXT_CHARS
    assert int(re.search(r"HISTORY_TURNS_SENT = (\d+)", source).group(1)) == coach_chat.MAX_HISTORY_TURNS == analyze_chat.MAX_HISTORY_TURNS == workout_chat.MAX_HISTORY_TURNS
    assert int(re.search(r"MAX_FEEDBACK_CHARS = (\d+)", source).group(1)) == analyze_chat.MAX_FEEDBACK_CHARS
    assert int(re.search(r"MAX_SUMMARY_CHARS = ([\d_]+)", source).group(1).replace("_", "")) == workout_chat.MAX_SUMMARY_CHARS
    assert re.search(r'GEMINI_MODEL = "([^"]+)"', text("_shared", "gemini.ts")).group(1) == coach_chat.GEMINI_MODEL == analyze_chat.GEMINI_MODEL == workout_chat.GEMINI_MODEL
    for kind, module in (("coach", coach_chat), ("analysis", analyze_chat), ("workout", workout_chat)):
        assert re.search(rf'{kind}: "([^"]+)"', source).group(1) == module._fallback_reply(), kind
    assert "Sorry, I couldn't come up with a reply there — could you try asking that again?" in source
    route = text("api", "routes", "chat.ts")
    assert 'FEATURE = "ai_chat"' in route
    for event in ("coach_chat_message", "analyze_chat_message", "workout_chat_message"):
        assert event in route and event in (ROOT / "api" / "routes" / "chat.py").read_text(encoding="utf-8")
    safety = text("_shared", "gemini.ts")
    import ai_safety
    assert re.findall(r'"(HARM_CATEGORY_\w+)"', safety) == [c.name for c in ai_safety.chat_safety_settings()[0:0]] or len(re.findall(r'"(HARM_CATEGORY_\w+)"', safety)) == len(ai_safety.chat_safety_settings())
    assert {s.category.name for s in ai_safety.chat_safety_settings()} == set(re.findall(r'"(HARM_CATEGORY_\w+)"', safety))
    assert {s.threshold.name for s in ai_safety.chat_safety_settings()} == {"BLOCK_MEDIUM_AND_ABOVE"} and '"BLOCK_MEDIUM_AND_ABOVE"' in safety


def test_the_chats_read_requests_cite_sources_and_write_prompts_in_typescript_exactly_as_in_python(tmp_path):
    import analyze_chat
    import health_sources
    import workout_chat
    from api import chat
    rng = random.Random(33)
    words = ["protein", "squat", "creatine", "rest between sets", "my knee hurts", "sleep", "stretching", "build muscle", "hello", "joke", "volume", "cardio", "lose fat", "calories", "deload",
             "โปรตีน", "café protein", "creatineé", "écreatine", "form", "reps", "walking", "sweat", "coffee"]
    ids = [s["id"] for s in health_sources.SOURCES]
    lines = ["SOURCES: {}", "**Sources:** {}", "sources - {}", "> SOURCES: [{}]", "  Sources : {}  ", "Sources: {}.", "*sources*: {}", "SOURCES: none", "Sources: N/A", "sources: **None**", "SOURCES: fake_study_2020", "Sources: eggs, chicken", "SOURCES: {} , fake_one"]
    sources = []
    for _ in range(600):
        body = rng.choice(["Eat more.", "- one\n- two", "Rest 3 minutes.\r\nThen go.", "", "  ", "Sources: eggs, chicken\nthen more", "Do this.\n\n", "x\ry"])
        picked = ", ".join(rng.sample(ids, rng.randint(1, 4)))
        line = rng.choice(lines).format(picked)
        trailing = rng.choice(["", "\n", "  \n \n", " ", "\r\n"])
        reply = body + ("\n" if body and not body.endswith("\n") else "") + line + trailing
        if rng.random() < .15:
            reply = reply + "\nmore text"
        sources.append([reply, " ".join(rng.sample(words, rng.randint(0, 3)))])
    sources += [["no line at all", w] for w in words] + [["", ""], ["SOURCES: none", ""], ["a\rSOURCES: acsm_2009", ""]]

    long_ctx = {"k": "x" * 39990}
    requests = []
    for takes in (False, True):
        for payload in [{}, {"message": ""}, {"message": "  hi  "}, {"message": 5}, {"message": True}, {"message": None}, {"message": "a" * 1000}, {"message": "a" * 1001}, {"message": "\U0001f3cb" * 1000},
                        {"message": "m", "history": "x"}, {"message": "m", "history": [5]}, {"message": "m", "history": [{"role": "user", "text": 5}]}, {"message": "m", "history": [{"role": 5, "text": "a"}]},
                        {"message": "m", "history": [{"role": "coach"}]}, {"message": "m", "history": [{"role": "r" * 30, "text": "t" * 4100}]}, {"message": "m", "history": [{"role": "user", "text": str(i)} for i in range(60)]},
                        {"message": "m", "history": {}}, {"message": "m", "history": 0}, {"message": "m", "context": "x"}, {"message": "m", "context": [1]}, {"message": "m", "context": {"a": 1}},
                        {"message": "m", "context": long_ctx}, {"message": "m", "context": {"k": "x" * 39991}}, {"message": "m", "context": {"k": "ก" * 6600}}, {"message": "m", "context": {"k": "ก" * 6700}},
                        {"message": "m", "context": {"a": [1, 2.5, None, True, "é", {"b": "\U0001f3cb"}]}}, {"message": "m", "context": 0}, {"message": "m", "context": {}}]:
            requests.append([payload, takes])

    contexts = [{}, {"exercise_label": " Bench Press "}, {"exercise_label": ""}, {"exercise_label": 7}, {"overall_score": 82, "stretch_score": 70.5, "squeeze_score": "x", "reps": 8.9, "feedback_text": "  Keep your back flat.  "},
                {"reps": 0}, {"reps": -3}, {"overall_score": 0}, {"overall_score": 99.25, "reps": 12}, {"feedback_text": "x" * 7000}, {"feedback_text": "\U0001f3cb" * 6100}, {"workout_summary": " Mon: squat 100kg "},
                {"workout_summary": ""}, {"workout_summary": "   "}, {"workout_summary": "y" * 15000}, {"workout_summary": 5}, {"exercise_label": "Squat", "feedback_text": "ok", "workout_summary": "s"}, {"exercise_label": None, "feedback_text": None}]
    answers = _run_edge_parity(tmp_path, {"sources": sources, "requests": requests, "analysisPrompts": contexts, "workoutPrompts": contexts, "instruction": True})

    expected_sources = []
    for reply, question in sources:
        text_, found = health_sources.attach_sources(reply, question)
        expected_sources.append([text_, [s["id"] for s in found]])
    assert answers["sources"] == expected_sources
    assert sum(1 for t in expected_sources if t[1]) > 500
    assert answers["instruction"] == health_sources.prompt_instruction()

    expected_requests = []
    for payload, takes in requests:
        try:
            m, h, c = chat.clean_request(payload, takes_context=takes)
            expected_requests.append([m, h, c])
        except chat.ChatRejected as rejected:
            expected_requests.append(f"ERR:{rejected}")
    assert answers["requests"] == expected_requests
    assert sum(1 for r in expected_requests if isinstance(r, str)) > 10 and sum(1 for r in expected_requests if isinstance(r, list)) > 30
    assert answers["analysisPrompts"] == [analyze_chat._build_system_prompt(c) for c in contexts]
    assert answers["workoutPrompts"] == [workout_chat._build_system_prompt(c) for c in contexts]


def test_the_generated_coaching_data_is_fresh():
    """coachingData.ts (the body-fat ranges and tuning constants) is written from coaching_engine.py."""
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "gen_edge_coaching_data.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, "run `python scripts/gen_edge_coaching_data.py` to regenerate supabase/functions/_shared/coachingData.ts"


def test_the_coaching_numbers_messages_and_routes_are_the_flask_apis():
    from api import coaching as flask_coaching
    source = text("_shared", "coaching.ts")
    assert int(re.search(r"MAX_LOG_ENTRIES = (\d+)", source).group(1)) == flask_coaching.MAX_LOG_ENTRIES
    assert int(re.search(r"MAX_CHECKIN_PHOTOS = (\d+)", source).group(1)) == flask_coaching.MAX_CHECKIN_PHOTOS
    messages = re.findall(r'"(Please [^"]+)"', source)
    flask_text = (ROOT / "api" / "coaching.py").read_text(encoding="utf-8")
    assert len(messages) >= 9 and all(m in flask_text for m in messages), [m for m in messages if m not in flask_text]
    assert list(flask_coaching.WEEKDAYS) == re.findall(r'"(\w+day)"', re.search(r"WEEKDAYS = \[(.*?)\] as const", text("_shared", "coachingEngine.ts")).group(1))
    import checkin_analyzer
    checkin = text("_shared", "checkin.ts")
    assert re.search(r'CHECKIN_MODEL = "([^"]+)"', checkin).group(1) == checkin_analyzer.GEMINI_MODEL
    assert int(re.search(r"CHECKIN_TIMEOUT_MS = ([\d_]+)", checkin).group(1).replace("_", "")) == checkin_analyzer.CHECKIN_ANALYSIS_TIMEOUT_SECONDS * 1000
    assert int(re.search(r"MAX_REASON_CHARS = (\d+)", checkin).group(1)) == 400
    route = text("api", "routes", "coaching.ts")
    assert 'FEATURE = "checkin_analysis"' in route and 'PHOTO_BUCKET = "progress-photos"' in route
    assert "checkin_ai_analysis" in route and "checkin_ai_analysis" in (ROOT / "api" / "routes" / "coaching.py").read_text(encoding="utf-8")


def _golden():
    import importlib.util
    spec = importlib.util.spec_from_file_location("edge_golden", ROOT / "scripts" / "edge_golden.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_golden_files_are_fresh():
    """supabase/functions/tests/fixtures/*_golden.json hold the Python's answers for the TypeScript's own offline tests; run `python scripts/edge_golden.py` to rewrite them."""
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "edge_golden.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, "a golden file is stale: run `python scripts/edge_golden.py`"


def test_the_coaching_engine_answers_in_typescript_exactly_as_in_python(tmp_path):
    """Profile checking, the target calculation, the weekly spread, the weekly tune, an applied delta, the check-in prompt and the model-answer parser: the same answer from both languages over seeded corpora, including the ties where Python rounds to even.
    (The TypeScript's own `deno task test` checks the same cases against the golden file; this runs the two side by side, live.)"""
    g = _golden().build_coaching()
    assert sum(1 for _, p in g["profiles"] if p[0]) > 200 and sum(1 for _, p in g["profiles"] if p[1]) > 20
    assert sum(1 for _, w in g["weekly"] if isinstance(w, dict)) > 60 and sum(1 for _, w in g["weekly"] if w is None) > 10 and any(w == "ERR" for _, w in g["weekly"])
    assert any(isinstance(a, dict) for _, a in g["applied"]) and any(a is None for _, a in g["applied"])
    inputs = {"profiles": [i for i, _ in g["profiles"]], "targets": [i for i, _ in g["targets"]], "distributions": [i for i, _ in g["distributions"]], "weekly": [i for i, _ in g["weekly"]],
              "applied": [i for i, _ in g["applied"]], "checkinPrompts": [i for i, _ in g["prompts"]], "extracted": [i for i, _ in g["extracted"]], "rounds": [i for i, _ in g["rounds"]], "ints": [i for i, _ in g["ints"]]}
    answers = _run_edge_parity(tmp_path, inputs)
    for ours, theirs in (("profiles", "profiles"), ("targets", "targets"), ("distributions", "distributions"), ("weekly", "weekly"), ("applied", "applied"), ("checkinPrompts", "prompts"),
                         ("extracted", "extracted"), ("rounds", "rounds"), ("ints", "ints")):
        expected = [e for _, e in g[theirs]]
        assert answers[ours] == expected, ours


def test_the_generated_title_data_is_fresh():
    """titleData.ts (the letters whose str.title() is not their upper case) is written from Python's own tables."""
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "gen_edge_title_data.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, "run `python scripts/gen_edge_title_data.py` to regenerate supabase/functions/_shared/titleData.ts"


def test_the_hyrox_route_messages_feature_limits_and_event_are_the_flask_apis():
    import hyrox_coach
    flask_text = (ROOT / "api" / "routes" / "planning.py").read_text(encoding="utf-8")
    route = text("api", "routes", "planning.ts")
    messages = re.findall(r'fail\("([^"]+)", 40[04]\)', route)
    assert len(messages) >= 4 and all(m in flask_text for m in messages), [m for m in messages if m not in flask_text]
    assert 'HYROX_FEATURE = "hyrox_analysis"' in route and "hyrox_analysis" in flask_limits.RATE_LIMITS
    assert flask_limits.RATE_LIMITS["hyrox_analysis"] == (8, 5 * 60 * 60) == (hyrox_coach.SESSION_ANALYSIS_LIMIT, hyrox_coach.SESSION_WINDOW_SECONDS)
    assert "hyrox_ai_analysis" in route and "hyrox_ai_analysis" in flask_text
    assert int(re.search(r"MAX_RACE_SEGMENTS = (\d+)", route).group(1)) == 40 and re.search(r"MAX_RACE_CHARS = 20_000", route) and "MAX_RACE_CHARS = 20_000" in flask_text
    assert "Please check back in" in route and "Please check back in" in flask_text and "races today." in route and "races today." in flask_text
    hyrox = text("_shared", "hyrox.ts")
    assert float(re.search(r"TEMPERATURE = ([\d.]+)", hyrox).group(1)) == 0.4
    assert "temperature=0.4" in (ROOT / "hyrox_coach.py").read_text(encoding="utf-8")


def test_the_hyrox_analysis_answers_in_typescript_exactly_as_in_python(tmp_path):
    """The race prompt, the reading of the model's answer, the clock and str.title() over seeded corpora; and str.title() over every letter Unicode has, alone and in company
    (the final sigma, the digraphs and the Georgian letters are where JavaScript's own capitalising differs).
    (The TypeScript's own `deno task test` checks the golden cases against the saved Python answers; this runs the two side by side, live.)"""
    g = _golden().build_hyrox()
    assert sum(1 for _, e in g["prompts"] if e == "ERR") > 20 and sum(1 for _, e in g["prompts"] if e != "ERR") > 100
    cases = {k: [i for i, _ in g[k]] for k in ("prompts", "coerced", "bullets", "clocks", "titles")}
    letters = [chr(c) for c in range(0x110000) if not 0xD800 <= c < 0xE000 and (chr(c).isalpha() or chr(c).title() != chr(c) or chr(c).lower() != chr(c))]
    assert len(letters) > 100_000
    sweep = letters + ["a" + c for c in letters] + [c + "\u03a3" for c in letters[::37]] + ["\u0391\u03a3", "\u03a3", "a\u03a3b", "\u03a3\u0391\u03a3", "\u0391\u03a3.", "x\u03a3 y", "\u0391\u03a3\u0301"]
    cases["titles"] = cases["titles"] + sweep
    answers = _run_edge_parity(tmp_path, {"hyrox_cases": cases})["hyroxKinds"]
    for k in ("prompts", "coerced", "bullets", "clocks"):
        expected = json.loads(json.dumps([e for _, e in g[k]]))
        assert answers[k] == expected, k
    assert answers["titles"] == [w.title() for w in cases["titles"]]


def test_the_generated_workout_data_is_fresh():
    """workoutData.ts (the exercise library: categories in order, and where each can be done) is written from workout_library.py."""
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "gen_edge_workout_data.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, "run `python scripts/gen_edge_workout_data.py` to regenerate supabase/functions/_shared/workoutData.ts"


def test_the_split_route_messages_feature_and_event_are_the_flask_apis():
    flask_text = (ROOT / "api" / "routes" / "planning.py").read_text(encoding="utf-8")
    route = text("api", "routes", "planning.ts")
    messages = re.findall(r'fail\(\s*(?:splitType === "custom" \? )?"([^"]+)"', route) + re.findall(r'" : "([^"]+)", 400', route)
    assert len(messages) >= 6 and all(m in flask_text for m in messages), [m for m in messages if m not in flask_text]
    assert 'FEATURE = "split_generation"' in route and "split_generation" in flask_limits.RATE_LIMITS
    assert "split_ai_suggested" in route and "split_ai_suggested" in flask_text
    assert "You've built ${RATE_LIMITS[FEATURE][0]} plans today. Please check back in" in route and "plans today. " in flask_text
    assert int(re.search(r"MAX_LABEL_CHARS = (\d+)", route).group(1)) == 60 and "[:60]" in flask_text


def test_the_split_generator_answers_in_typescript_exactly_as_in_python(tmp_path):
    """The fallback plan, the prompts, the checking of a model's plan, the lifter text, the route's input cleaning: the same answer from both languages over seeded corpora.
    (The TypeScript's own `deno task test` checks the same cases against the golden file; this runs the two side by side, live.)"""
    g = _golden().build_split()
    accepted = sum(1 for _, e in g["validate"] if isinstance(e, dict))
    assert accepted > 300 and sum(1 for _, e in g["validate"] if e == "ERR") > 300, accepted
    assert len(g["fallback"]) > 800 and len(g["prompts"]) > 400 and len(g["suggestPrompts"]) > 500
    assert any(c[0][3] and "pregnan" in c[0][3] for c in g["fallback"]) and any(c[0][5] == "hybrid" for c in g["fallback"])
    names = [k for k in g if k != "constants"]
    answers = _run_edge_parity(tmp_path, {"split": {k: [i for i, _ in g[k]] for k in names}})["split"]
    for k in names:
        expected = json.loads(json.dumps([e for _, e in g[k]]))
        if k in ("prompts", "suggestPrompts"):
            expected = [{"sha256": e["sha256"], "chars": e["chars"]} for e in expected]
        assert len(answers[k]) == len(expected), k
        for i, (got, want) in enumerate(zip(answers[k], expected)):
            assert got == want, (k, i, g[k][i][0])
