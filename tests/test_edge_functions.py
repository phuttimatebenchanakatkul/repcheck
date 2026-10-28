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
