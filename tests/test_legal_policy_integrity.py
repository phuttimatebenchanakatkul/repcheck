"""The legal pages have to keep describing what the code actually does.

A privacy or cookie policy is the one kind of copy where being out of date is
not cosmetic -- it is a false statement about how you handle someone's data.
So the pages state as little as possible in prose and render the rest from the
code, and this file pins the joins.

Three properties, each of which has a plausible way of silently breaking:

1. COOKIES. /cookies documents every cookie the app sets. Adding a cookie is a
   two-line change somewhere in a request handler, and nothing about it makes
   you think about a policy page. The test walks the source for cookie names
   and fails if one is undocumented.

2. VALUES. The lifetimes and flags on that page come from app.config and
   auth.APPLE_STATE_MAX_AGE. Changing SESSION_COOKIE_SAMESITE without touching
   the page must not be possible.

3. REFUNDS. /refunds says RepCheck is free and there is nothing to refund,
   which is true because there is no payment code in the repo. A "RepCheck
   Pro" screen exists on an unmerged branch. If purchase code lands while that
   page still says the app is free, the page becomes a lie in the direction
   that actually matters -- charging people with no refund terms published.

Plus the flat requirement, under both the PDPA and the GDPR, that a reader can
tell who the controller is and how to reach them.
"""

import re
from pathlib import Path

import pytest

import database
from app import app as flask_app

ROOT = Path(__file__).resolve().parent.parent

POLICY_PATHS = ["/privacy", "/terms", "/cookies", "/refunds"]

CONTACT = "phuttimatebenchanakatkul@gmail.com"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    flask_app.config["TESTING"] = True
    return database


def _render(path):
    return flask_app.test_client().get(path).get_data(as_text=True)


# ---------- 1. Every cookie the app sets is documented ----------

def _cookie_names_set_by_the_app():
    """Cookie names the source actually sets.

    Two shapes to find: a literal first argument to set_cookie(), and the
    constants those calls use (APPLE_STATE_COOKIE = "apple_oauth_state").
    Flask's own session cookie is not set through set_cookie() at all, so it
    is added by name -- it is the one cookie that is always there.
    """
    names = {flask_app.config.get("SESSION_COOKIE_NAME") or "session"}

    for relative in ("app.py", "auth.py"):
        source = (ROOT / relative).read_text(encoding="utf-8")

        # set_cookie("literal-name", ...)
        names.update(re.findall(r"set_cookie\(\s*[\"']([A-Za-z0-9_.-]+)[\"']", source))

        # set_cookie(SOME_CONSTANT, ...) -> resolve the constant's literal
        for const in re.findall(r"set_cookie\(\s*([A-Z][A-Z0-9_]+)\s*,", source):
            literal = re.search(
                r"^" + const + r"\s*=\s*[\"']([A-Za-z0-9_.-]+)[\"']",
                source,
                re.MULTILINE,
            )
            if literal:
                names.add(literal.group(1))

    return names


def test_every_cookie_the_app_sets_is_named_on_the_cookie_policy(db):
    html = _render("/cookies")
    names = _cookie_names_set_by_the_app()

    # Guard the guard: if the scan stops finding anything, the assertion below
    # passes vacuously and the whole test stops protecting anything.
    assert len(names) >= 2, (
        "the cookie-name scan found " + repr(names) + " -- it should find at "
        "least the Flask session cookie and the Apple OAuth state cookie. If "
        "the app genuinely dropped one, update this floor deliberately."
    )

    # Match the cookie LIST, in a <code> element -- not the whole document.
    # Substring-matching the rendered page is defeated by any cookie with a
    # common name: base.html alone carries lang="en", data-theme and
    # data-lang, so cookies called lang, theme, state, id or user would count
    # as "documented" while appearing nowhere on the page.
    table = re.search(
        r"<h2>Cookies we set</h2>(.*?)<h2>", html, re.DOTALL
    )
    assert table, (
        "could not find the 'Cookies we set' section on /cookies -- if the "
        "heading was renamed, update this test rather than widening it back "
        "to the whole page"
    )
    section = table.group(1)

    undocumented = [
        name for name in names if "<code>" + name + "</code>" not in section
    ]

    assert undocumented == [], (
        "these cookies are set by the app but not documented in the 'Cookies "
        "we set' list on /cookies: " + repr(undocumented)
        + " -- add a row for each to templates/cookies.html. A cookie the "
        "policy does not mention is an undisclosed cookie."
    )


