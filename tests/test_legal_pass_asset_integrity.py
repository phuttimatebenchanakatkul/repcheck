"""The self-hosting and focus-visibility changes, pinned from the other side.

tests/test_legal_policy_integrity.py proves the Google Fonts hosts are GONE:
no template names them, and the CSP no longer allowlists them. That is a test
of an absence, and an absence is exactly what a vacuous test looks like. Three
things it cannot see:

1. FONTS ACTUALLY LOADED. Delete the `<link ... fonts.css>` line from
   base.html and every google-fonts assertion still passes -- while the app
   silently renders in Arial, and Thai renders in Arial for EVERYTHING,
   because style.css's :root[data-lang="th"] stack is Noto Sans Thai alone
   with no Inter behind it. Nothing else in the suite notices. So this file
   asserts the presence, not just the absence.

2. THE OTHER HOSTS. style-src is now `'self' 'unsafe-inline'` and font-src
   `'self' data:` -- so ANY remote stylesheet or webfont, not just Google's,
   is now blocked by the browser. A <link> to a different CDN would fail
   silently at runtime and pass every existing test, because they only look
   for two specific hostnames.

3. THE FOCUS RING AND ITS COLOUR. The pass added --link (because --blue is
   3.39:1 on the dark card, an AA failure on the consent notice the user is
   being asked to agree to) and two :focus-visible rules that use it. Both
   halves can be reverted independently and neither is currently guarded on
   the app side -- test_marketing_site_compliance.py has the focus tests, but
   only for marketing/styles.css.

Source-level regex assertions against the real files, per CLAUDE.md. Every one
was mutation-checked when written.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# The four templates with a <head> of their own; every other template extends
# base.html, so these are the complete set of font-loading surfaces.
HEAD_TEMPLATES = ("base.html", "login.html", "signup.html", "onboarding.html")


def _strip_html_comments(text):
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def _strip_css_comments(text):
    return re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)


# ---------- 1. The self-hosted stylesheet is actually loaded ----------

def test_every_head_template_loads_the_self_hosted_font_stylesheet():
    """The counterpart to test_no_template_loads_a_google_fonts_stylesheet.

    That test passes if a template loads NO fonts at all, which is the likely
    shape of the regression: someone tidying a <head> drops the line. The
    failure is invisible in English (Inter falls back to a system sans that
    looks close) and total in Thai.
    """
    missing = []
    for name in HEAD_TEMPLATES:
        html = _strip_html_comments((ROOT / "templates" / name).read_text(encoding="utf-8"))
        if not re.search(r"""<link[^>]+href=["']?\{\{\s*asset_url\(\s*['"]fonts\.css['"]\s*\)""", html):
            missing.append(name)

    assert missing == [], (
        "these templates no longer load static/fonts.css: " + repr(missing) + "\n"
        "Nothing else fails when this line goes: the app just renders in the "
        "fallback, and Thai loses its ONLY font (style.css's "
        ':root[data-lang="th"] stack is Noto Sans Thai with no Inter behind '
        "it). Put the <link> back rather than re-adding the Google one."
    )


# (That the file it references exists, and that every face inside it resolves,
# is already covered by test_legal_policy_integrity.py's
# test_the_self_hosted_faces_all_exist.)


# ---------- 2. Nothing remote is loaded any more, from any host ----------

def test_no_head_template_loads_a_stylesheet_from_any_remote_host():
    """style-src is now `'self' 'unsafe-inline'` with no host allowlisted, so
    a remote stylesheet is no longer merely a privacy problem -- the browser
    refuses it and the page renders unstyled. The existing test only knows
    about fonts.googleapis.com.
    """
    offenders = []
    for name in HEAD_TEMPLATES:
        html = _strip_html_comments((ROOT / "templates" / name).read_text(encoding="utf-8"))
        for link in re.finditer(r"<link\b[^>]*>", html):
            tag = link.group(0)
            if "stylesheet" not in tag and "preconnect" not in tag:
                continue
            href = re.search(r'href=["\']([^"\']+)["\']', tag)
            if href and re.match(r"(https?:)?//", href.group(1)):
                offenders.append(name + " -> " + href.group(1))

    assert offenders == [], (
        "remote stylesheet/preconnect found: " + repr(offenders) + "\n"
        "The CSP allowlists no style or font host at all now, so this is "
        "blocked at runtime rather than degraded -- and /cookies tells the "
        "reader the app contacts no third party for assets. Self-host it."
    )


def test_no_app_stylesheet_pulls_a_remote_resource():
    """Same rule one level down: an @import or a url() in our own CSS reaches
    the network just as a <link> does, and font-src is `'self' data:`."""
    offenders = []
    for css_path in sorted((ROOT / "static").glob("*.css")):
        css = _strip_css_comments(css_path.read_text(encoding="utf-8", errors="ignore"))
        for ref in re.findall(r"url\(\s*['\"]?([^'\")]+)", css):
            if re.match(r"(https?:)?//", ref.strip()):
                offenders.append(css_path.name + " -> url(" + ref.strip() + ")")
        for ref in re.findall(r"@import\s+(?:url\()?\s*['\"]([^'\"]+)", css):
            if re.match(r"(https?:)?//", ref.strip()):
                offenders.append(css_path.name + " -> @import " + ref.strip())

    assert offenders == [], "remote resources in static CSS: " + repr(offenders)


def test_the_csp_allowlists_no_style_or_font_host_whatsoever():
    """Stronger than "not Google's two hosts": the directives must carry only
    keyword sources. That is what makes the two tests above enforceable by the
    browser and not just by this suite.
    """
    import app as app_module

    directives = {}
    for part in app_module.CSP.split(";"):
        part = part.strip()
        if not part:
            continue
        name, _, value = part.partition(" ")
        directives[name] = value.split()

    for name in ("style-src", "font-src"):
        hosts = [
            source for source in directives.get(name, [])
            if not source.startswith("'") and source != "data:"
        ]
        assert hosts == [], (
            name + " allowlists these hosts: " + repr(hosts) + "\n"
            "The fonts are first-party now (static/fonts.css). Leaving a host "
            "in here lets a stray <link> silently reintroduce the third-party "
            "request /cookies says does not happen."
        )


# ---------- 3. The keyboard focus ring, and the colour it is drawn in ----------

def _root_vars(css, selector):
    """Merge every block with exactly this selector, later wins.

    style.css declares :root twice (the second time for the analyze page's
    paper palette), so a single-match parse would read the wrong block.
    """
    out = {}
    pattern = re.escape(selector) + r"\s*\{(.*?)\}"
    for block in re.findall(pattern, css, re.DOTALL):
        for name, value in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block):
            out[name] = value.strip()
    return out


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
def palettes():
    css = _strip_css_comments((ROOT / "static" / "style.css").read_text(encoding="utf-8"))
    light = _root_vars(css, ":root")
    dark = dict(light)
    dark.update(_root_vars(css, ':root[data-theme="dark"]'))
    return {"light": light, "dark": dark}


