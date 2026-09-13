"""Guards for marketing/v2.html, the loud-typography redesign preview.

v2 is a SECOND page on the same static deploy, not a replacement (yet), so it
is deliberately outside test_marketing_site_compliance.py's PAGES list. It
still shares that deploy's legal posture and its one genuinely dangerous new
component, so those two things are pinned here:

* THE LOADING SCREEN MUST NOT NEED JAVASCRIPT TO LEAVE. A full-bleed overlay
  that is only ever dismissed by a script is a blank blue rectangle for
  anyone whose JS is blocked, fails, or 404s -- the whole page, gone, with no
  error. The dismissal therefore lives in CSS (an animation that ends at
  visibility:hidden), and v2.js only makes it leave sooner. Verified live in
  a browser with the script removed: visible at t=0, hidden at t=3s.

* ZERO THIRD-PARTY REQUESTS, same as every other page here. cookies.html
  tells visitors the site contacts no other company and uses that to justify
  having no consent banner. That claim is one <link href="fonts.googleapis">
  away from being false, and it does not stop being false because the
  offending page is a preview.

Source-level regex assertions against the real files, the tradeoff CLAUDE.md
describes for this directory. Each one was mutation-checked when written.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MARKETING = ROOT / "marketing"


def _read(name):
    return (MARKETING / name).read_text(encoding="utf-8")


def _strip_html_comments(html):
    return re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)


def _strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)


@pytest.fixture(scope="module")
def html():
    return _strip_html_comments(_read("v2.html"))


@pytest.fixture(scope="module")
def css():
    return _strip_css_comments((MARKETING / "v2.css").read_text(encoding="utf-8"))


def test_the_preview_page_exists():
    """Guard the guard: every assertion below reads these files, so a rename
    would make the whole module vacuously pass if it only used .exists()."""
    for name in ("v2.html", "v2.css", "v2.js"):
        assert (MARKETING / name).is_file(), name + " is gone"


def test_the_loading_screen_leaves_without_javascript(css):
    """The one thing that can take the entire page down for a real visitor."""
    rule = re.search(r"\.loader\s*\{([^}]*)\}", css)
    assert rule, "the .loader rule is gone"

    animation = re.search(r"animation:\s*([^;]+);", rule.group(1))
    assert animation, (
        "the .loader rule has no animation -- the overlay's ONLY dismissal is "
        "now whatever v2.js does, so a blocked or broken script leaves a "
        "visitor staring at a blank blue screen with no way past it"
    )
    shorthand = animation.group(1)
    assert "loader-out" in shorthand, (
        "the .loader animation no longer runs loader-out: " + shorthand
    )
    assert "forwards" in shorthand, (
        "the .loader animation does not hold its end state (`forwards`), so "
        "the overlay springs back into view when it finishes: " + shorthand
    )

    keyframes = re.search(r"@keyframes\s+loader-out\s*\{(.*?)\n\}", css, re.DOTALL)
    assert keyframes, "the loader-out keyframes are gone"
    assert re.search(r"visibility:\s*hidden", keyframes.group(1)), (
        "loader-out fades the overlay but never takes it out of the "
        "accessibility tree or the tab order -- opacity:0 alone leaves every "
        "control inside it still focusable over the top of the page"
    )
    assert re.search(r"pointer-events:\s*none", keyframes.group(1)), (
        "loader-out leaves the overlay swallowing clicks after it fades"
    )


def test_reduced_motion_still_lets_the_loading_screen_leave(css):
    """The reduced-motion block switches animations off wholesale, which is
    exactly how you accidentally disable the one animation that is load
    bearing rather than decorative."""
    block = re.search(
        r"@media\s*\(prefers-reduced-motion: reduce\)\s*\{(.*?)\n\}", css, re.DOTALL
    )
    assert block, "the prefers-reduced-motion block is gone"

    loader_rule = re.search(r"\.loader\s*\{([^}]*)\}", block.group(1))
    assert loader_rule, (
        "prefers-reduced-motion no longer re-states .loader's animation. If it "
        "falls under a blanket `animation: none`, the overlay never leaves for "
        "anyone who asked for less motion -- the accessibility setting would "
        "black out the site for exactly the people it is meant to help"
    )
    assert "loader-out" in loader_rule.group(1), (
        "the reduced-motion .loader rule does not run loader-out: "
        + loader_rule.group(1)
    )
    assert "forwards" in loader_rule.group(1), (
        "the reduced-motion .loader animation does not hold its end state"
    )


def test_javascript_only_accelerates_the_loading_screen():
    """v2.js may end the hold early; it must not become the only thing that
    ends it (which is what happens when someone 'simplifies' the CSS away)."""
    js = (MARKETING / "v2.js").read_text(encoding="utf-8")
    assert "is-done" in js, (
        "v2.js no longer dismisses the loader early -- every visitor now waits "
        "out the full CSS hold even on a cached reload"
    )
    assert not re.search(r"\.loader\b[^\n]*\bremove\(\)", js), (
        "v2.js removes the loader element outright. That works, but it makes "
        "the CSS fallback untestable in the browser and the no-JS path silently "
        "unexercised; prefer toggling the class the stylesheet already owns."
    )


def test_the_preview_loads_nothing_from_another_company(html, css):
    """Same rule the other four pages are held to, for the same reason: this
    page ships on the deploy whose cookie policy claims no third-party
    contact and therefore carries no consent banner."""
    offenders = []
    for url in re.findall(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', html):
        if url.startswith(("http://", "https://", "//")) and "mailto:" not in url:
            offenders.append(url)
    for url in re.findall(r"url\(\s*['\"]?([^'\")]+)", css):
        if url.startswith(("http://", "https://", "//")):
            offenders.append(url)

    assert offenders == [], (
        "v2 loads remote resources: " + repr(offenders) + "\nEvery font and "
        "asset on this site is served first-party on purpose -- see "
        "marketing/assets/fonts.css for why."
    )


def test_the_preview_does_not_suppress_focus_rings(css):
    """`outline: none` is banned outright on this site, paired replacement or
    not -- the same assertion test_marketing_site_compliance.py makes about
    styles.css, applied to the stylesheet that would replace it."""
    offenders = [
        selector.strip()
        for selector, body in re.findall(r"([^{}]+)\{([^}]*)\}", css)
        if re.search(r"outline\s*:\s*(none|0)\b", body)
    ]
    assert offenders == [], (
        "these v2 rules remove the focus indicator: " + repr(offenders)
    )


def test_the_preview_keeps_the_sites_standing_claims(html):
    """The redesign is a visual pass. It does not get to drop the lines that
    are there for legal reasons."""
    lowered = html.lower()

    assert "not medical advice" in lowered, (
        "the training-guidance disclaimer is gone from v2"
    )
    for page in ("privacy.html", "cookies.html", "terms.html"):
        assert page in lowered, "v2's footer no longer links " + page
    assert "phuttimate benchanakatkul" in lowered, (
        "v2 no longer identifies who operates the site"
    )
    assert "example data" in lowered, (
        "v2's mocked-up cards show invented numbers and need to say so"
    )
    assert "not on the app store yet" in lowered, (
        "v2 dropped the availability line, so its waitlist CTA now reads as a "
        "download promise for an app that is not downloadable"
    )


def test_the_preview_is_not_indexed_while_it_is_a_preview(html):
    """Two pages serving near-identical copy on one domain is a duplicate
    content problem, and the preview is the one that should lose."""
    assert re.search(r'<meta\s+name="robots"\s+content="[^"]*noindex', html), (
        "v2.html has no noindex -- it will compete with index.html in search "
        "results while it is still a draft"
    )