def test_cookie_policy_claims_no_third_party_analytics_only_while_thats_true():
    """The page tells the reader there is no third-party analytics, and that
    claim is why it also says no consent banner is needed. If a tracker is
    ever added, that reasoning collapses -- so pin the absence.
    """
    tracker_markers = (
        "google-analytics.com",
        "googletagmanager.com",
        "gtag(",
        "dataLayer",
        "connect.facebook.net",
        "fbq(",
        "plausible.io",
        "posthog",
        "mixpanel",
        "amplitude",
        "hotjar",
        "segment.com",
        "analytics.js",
    )

    found = []
    for path in sorted((ROOT / "templates").glob("*.html")) + sorted((ROOT / "static").glob("*.js")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        stripped = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
        stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.DOTALL)
        for marker in tracker_markers:
            if marker in stripped:
                found.append(path.name + " -> " + marker)

    assert found == [], (
        "third-party analytics found: " + repr(found) + ".\n"
        "/cookies and /privacy both state there is none, and /cookies uses "
        "that to justify having no consent banner. Adding a tracker means "
        "rewriting both pages and almost certainly adding a consent gate."
    )


# ---------- 2. The quoted values come from the code ----------

def test_cookie_policy_quotes_the_real_session_lifetime(db):
    html = _render("/cookies")
    days = flask_app.config["PERMANENT_SESSION_LIFETIME"].days

    assert str(days) + " days" in html, (
        "/cookies must render the session lifetime from "
        "PERMANENT_SESSION_LIFETIME (currently " + str(days) + " days), "
        "not state a number of its own"
    )


def test_cookie_policy_quotes_the_real_samesite_value(db):
    html = _render("/cookies")
    samesite = flask_app.config["SESSION_COOKIE_SAMESITE"]

    assert "SameSite=" + samesite in html


def test_cookie_policy_quotes_the_real_oauth_state_window(db):
    from auth import APPLE_STATE_MAX_AGE

    html = _render("/cookies")

    assert str(APPLE_STATE_MAX_AGE // 60) + " minutes" in html


def test_cookie_policy_mentions_secure_only_when_the_cookie_is_secure(db):
    """SESSION_COOKIE_SECURE is False in local dev and True on Render. The
    page must not promise a Secure cookie in an environment that is not
    sending one -- it is rendered conditionally for exactly that reason.
    """
    original = flask_app.config["SESSION_COOKIE_SECURE"]
    try:
        flask_app.config["SESSION_COOKIE_SECURE"] = True
        assert "<code>Secure</code>" in _render("/cookies")

        flask_app.config["SESSION_COOKIE_SECURE"] = False
        assert "<code>Secure</code>" not in _render("/cookies")
    finally:
        flask_app.config["SESSION_COOKIE_SECURE"] = original


# ---------- 3. The refund page versus reality ----------

def _payment_integration_markers():
    """Signs that real purchasing has landed in the shipped app.

    Deliberately narrow. It looks for payment SDKs and purchase endpoints, not
    for the word "price" -- the food library is full of unrelated numbers, and
    a test that cries wolf gets deleted.
    """
    # Matched on WORD BOUNDARIES, not as bare substrings. This codebase is
    # full of innocent collisions: "omise" is inside every JS `Promise`, and
    # "stripe" is inside `dateStripEl`. A first cut of this scan matched them
    # as substrings and reported 14 findings in files with no payment code
    # anywhere -- a guard that cries wolf gets deleted, which is worse than
    # not having it.
    markers = (
        r"stripe",
        r"storekit",
        r"revenuecat",
        r"braintree",
        r"paypal",
        r"omise",
        r"/api/checkout",
        r"create_checkout_session",
        r"in_app_purchase",
        # The iOS shell is Capacitor, so a subscription most likely arrives as
        # one of these rather than as a Python SDK.
        r"cordova-plugin-purchase",
        r"capacitor-purchases",
        r"purchaseproduct",
        r"restorepurchases",
    )
    # Scan every shipped surface, not just three modules. The "RepCheck Pro"
    # work this guards is a SETTINGS SCREEN plus, almost certainly, a new
    # module and a new dependency -- i.e. a template and a file that does not
    # exist yet. Reading only app.py/auth.py/database.py would let the whole
    # most-likely shape of it land with this page still saying the app is free.
    candidates = (
        list(ROOT.glob("*.py"))
        + list((ROOT / "templates").glob("*.html"))
        + list((ROOT / "static").glob("*.js"))
        + [ROOT / "requirements.txt"]
    )
    hits = []
    for path in candidates:
        if not path.is_file():
            continue
        if path.name.startswith("test_"):
            continue
        source = path.read_text(encoding="utf-8", errors="ignore")
        stripped = re.sub(r"#.*$", "", source, flags=re.MULTILINE)
        stripped = re.sub(r'""".*?"""', "", stripped, flags=re.DOTALL)
        stripped = re.sub(r"<!--.*?-->", "", stripped, flags=re.DOTALL)
        stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.DOTALL)
        low = stripped.lower()
        for marker in markers:
            if re.search(marker, low):
                hits.append(path.name + " -> " + marker)
    return hits


