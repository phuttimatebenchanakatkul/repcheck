"""Versioned /static URLs must be keepable; unversioned ones must revalidate.

asset_url() stamps every stylesheet and script with ?v=<file mtime>, which
makes the URL content-addressed: edit the file, the URL changes. Flask still
served /static with `Cache-Control: no-cache` though, so the device had to ask
the server before reusing any of them -- a network round trip per asset, on
every single page load.

base.html references 13 such assets, eight of them render-blocking <script>s
in <head> (i18n.js is 145 KB, style.css 92 KB), and page templates add more.
So tapping a tab meant: fetch the page, then ~13 conditional requests, and
only then a first paint -- with the whole screen blank until the last one
answered, bottom tab bar included, because the bar is part of the document
being loaded. That is what "it refreshes when I switch tabs" was: not a
missing animation, a first paint waiting on a dozen round trips.

/lib/<name>.js already takes exactly this deal and says why: "safe to cache
immutably: the ?v= hash above changes whenever the content does, so a stale
copy can never be served under a live URL". These tests pin that the same
deal now applies to versioned /static URLs, that unversioned ones are left
alone, and -- the invariant this is easiest to break -- that HTML itself is
NOT swept up in it. The moment a rendered page can be reused without asking
the server, the stale-deploy bug of v0.4.9.2 is back, and immutably so.
"""

import re

from app import app as flask_app


def _client():
    flask_app.config["TESTING"] = True
    return flask_app.test_client()


def test_versioned_assets_are_cached_immutably():
    client = _client()
    response = client.get("/static/style.css?v=1234567890")
    assert response.status_code == 200
    cache_control = response.headers.get("Cache-Control", "")
    assert "immutable" in cache_control and "max-age=31536000" in cache_control, (
        "A /static URL carrying ?v= must be cacheable for a year. The version "
        "is the file's mtime, so the URL changes whenever the content does -- "
        "keeping it is safe, and NOT keeping it costs a network round trip per "
        "asset on every page load, which is the whole reason switching tabs "
        f"went blank before painting. Got: {cache_control!r}"
    )
    assert "no-cache" not in cache_control, (
        "no-cache would put the round trip straight back."
    )


def test_unversioned_static_still_revalidates():
    client = _client()
    response = client.get("/static/style.css")
    cache_control = response.headers.get("Cache-Control", "")
    assert "immutable" not in cache_control, (
        "Only URLs that carry ?v= may be cached immutably. Without a version "
        "the URL does not change when the file does, so caching it for a year "
        "would pin a device to that copy with no way to correct it. Images "
        "referenced from CSS, the favicon and hand-typed URLs all arrive here. "
        f"Got: {cache_control!r}"
    )
    assert response.headers.get("ETag"), (
        "Unversioned assets must keep the ETag that lets them 304."
    )


def test_html_is_never_cached_immutably_even_with_a_version_string():
    """?v= on a page URL must not make the PAGE keepable.

    The rule keys off the static endpoint, not the query string, and this is
    the assertion that keeps it that way. A rendered page that a device may
    reuse without asking is precisely the v0.4.9.2 bug -- the app showing a
    screen from before the deploy -- except cached for a year.
    """
    client = _client()
    response = client.get("/login?v=1234567890")
    assert response.status_code == 200
    cache_control = response.headers.get("Cache-Control", "")
    assert "immutable" not in cache_control, (
        f"/login must not be immutable. Got: {cache_control!r}"
    )
    max_age = re.search(r"max-age=(\d+)", cache_control)
    assert "no-cache" in cache_control or (max_age and int(max_age.group(1)) <= 10), (
        "HTML must keep its own short freshness rule, version string in the "
        "URL or not -- see tests/test_html_revalidates_for_the_ios_webview.py "
        f"for what that rule is and why. Got: {cache_control!r}"
    )
