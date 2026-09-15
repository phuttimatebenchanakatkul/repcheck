"""The marketing site's legal, accessibility and honesty properties.

marketing/ is a separate static deploy with no build step and no test harness
of its own, so these are source-level assertions against the real files -- the
tradeoff CLAUDE.md describes. Every one was mutation-checked when written.

Why each property is here rather than left to review:

* NO THIRD-PARTY REQUESTS. cookies.html tells visitors the site contacts no
  other company and uses that to justify having no consent banner. That claim
  is one <link> away from being false, and the <link> that was there loaded
  Google Fonts -- which sends every visitor's IP to Google before consent, and
  is exactly what LG Muenchen I, 3 O 17493/20 was about. If someone re-adds an
  embed, the policy is wrong and nobody would notice.

* THE WAITLIST NOTICE. Collecting an email address needs the purpose and the
  policy stated at the point of collection (PDPA s.23 / GDPR Art. 13), and the
  status line needs to be a live region or a screen-reader user submits the
  form and hears nothing.

* FOCUS VISIBILITY. The email input had `outline: none` and nothing in its
  place, so keyboard users had no idea where they were (WCAG 2.4.7). It is an
  easy thing to reintroduce while tidying CSS.

* THE CLAIMS. The store button said "Download with Apple" on href="#" for an
  app that is not on the App Store; the stats band said 527 exercises when the
  library held 735; the waitlist kicker invented scarcity. These are the three
  shapes of misleading claim a marketing page falls into, so all three are
  pinned.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MARKETING = ROOT / "marketing"

PAGES = ["index.html", "pricing.html", "privacy.html", "cookies.html", "terms.html"]


def _read(name):
    return (MARKETING / name).read_text(encoding="utf-8")


def _strip_comments(html):
    return re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)


def _strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)


# ---------- Every page exists and is wired up ----------

@pytest.mark.parametrize("name", PAGES)
def test_page_exists(name):
    assert (MARKETING / name).is_file(), (
        "marketing/" + name + " is missing -- the footer links to it, so its "
        "absence is a 404 on a legal page"
    )


@pytest.mark.parametrize("name", PAGES)
def test_every_page_links_the_legal_pages_in_its_footer(name):
    """A privacy notice reachable from only one page is reachable from nowhere
    in practice. Every page carries the same three links."""
    html = _strip_comments(_read(name))

    for target in ("privacy.html", "cookies.html", "terms.html"):
        assert 'href="' + target + '"' in html, (
            name + " must link to " + target + " in its footer"
        )


@pytest.mark.parametrize("name", PAGES)
def test_every_page_identifies_the_operator(name):
    """Consumer law in Thailand and the EU/UK both want the trader
    identifiable. The footer carries it on every page."""
    html = _strip_comments(_read(name))

    assert "Phuttimate Benchanakatkul" in html
    assert "Thailand" in html
    assert "phuttimatebenchanakatkul@gmail.com" in html


# ---------- No third-party requests, anywhere ----------

# Not "any URL" -- the pages legitimately reference their own canonical
# https://repcheck.app/ URLs, the app's own policy pages, and the XML
# namespace in inline SVG. Anything else is a request to another company.
ALLOWED_OFFSITE = (
    "https://repcheck.app",
    "http://www.w3.org",
    "https://www.w3.org",
    # The in-app policies live on the app's own Render host. These are links a
    # visitor clicks, not resources the page loads, so they cost nothing until
    # followed -- and they are ours.
    "https://repcheck-q0m4.onrender.com",
    # Named in prose on the policy pages (Google's privacy policy, the
    # Formspree signup) and in the README. Also click-throughs, not loads.
    "https://policies.google.com",
    "https://formspree.io",
    "https://reportaproblem.apple.com",
)


def _offsite_urls(text):
    urls = re.findall(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+", text)
    out = []
    for url in urls:
        if not any(url.startswith(prefix) for prefix in ALLOWED_OFFSITE):
            out.append(url)
    return out


@pytest.mark.parametrize("name", PAGES)
def test_no_page_loads_anything_from_another_company(name):
    """The claim on cookies.html depends on this being true."""
    offsite = _offsite_urls(_strip_comments(_read(name)))

    assert offsite == [], (
        "marketing/" + name + " references off-site URLs: " + repr(offsite) + "\n"
        "cookies.html tells visitors this site makes no third-party requests "
        "and therefore needs no consent banner. Adding an external font, "
        "script, iframe or pixel makes that false. Self-host it, or update "
        "cookies.html and privacy.html and add a consent gate."
    )


@pytest.mark.parametrize("name", PAGES)
def test_no_page_carries_an_inline_script(name):
    """The site is served with a Content-Security-Policy of script-src 'self'
    (set on the Render static site, not in this repo -- it is response-header
    config, not content). Under that policy an inline <script> does not run.
    It does not warn, it does not throw where anyone will see it: the block is
    refused and whatever it powered silently stops working.

    pricing.html used to carry one -- the monthly/yearly toggle -- and moving
    it to assets/pricing.js is what let the policy be strict rather than
    carrying 'unsafe-inline', which switches off the half of CSP that stops
    injected script. This test is what keeps it that way, because the failure
    it guards against is invisible in local preview: without the header, an
    inline block works perfectly right up until it is deployed.

    If you need script on a page, give it a file.
    """
    html = _strip_comments(_read(name))

    inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html, re.I)

    assert inline == [], (
        "marketing/" + name + " has an inline <script>: " + repr(inline) + "\n"
        "The deployed Content-Security-Policy is script-src 'self', so this "
        "block will not run in production -- silently. Move it to a file under "
        "marketing/assets/ and load it with src, the way pricing.html does."
    )


def test_the_stylesheet_loads_no_remote_resources():
    offsite = _offsite_urls(_strip_css_comments((MARKETING / "styles.css").read_text(encoding="utf-8")))

    assert offsite == [], repr(offsite)


def test_the_fonts_are_self_hosted_and_present():
    """The @font-face src has to point at local files that actually exist --
    a stylesheet referencing a missing woff2 falls back silently."""
    css = (MARKETING / "assets" / "fonts.css").read_text(encoding="utf-8")

    refs = re.findall(r"url\(([^)]+)\)", css)
    assert refs, "assets/fonts.css declares no font files"

    missing = []
    for ref in refs:
        ref = ref.strip("'\"")
        assert not ref.startswith("http"), (
            "assets/fonts.css must not load fonts over the network: " + ref
        )
        if not (MARKETING / "assets" / ref).is_file():
            missing.append(ref)

    assert missing == [], "declared but absent: " + repr(missing)


def test_the_font_licences_ship_with_the_fonts():
    """Both families are SIL Open Font License 1.1, which requires the licence
    to be distributed with the font. Redistributing without it is the one
    copyright problem this site can actually have."""
    licences = list((MARKETING / "assets" / "fonts").glob("OFL*.txt"))

    assert len(licences) >= 2, (
        "expected an OFL licence file per font family, found: "
        + repr([p.name for p in licences])
    )
    for licence in licences:
        text = licence.read_text(encoding="utf-8", errors="ignore")
        assert "SIL OPEN FONT LICENSE" in text.upper()
        assert "Copyright" in text


def test_no_analytics_or_tracking_on_the_marketing_site():
    markers = (
        "google-analytics", "googletagmanager", "gtag(", "dataLayer",
        "connect.facebook.net", "fbq(", "plausible", "posthog", "mixpanel",
        "amplitude", "hotjar", "clarity.ms", "segment.com",
    )
    found = []
    for path in list(MARKETING.glob("*.html")) + list(MARKETING.glob("*.js")) + list(MARKETING.glob("*.css")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for marker in markers:
            if marker in text:
                found.append(path.name + " -> " + marker)

    assert found == [], (
        "tracking found: " + repr(found) + " -- privacy.html and cookies.html "
        "both state there is none"
    )


# ---------- The waitlist form ----------

def test_the_waitlist_states_its_purpose_and_links_the_policy_at_the_point_of_collection():
    """A footer link is not enough: the notice has to be where the address is
    typed (PDPA s.23 / GDPR Art. 13)."""
    html = _strip_comments(_read("index.html"))

    consent = re.search(r'<p class="form-consent">(.*?)</p>', html, re.DOTALL)
    assert consent, "index.html has no .form-consent notice next to the waitlist field"

    body = consent.group(1)
    assert 'href="privacy.html"' in body, "the consent notice must link the privacy notice"
    assert "email" in body.lower(), "it must say what the address is used for"


def test_the_form_status_line_is_a_live_region():
    """app.js writes the success and failure text into this element. Without a
    live region a screen-reader user submits the form and is told nothing."""
    html = _read("index.html")

    note = re.search(r'<p class="form-note"[^>]*>', html)
    assert note, "the .form-note status element is gone"

    tag = note.group(0)
    assert 'aria-live="polite"' in tag or 'role="status"' in tag, (
        "the waitlist status line must be a live region: " + tag
    )


def test_the_email_field_is_described_by_the_status_line():
    """Ties the validation message to the input so it is announced as part of
    the field rather than stranded further down the page."""
    html = _read("index.html")

    field = re.search(r'<input[^>]*type="email"[^>]*>', html)
    assert field, "the waitlist email input is gone"

    assert "aria-describedby=" in field.group(0), field.group(0)


def test_the_email_field_still_has_a_label():
    html = _read("index.html")

    assert re.search(r'<label[^>]*for="email"', html), (
        "the email input needs a programmatic label, even a visually hidden one"
    )


# ---------- Focus visibility ----------

def test_focus_is_never_suppressed_without_a_replacement():
    """`outline: none` on a focusable element with nothing in its place is a
    WCAG 2.4.7 failure. It was on the waitlist input."""
    css = _strip_css_comments((MARKETING / "styles.css").read_text(encoding="utf-8"))

    offenders = []
    for match in re.finditer(r"([^{}]+)\{([^}]*)\}", css):
        selector, body = match.group(1).strip(), match.group(2)
        if re.search(r"outline\s*:\s*(none|0)\b", body):
            offenders.append(selector)

    assert offenders == [], (
        "these rules remove the focus indicator: " + repr(offenders) + "\n"
        "Outline suppression is banned outright on this site -- there is no "
        "mouse-only styling here worth losing the keyboard ring for. (The app "
        "side does allow `outline: none` on :focus paired with a separate "
        ":focus-visible ring; this static site has no need of that pattern, "
        "and the earlier wording of this message suggested a fix the "
        "assertion would still have rejected.)"
    )


def test_the_focus_visible_rules_actually_draw_something():
    """`":focus-visible" in css` was the first version of this, and an empty
    `:focus-visible {}` rule satisfies that -- so it would pass while keyboard
    users saw nothing.

    Assert the rules carry a real outline, and that every dark ground gets an
    overridden colour: the base ring is --ink, which measures about 1.4:1
    against --app-line, so on the phone screens it is invisible. The buttons
    in there (.stchip, .cta-blue) are generated by app.js and ARE keyboard
    reachable, which is how that got missed the first time.
    """
    css = _strip_css_comments((MARKETING / "styles.css").read_text(encoding="utf-8"))

    rules = [
        (sel.strip(), body)
        for sel, body in re.findall(r"([^{}]+)\{([^}]*)\}", css)
    ]

    # The GLOBAL rule specifically, not "some rule somewhere": the whole point
    # of it is that every keyboard-reachable element gets a ring without being
    # named. Checking any-rule-has-an-outline would pass with the global rule
    # emptied out, leaving everything except the waitlist field bare.
    global_rules = [
        body for sel, body in rules
        if ":focus-visible" in sel and ("[tabindex]" in sel or ":where(" in sel)
    ]
    assert global_rules, (
        "the catch-all :where(a, button, input, [tabindex]):focus-visible rule "
        "is gone -- without it only the elements named individually get a ring"
    )

    widths = [
        int(m) for body in global_rules
        for m in re.findall(r"outline:\s*(\d+)px", body)
    ]
    assert widths, "the catch-all :focus-visible rule sets no outline width"
    assert max(widths) >= 2, "the focus ring is thinner than 2px: " + repr(widths)

    for dark in (".nav-cta", ".btn-dark", ".phone-screen"):
        override = [
            sel for sel, body in rules
            if dark in sel and ":focus-visible" in sel and "outline-color" in body
        ]
        assert override, (
            dark + " is a dark surface with no :focus-visible outline-color "
            "override -- the --ink ring is about 1.4:1 there, i.e. invisible"
        )


# ---------- Honest claims ----------

def test_no_cta_promises_a_download_while_the_app_is_not_downloadable():
    """The hero button said "Download with Apple" and pointed at href="#".
    Advertising availability you do not have is a misleading commercial
    practice, and it was the most prominent control on the page.

    The rule enforced: any control whose text offers a download must point at
    a real store URL, not at a fragment.
    """
    html = _strip_comments(_read("index.html"))

    offenders = []
    for anchor in re.finditer(r'<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>', html, re.DOTALL):
        href, inner = anchor.group(1), anchor.group(2)
        text = re.sub(r"<[^>]+>", " ", inner)
        if re.search(r"\bdownload\b", text, re.I) and not href.startswith("https://apps.apple.com"):
            offenders.append((text.strip()[:60], href))

    assert offenders == [], (
        "these controls offer a download but do not link to the App Store: "
        + repr(offenders)
        + "\nEither link the real store listing or say what is actually true "
        "(see the 'Coming to the App Store' label)."
    )


# ---------- The food log demo quotes the real library ----------

_NL_FIELD = re.compile(r'(\w+): (?:"([^"]*)"|([\d.]+))')


def _food_log_rows():
    """The NL_FOODS table out of marketing/app.js, as dicts."""
    js = (MARKETING / "app.js").read_text(encoding="utf-8")
    block = re.search(r"var NL_FOODS = \[(.*?)\n    \];", js, re.DOTALL)
    assert block, "NL_FOODS is gone from marketing/app.js -- the food log demo moved"

    expected_keys = {"name", "calories", "protein", "fat", "carbs", "serving"}
    rows = []
    for line in re.findall(r"\{([^}]*)\}", block.group(1)):
        row = {}
        for key, text, number in _NL_FIELD.findall(line):
            row[key] = text if number == "" else float(number)
        rows.append(row)

    assert rows, "parsed no rows out of NL_FOODS -- the table's shape changed"

    # A field the regex can't parse (a negative number, a dropped key) is
    # simply missing from the row, and the comparison below would then die
    # with a bare KeyError instead of a message about the food log.
    malformed = {
        row.get("name", "<no name parsed>"): sorted(expected_keys - set(row))
        for row in rows if set(row) != expected_keys
    }
    assert not malformed, (
        "could not fully parse these NL_FOODS rows: " + repr(malformed)
    )
    return rows


def test_the_food_log_demo_quotes_the_real_library():
    """Feature 02 used to be a screen recording, guarded by
    test_marketing_demo_video.py. It is a working food log now, and its numbers
    are hand-copied constants in app.js -- a landing page quoting the wrong
    calories for jasmine rice is the same class of untrue claim as a stats band
    that says 527 exercises. Derive both from the app."""
    from food_library import FOOD_LIBRARY

    by_name = {food["name"]: food for food in FOOD_LIBRARY}
    wrong = {}

    for row in _food_log_rows():
        name = row["name"]
        real = by_name.get(name)
        if real is None:
            wrong[name] = "not in FOOD_LIBRARY at all"
            continue

        for key in ("calories", "protein", "fat", "carbs"):
            if abs(row[key] - real[key]) > 0.05:
                wrong[name + "." + key] = {"page": row[key], "library": real[key]}

        # "1 serving" is a dish's recipe total, or the 100g a raw ingredient's
        # macros are anchored to -- the rule openLogAmountModal() uses in
        # templates/nutrition.html.
        expected_serving = (
            sum(ing["grams"] for ing in real["ingredients"])
            if real.get("ingredients") else 100
        )
        if row["serving"] != expected_serving:
            wrong[name + ".serving"] = {"page": row["serving"], "real": expected_serving}

    assert wrong == {}, (
        "the food log demo disagrees with food_library.py: " + repr(wrong)
    )


def test_the_food_log_day_goal_matches_the_pill_beside_it():
    """The goal is a JS constant (NL_GOAL) and it is retyped as static markup
    in several places: the pill above the ring, the no-JS/initial macro
    targets in the food log card, and -- because the code comment claims it
    matches -- the weekly check-in screen next door (feature 03). Those never
    get overwritten by nlRenderDay(), so a NL_GOAL edit alone leaves them
    quietly wrong while every other test stays green."""
    js = (MARKETING / "app.js").read_text(encoding="utf-8")
    goal_match = re.search(
        r"var NL_GOAL = \{ kcal: (\d+), protein: (\d+), fat: (\d+), carbs: (\d+)", js
    )
    assert goal_match, "NL_GOAL is gone from marketing/app.js, or its shape changed"
    kcal, protein, fat, carbs = (int(g) for g in goal_match.groups())

    html = _strip_comments(_read("index.html"))

    def _int(pattern, label):
        m = re.search(pattern, html)
        assert m, label + " is gone from index.html"
        return int(m.group(1).replace(",", ""))

    wrong = {}
    checks = [
        (r'<span class="pill">([\d,]+) kcal goal</span>', "the food log's kcal goal pill", kcal),
        (r'<b id="nl-mac-p">0 / (\d+)g</b>', "the food log's protein target", protein),
        (r'<b id="nl-mac-f">0 / (\d+)g</b>', "the food log's fat target", fat),
        (r'<b id="nl-mac-c">0 / (\d+)g</b>', "the food log's carbs target", carbs),
        # The weekly check-in screen (feature 03) is a separate, static mock
        # -- app.js's own comment on NL_GOAL says it is meant to match.
        (r'<b class="big">([\d,]+) <em>kcal left</em></b>', "the check-in screen's kcal-left figure", kcal),
        (r'<span class="sub">of ([\d,]+) kcal today</span>', "the check-in screen's kcal-today figure", kcal),
    ]
    for pattern, label, expected in checks:
        actual = _int(pattern, label)
        if actual != expected:
            wrong[label] = {"page": actual, "NL_GOAL": expected}

    assert wrong == {}, (
        "the food log's goal drifted from one of its own static copies: " + repr(wrong)
    )


def test_the_food_log_sheets_stay_out_of_reach_while_closed():
    """A sheet merely translated off-screen still takes tab focus and still
    reads out to a screen reader: a keyboard user tabs into an invisible search
    field. visibility:hidden is what actually takes it out of both."""
    css = _strip_css_comments((MARKETING / "styles.css").read_text(encoding="utf-8"))

    closed = re.search(r"\.nl-sheet\s*\{([^}]*)\}", css)
    assert closed, "the .nl-sheet rule is gone"
    assert re.search(r"visibility:\s*hidden", closed.group(1)), (
        "closed food-log sheets are not visibility:hidden -- an off-screen "
        "sheet is still in the tab order and still in the accessibility tree"
    )

    opened = re.search(r"\.nl-sheet\.is-open\s*\{([^}]*)\}", css)
    assert opened and re.search(r"visibility:\s*visible", opened.group(1)), (
        "the open state does not restore visibility -- the sheet would never show"
    )


def test_the_food_log_inputs_do_not_trigger_ios_auto_zoom():
    """iOS Safari zooms the whole page when a focused input is under 16px,
    throwing the visitor out of the section mid-search. templates/nutrition.html
    carries the same rule for the same reason."""
    css = _strip_css_comments((MARKETING / "styles.css").read_text(encoding="utf-8"))

    # The selector list and the font-size must be on the SAME rule -- both
    # substrings present anywhere in the media block (the previous version of
    # this assertion) is satisfied by an unrelated 16px declaration a few
    # lines away, which does nothing to stop these two specific fields
    # from zooming.
    rule = re.search(r"\.nl-input,\s*#nl-amount\s*\{[^}]*\bfont-size:\s*(\d+)px", css)
    assert rule, (
        "no single rule sets .nl-input and #nl-amount's font-size together"
    )
    within_720 = any(
        rule.group(0) in body
        for body in re.findall(r"@media\s*\(max-width:\s*720px\)\s*\{(.*?)\n\}", css, re.DOTALL)
    )
    assert within_720 and int(rule.group(1)) >= 16, (
        "the food log's .nl-input/#nl-amount rule is not bumped to >=16px "
        "under a 720px breakpoint -- iOS Safari will auto-zoom the page when "
        "one of them is focused"
    )


def test_the_stats_band_matches_the_real_library_sizes():
    """The exercise count said 527 for months after the library passed it.
    Derive both numbers from the app rather than trusting the page."""
    from exercise_details import EXERCISE_DETAILS
    from food_library import FOOD_LIBRARY

    html = _strip_comments(_read("index.html"))

    stats = re.search(r'<section class="stats">(.*?)</section>', html, re.DOTALL)
    assert stats, "the stats band is gone"
    band = stats.group(1)

    # Pair each number with the label beside it. Bare membership ("is 735
    # somewhere in this band") passes even if the exercise and food figures
    # are swapped -- and a mislabelled count is exactly what this test exists
    # to stop.
    pairs = {
        label.strip().lower(): int(number.replace(",", ""))
        for number, label in re.findall(
            r"<b>([\d,]+)</b><span>([^<]+)</span>", band
        )
    }
    assert len(pairs) >= 3, (
        "could not parse number/label pairs out of the stats band: " + repr(pairs)
    )

    expected = {
        "exercises in the library": len(EXERCISE_DETAILS),
        "foods, thai included": len(FOOD_LIBRARY),
    }
    wrong = {
        label: {"claimed": pairs.get(label), "real": want}
        for label, want in expected.items()
        if pairs.get(label) != want
    }

    assert wrong == {}, (
        "the stats band disagrees with the app: " + repr(wrong)
    )


def test_no_invented_scarcity():
    """"Limited early-access slots" with no actual limit anywhere in the site
    or the app is manufactured urgency -- a listed unfair practice in the EU
    (UCPD Annex I) and misleading under the Thai CPA."""
    html = _strip_comments(_read("index.html")).lower()

    for phrase in ("limited early-access slots", "only a few spots", "spots left", "hurry"):
        assert phrase not in html, (
            "invented scarcity on the page: " + repr(phrase) + " -- there is no "
            "cap on the waitlist in any code here"
        )


def test_no_reviews_or_testimonials_are_fabricated():
    """There are none today, which is the correct state for a pre-launch site
    with no users. This test exists so that adding one is a deliberate act
    rather than a slip -- a fabricated review is a straightforward consumer
    protection offence in both Thailand and the EU."""
    html = _strip_comments(_read("index.html")).lower()

    for marker in ("testimonial", "★★", "trusted by", "as seen in", "rated 5", "5-star", "reviews say"):
        assert marker not in html, (
            "review/testimonial markup found (" + repr(marker) + "). If these "
            "are real, attributed and verifiable, update this test "
            "deliberately. If they are illustrative, do not ship them."
        )


def test_no_invented_figure_from_the_mockups_is_repeated_in_the_page_copy():
    """This replaces a test that required the words "Example data, for
    illustration" on the page. That line was removed at the owner's
    instruction, and the reason it existed does not go away with it: the
    handset shows an invented form score, an invented race time and invented
    friend rep-counts, and an unlabelled screenshot of "results" is the shape
    of thing that can read as a performance claim.

    What keeps it from being one is that those numbers never leave the
    mockup. The page's own prose says what the app DOES -- scores a set,
    counts reps, tracks a race -- and never what it got anybody. A number
    inside a drawing of a phone screen is interface. The same number in a
    sentence is a claim, and that is the line this test holds.

    So: strip the handsets out, and assert none of their figures survive in
    what is left."""
    html = _strip_comments(_read("index.html"))

    # Everything inside .phone-stage is the mockup -- the handsets, the watch
    # and every screen in them. Cut it out by counting <div> depth rather than
    # with a regex: the stage is nested a dozen levels deep, and a lazy
    # .*?</div> stops at the FIRST close tag, which left the whole mockup in
    # and failed this test on its own markup.
    start = html.find('<div class="phone-stage">')
    assert start != -1, "the handset markup moved -- this test no longer cuts it out"
    depth, i = 0, start
    while i < len(html):
        if html.startswith("<div", i):
            depth += 1
            i += 4
        elif html.startswith("</div>", i):
            depth -= 1
            i += 6
            if depth == 0:
                break
        else:
            i += 1
    prose = re.sub(r"<[^>]+>", " ", html[:start] + " " + html[i:])

    # The figures a reader could mistake for an outcome someone achieved.
    claims = ["1:24:06", "132 reps", "148 reps", "96 reps", "9 reps counted"]
    found = [c for c in claims if c.lower() in prose.lower()]

    assert found == [], (
        "these invented figures have escaped the phone mockup into the page's "
        "own copy: " + repr(found) + "\n"
        "Inside a drawing of a screen they are interface. In a sentence they "
        "are a claim about what the app got somebody, and this page carries "
        "no such claim -- it used to carry an 'Example data, for "
        "illustration' line and no longer does. Either take the figure back "
        "out of the prose, or put that line back."
    )


def test_the_site_still_carries_the_not_medical_advice_line():
    for name in PAGES:
        html = _strip_comments(_read(name)).lower()
        assert "not medical advice" in html, name


# ---------- The fonts are actually LOADED, not just present ----------

@pytest.mark.parametrize("name", PAGES)
def test_every_page_loads_the_self_hosted_font_stylesheet(name):
    """An absence test is only half the guard, and the weaker half.

    test_no_page_loads_anything_from_another_company passes just as happily if
    a page loads NO font stylesheet at all -- at which point the woff2 and the
    OFL licences ship for nothing and the site silently renders in system
    fallbacks. Pin the presence too.
    """
    html = _strip_comments(_read(name))

    assert 'href="assets/fonts.css"' in html, (
        "marketing/" + name + " no longer loads assets/fonts.css, so Archivo "
        "and JetBrains Mono fall back to system fonts"
    )


def test_no_marketing_font_file_is_shipped_twice():
    """Archivo and JetBrains Mono are variable fonts. Asking Google's css2 API
    for individual weights returns the SAME file per weight -- which is how the
    app side accidentally committed 22 woff2 that were 5 unique blobs. This
    sheet uses the range syntax; keep it that way.
    """
    import hashlib

    digests = {}
    for path in sorted((MARKETING / "assets" / "fonts").glob("*.woff2")):
        digests.setdefault(hashlib.md5(path.read_bytes()).hexdigest(), []).append(path.name)

    duplicates = {d: names for d, names in digests.items() if len(names) > 1}

    assert duplicates == {}, (
        "identical font files under different names: "
        + repr(list(duplicates.values()))
        + " -- request one face per subset with a wght RANGE, not one per weight"
    )


def test_the_script_and_font_sheet_contact_nobody_either():
    """app.js is the one file here that makes a network request, and
    assets/fonts.css is the one that pulls binaries -- so they are the two
    most likely places for a third-party host to reappear. Neither was
    covered when this suite only walked the HTML pages and styles.css.
    """
    for relative in ("app.js", "assets/fonts.css"):
        text = (MARKETING / relative).read_text(encoding="utf-8")
        stripped = _strip_css_comments(re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE))
        offsite = _offsite_urls(stripped)

        assert offsite == [], (
            "marketing/" + relative + " references off-site URLs: " + repr(offsite)
        )


# ---------- The form processor named in the notice is the real one ----------

def test_the_privacy_notice_names_the_processor_the_form_actually_posts_to():
    """privacy.html states, in capitals in its own header comment, that this
    has to stay in step: "IF YOU CHANGE THE FORM PROVIDER, CHANGE THIS PAGE."
    marketing/README.md repeats it. Neither is enforcement.

    The notice tells the visitor which company receives their email address
    and which country it goes to. Swapping ENDPOINT for a different provider
    while the page still names Formspree makes that a false statement about
    an international transfer of personal data.
    """
    js = (MARKETING / "app.js").read_text(encoding="utf-8")

    endpoint = re.search(r'ENDPOINT\s*=\s*["\']([^"\']+)', js)
    assert endpoint, "could not find the ENDPOINT constant in marketing/app.js"

    host = re.match(r"https?://([^/]+)", endpoint.group(1))
    assert host, "ENDPOINT is not an absolute URL: " + endpoint.group(1)
    host = host.group(1).lower()

    # host -> the name that must appear in the privacy notice
    KNOWN = {"formspree.io": "Formspree"}

    assert host in KNOWN, (
        "the waitlist now posts to " + host + ", which this test does not know. "
        "Add it here AND update the 'Who else sees it' section of "
        "marketing/privacy.html with the new processor's name and country."
    )

    notice = _read("privacy.html")
    assert KNOWN[host] in notice, (
        "marketing/privacy.html does not name " + KNOWN[host] + ", but the form "
        "posts to " + host
    )


# ---------- The marketing palette clears AA too ----------

def _relative_luminance(hex_colour):
    hex_colour = hex_colour.lstrip("#")
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [
        c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        for c in channels
    ]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _contrast(a, b):
    la, lb = _relative_luminance(a), _relative_luminance(b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


@pytest.fixture(scope="module")
def marketing_palette():
    css = _strip_css_comments((MARKETING / "styles.css").read_text(encoding="utf-8"))
    root = re.search(r":root\s*\{(.*?)\}", css, re.DOTALL)
    assert root, "could not find the :root palette in marketing/styles.css"
    return dict(re.findall(r"(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;", root.group(1)))


# Every token used for TEXT on the white page. --meta was #767676 (4.54:1, a
# hair over the line at 11px uppercase) and the success green was the app's
# --green at 3.01:1, an outright AA failure on the one message a visitor reads
# after submitting the form. Both were fixed by hand in this pass; nothing
# stopped the next person putting them back.
@pytest.mark.parametrize("token", ["--ink", "--ink-body", "--muted", "--meta", "--green-on-paper", "--red-on-paper"])
def test_every_text_token_clears_wcag_aa_on_the_page_background(token, marketing_palette):
    palette = marketing_palette

    assert token in palette, token + " is gone from the :root palette"

    ratio = _contrast(palette[token], palette["--paper"])

    assert ratio >= 4.5, (
        token + " (" + palette[token] + ") is only " + format(ratio, ".2f")
        + ":1 on --paper (" + palette["--paper"] + "), under the 4.5:1 AA floor "
        "for body text. Darken it; do not widen this test."
    )