def test_refund_page_stops_claiming_the_app_is_free_once_payments_land(db):
    html = _render("/refunds")

    claims_free = "RepCheck is free" in html
    payments = _payment_integration_markers()

    if payments:
        assert not claims_free, (
            "payment integration found (" + repr(payments) + ") while "
            "/refunds still says \"RepCheck is free\".\n"
            "Rewrite templates/refunds.html with real refund and cancellation "
            "terms BEFORE anyone can be charged. Charging with no published "
            "refund terms, and telling users the app is free while billing "
            "them, are both problems this test exists to stop."
        )
    else:
        assert claims_free, (
            "there is no payment code in the app, so /refunds should say so "
            "plainly. Publishing refund terms for something nobody can buy is "
            "itself a misleading statement."
        )


def test_terms_and_refunds_agree_about_the_app_being_free(db):
    """Two pages state the same fact. They must not disagree."""
    terms = _render("/terms")
    refunds = _render("/refunds")

    assert "RepCheck is free" in refunds
    assert "RepCheck is free" in terms, (
        "/terms has a 'What it costs' section that must match /refunds"
    )


# ---------- The controller has to be identifiable ----------

@pytest.mark.parametrize("path", POLICY_PATHS)
def test_every_policy_page_carries_a_contact_address(db, path):
    """PDPA s.23 and GDPR Art. 13 both require the controller's identity and
    contact details. A policy you cannot act on is not a policy."""
    assert CONTACT in _render(path), (
        path + " must carry the contact address"
    )


@pytest.mark.parametrize("path", ["/privacy", "/terms"])
def test_the_two_binding_pages_name_the_operator_and_the_country(db, path):
    """These are the two pages the signup consent notice links to, so they are
    the ones that have to identify who the user is contracting with."""
    html = _render(path)

    assert "Phuttimate Benchanakatkul" in html, (
        path + " must name the operator -- an unidentifiable controller is "
        "itself a defect under the PDPA and the GDPR"
    )
    assert "Thailand" in html, (
        path + " must say where the operator is, which is what makes the "
        "governing law and the regulator meaningful"
    )


def test_privacy_policy_states_a_legal_basis_and_the_transfer(db):
    """The two things a health-data app is most likely to omit."""
    html = _render("/privacy")

    assert "explicit consent" in html, (
        "health data is sensitive/special-category; the policy has to say it "
        "rests on explicit consent"
    )
    assert "United States" in html, (
        "the AI providers and the host are US-based, so the policy has to "
        "disclose the international transfer"
    )
    assert "PDPC" in html, "the PDPA right to complain to a regulator must be stated"


# ---------- The pages have to be reachable from each other ----------

def test_policy_pages_link_to_one_another(db):
    """A cookie policy nobody can find does not discharge anything. Each page
    points at the others, so landing on any one of them reaches all."""
    missing = []
    for path in POLICY_PATHS:
        html = _render(path)
        for other in POLICY_PATHS:
            if other == path:
                continue
            if 'href="' + other + '"' not in html:
                missing.append(path + " does not link to " + other)

    assert missing == [], repr(missing)


def test_settings_links_every_policy_page(db):
    """Settings -> Legal is the only route to these from inside the app."""
    user_id = database.create_local_user("legal@example.com", "irrelevant-password", "Legal")
    client = flask_app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user_id

    html = client.get("/settings").get_data(as_text=True)

    missing = [p for p in POLICY_PATHS + ["/support"] if 'href="' + p + '"' not in html]

    assert missing == [], (
        "Settings -> Legal must link these: " + repr(missing)
    )