# --link needs a value on :root AND an override in the dark block: without the
# override the dark theme silently inherits the light #2f66e8, which is the
# 3.39:1 failure the token exists to fix. That case does not need its own test
# -- it IS the dark case below, since the merged dark palette then reads the
# light value and comes out at 3.39:1.


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_link_text_clears_wcag_aa_on_the_surfaces_it_sits_on(theme, palettes):
    """--link is the colour of the Terms/Privacy consent notice, the log
    in/sign up switch, and the focus rings. 4.5:1 is the AA floor for body
    text; both --card-bg (the auth card, settings cards) and --bg (the page
    itself) are surfaces it renders on.
    """
    palette = palettes[theme]
    link = palette["--link"]

    for surface in ("--card-bg", "--bg"):
        ratio = _contrast(link, palette[surface])
        assert ratio >= 4.5, (
            theme + " theme: --link (" + link + ") is only "
            + format(ratio, ".2f") + ":1 on " + surface + " ("
            + palette[surface] + "), under the 4.5:1 AA floor. This token "
            "exists precisely because --blue measured 3.39:1 here -- do not "
            "point it back at --blue."
        )


@pytest.mark.parametrize("stylesheet,selector", [
    ("auth.css", ".auth-field input:focus-visible"),
    ("style.css", ".ag-inputrow input:focus-visible"),
])
def test_the_inputs_that_suppress_their_outline_light_up_on_keyboard_focus(stylesheet, selector):
    """Both of these inputs carry `outline: none` for mouse focus. Without the
    :focus-visible rule beside it, tabbing into the field changes nothing
    visible at all (WCAG 2.4.7) -- which is how they both shipped.
    """
    css = _strip_css_comments((ROOT / "static" / stylesheet).read_text(encoding="utf-8"))

    rule = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert rule, (
        stylesheet + " has no `" + selector + "` rule. This input sets "
        "`outline: none` on :focus, so removing the :focus-visible rule "
        "leaves keyboard users with no focus indicator whatsoever."
    )

    body = rule.group(1)
    assert re.search(r"outline\s*:\s*\d", body), (
        selector + " must draw a real outline, not just exist: " + repr(body)
    )
    assert "var(--link)" in body, (
        selector + " should use --link -- var(--blue) is 3.39:1 on the dark "
        "card, under the 3:1 floor a non-text indicator needs"
    )