def test_signup_consent_links_the_binding_policies(db):
    """The consent notice is what makes the agreement informed. Its links have
    to resolve for someone with no account, which is the whole point of
    /privacy and /terms being public."""
    html = flask_app.test_client().get("/signup").get_data(as_text=True)

    assert 'href="/terms"' in html
    assert 'href="/privacy"' in html
    assert "agree" in html.lower()


# ---------- The app loads no fonts from Google ----------
#
# /cookies tells the reader "the typefaces the app uses are served from our own
# servers, not from Google's font CDN", and explains why that matters. Before
# the legal pass it was the opposite: base.html, login, signup and onboarding
# all pulled a stylesheet from fonts.googleapis.com, so every page load handed
# the visitor's IP to Google -- including /signup, the screen where consent is
# actually asked for. LG Muenchen I (3 O 17493/20) held that dynamic Google
# Fonts loading breaches the GDPR on its own.
#
# Three independent things have to stay true for that paragraph to be honest,
# and each can regress on its own.

FONT_TEMPLATES = ("base.html", "login.html", "signup.html", "onboarding.html")


@pytest.mark.parametrize("name", FONT_TEMPLATES)
def test_no_template_loads_a_google_fonts_stylesheet(name):
    """Comments are stripped first: base.html and fonts.css deliberately
    mention the hostname while explaining why it is not used."""
    html = (ROOT / "templates" / name).read_text(encoding="utf-8")
    stripped = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)

    for host in ("fonts.googleapis.com", "fonts.gstatic.com"):
        assert host not in stripped, (
            name + " loads " + host + " again. Every page request would hand "
            "the visitor's IP to Google before consent, and /cookies says "
            "that does not happen. Add the face to static/fonts.css instead."
        )


def test_the_csp_no_longer_allowlists_google_fonts():
    """Belt and braces for the test above: with the hosts out of the policy, a
    reintroduced <link> is blocked by the browser rather than silently
    working. Removing them from the CSP is what makes the fix hold."""
    import app as app_module

    directives = dict(
        (part.split(" ", 1) + [""])[:2]
        for part in (d.strip() for d in app_module.CSP.split(";"))
        if part
    )

    assert "fonts.googleapis.com" not in directives.get("style-src", "")
    assert "fonts.gstatic.com" not in directives.get("font-src", "")


def test_the_self_hosted_faces_all_exist():
    """A @font-face pointing at a missing woff2 fails silently -- the browser
    just renders the fallback, so this cannot be caught by eye."""
    css_path = ROOT / "static" / "fonts.css"
    assert css_path.is_file(), "static/fonts.css is missing"

    css = css_path.read_text(encoding="utf-8")
    refs = [r.strip("'\"") for r in re.findall(r"url\(([^)]+)\)", css)]
    assert refs, "static/fonts.css declares no font files"

    remote = [r for r in refs if r.startswith("http")]
    assert remote == [], "these faces are still loaded over the network: " + repr(remote)

    missing = [r for r in refs if not (ROOT / "static" / r).is_file()]
    assert missing == [], "declared but absent from static/: " + repr(missing)


def test_both_families_are_present_including_thai():
    """Noto Sans Thai is the ENTIRE font stack in Thai mode (style.css's
    :root[data-lang="th"] rule does not list Inter), so losing it would fall
    Thai users back to Arial for everything, not just Thai glyphs."""
    css = (ROOT / "static" / "fonts.css").read_text(encoding="utf-8")

    assert "'Inter'" in css or '"Inter"' in css
    assert "Noto Sans Thai" in css

    thai_faces = [
        block for block in re.findall(r"@font-face\s*\{.*?\}", css, re.DOTALL)
        if "Noto Sans Thai" in block
    ]
    assert thai_faces, "no Noto Sans Thai faces declared"

    # At least one face must actually cover the Thai block (U+0E01-0E5B).
    assert any("0E01" in block.upper() for block in thai_faces), (
        "no Noto Sans Thai face declares the Thai unicode-range -- Thai text "
        "would fall through to a system font"
    )


def test_the_font_licences_ship_with_the_fonts():
    """Inter and Noto Sans Thai are both SIL Open Font License 1.1, which
    requires the licence to travel with the font files we redistribute."""
    licences = list((ROOT / "static" / "fonts").glob("OFL*.txt"))

    assert len(licences) >= 2, (
        "expected an OFL licence per family, found: "
        + repr([p.name for p in licences])
    )
    for licence in licences:
        text = licence.read_text(encoding="utf-8", errors="ignore")
        assert "SIL OPEN FONT LICENSE" in text.upper()
        assert "Copyright" in text


def test_the_cookie_policy_actually_makes_the_self_hosted_claim(db):
    """If someone deletes the paragraph, the tests above stop guarding
    anything a user was told."""
    html = _render("/cookies")

    assert "not from Google" in html and "font" in html.lower(), (
        "/cookies must state that fonts are served first-party -- that is the "
        "claim the font tests exist to keep true"
    )


# ---------- Cited test files have to exist ----------

def test_every_test_file_cited_in_a_comment_exists():
    """The policy templates explain, in their header comments, which test
    stops them drifting. Three of those citations pointed at filenames that
    were never created -- the tests were real but had been renamed, so anyone
    following the comment to check the guard found nothing and would
    reasonably conclude there wasn't one.

    Cheap to check, and it fails the moment a rename outruns a comment.
    """
    # templates/, marketing/ and static/ only -- deliberately NOT tests/.
    # Test files legitimately refer to DELETED tests in historical prose
    # ("these assertions previously lived in ..."), and flagging that as drift
    # would be a false positive that gets this test deleted. Source comments
    # that name a guard are a different thing: they are a pointer the reader
    # is meant to follow.
    roots = [ROOT / "templates", ROOT / "marketing", ROOT / "static"]
    cited = {}
    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.suffix.lower() not in (".html", ".py", ".js", ".css"):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for ref in re.findall(r"tests(?:-js)?/[A-Za-z0-9_./-]*test[A-Za-z0-9_./-]*\.(?:py|js)", text):
                cited.setdefault(ref, set()).add(path.relative_to(ROOT).as_posix())

    assert cited, "the citation scan found nothing -- it has stopped working"

    missing = {
        ref: sorted(where) for ref, where in cited.items()
        if not (ROOT / ref).is_file()
    }

    assert missing == {}, (
        "these comments cite test files that do not exist: "
        + repr(missing)
        + " -- fix the citation (or create the file). A comment pointing at a "
        "guard that isn't there is worse than no comment."
    )


# ---------- The subprocessor list ----------

def test_every_third_party_the_code_talks_to_is_named_on_the_privacy_policy():
    """/privacy carries a section headed "Who else your data reaches" that
    claims to be "The full list of companies that can touch your data".

    That is the same kind of claim as the cookie inventory above, and the same
    kind of thing to get silently wrong: adding an AI provider or a hosting
    dependency is a one-import change and nothing about it makes you think
    about a policy page. An undisclosed recipient is a PDPA s.23 / GDPR
    Art. 13 defect.

    Deliberately keyed on the HOSTNAMES and SDK names the code really uses,
    so it cannot drift into vibes.
    """
    providers = {
        "google": ("google.generativeai", "from google import genai", "gemini"),
        "openai": ("openai",),
        "fatsecret": ("fatsecret",),
        "jsdelivr": ("cdn.jsdelivr.net",),
        "storage.googleapis.com": ("storage.googleapis.com",),
        "youtube": ("youtube-nocookie.com",),
        # In the CSP's img-src, and loaded on the HYROX space-measure screen
        # (static/hyrox.js). The first cut of this dict missed it, so the test
        # certified the list "full" while a disclosed-in-CSP recipient was
        # absent from both pages.
        "unsplash": ("images.unsplash.com",),
    }

    sources = (
        list(ROOT.glob("*.py"))
        + list((ROOT / "templates").glob("*.html"))
        + list((ROOT / "static").glob("*.js"))
        + [ROOT / "requirements.txt"]
    )
    blob = "\n".join(
        p.read_text(encoding="utf-8", errors="ignore")
        for p in sources
        if p.is_file() and not p.name.startswith("test_")
    ).lower()

    present = sorted(
        name for name, needles in providers.items()
        if any(n.lower() in blob for n in needles)
    )

    # Guard the guard: if the scan finds nothing the assertion below is
    # vacuous and this test silently stops protecting the policy.
    assert len(present) >= 5, (
        "the provider scan found only " + repr(present) + " -- it should find "
        "at least Google, OpenAI, jsDelivr and the model bucket. If a provider "
        "was genuinely dropped, lower this floor deliberately."
    )

    html = flask_app.test_client().get("/privacy").get_data(as_text=True).lower()

    undisclosed = [name for name in present if name not in html]

    assert undisclosed == [], (
        "these third parties are reached by the code but are NOT named on "
        "/privacy: " + repr(undisclosed) + "\n"
        "That section says it is the full list. Add them, or stop calling it "
        "the full list."
    )


# ---------- The self-hosted faces cover every weight the app asks for ----------

def test_the_font_faces_cover_every_weight_the_stylesheets_use():
    """style.css sets font-weight up to 800, and base.html carries a comment
    explaining why 800 specifically has to be a real cut: without it browsers
    synthesise it by thickening 700, which renders visibly differently.

    The faces are variable fonts declaring a RANGE (`font-weight: 400 800`),
    so this checks the range covers what the CSS asks for rather than
    counting blocks. The first cut of fonts.css instead declared one block per
    weight -- five blocks pointing at five byte-identical copies of the same
    variable file, which made an English page download that face five times.
    """
    fonts_css = (ROOT / "static" / "fonts.css").read_text(encoding="utf-8")

    ranges = {}
    for block in re.findall(r"@font-face\s*\{.*?\}", fonts_css, re.DOTALL):
        family = re.search(r"font-family:\s*['\"]([^'\"]+)", block).group(1)
        weights = re.search(r"font-weight:\s*(\d+)(?:\s+(\d+))?\s*;", block)
        low = int(weights.group(1))
        high = int(weights.group(2) or weights.group(1))
        known = ranges.get(family)
        ranges[family] = (min(low, known[0]), max(high, known[1])) if known else (low, high)

    assert "Inter" in ranges, "Inter is no longer declared in static/fonts.css"

    used = set()
    for name in ("style.css", "auth.css", "coaching.css", "hyrox.css"):
        path = ROOT / "static" / name
        if path.is_file():
            used.update(
                int(w) for w in re.findall(
                    r"font-weight:\s*(\d{3})\b",
                    _strip_css_comments_local(path.read_text(encoding="utf-8")),
                )
            )

    assert used, "found no numeric font-weights in the app stylesheets"

    low, high = ranges["Inter"]
    uncovered = sorted(w for w in used if not (low <= w <= high))

    assert uncovered == [], (
        "the app's CSS uses font-weight " + repr(uncovered) + " but the Inter "
        "faces in static/fonts.css only cover " + str(low) + "-" + str(high)
        + ". Widen the wght range in the Google css2 URL and re-download -- do "
        "NOT add a second @font-face block, that is how the duplicate-file bug "
        "happened."
    )


def _strip_css_comments_local(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)


def test_no_font_file_is_shipped_twice():
    """The variable-font trap, pinned by content rather than by name.

    Asking Google's css2 API for wght@400;500;600;700;800 returns the SAME
    variable file five times under five URLs. The first cut of this pass
    committed 22 woff2 that were only 5 unique blobs, and declared 22
    @font-face rules over them -- so a browser fetched one 48KB face five
    times per page. Identical content under different names is the signature.
    """
    import hashlib

    for directory in (ROOT / "static" / "fonts", ROOT / "marketing" / "assets" / "fonts"):
        if not directory.is_dir():
            continue
        digests = {}
        for path in sorted(directory.glob("*.woff2")):
            digest = hashlib.md5(path.read_bytes()).hexdigest()
            digests.setdefault(digest, []).append(path.name)

        duplicates = {d: names for d, names in digests.items() if len(names) > 1}

        assert duplicates == {}, (
            "identical font files shipped under different names in "
            + directory.name + ": " + repr(list(duplicates.values()))
            + " -- these are variable fonts. Request one face per subset with "
            "a wght RANGE (wght@400..800) instead of one per weight."
        )


# ---------- The YouTube claim ----------

def test_every_youtube_embed_uses_the_privacy_enhanced_host():
    """/cookies tells the reader: "We use youtube-nocookie.com, YouTube's
    privacy-enhanced mode". True today, and one copy-paste from not being.
    """
    offenders = []
    for path in list((ROOT / "templates").glob("*.html")) + list((ROOT / "static").glob("*.js")):
        text = re.sub(
            r"<!--.*?-->", "", path.read_text(encoding="utf-8", errors="ignore"), flags=re.DOTALL
        )
        for src in re.findall(r"(?:https?:)?//[\w.-]*youtube[\w.-]*/embed[^\"'`\s]*", text):
            if "youtube-nocookie.com" not in src:
                offenders.append(path.name + " -> " + src)

    assert offenders == [], (
        "/cookies says every embed uses youtube-nocookie.com, but these do "
        "not: " + repr(offenders)
    )
